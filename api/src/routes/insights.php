<?php
declare(strict_types=1);

namespace Loft;

// M8 resources: Insights (last seen, attendance, homework on time, fees, at risk) and nudges
// (automatic rules run by the first request of the day; custom nudges delivered when due, no cron).
// PHP twin of packages/data/src/local/routes-insights.ts. On the server the "email" channel really sends.

function ins_or(string $a, string $b): string
{
    return $a !== '' ? $a : $b;
}

/** JS `Number(v)` for a query/body value; null stands for NaN. */
function ins_number(mixed $v): int|float|null
{
    if (is_int($v) || is_float($v)) return $v;
    if (is_bool($v)) return (int) $v;
    if (is_string($v)) {
        $t = trim($v);
        return $t === '' ? 0 : (is_numeric($t) ? $t + 0 : null);
    }
    return null;
}

function ins_nudge_settings(Ctx $ctx, string $hostId): array
{
    $s = $ctx->db->get('nudge_settings', $hostId);
    if ($s) {
        $s['rules'] = (array) ($s['rules'] ?? []);
        $s['sent'] = (array) ($s['sent'] ?? []);
        $s['lastDaily'] = (string) ($s['lastDaily'] ?? '');
        return $s;
    }
    $rules = [];
    foreach (NUDGE_RULES as $r) $rules[$r['id']] = $r['on'];
    return ['id' => $hostId, 'rules' => $rules, 'sent' => [], 'lastDaily' => ''];
}

function ins_save_settings(Ctx $ctx, array $s): void
{
    $ctx->db->put('nudge_settings', array_merge($s, ['rules' => obj($s['rules']), 'sent' => obj($s['sent'])]));
}

/** Count a visit: last seen on every request (throttled), last login when a visit starts after 30 min away. */
function touch_seen(Ctx $ctx): void
{
    if (!$ctx->meId) return;
    $u = $ctx->db->get('users', $ctx->meId);
    if (!$u) return;
    $t = $ctx->now();
    $last = !empty($u['lastSeenAt']) ? ms((string) $u['lastSeenAt']) : 0;
    if ($t - $last < 5 * 60000) return;
    $patch = ['lastSeenAt' => iso($t)];
    if ($t - $last > 30 * 60000) $patch['lastLoginAt'] = iso($t);
    $ctx->db->patch('users', $ctx->meId, $patch);
}

function ins_hosted_spaces(Ctx $ctx, string $hostId): array
{
    $ids = array_flip(array_map(fn ($m) => (string) $m['spaceId'], $ctx->db->list('memberships', fn ($m) => ($m['userId'] ?? null) === $hostId && (($m['role'] ?? '') === 'host' || ($m['role'] ?? '') === 'cohost'))));
    return $ctx->db->list('spaces', fn ($s) => isset($ids[(string) $s['id']]));
}

/** Everything Insights needs for each member of the host's spaces in a window. */
function ins_people(Ctx $ctx, string $hostId, ?string $spaceId, int $from, int $to): array
{
    // Insights are about learners and clients: team spaces (colleagues) are left out.
    $spaces = array_values(array_filter(ins_hosted_spaces($ctx, $hostId), fn ($s) => ($s['mode'] ?? '') !== 'team' && ($spaceId === null || $s['id'] === $spaceId)));
    $ids = array_flip(array_map(fn ($s) => (string) $s['id'], $spaces));
    $inWin = fn ($iso) => is_string($iso) && ms($iso) >= $from && ms($iso) <= $to;
    $members = $ctx->db->list('memberships', fn ($m) => isset($ids[(string) ($m['spaceId'] ?? '')]) && (($m['role'] ?? '') === 'member' || ($m['role'] ?? '') === 'payer'));
    $users = index_by($ctx->db->list('users'), fn ($u) => $u['id']);
    $logs = $ctx->db->list('session_log', fn ($r) => isset($ids[(string) ($r['spaceId'] ?? '')]) && $inWin($r['at'] ?? null));
    $tasks = $ctx->db->list('posts', fn ($p) => isset($ids[(string) ($p['spaceId'] ?? '')]) && ($p['kind'] ?? '') === 'task' && !empty($p['dueAt']) && $inWin($p['dueAt']));
    $checks = $ctx->db->list('checks', fn ($c) => isset($ids[(string) ($c['spaceId'] ?? '')]) && ($c['status'] ?? '') !== 'draft' && !empty($c['closeAt']) && $inWin($c['closeAt']));
    $subs = $ctx->db->list('submissions');
    $attempts = $ctx->db->list('check_attempts', fn ($a) => !empty($a['submittedAt']));
    $open = $ctx->db->list('attendance_events', fn ($e) => empty($e['leftAt']) && ms(isset($e['joinedAt']) ? (string) $e['joinedAt'] : null) > $to - 12 * 3600000);
    $invoices = $ctx->db->list('invoices', fn ($i) => ($i['hostId'] ?? null) === $hostId && ($i['status'] ?? '') === 'sent');
    $byUser = [];
    foreach ($members as $m) $byUser[(string) $m['userId']][] = $m;
    $out = [];
    foreach ($byUser as $userId => $ms) {
        $userId = (string) $userId;
        $user = $users[$userId] ?? null;
        if (!$user || !empty($user['guest'])) continue;
        $mine = array_map(fn ($m) => $m['spaceId'], $ms);
        $mySpaces = array_values(array_filter($spaces, fn ($s) => in_array($s['id'], $mine, true)));
        $sp = array_map(fn ($s) => $s['id'], $mySpaces);
        $payerId = null;
        foreach ($mySpaces as $s) {
            $pid = ((array) (billing_for($s)['payers'] ?? []))[$userId] ?? null;
            if ($pid) {
                $payerId = (string) $pid;
                break;
            }
        }
        $theirs = array_values(array_filter($invoices, fn ($i) => !empty($i['payerId']) && ($i['payerId'] === $userId || $i['payerId'] === $payerId || in_array($userId, $i['memberIds'] ?? [], true))));
        usort($theirs, fn ($a, $b) => strcmp((string) ($b['sentAt'] ?? ''), (string) ($a['sentAt'] ?? '')));
        $latest = $theirs[0] ?? null;
        $status = $latest ? invoice_status($latest, $to) : null;
        $fee = some($theirs, fn ($i) => is_overdue($i, $to)) ? 'overdue' : (!$status ? 'none' : ($status === 'claimed' ? 'claimed' : ($status === 'paid' ? 'paid' : 'sent')));
        $myLogs = array_values(array_filter($logs, fn ($r) => ($r['memberId'] ?? null) === $userId));
        usort($myLogs, fn ($a, $b) => strcmp((string) $b['at'], (string) $a['at']));
        $work = [];
        foreach ($tasks as $t) {
            if (!in_array($t['spaceId'], $sp, true)) continue;
            $sub = find($subs, fn ($s) => ($s['postId'] ?? null) === $t['id'] && ($s['userId'] ?? null) === $userId);
            $work[] = ['dueAt' => $t['dueAt'], 'doneAt' => $sub['at'] ?? null];
        }
        foreach ($checks as $c) {
            if (!in_array($c['spaceId'], $sp, true)) continue;
            $at = find($attempts, fn ($a) => ($a['checkId'] ?? null) === $c['id'] && ($a['userId'] ?? null) === $userId);
            $work[] = ['dueAt' => $c['closeAt'], 'doneAt' => $at['submittedAt'] ?? null];
        }
        $out[] = [
            'user' => $user,
            'spaces' => $mySpaces,
            'payerId' => $payerId,
            'sessionIds' => array_map(fn ($r) => $r['sessionId'] ?? null, $myLogs),
            'activity' => [
                'lastSeenAt' => $user['lastSeenAt'] ?? null,
                'lastLoginAt' => $user['lastLoginAt'] ?? null,
                'inRoom' => ($user['status'] ?? '') === 'busy' || some($open, fn ($e) => ($e['userId'] ?? null) === $userId),
                'sessions' => array_map(fn ($r) => ['at' => $r['at'], 'status' => $r['status'] ?? '', 'minutes' => $r['minutes'] ?? 0], $myLogs),
                'work' => $work,
                'fee' => $fee,
            ],
        ];
    }
    usort($out, fn ($a, $b) => strcmp((string) $a['user']['name'], (string) $b['user']['name']));
    return $out;
}

/** Who a custom nudge can go to. */
function ins_audiences(Ctx $ctx, string $hostId, array $list, int $now): array
{
    $out = [];
    $risk = [];
    $unseen = [];
    foreach ($list as $p) {
        $i = member_insight($p['activity'], $now);
        if ($i['atRisk']) $risk[] = $p['user']['id'];
        if (($i['notSeenDays'] ?? 99) >= 7) $unseen[] = $p['user']['id'];
    }
    $spaces = ins_hosted_spaces($ctx, $hostId);
    $ids = array_flip(array_map(fn ($s) => (string) $s['id'], $spaces));
    $tasks = sorted(
        $ctx->db->list('posts', fn ($p) => isset($ids[(string) ($p['spaceId'] ?? '')]) && ($p['kind'] ?? '') === 'task' && !empty($p['dueAt']) && ms((string) $p['dueAt']) > $now - 3 * DAY),
        fn ($a, $b) => strcmp((string) ($a['dueAt'] ?? ''), (string) ($b['dueAt'] ?? ''))
    );
    foreach ($tasks as $t) {
        $members = array_map(fn ($m) => $m['userId'], $ctx->db->list('memberships', fn ($m) => ($m['spaceId'] ?? null) === $t['spaceId'] && ($m['role'] ?? '') === 'member'));
        $done = array_map(fn ($s) => $s['userId'] ?? null, $ctx->db->list('submissions', fn ($s) => ($s['postId'] ?? null) === $t['id']));
        $missing = array_values(array_filter($members, fn ($m) => !in_array($m, $done, true)));
        if ($missing) $out[] = ['id' => "task:{$t['id']}", 'label' => count($missing) . " who haven't handed in {$t['title']}", 'recipients' => $missing, 'taskId' => $t['id']];
    }
    if ($risk) $out[] = ['id' => 'at_risk', 'label' => count($risk) . ' at risk', 'recipients' => $risk];
    if ($unseen) $out[] = ['id' => 'not_seen', 'label' => count($unseen) . ' not seen for 7 days', 'recipients' => $unseen];
    foreach ($spaces as $s) {
        if (($s['mode'] ?? '') === 'team') continue;
        $ms = array_map(fn ($m) => $m['userId'], $ctx->db->list('memberships', fn ($m) => ($m['spaceId'] ?? null) === $s['id'] && ($m['role'] ?? '') === 'member'));
        if ($ms) $out[] = ['id' => "space:{$s['id']}", 'label' => "Everyone in {$s['name']} (" . count($ms) . ')', 'recipients' => $ms];
    }
    return $out;
}

function ins_notify_nudge(Ctx $ctx, string $hostId, string $userId, string $title, string $sub, string $link, array $meta): void
{
    $id = sortable_id('nt');
    $ctx->db->put('notifications', ['id' => $id, 'userId' => $userId, 'kind' => 'nudge', 'title' => $title, 'sub' => $sub, 'link' => $link, 'createdAt' => $ctx->nowIso(), 'readAt' => null]);
    $ctx->db->put('nudge_log', array_merge(['id' => new_id('nl'), 'hostId' => $hostId, 'nudgeId' => null, 'rule' => null, 'userId' => $userId, 'notificationId' => $id, 'at' => $ctx->nowIso()], $meta));
}

/** The message a nudge sends to one person. */
function ins_nudge_text(string $text, ?array $user, ?array $task): string
{
    return fill_template($text, [
        'first_name' => first_name((string) ($user['name'] ?? '')),
        'task' => $task['title'] ?? 'your work',
        'due' => !empty($task['dueAt']) ? short_date((string) $task['dueAt']) : 'soon',
        'space' => '',
    ]);
}

/** Deliver custom nudges whose time has come (every request; no cron). */
function deliver_nudges(Ctx $ctx, string $hostId): void
{
    $t = $ctx->nowIso();
    $due = $ctx->db->list('nudges', fn ($x) => ($x['hostId'] ?? null) === $hostId && empty($x['sentAt']) && strcmp((string) ($x['sendAt'] ?? ''), $t) <= 0);
    if (!$due) return;
    $host = $ctx->db->get('users', $hostId);
    $users = index_by($ctx->db->list('users'), fn ($u) => $u['id']);
    foreach ($due as $n) {
        // Server-only: claim the nudge in one transaction first, so two concurrent requests never deliver it twice.
        $claimed = false;
        $ctx->db->update('nudges', $n['id'], function (array $cur) use (&$claimed, $t) {
            if (!empty($cur['sentAt'])) return $cur;
            $claimed = true;
            return array_merge($cur, ['sentAt' => $t]);
        });
        if (!$claimed) continue;
        $task = !empty($n['taskId']) ? $ctx->db->get('posts', (string) $n['taskId']) : null;
        $channels = strings($n['channels'] ?? []);
        foreach (strings($n['recipients'] ?? []) as $uid) {
            $u = $users[$uid] ?? null;
            if (!$u) continue;
            $text = ins_nudge_text((string) ($n['text'] ?? ''), $u, $task);
            $title = first_name((string) ($host['name'] ?? 'Your host')) . ': ' . mb_substr($text, 0, 70) . (mb_strlen($text) > 70 ? '…' : '');
            $link = $task ? "/s/{$task['spaceId']}/work" : '/';
            if (in_array('inapp', $channels, true)) ins_notify_nudge($ctx, $hostId, $uid, $title, $text, $link, ['nudgeId' => $n['id'], 'taskId' => $n['taskId'] ?? null]);
            if (in_array('email', $channels, true) && !empty($u['email'])) send_mail((string) $u['email'], $title, $text . "\n\nOpen Loft: " . $ctx->appUrl($link));
        }
        $ctx->changed('notifications', 'nudges');
    }
}

/** Automatic nudges, once a day on the first request. Each fires once per person per thing. */
function insights_daily(Ctx $ctx, string $hostId): void
{
    if (!is_daily_due(ins_nudge_settings($ctx, $hostId)['lastDaily'], $ctx->now())) return;
    // Server-only: one immediate transaction so two "first requests of the day" can't both run the rules.
    $pdo = $ctx->db->pdo;
    $own = !$pdo->inTransaction();
    if ($own) {
        $pdo->exec('BEGIN IMMEDIATE');
        $ctx->db->clearCache();
    }
    try {
        ins_daily_run($ctx, $hostId);
        if ($own) $pdo->exec('COMMIT');
    } catch (\Throwable $e) {
        if ($own) $pdo->exec('ROLLBACK');
        throw $e;
    }
}

function ins_daily_run(Ctx $ctx, string $hostId): void
{
    $s = ins_nudge_settings($ctx, $hostId);
    $now = $ctx->now();
    if (!is_daily_due($s['lastDaily'], $now)) return; // another request ran it while we waited
    $nowIso = iso($now);
    $once = function (string $key, callable $fn) use (&$s, $nowIso): void {
        if (!empty($s['sent'][$key])) return;
        $fn();
        $s['sent'][$key] = $nowIso;
    };
    $spaces = ins_hosted_spaces($ctx, $hostId);
    $ids = array_flip(array_map(fn ($x) => (string) $x['id'], $spaces));
    if (!empty($s['rules']['deadline'])) {
        $tasks = $ctx->db->list('posts', fn ($p) => isset($ids[(string) ($p['spaceId'] ?? '')]) && ($p['kind'] ?? '') === 'task' && !empty($p['dueAt']) && ms((string) $p['dueAt']) > $now && ms((string) $p['dueAt']) <= $now + DAY);
        foreach ($tasks as $task) {
            $done = array_map(fn ($x) => $x['userId'] ?? null, $ctx->db->list('submissions', fn ($x) => ($x['postId'] ?? null) === $task['id']));
            foreach ($ctx->db->list('memberships', fn ($x) => ($x['spaceId'] ?? null) === $task['spaceId'] && ($x['role'] ?? '') === 'member') as $m) {
                if (in_array($m['userId'], $done, true)) continue;
                $once("deadline:{$task['id']}:{$m['userId']}", fn () => ins_notify_nudge($ctx, $hostId, (string) $m['userId'], "Due tomorrow: {$task['title']}", 'Due ' . short_date((string) $task['dueAt']), "/s/{$task['spaceId']}/work", ['rule' => 'deadline', 'taskId' => $task['id']]));
            }
        }
    }
    $list = ins_people($ctx, $hostId, null, $now - 30 * DAY, $now);
    if (!empty($s['rules']['missed2'])) {
        foreach ($list as $p) {
            $i = member_insight($p['activity'], $now);
            if ($i['missedInARow'] < 2 || empty($p['sessionIds'][0])) continue;
            $to = (string) ($p['payerId'] ?? $p['user']['id']);
            $names = implode(', ', array_map(fn ($x) => (string) $x['name'], $p['spaces']));
            $once("missed2:{$p['user']['id']}:{$p['sessionIds'][0]}", fn () => ins_notify_nudge($ctx, $hostId, $to, first_name((string) $p['user']['name']) . " missed {$i['missedInARow']} sessions in a row", "$names · reply if anything's up", "/dm/$hostId", ['rule' => 'missed2']));
        }
    }
    if (!empty($s['rules']['fee3'])) {
        foreach ($ctx->db->list('invoices', fn ($x) => ($x['hostId'] ?? null) === $hostId && ($x['status'] ?? '') === 'sent') as $inv) {
            if (!is_overdue($inv, $now) || empty($inv['dueAt']) || $now - ms((string) $inv['dueAt']) < 3 * DAY || in_array(3, $inv['remindersSent'] ?? [], true) || empty($inv['payerId'])) continue;
            $once("fee3:{$inv['id']}", fn () => ins_notify_nudge($ctx, $hostId, (string) $inv['payerId'], "{$inv['number']} is overdue · " . format_usd(balance_due($inv)), "Pay with the link on the invoice, then tap I've paid", "/pay/{$inv['payToken']}", ['rule' => 'fee3', 'invoiceId' => $inv['id']]));
        }
    }
    if (!empty($s['rules']['files3'])) {
        $files = $ctx->db->list('files', fn ($x) => isset($ids[(string) ($x['spaceId'] ?? '')]) && ms((string) ($x['createdAt'] ?? '')) < $now - 3 * DAY && ms((string) ($x['createdAt'] ?? '')) > $now - 14 * DAY);
        foreach ($files as $f) {
            foreach ($ctx->db->list('memberships', fn ($x) => ($x['spaceId'] ?? null) === $f['spaceId'] && ($x['role'] ?? '') === 'member' && $x['userId'] !== ($f['ownerId'] ?? null)) as $m) {
                if ($ctx->db->get('file_opens', "{$f['id']}:{$m['userId']}")) continue;
                $spaceName = (string) (find($spaces, fn ($x) => $x['id'] === $f['spaceId'])['name'] ?? 'your space');
                $once("files3:{$f['id']}:{$m['userId']}", fn () => ins_notify_nudge($ctx, $hostId, (string) $m['userId'], "Have a look at {$f['name']}", "Shared in $spaceName", "/s/{$f['spaceId']}/files", ['rule' => 'files3']));
            }
        }
    }
    $s['lastDaily'] = day_key($now);
    ins_save_settings($ctx, $s);
    $ctx->changed('notifications');
}

function ins_week_stats(Ctx $ctx, string $hostId): array
{
    $t = $ctx->now();
    $logs = $ctx->db->list('nudge_log', fn ($l) => ($l['hostId'] ?? null) === $hostId && ms((string) ($l['at'] ?? '')) > $t - 7 * DAY);
    $opened = 0;
    $acted = 0;
    foreach ($logs as $l) {
        $n = $ctx->db->get('notifications', (string) ($l['notificationId'] ?? ''));
        if (!empty($n['readAt'])) $opened++;
        $at = (string) $l['at'];
        if (!empty($l['taskId']) && $ctx->db->list('submissions', fn ($s) => ($s['postId'] ?? null) === $l['taskId'] && ($s['userId'] ?? null) === $l['userId'] && strcmp((string) ($s['at'] ?? ''), $at) > 0)) $acted++;
        elseif (!empty($l['invoiceId'])) {
            $inv = $ctx->db->get('invoices', (string) $l['invoiceId']);
            if ($inv && (some($inv['payments'] ?? [], fn ($p) => strcmp((string) ($p['at'] ?? ''), $at) > 0) || some($inv['claims'] ?? [], fn ($c) => strcmp((string) ($c['at'] ?? ''), $at) > 0))) $acted++;
        }
    }
    return ['sent' => count($logs), 'opened' => $opened, 'acted' => $acted];
}

routes()
    ->get('insights', function (Ctx $ctx, array $p, array $in) {
        $me = require_me($ctx);
        insights_daily($ctx, $me['id']);
        $d = ins_number($in['days'] ?? null);
        $days = $d !== null && in_array($d, [7, 30, 90]) ? (int) $d : 30;
        $spaceId = str($in['space'] ?? '', 80);
        $spaceId = $spaceId !== '' ? $spaceId : null;
        $t = $ctx->now();
        $cur = ins_people($ctx, $me['id'], $spaceId, $t - $days * DAY, $t);
        $prev = ins_people($ctx, $me['id'], $spaceId, $t - 2 * $days * DAY, $t - $days * DAY);
        $rows = array_map(fn ($x) => ['p' => $x, 'i' => member_insight($x['activity'], $t)], $cur);
        $a = totals(array_map(fn ($r) => ['activity' => $r['p']['activity'], 'insight' => $r['i']], $rows), $t - $days * DAY);
        $b = totals(array_map(fn ($x) => ['activity' => $x['activity'], 'insight' => member_insight($x['activity'], $t - $days * DAY)], $prev), $t - 2 * $days * DAY);
        $s = ins_nudge_settings($ctx, $me['id']);
        $spaces = ins_hosted_spaces($ctx, $me['id']);
        $people = array_map(fn ($r) => [
            'userId' => $r['p']['user']['id'],
            'name' => $r['p']['user']['name'],
            'phone' => $r['p']['user']['phone'] ?? null,
            'spaces' => implode(' · ', array_map(fn ($x) => (string) ($x['code'] ?? ''), $r['p']['spaces'])),
            'seen' => seen_label($r['p']['activity'], $t),
            'lastLogin' => $r['p']['activity']['lastLoginAt'],
            'attendance' => $r['i']['attendance'],
            'homework' => $r['i']['homeworkDue'] ? "{$r['i']['onTime']}/{$r['i']['homeworkDue']}" : '—',
            'fee' => $r['p']['activity']['fee'],
            'atRisk' => $r['i']['atRisk'],
            'reasons' => $r['i']['reasons'],
            'notSeen7' => ($r['i']['notSeenDays'] ?? 99) >= 7,
        ], $rows);
        usort($people, fn ($x, $y) => ((int) $y['atRisk'] - (int) $x['atRisk']) ?: strcmp((string) $x['name'], (string) $y['name']));
        return [
            'days' => $days,
            'spaceId' => $spaceId,
            'spaces' => array_values(array_map(fn ($x) => ['id' => $x['id'], 'code' => $x['code'] ?? '', 'name' => $x['name']], array_filter($spaces, fn ($x) => ($x['mode'] ?? '') !== 'team'))),
            'kpis' => [
                'active' => $a['active'],
                'members' => $a['members'],
                'activeDelta' => delta($a['active'], $b['members'] ? $b['active'] : null),
                'attendance' => $a['attendance'],
                'attendanceDelta' => delta($a['attendance'], $b['attendance'], '%'),
                'onTime' => $a['onTime'],
                'onTimeDelta' => delta($a['onTime'], $b['onTime'], '%'),
                'avgMinutes' => $a['avgMinutes'],
                'avgDelta' => delta($a['avgMinutes'], $b['avgMinutes'], ' min'),
            ],
            'people' => $people,
            'rules' => array_map(fn ($r) => array_merge($r, ['on' => $s['rules'][$r['id']] ?? $r['on']]), NUDGE_RULES),
            'audiences' => array_map(fn ($x) => ['id' => $x['id'], 'label' => $x['label'], 'count' => count($x['recipients'])], ins_audiences($ctx, $me['id'], $cur, $t)),
            'template' => DEFAULT_NUDGE_TEXT,
            'stats' => ins_week_stats($ctx, $me['id']),
            'scheduled' => array_map(fn ($n) => ['id' => $n['id'], 'label' => $n['label'], 'sendAt' => $n['sendAt']], $ctx->db->list('nudges', fn ($n) => ($n['hostId'] ?? null) === $me['id'] && empty($n['sentAt']))),
        ];
    })
    ->post('nudges/rules', function (Ctx $ctx, array $p, array $in) {
        $me = require_me($ctx);
        $s = ins_nudge_settings($ctx, $me['id']);
        $rule = find(NUDGE_RULES, fn ($r) => $r['id'] === ($in['rule'] ?? null));
        if (!$rule) throw new NotFound('Unknown rule');
        $s['rules'][$rule['id']] = ($in['on'] ?? null) === true;
        ins_save_settings($ctx, $s);
        $ctx->changed('nudge_settings');
        return ['ok' => true];
    })
    ->post('nudges', function (Ctx $ctx, array $p, array $in) {
        $me = require_me($ctx);
        $t = $ctx->now();
        $list = ins_people($ctx, $me['id'], null, $t - 30 * DAY, $t);
        $aud = find(ins_audiences($ctx, $me['id'], $list, $t), fn ($a) => $a['id'] === ($in['audience'] ?? null));
        $single = is_string($in['userId'] ?? null) ? $ctx->db->get('users', $in['userId']) : null;
        $recipients = $single ? [$single['id']] : ($aud['recipients'] ?? []);
        if (!$recipients) throw new BadRequest('Nobody to nudge');
        $channels = strings(is_array($in['channels'] ?? null) ? $in['channels'] : ['inapp']);
        $sendAt = is_string($in['sendAt'] ?? null) && ms($in['sendAt']) > $t ? iso(ms($in['sendAt'])) : iso($t);
        $n = [
            'id' => new_id('nd'),
            'hostId' => $me['id'],
            'audience' => $single ? "user:{$single['id']}" : (string) $in['audience'],
            'label' => $single ? $single['name'] : $aud['label'],
            'recipients' => array_values($recipients),
            'text' => ins_or(str($in['text'] ?? '', 1000), DEFAULT_NUDGE_TEXT),
            'channels' => $channels,
            'sendAt' => $sendAt,
            'sentAt' => null,
            'createdAt' => iso($t),
            'taskId' => $aud['taskId'] ?? null,
        ];
        $ctx->db->put('nudges', $n);
        deliver_nudges($ctx, $me['id']);
        $users = index_by($ctx->db->list('users'), fn ($u) => $u['id']);
        $task = $n['taskId'] ? $ctx->db->get('posts', (string) $n['taskId']) : null;
        $ctx->changed('nudges', 'notifications');
        return [
            'scheduled' => strcmp($sendAt, iso($t)) > 0,
            'sendAt' => $sendAt,
            'recipients' => count($recipients),
            'whatsapp' => in_array('whatsapp', $channels, true)
                ? array_map(function ($id) use ($users, $task, $n) {
                    $u = $users[$id] ?? null;
                    return ['name' => $u['name'] ?? '?', 'phone' => $u['phone'] ?? '', 'text' => ins_nudge_text($n['text'], $u, $task)];
                }, array_values($recipients))
                : [],
        ];
    })
    ->post('files/:id/open', function (Ctx $ctx, array $p) {
        $me = require_me($ctx);
        $ctx->db->put('file_opens', ['id' => "{$p['id']}:{$me['id']}", 'at' => $ctx->nowIso()]);
        return ['ok' => true];
    });
