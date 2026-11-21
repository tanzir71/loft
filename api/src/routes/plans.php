<?php
declare(strict_types=1);

namespace Loft;

// Port of packages/data/src/local/routes-plans.ts (M6): plans library, block editor (autosave + history),
// attach & prepare, room rail, attendance from presence, and wrap-up (the hinge that writes session_log
// lines through record_attendance() in routes/money.php).

function pln_host_of(Ctx $ctx, string $spaceId): array
{
    $me = require_me($ctx);
    $m = $ctx->db->get('memberships', "$spaceId:{$me['id']}");
    if (!$m || ($m['role'] !== 'host' && $m['role'] !== 'cohost')) throw new Forbidden('Plans are for hosts');
    return $me;
}

function pln_plan_or_404(Ctx $ctx, string $id): array
{
    $p = $ctx->db->get('plans', $id);
    if (!$p) throw new NotFound('Plan not found');
    return $p;
}

/** A JSON array (TS Array.isArray). */
function pln_list(mixed $v): bool
{
    return is_array($v) && array_is_list($v);
}

/** Tags: up to 10, each cut to 40 characters. */
function pln_tags(mixed $v): array
{
    return pln_list($v) ? array_slice(array_map(fn ($t) => mb_substr(pln_string($t), 0, 40), $v), 0, 10) : [];
}

/** `${Number(v)}` (a version number in a row id). */
function pln_num_key(mixed $v): string
{
    $n = pln_num($v);
    if (is_float($n) && is_nan($n)) return 'NaN';
    return (string) (is_float($n) && is_finite($n) && floor($n) === $n && abs($n) < PHP_INT_MAX ? (int) $n : $n);
}

function pln_policy_for(?array $space): array
{
    if (!$space) return DEFAULT_POLICY + ['model' => 'per_session', 'per' => 'member'];
    $b = billing_for($space);
    return ['unitPriceCents' => $b['unitPriceCents'], 'billable' => $b['model'] === 'free' ? [] : $b['billable'], 'model' => $b['model'], 'per' => $b['per']];
}

/** Agenda clock times: the browser shows its local zone; the server uses the host's zone. */
function pln_zone_for(Ctx $ctx, string $userId): \DateTimeZone
{
    $u = $ctx->db->get('users', $userId);
    return sch_valid_tz($u['tz'] ?? null) ? sch_zone((string) $u['tz']) : tz();
}

function pln_prepared(array $s): array
{
    return is_array($s['prepared'] ?? null) ? $s['prepared'] : [];
}

function pln_new_room(Ctx $ctx, array $session, string $hostId): array
{
    $code = room_code();
    $room = ['id' => new_id('rm'), 'spaceId' => $session['spaceId'], 'sessionId' => $session['id'], 'slug' => strtolower($code), 'code' => $code, 'name' => $session['title'], 'capacity' => ROOM_CAPACITY, 'guestJoin' => false, 'createdBy' => $hostId, 'createdAt' => $ctx->nowIso(), 'endedAt' => null];
    $ctx->db->put('rooms', $room);
    return $room;
}

/** Ensure the session has a room, then create/update one board page per Board/Hand-out block (idempotent). */
function pln_prepare(Ctx $ctx, array $plan, array $session, string $hostId): array
{
    $prepared = pln_prepared($session);
    $room = sch_filled($prepared['roomId'] ?? null) ? $ctx->db->get('rooms', $prepared['roomId']) : null;
    if (!$room) {
        $room = pln_new_room($ctx, $session, $hostId);
        $prepared['roomId'] = $room['id'];
    }
    $pages = is_array($prepared['pages'] ?? null) ? $prepared['pages'] : [];
    $ops = [];
    $order = 1 + count($pages);
    foreach ($plan['blocks'] as $b) {
        if (!in_array($b['type'] ?? null, ['board', 'handout'], true)) continue;
        $bid = (string) $b['id'];
        if (!empty($pages[$bid])) {
            $ops[] = ['actor' => $hostId, 'ts' => now_ms(), 'kind' => 'update', 'payload' => ['id' => $pages[$bid], 'target' => 'page', 'patch' => ['title' => $b['title'] ?? '']]];
        } else {
            $id = "pg_$bid";
            $pages[$bid] = $id;
            $ops[] = ['actor' => $hostId, 'ts' => now_ms(), 'kind' => 'add', 'payload' => ['page' => ['id' => $id, 'title' => $b['title'] ?? '', 'order' => $order, 'x' => $order * 1280, 'y' => 0, 'w' => 1200, 'h' => 750, 'bg' => null]]];
            $order++;
        }
    }
    if ($ops) {
        $ctx->db->appendOps($room['id'], $ops);
        $ctx->opsChanged($room['id']); // wake rooms polling this op-log
    }
    $prepared['pages'] = obj($pages);
    // Agenda post at start − 1 h (titles + times only).
    $agenda = member_agenda($plan['blocks'], (string) $session['startsAt'], pln_zone_for($ctx, $hostId));
    $publishAt = iso(ms((string) $session['startsAt']) - 3600000);
    $agendaPost = ['id' => $prepared['agendaPostId'] ?? sortable_id('po'), 'spaceId' => $session['spaceId'], 'kind' => 'agenda', 'title' => "Agenda · {$session['title']}", 'body' => implode("\n", array_map(fn ($a) => "{$a['time']}  {$a['title']}", $agenda)), 'mustRead' => false, 'createdBy' => $hostId, 'createdAt' => $publishAt, 'publishAt' => $publishAt, 'attachments' => []];
    $ctx->db->put('posts', $agendaPost);
    $prepared['agendaPostId'] = $agendaPost['id'];
    // Reminder at start − 24 h (delivered by the first request after that time).
    $remindAt = iso(ms((string) $session['startsAt']) - DAY);
    $reminder = ['id' => $prepared['reminderId'] ?? sortable_id('nt'), 'userId' => '*space', 'spaceId' => $session['spaceId'], 'kind' => 'notice', 'title' => "Tomorrow: {$session['title']}", 'sub' => $plan['title'], 'link' => '/calendar', 'createdAt' => $remindAt, 'deliverAt' => $remindAt, 'readAt' => null];
    $ctx->db->put('scheduled_reminders', $reminder);
    $prepared['reminderId'] = $reminder['id'];
    return $prepared;
}

/** Sessions with a plan that ended without a wrap-up (shown on Home and To review). Cross-module. */
function wrapups_pending(Ctx $ctx, string $hostId): array
{
    $hosted = [];
    foreach ($ctx->db->list('memberships', fn ($m) => $m['userId'] === $hostId && ($m['role'] === 'host' || $m['role'] === 'cohost')) as $m) $hosted[$m['spaceId']] = true;
    $t = $ctx->now();
    $list = $ctx->db->list('sessions', fn ($s) => isset($hosted[$s['spaceId']]) && !empty($s['planId']) && empty($s['wrapped']) && ($s['status'] ?? '') !== 'cancelled' && ms((string) $s['startsAt']) + $s['minutes'] * 60000 < $t);
    return sorted($list, fn ($a, $b) => strcmp((string) $a['startsAt'], (string) $b['startsAt']));
}

/** @return array<string, float|int> user id → minutes present in the session's rooms */
function pln_attendance_minutes(Ctx $ctx, string $sessionId): array
{
    $ids = [];
    foreach ($ctx->db->list('rooms', fn ($r) => ($r['sessionId'] ?? null) === $sessionId) as $r) $ids[$r['id']] = true;
    $out = [];
    foreach ($ctx->db->list('attendance_events', fn ($x) => isset($ids[(string) ($x['roomId'] ?? '')])) as $e) {
        $end = sch_filled($e['leftAt'] ?? null) ? ms($e['leftAt']) : $ctx->now();
        $out[$e['userId']] = ($out[$e['userId']] ?? 0) + max(0, ($end - ms((string) $e['joinedAt'])) / 60000);
    }
    return $out;
}

/** If the host never wraps up, billable lines are still written from presence with default statuses after 24 h. Cross-module. */
function auto_wrap_stale(Ctx $ctx, string $hostId): void
{
    $t = $ctx->now();
    foreach (wrapups_pending($ctx, $hostId) as $s) {
        if (ms((string) $s['startsAt']) + $s['minutes'] * 60000 + DAY > $t) continue;
        $members = array_map(fn ($m) => (string) $m['userId'], $ctx->db->list('memberships', fn ($m) => $m['spaceId'] === $s['spaceId'] && $m['role'] !== 'host' && $m['role'] !== 'cohost'));
        record_attendance($ctx, $s, attendance_from_presence($members, pln_attendance_minutes($ctx, (string) $s['id'])));
        $ctx->db->patch('sessions', $s['id'], ['wrapped' => true]);
    }
}

/** The next plan to teach in a space (lowest order, not taught). */
function pln_next_plan(Ctx $ctx, string $spaceId, ?string $exceptId): ?array
{
    $list = sorted($ctx->db->list('plans', fn ($x) => $x['spaceId'] === $spaceId && $x['id'] !== $exceptId && ($x['status'] ?? '') !== 'taught'), fn ($a, $b) => ($a['order'] ?? 0) <=> ($b['order'] ?? 0));
    return $list[0] ?? null;
}

function pln_rail_out(mixed $rail): array
{
    if (!is_array($rail)) return ['current' => 0, 'startedAt' => null, 'extensions' => new \stdClass()];
    if (is_array($rail['extensions'] ?? null)) $rail['extensions'] = obj($rail['extensions']);
    return $rail;
}

routes()
    ->get('spaces/:id/plans', function (Ctx $ctx, array $p) {
        pln_host_of($ctx, $p['id']);
        $plans = sorted($ctx->db->list('plans', fn ($x) => $x['spaceId'] === $p['id']), fn ($a, $b) => strcmp((string) $a['unit'], (string) $b['unit']) ?: (($a['order'] ?? 0) <=> ($b['order'] ?? 0)));
        $sessions = $ctx->db->list('sessions', fn ($s) => $s['spaceId'] === $p['id'] && ($s['status'] ?? '') !== 'cancelled');
        $byId = index_by($sessions, fn ($s) => $s['id']);
        $t = $ctx->now();
        $unplanned = sorted(array_values(array_filter($sessions, fn ($s) => empty($s['planId']) && ms((string) $s['startsAt']) > $t && ms((string) $s['startsAt']) < $t + 14 * DAY)), fn ($a, $b) => strcmp((string) $a['startsAt'], (string) $b['startsAt']));
        $units = []; // keyed with a prefix so numeric unit names keep insertion order and stay strings
        foreach ($plans as $pl) {
            $k = 'u:' . $pl['unit'];
            $units[$k] ??= ['unit' => $pl['unit'], 'objectives' => 0, 'covered' => 0];
            $n = count(is_array($pl['tags'] ?? null) ? $pl['tags'] : []) ?: 1;
            $units[$k]['objectives'] += $n;
            if (($pl['status'] ?? '') === 'taught') $units[$k]['covered'] += $n;
        }
        return [
            'plans' => array_map(fn ($pl) => array_merge($pl, ['status' => derive_plan_status($pl), 'session' => !empty($pl['sessionId']) ? ($byId[$pl['sessionId']] ?? null) : null, 'planned' => sum($pl['blocks'] ?? [], fn ($b) => $b['minutes'] ?? 0)]), $plans),
            'unplanned' => array_slice($unplanned, 0, 5),
            'units' => array_values($units),
        ];
    })
    ->post('spaces/:id/plans', function (Ctx $ctx, array $p, array $in) {
        pln_host_of($ctx, $p['id']);
        $from = str($in['from'] ?? null, 40) ?: 'blank';
        $tplKey = str_starts_with($from, 'template:') ? substr($from, 9) : null;
        $tpl = $tplKey !== null && array_key_exists($tplKey, TEMPLATES) ? TEMPLATES[$tplKey] : null;
        $blocks = pln_list($in['blocks'] ?? null) ? $in['blocks'] : ($tpl ? plan_template_blocks($tplKey) : []);
        $count = count($ctx->db->list('plans', fn ($x) => $x['spaceId'] === $p['id']));
        $plan = [
            'id' => new_id('pl'),
            'spaceId' => $p['id'],
            'title' => str($in['title'] ?? null, 120) ?: 'Untitled plan',
            'minutes' => pln_or(pln_num($in['minutes'] ?? null), $tpl['minutes'] ?? 60),
            'objective' => str($in['objective'] ?? null, 300),
            'tags' => pln_tags($in['tags'] ?? null),
            'unit' => str($in['unit'] ?? null, 60) ?: 'Unit 1',
            'order' => $count,
            'status' => 'draft',
            'aiDraft' => $from === 'ai',
            'blocks' => $blocks,
            'sessionId' => null,
            'version' => 1,
            'createdAt' => $ctx->nowIso(),
            'updatedAt' => $ctx->nowIso(),
        ];
        $ctx->db->put('plans', $plan);
        $ctx->db->put('plan_versions', ['id' => "{$plan['id']}:1", 'planId' => $plan['id'], 'version' => 1, 'blocks' => $blocks, 'at' => $ctx->nowIso()]);
        $ctx->changed('plans');
        return $plan;
    })
    ->get('plans/:id', function (Ctx $ctx, array $p) {
        $plan = pln_plan_or_404($ctx, $p['id']);
        pln_host_of($ctx, $plan['spaceId']);
        $space = $ctx->db->get('spaces', (string) $plan['spaceId']);
        $t = $ctx->now();
        $sessions = sorted($ctx->db->list('sessions', fn ($s) => $s['spaceId'] === $plan['spaceId'] && ($s['status'] ?? '') !== 'cancelled' && ms((string) $s['startsAt']) > $t - 3600000), fn ($a, $b) => strcmp((string) $a['startsAt'], (string) $b['startsAt']));
        $versions = sorted($ctx->db->list('plan_versions', fn ($v) => $v['planId'] === $plan['id']), fn ($a, $b) => $b['version'] <=> $a['version']);
        return array_merge($plan, [
            'status' => derive_plan_status($plan),
            'space' => ['id' => $space['id'] ?? null, 'name' => $space['name'] ?? null, 'slug' => $space['slug'] ?? null],
            'sessions' => array_map(fn ($s) => ['id' => $s['id'], 'title' => $s['title'], 'startsAt' => $s['startsAt'], 'minutes' => $s['minutes'], 'planId' => $s['planId'] ?? null], array_slice($sessions, 0, 12)),
            'versions' => array_map(fn ($v) => ['version' => $v['version'], 'at' => $v['at']], array_slice($versions, 0, 10)),
            'agenda' => member_agenda($plan['blocks']),
        ]);
    })
    ->post('plans/:id', function (Ctx $ctx, array $p, array $in) {
        $plan = pln_plan_or_404($ctx, $p['id']);
        pln_host_of($ctx, $plan['spaceId']);
        $patch = ['updatedAt' => $ctx->nowIso()];
        if (array_key_exists('title', $in)) $patch['title'] = str($in['title'], 120) ?: $plan['title'];
        if (array_key_exists('minutes', $in)) $patch['minutes'] = max(5, min(480, pln_or(pln_num($in['minutes']), $plan['minutes'])));
        if (array_key_exists('objective', $in)) $patch['objective'] = str($in['objective'], 300);
        if (array_key_exists('unit', $in)) $patch['unit'] = str($in['unit'], 60) ?: $plan['unit'];
        if (pln_list($in['tags'] ?? null)) $patch['tags'] = pln_tags($in['tags']);
        $hasBlocks = pln_list($in['blocks'] ?? null);
        if ($hasBlocks) {
            $patch['blocks'] = array_slice($in['blocks'], 0, 60);
            $patch['version'] = $plan['version'] + 1;
            $patch['aiDraft'] = false; // an edited AI draft is no longer "AI draft"
            $ctx->db->put('plan_versions', ['id' => "{$plan['id']}:{$patch['version']}", 'planId' => $plan['id'], 'version' => $patch['version'], 'blocks' => $patch['blocks'], 'at' => $ctx->nowIso()]);
        }
        $next = $ctx->db->patch('plans', $plan['id'], $patch);
        // Re-prepare an attached session so pages and the agenda follow edits (idempotent).
        if (!empty($next['sessionId']) && $hasBlocks) {
            $s = $ctx->db->get('sessions', (string) $next['sessionId']);
            if ($s) $ctx->db->patch('sessions', $s['id'], ['prepared' => pln_prepare($ctx, $next, $s, require_me($ctx)['id'])]);
        }
        $ctx->changed('plans');
        return array_merge($next, ['status' => derive_plan_status($next)]);
    })
    ->post('plans/:id/restore', function (Ctx $ctx, array $p, array $in) {
        $plan = pln_plan_or_404($ctx, $p['id']);
        pln_host_of($ctx, $plan['spaceId']);
        $v = $ctx->db->get('plan_versions', "{$plan['id']}:" . pln_num_key($in['version'] ?? null));
        if (!$v) throw new NotFound('Version not found');
        $version = $plan['version'] + 1;
        $ctx->db->put('plan_versions', ['id' => "{$plan['id']}:$version", 'planId' => $plan['id'], 'version' => $version, 'blocks' => $v['blocks'], 'at' => $ctx->nowIso()]);
        $next = $ctx->db->patch('plans', $plan['id'], ['blocks' => $v['blocks'], 'version' => $version, 'updatedAt' => $ctx->nowIso()]);
        $ctx->changed('plans');
        return $next;
    })
    ->post('plans/:id/reorder', function (Ctx $ctx, array $p, array $in) {
        $plan = pln_plan_or_404($ctx, $p['id']);
        pln_host_of($ctx, $plan['spaceId']);
        $ids = pln_list($in['ids'] ?? null) ? $in['ids'] : [];
        foreach ($ids as $i => $id) {
            if (!is_string($id)) continue;
            $pl = $ctx->db->get('plans', $id);
            // Only plans in this space (the TS adapter is single-user and doesn't need the check).
            if ($pl && $pl['spaceId'] === $plan['spaceId']) $ctx->db->patch('plans', $id, ['order' => $i]);
        }
        $ctx->changed('plans');
        return ['ok' => true];
    })
    ->post('plans/:id/attach', function (Ctx $ctx, array $p, array $in) {
        $plan = pln_plan_or_404($ctx, $p['id']);
        $me = pln_host_of($ctx, $plan['spaceId']);
        $s = $ctx->db->get('sessions', str($in['sessionId'] ?? null, 60));
        if (!$s || $s['spaceId'] !== $plan['spaceId']) throw new NotFound('Pick a session in this space');
        if (!empty($s['planId']) && $s['planId'] !== $plan['id']) throw new BadRequest('That session already has a plan');
        if (!empty($plan['sessionId']) && $plan['sessionId'] !== $s['id']) {
            $old = $ctx->db->get('sessions', (string) $plan['sessionId']);
            if ($old) $ctx->db->patch('sessions', $old['id'], ['planId' => null]);
        }
        $prepared = pln_prepare($ctx, $plan, $s, $me['id']);
        $ctx->db->patch('sessions', $s['id'], ['planId' => $plan['id'], 'prepared' => $prepared]);
        $next = $ctx->db->patch('plans', $plan['id'], ['sessionId' => $s['id'], 'updatedAt' => $ctx->nowIso()]);
        // "Also copy to…": an independent copy for another space's session.
        foreach (strings($in['copyTo'] ?? null) as $target) {
            $ts = $ctx->db->get('sessions', $target);
            if (!$ts || !empty($ts['planId'])) continue;
            pln_host_of($ctx, (string) $ts['spaceId']);
            $copy = array_merge($plan, ['id' => new_id('pl'), 'spaceId' => $ts['spaceId'], 'sessionId' => $ts['id'], 'status' => 'draft', 'version' => 1, 'createdAt' => $ctx->nowIso(), 'updatedAt' => $ctx->nowIso(), 'blocks' => array_map(fn ($b) => array_merge($b, ['id' => new_id('b')]), $plan['blocks'])]);
            $ctx->db->put('plans', $copy);
            $ctx->db->patch('sessions', $ts['id'], ['planId' => $copy['id'], 'prepared' => pln_prepare($ctx, $copy, $ts, $me['id'])]);
        }
        $ctx->changed('plans', 'sessions', 'posts');
        return array_merge($next, ['status' => derive_plan_status($next), 'prepared' => $prepared]);
    })
    ->post('plans/:id/detach', function (Ctx $ctx, array $p) {
        $plan = pln_plan_or_404($ctx, $p['id']);
        pln_host_of($ctx, $plan['spaceId']);
        if (!empty($plan['sessionId'])) {
            $s = $ctx->db->get('sessions', (string) $plan['sessionId']);
            if ($s) {
                $prep = pln_prepared($s);
                if (sch_filled($prep['agendaPostId'] ?? null)) $ctx->db->del('posts', $prep['agendaPostId']);
                if (sch_filled($prep['reminderId'] ?? null)) $ctx->db->del('scheduled_reminders', $prep['reminderId']);
                $ctx->db->patch('sessions', $s['id'], ['planId' => null, 'prepared' => isset($prep['roomId']) ? ['roomId' => $prep['roomId']] : new \stdClass()]);
            }
        }
        $ctx->db->patch('plans', $plan['id'], ['sessionId' => null]);
        $ctx->changed('plans', 'sessions', 'posts');
        return ['ok' => true];
    })
    ->post('plans/:id/delete', function (Ctx $ctx, array $p) {
        $plan = pln_plan_or_404($ctx, $p['id']);
        pln_host_of($ctx, $plan['spaceId']);
        if (!empty($plan['sessionId'])) {
            $s = $ctx->db->get('sessions', (string) $plan['sessionId']);
            if ($s) $ctx->db->patch('sessions', $s['id'], ['planId' => null]);
        }
        $ctx->db->del('plans', $plan['id']);
        $ctx->changed('plans');
        return ['ok' => true];
    })
    ->get('sessions/:id/plan', function (Ctx $ctx, array $p) {
        $me = require_me($ctx);
        $s = $ctx->db->get('sessions', $p['id']);
        if (!$s || empty($s['planId'])) return null;
        $plan = $ctx->db->get('plans', (string) $s['planId']);
        if (!$plan) return null;
        $m = $ctx->db->get('memberships', "{$s['spaceId']}:{$me['id']}");
        $isHost = $m && ($m['role'] === 'host' || $m['role'] === 'cohost');
        // Host notes never leave the host; members get titles of visible blocks only.
        $blocks = [];
        foreach ($plan['blocks'] as $b) {
            if (!$isHost && empty($b['visible'])) continue;
            $blocks[] = $isHost ? $b : array_merge($b, ['hostNotes' => '', 'resources' => []]);
        }
        $prep = pln_prepared($s);
        return ['planId' => $plan['id'], 'title' => $plan['title'], 'blocks' => $blocks, 'rail' => pln_rail_out($s['rail'] ?? null), 'isHost' => $isHost, 'sessionId' => $s['id'], 'pages' => obj(is_array($prep['pages'] ?? null) ? $prep['pages'] : [])];
    })
    ->post('sessions/:id/rail', function (Ctx $ctx, array $p, array $in) {
        $s = $ctx->db->get('sessions', $p['id']);
        if (!$s) throw new NotFound('Session not found');
        pln_host_of($ctx, (string) $s['spaceId']);
        $rail = ['current' => max(0, pln_or(pln_num($in['current'] ?? null), 0)), 'startedAt' => str($in['startedAt'] ?? null, 40) ?: null, 'extensions' => $in['extensions'] ?? []];
        $ctx->db->patch('sessions', $s['id'], ['rail' => $rail]);
        $ctx->changed('sessions');
        return pln_rail_out($rail);
    })
    // "Open board" for a session: its prepared room, created on first use.
    ->post('sessions/:id/room', function (Ctx $ctx, array $p) {
        $me = require_me($ctx);
        $s = $ctx->db->get('sessions', $p['id']);
        if (!$s) throw new NotFound('Session not found');
        if (!$ctx->db->get('memberships', "{$s['spaceId']}:{$me['id']}")) throw new Forbidden("You're not in this space");
        $prep = pln_prepared($s);
        $room = sch_filled($prep['roomId'] ?? null) ? $ctx->db->get('rooms', $prep['roomId']) : null;
        if ($room && !empty($room['endedAt'])) $room = null;
        if (!$room) {
            $plan = !empty($s['planId']) ? $ctx->db->get('plans', (string) $s['planId']) : null;
            $hosts = $ctx->db->list('memberships', fn ($m) => $m['spaceId'] === $s['spaceId'] && $m['role'] === 'host');
            $host = (string) ($hosts[0]['userId'] ?? $me['id']);
            if ($plan) {
                $prepared = pln_prepare($ctx, $plan, array_merge($s, ['prepared' => array_merge($prep, ['roomId' => null, 'pages' => []])]), $host); // a new room starts with no pages
                $ctx->db->patch('sessions', $s['id'], ['prepared' => $prepared]);
                $room = $ctx->db->get('rooms', (string) $prepared['roomId']);
            } else {
                $room = pln_new_room($ctx, $s, $host);
                $ctx->db->patch('sessions', $s['id'], ['prepared' => array_merge($prep, ['roomId' => $room['id']])]);
            }
        }
        $ctx->changed('rooms');
        return $room;
    })
    ->post('rooms/:id/attendance', function (Ctx $ctx, array $p, array $in) {
        $me = require_me($ctx);
        $id = "{$p['id']}:{$me['id']}";
        $cur = $ctx->db->get('attendance_events', $id);
        if (($in['event'] ?? null) === 'leave') {
            if ($cur && empty($cur['leftAt'])) $ctx->db->patch('attendance_events', $id, ['leftAt' => $ctx->nowIso()]);
        } elseif (!$cur) {
            $ctx->db->put('attendance_events', ['id' => $id, 'roomId' => $p['id'], 'userId' => $me['id'], 'joinedAt' => $ctx->nowIso(), 'leftAt' => null]);
        } elseif (!empty($cur['leftAt'])) {
            $ctx->db->patch('attendance_events', $id, ['leftAt' => null]);
        }
        return ['ok' => true];
    })
    ->get('sessions/:id/wrapup', function (Ctx $ctx, array $p) {
        $s = $ctx->db->get('sessions', $p['id']);
        if (!$s) throw new NotFound('Session not found');
        pln_host_of($ctx, (string) $s['spaceId']);
        $plan = !empty($s['planId']) ? $ctx->db->get('plans', (string) $s['planId']) : null;
        $space = $ctx->db->get('spaces', (string) $s['spaceId']);
        $members = $ctx->db->list('memberships', fn ($m) => $m['spaceId'] === $s['spaceId'] && $m['role'] !== 'host' && $m['role'] !== 'cohost');
        $users = index_by($ctx->db->list('users'), fn ($u) => $u['id']);
        $late = array_map(fn ($x) => (string) $x['userId'], $ctx->db->list('attendance_exceptions', fn ($x) => ($x['sessionId'] ?? null) === $s['id']));
        $att = attendance_from_presence(array_map(fn ($m) => (string) $m['userId'], $members), pln_attendance_minutes($ctx, (string) $s['id']), $late);
        $homework = $plan ? find($plan['blocks'], fn ($b) => ($b['type'] ?? null) === 'handout' && preg_match('/homework/i', (string) ($b['title'] ?? '')) === 1) : null;
        $nextPlan = pln_next_plan($ctx, (string) $s['spaceId'], $plan['id'] ?? null);
        return [
            'session' => $s,
            'space' => ['id' => $space['id'] ?? null, 'name' => $space['name'] ?? null, 'slug' => $space['slug'] ?? null],
            'plan' => $plan,
            'policy' => pln_policy_for($space),
            'attendance' => array_map(fn ($a) => array_merge($a, ['name' => $users[$a['memberId']]['name'] ?? '?']), $att),
            'homework' => $homework ? ['title' => sch_filled($homework['memberText'] ?? null) ? $homework['memberText'] : $homework['title']] : null,
            'nextPlan' => $nextPlan ? ['id' => $nextPlan['id'], 'title' => $nextPlan['title']] : null,
        ];
    })
    ->post('sessions/:id/wrapup', function (Ctx $ctx, array $p, array $in) {
        $s = $ctx->db->get('sessions', $p['id']);
        if (!$s) throw new NotFound('Session not found');
        $me = pln_host_of($ctx, (string) $s['spaceId']);
        $plan = !empty($s['planId']) ? $ctx->db->get('plans', (string) $s['planId']) : null;
        $outcomes = is_array($in['outcomes'] ?? null) ? $in['outcomes'] : [];
        // The TS adapter passes the rows through; the server keeps only well-formed ones.
        $rows = [];
        foreach ((pln_list($in['attendance'] ?? null) ? $in['attendance'] : []) as $a) {
            if (!is_array($a) || !is_string($a['memberId'] ?? null)) continue;
            $rows[] = ['memberId' => $a['memberId'], 'minutes' => pln_or(pln_num($a['minutes'] ?? 0), 0), 'status' => is_string($a['status'] ?? null) ? $a['status'] : 'absent'];
        }
        $written = record_attendance($ctx, $s, $rows);
        if ($plan && ($in['markTaught'] ?? null) !== false) $ctx->db->patch('plans', $plan['id'], ['status' => 'taught']);
        // Carry partly/skipped blocks into the next plan, or keep them in a tray.
        $carried = $plan ? carry_over($outcomes, $plan['blocks'], strings($in['carry'] ?? null)) : [];
        if ($carried) {
            $next = pln_next_plan($ctx, (string) $s['spaceId'], $plan['id'] ?? null);
            if ($next) $ctx->db->patch('plans', $next['id'], ['blocks' => array_merge($carried, $next['blocks']), 'version' => $next['version'] + 1]);
            else $ctx->db->put('carry_tray', ['id' => $s['spaceId'], 'blocks' => $carried]);
        }
        if (($in['postRecap'] ?? null) !== false) {
            $covered = $plan ? array_map(fn ($b) => $b['title'], array_values(array_filter($plan['blocks'], fn ($b) => ($outcomes[$b['id']] ?? 'done') !== 'skipped'))) : [];
            $body = array_values(array_filter(['What we covered: ' . (implode(', ', $covered) ?: '—') . '.', str($in['recapText'] ?? null, 2000)], fn ($x) => $x !== ''));
            $ctx->db->put('posts', ['id' => sortable_id('po'), 'spaceId' => $s['spaceId'], 'kind' => 'recap', 'title' => 'Recap: ' . ($plan['title'] ?? $s['title']), 'body' => implode("\n\n", $body), 'mustRead' => false, 'createdBy' => $me['id'], 'createdAt' => $ctx->nowIso(), 'attachments' => [['name' => 'Board notes.pdf', 'meta' => 'from the room', 'kind' => 'file']]]);
        }
        $hw = is_array($in['homework'] ?? null) ? $in['homework'] : null;
        if ($hw && sch_truthy($hw['title'] ?? null)) {
            $ctx->db->put('posts', ['id' => sortable_id('po'), 'spaceId' => $s['spaceId'], 'kind' => 'task', 'title' => str($hw['title'], 160), 'body' => '', 'mustRead' => false, 'dueAt' => str($hw['dueAt'] ?? null, 40) ?: iso($ctx->now() + 2 * DAY), 'createdBy' => $me['id'], 'createdAt' => $ctx->nowIso(), 'attachments' => []]);
        }
        $ctx->db->patch('sessions', $s['id'], ['wrapped' => true]);
        $ctx->changed('posts', 'plans', 'sessions', 'session_log');
        $billable = array_values(array_filter($written, fn ($l) => !empty($l['billable'])));
        return ['ok' => true, 'lines' => count($written), 'billable' => count($billable), 'totalCents' => sum($billable, fn ($l) => $l['amountCents'] ?? 0), 'packaged' => count(array_filter($billable, fn ($l) => !empty($l['packageId']))), 'carried' => count($carried)];
    });
