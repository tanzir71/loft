<?php
declare(strict_types=1);

namespace Loft;

// Port of packages/data/src/local/routes-spaces.ts (M3): spaces, stream (posts, must-read acks,
// tasks), files, space chat, people, DMs, knock, notifications and the To review inbox.
// Keep in step with the TS twin.

/** Deliver reminders whose time has come (no cron: the first request after deliverAt does it). */
function sp_deliver_due(Ctx $ctx): void
{
    $t = $ctx->nowIso();
    $sent = false;
    foreach ($ctx->db->list('scheduled_reminders', fn ($x) => isset($x['deliverAt']) && strcmp((string) $x['deliverAt'], $t) <= 0) as $r) {
        // Server: claim the reminder first so two simultaneous first requests never deliver it twice.
        $st = $ctx->db->pdo->prepare('DELETE FROM rows WHERE tbl = ? AND id = ?');
        $st->execute(['scheduled_reminders', (string) $r['id']]);
        if ($st->rowCount() !== 1) continue;
        $ctx->db->del('scheduled_reminders', (string) $r['id']); // already gone; this drops the read cache
        foreach ($ctx->db->list('memberships', fn ($x) => $x['spaceId'] === ($r['spaceId'] ?? null)) as $m) {
            $ctx->db->put('notifications', ['id' => sortable_id('nt'), 'userId' => $m['userId'], 'kind' => $r['kind'] ?? '', 'title' => $r['title'] ?? '', 'sub' => $r['sub'] ?? '', 'link' => $r['link'] ?? '', 'createdAt' => $r['deliverAt'], 'readAt' => null]);
        }
        $sent = true;
    }
    if ($sent) $ctx->changed('notifications');
}

function sp_dm_key(string $a, string $b): string
{
    $x = [$a, $b];
    sort($x, SORT_STRING);
    return implode('~', $x);
}

/** Stable, readable join code per space: "prc-7kq" (FNV-1a over the id, same as the TS). */
function sp_join_code(array $s): string
{
    $alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
    $n = strlen($alphabet);
    $id = (string) $s['id'];
    $h = 2166136261;
    for ($i = 0, $len = strlen($id); $i < $len; $i++) $h = (($h ^ ord($id[$i])) * 16777619) & 0xFFFFFFFF;
    $tail = '';
    for ($i = 0; $i < 3; $i++) {
        $tail .= $alphabet[$h % $n];
        $h = intdiv($h, $n);
    }
    return mb_strtolower((string) $s['code']) . '-' . $tail;
}

function sp_by_time(array $a, array $b): int
{
    return strcmp((string) ($a['createdAt'] ?? ''), (string) ($b['createdAt'] ?? ''));
}

/** @return array<string, array> users by id (never send these rows out whole: they may hold passwordHash) */
function sp_users(Ctx $ctx): array
{
    return index_by($ctx->db->list('users'), fn ($u) => $u['id']);
}

function sp_space(Ctx $ctx, string $key): array
{
    $s = $ctx->db->get('spaces', $key) ?? ($ctx->db->list('spaces', fn ($x) => ($x['slug'] ?? '') === $key)[0] ?? null);
    if (!$s) throw new NotFound('Space not found');
    return $s;
}

function sp_membership(Ctx $ctx, string $spaceId, string $userId): ?array
{
    return $ctx->db->get('memberships', "$spaceId:$userId");
}

/** @return array{me: array, m: array, isHost: bool} */
function sp_require_member(Ctx $ctx, string $spaceId): array
{
    $me = require_me($ctx);
    $m = sp_membership($ctx, $spaceId, $me['id']);
    if (!$m) throw new Forbidden("You're not in this space");
    return ['me' => $me, 'm' => $m, 'isHost' => $m['role'] === 'host' || $m['role'] === 'cohost'];
}

function sp_notify(Ctx $ctx, string $userId, string $kind, string $title, string $sub, string $link): void
{
    $ctx->db->put('notifications', ['id' => sortable_id('nt'), 'userId' => $userId, 'kind' => $kind, 'title' => $title, 'sub' => $sub, 'link' => $link, 'createdAt' => $ctx->nowIso(), 'readAt' => null]);
}

function sp_space_unread(Ctx $ctx, array $s, string $meId): int
{
    $m = sp_membership($ctx, $s['id'], $meId);
    if (!$m) return 0;
    $since = (string) ($m['lastReadAt'] ?? '');
    $msgs = $ctx->db->list('messages', fn ($x) => ($x['channelType'] ?? '') === 'space' && ($x['channelId'] ?? '') === $s['id'] && $x['userId'] !== $meId && strcmp((string) $x['createdAt'], $since) > 0);
    $posts = $ctx->db->list('posts', fn ($x) => $x['spaceId'] === $s['id'] && $x['createdBy'] !== $meId && strcmp((string) $x['createdAt'], $since) > 0);
    return count($msgs) + count($posts);
}

function sp_my_spaces(Ctx $ctx, string $meId): array
{
    $mine = array_flip(array_map(fn ($m) => (string) $m['spaceId'], $ctx->db->list('memberships', fn ($m) => $m['userId'] === $meId)));
    return sorted($ctx->db->list('spaces', fn ($s) => isset($mine[$s['id']])), sp_by_time(...));
}

function sp_in_dm(array $m, string $meId): bool
{
    return ($m['channelType'] ?? '') === 'dm' && in_array($meId, explode('~', (string) ($m['channelId'] ?? '')), true);
}

function sp_dm_list(Ctx $ctx, string $meId): array
{
    $all = $ctx->db->list('messages', fn ($m) => sp_in_dm($m, $meId));
    $u = sp_users($ctx);
    $byPeer = [];
    foreach ($all as $m) {
        $peer = find(explode('~', (string) $m['channelId']), fn ($x) => $x !== $meId) ?? $meId;
        $byPeer[$peer][] = $m;
    }
    // Everyone you share a space with is reachable, even before the first message.
    foreach (sp_my_spaces($ctx, $meId) as $s) {
        foreach ($ctx->db->list('memberships', fn ($x) => $x['spaceId'] === $s['id']) as $m) {
            if ($m['userId'] !== $meId && !isset($byPeer[$m['userId']])) $byPeer[$m['userId']] = [];
        }
    }
    $rows = [];
    foreach ($byPeer as $peer => $msgs) {
        $peer = (string) $peer;
        $user = $u[$peer] ?? null;
        if (!$user || !empty($user['guest'])) continue;
        $msgs = sorted($msgs, sp_by_time(...));
        $read = (string) ($ctx->db->get('dm_reads', $meId . ':' . sp_dm_key($meId, $peer))['at'] ?? '');
        $unread = count(array_filter($msgs, fn ($m) => $m['userId'] !== $meId && strcmp((string) $m['createdAt'], $read) > 0));
        $last = $msgs ? $msgs[count($msgs) - 1] : null;
        $rows[] = [
            'id' => $peer,
            'name' => $user['name'],
            'title' => $user['title'] ?? '',
            'status' => $user['status'] ?? 'offline',
            'last' => $last ? ['body' => ($last['kind'] ?? null) === 'room' ? 'Room · ' . ($last['roomName'] ?? '') : $last['body'], 'at' => $last['createdAt'], 'mine' => $last['userId'] === $meId] : null,
            'unread' => $unread,
        ];
    }
    return sorted($rows, fn ($a, $b) => strcmp((string) ($b['last']['at'] ?? ''), (string) ($a['last']['at'] ?? '')) ?: strcasecmp((string) $a['name'], (string) $b['name']));
}

/** en-GB "Sun 15, 18:30" (weekday short, day, 2-digit time) in the host's time zone. */
function sp_when(string $isoStr): string
{
    return local(ms($isoStr))->format('D j, H:i');
}

function sp_review_items(Ctx $ctx, string $meId): array
{
    $items = [];
    $hosted = array_flip(array_map(fn ($m) => (string) $m['spaceId'], $ctx->db->list('memberships', fn ($m) => $m['userId'] === $meId && ($m['role'] === 'host' || $m['role'] === 'cohost'))));
    $byPost = [];
    foreach ($ctx->db->list('submissions', fn ($s) => $s['status'] === 'handed-in' && isset($hosted[$s['spaceId']])) as $s) $byPost[$s['postId']][] = $s;
    foreach ($byPost as $postId => $list) {
        $postId = (string) $postId;
        $post = $ctx->db->get('posts', $postId);
        $space = $post ? $ctx->db->get('spaces', (string) $post['spaceId']) : null;
        if (!$post || !$space) continue;
        $n = count($list);
        $items[] = ['id' => "handin:$postId", 'kind' => 'handin', 'title' => "$n hand-in" . ($n === 1 ? '' : 's') . ' to review', 'sub' => "{$post['title']} · {$space['name']}", 'action' => 'Review', 'link' => "/s/{$space['slug']}/work"];
    }
    foreach (wrapups_pending($ctx, $meId) as $s) {
        $items[] = ['id' => "wrap:{$s['id']}", 'kind' => 'wrapup', 'title' => "Wrap-up pending · {$s['title']}", 'sub' => short_date((string) $s['startsAt']), 'action' => 'Finish', 'link' => "/wrapup/{$s['id']}"];
    }
    foreach (money_review_items($ctx, $meId) as $it) $items[] = $it;
    foreach (checks_review_items($ctx, $meId) as $it) $items[] = $it;
    foreach (pending_requests($ctx, $meId) as $r) {
        $kind = $r['kind'];
        $when = sp_when((string) $r['from']);
        $to = !empty($r['to']) ? sp_when((string) $r['to']) : '';
        $first = explode(' ', (string) $r['who'])[0];
        $items[] = [
            'id' => "req:{$r['id']}",
            'kind' => $kind === 'booking' ? 'booking' : 'move',
            'title' => $kind === 'booking' ? 'New booking · ' . explode(' · ', (string) $r['title'])[0] : ($kind === 'move' ? "$first asks to move {$r['title']}" : "$first asks to cancel {$r['title']}"),
            'sub' => $kind === 'booking' ? "{$r['who']} · $when" : $when . ($to !== '' ? " → $to" : '') . (!empty($r['late']) ? ' · late' : ''),
            'action' => 'Approve',
            'link' => '/calendar?requests=1',
        ];
    }
    foreach ($ctx->db->list('notifications', fn ($n) => $n['userId'] === $meId && ($n['kind'] ?? '') === 'knock' && empty($n['readAt'])) as $k) {
        $items[] = ['id' => "knock:{$k['id']}", 'kind' => 'knock', 'title' => $k['title'], 'sub' => $k['sub'], 'action' => 'Join', 'link' => $k['link']];
    }
    // Must-read posts you haven't acknowledged yet (as a member).
    foreach ($ctx->db->list('memberships', fn ($m) => $m['userId'] === $meId && $m['role'] !== 'host' && $m['role'] !== 'cohost') as $m) {
        foreach ($ctx->db->list('posts', fn ($x) => $x['spaceId'] === $m['spaceId'] && !empty($x['mustRead'])) as $p) {
            if (!$ctx->db->get('post_acks', "{$p['id']}:$meId")) $items[] = ['id' => "ack:{$p['id']}", 'kind' => 'ack', 'title' => "Please confirm: {$p['title']}", 'sub' => 'Must-read', 'action' => 'Open', 'link' => "/s/{$m['spaceId']}"];
        }
    }
    return $items;
}

function sp_post_view(Ctx $ctx, array $p, string $meId, array $members, array $u): array
{
    $ackIds = array_map(fn ($a) => (string) $a['userId'], $ctx->db->list('post_acks', fn ($a) => $a['postId'] === $p['id']));
    $waiting = !empty($p['mustRead']) ? unacknowledged(array_map(fn ($m) => (string) $m['userId'], $members), $ackIds, (string) $p['createdBy']) : [];
    $subs = $p['kind'] === 'task' ? $ctx->db->list('submissions', fn ($s) => $s['postId'] === $p['id']) : [];
    return array_merge($p, [
        'authorName' => $u[$p['createdBy']]['name'] ?? 'Someone',
        'acked' => count($ackIds),
        'audience' => max(0, count($members) - 1),
        'ackedByMe' => in_array($meId, $ackIds, true),
        'notSeen' => array_map(fn ($id) => $u[$id]['name'] ?? $id, $waiting),
        'handIns' => count(array_filter($subs, fn ($s) => $s['status'] === 'handed-in')),
        'mySubmission' => find($subs, fn ($s) => $s['userId'] === $meId),
    ]);
}

/** A files row as the Files tab reads it: server uploads (POST files) store `size`, linked rows `fileId` + `bytes`. */
function sp_file_view(array $f, array $u): array
{
    return array_merge($f, ['fileId' => $f['fileId'] ?? $f['id'], 'bytes' => $f['bytes'] ?? ($f['size'] ?? 0), 'ownerName' => $u[$f['ownerId'] ?? '']['name'] ?? '?']);
}

/**
 * Server-only scoping: one install serves many hosts, so the side panel and Home only list rooms
 * the user started, rooms of their spaces, rooms they were let into and rooms they were invited
 * to in a DM (the preview lists every room in the browser).
 */
function sp_visible_rooms(Ctx $ctx, string $meId, array $spaceIds, callable $filter): array
{
    $spaces = array_flip(array_map('strval', $spaceIds));
    $admitted = array_flip(array_map(fn ($a) => (string) $a['roomId'], $ctx->db->list('admissions', fn ($a) => $a['guestId'] === $meId && $a['status'] === 'admitted')));
    $invited = array_flip(array_map(fn ($m) => (string) ($m['roomCode'] ?? ''), $ctx->db->list('messages', fn ($m) => ($m['kind'] ?? '') === 'room' && sp_in_dm($m, $meId))));
    return $ctx->db->list('rooms', fn ($r) => $filter($r) && (
        ($r['createdBy'] ?? '') === $meId
        || (!empty($r['spaceId']) && isset($spaces[$r['spaceId']]))
        || isset($admitted[$r['id']])
        || isset($invited[(string) ($r['code'] ?? '')])
    ));
}

/** The side panel brand: the host's organisation while branding is active, else Loft. */
function sp_brand(Ctx $ctx, array $me): array
{
    $hosts = (bool) $ctx->db->list('memberships', fn ($m) => $m['userId'] === $me['id'] && $m['role'] === 'host');
    if ($hosts && empty($me['guest'])) {
        $org = org_for_host($ctx, $me);
        if (branding_active($org, $ctx->now())) return ['name' => $org['name'], 'monogram' => $org['monogram'], 'theme' => $org['theme']];
    }
    return ['name' => 'Loft', 'monogram' => 'L'];
}

routes()
    ->get('nav', function (Ctx $ctx) {
        $me = require_me($ctx);
        sp_deliver_due($ctx);
        auto_wrap_stale($ctx, $me['id']);
        money_daily($ctx, $me['id']);
        insights_daily($ctx, $me['id']);
        deliver_nudges($ctx, $me['id']);
        touch_seen($ctx);
        $spaces = sp_my_spaces($ctx, $me['id']);
        $cutoff = $ctx->now() - 12 * 3600000;
        $rooms = sp_visible_rooms($ctx, $me['id'], array_column($spaces, 'id'), fn ($r) => empty($r['endedAt']) && ms((string) ($r['createdAt'] ?? '')) > $cutoff);
        $dms = sp_dm_list($ctx, $me['id']);
        $review = sp_review_items($ctx, $me['id']);
        $notes = $ctx->db->list('notifications', fn ($n) => $n['userId'] === $me['id'] && empty($n['readAt']));
        $spaceRows = [];
        $chats = 0;
        foreach ($spaces as $s) {
            $unread = sp_space_unread($ctx, $s, $me['id']);
            $chats += $unread;
            $spaceRows[] = ['id' => $s['id'], 'slug' => $s['slug'], 'to' => "/s/{$s['slug']}", 'unread' => $unread];
        }
        $chats += sum($dms, fn ($d) => $d['unread']);
        return [
            'me' => public_user($me),
            'brand' => sp_brand($ctx, $me),
            'rooms' => array_map(fn ($r) => ['id' => $r['id'], 'name' => $r['name'], 'to' => "/r/{$r['code']}", 'people' => 0], $rooms),
            'spaces' => $spaceRows,
            'dms' => array_map(fn ($d) => ['id' => $d['id'], 'name' => $d['name'], 'to' => "/dm/{$d['id']}", 'presence' => $d['status']] + ($d['status'] === 'busy' ? ['note' => 'in a room'] : []) + ['canKnock' => $d['status'] === 'available'], array_slice($dms, 0, 6)),
            'counts' => ['review' => count($review), 'chats' => $chats, 'inbox' => count($review) + count($notes)],
        ];
    })
    ->get('home', function (Ctx $ctx) {
        $me = require_me($ctx);
        // Server: a new host has no settings row yet; Home reads settings.roomLink, so send the defaults.
        $settings = $ctx->db->get('settings', $me['id']) ?? sp_default_settings($me['id']);
        $spaces = sp_my_spaces($ctx, $me['id']);
        $now = $ctx->now();
        $startMs = (int) local($now)->setTime(0, 0, 0)->format('U') * 1000;
        $startIso = iso($startMs);
        $endIso = iso($startMs + DAY);
        $sp = index_by($spaces, fn ($s) => $s['id']);
        $mineSessions = sorted($ctx->db->list('sessions', fn ($x) => isset($sp[$x['spaceId'] ?? ''])), fn ($a, $b) => strcmp((string) $a['startsAt'], (string) $b['startsAt']));
        $live = sp_visible_rooms($ctx, $me['id'], array_column($spaces, 'id'), fn ($r) => empty($r['endedAt']));
        $today = [];
        foreach ($mineSessions as $x) {
            if (strcmp((string) $x['startsAt'], $startIso) < 0 || strcmp((string) $x['startsAt'], $endIso) >= 0) continue;
            $s = $sp[$x['spaceId']];
            $at = ms((string) $x['startsAt']);
            $isLive = $now >= $at && $now < $at + (int) ($x['minutes'] ?? 0) * 60000;
            $room = find($live, fn ($r) => ($r['spaceId'] ?? null) === $s['id']);
            $today[] = array_merge($x, ['spaceName' => $s['name'], 'code' => $s['code'], 'colour' => $s['colour'], 'slug' => $s['slug'], 'live' => $isLive, 'roomCode' => $room['code'] ?? null]);
        }
        $next = fn (string $spaceId) => find($mineSessions, fn ($x) => $x['spaceId'] === $spaceId && ms((string) $x['startsAt']) + (int) ($x['minutes'] ?? 0) * 60000 > $now);
        return [
            'me' => public_user($me),
            'settings' => $settings,
            'today' => $today,
            'spaces' => array_map(fn ($s) => array_merge($s, ['modeLabel' => space_mode((string) $s['mode'])['label'], 'next' => $next((string) $s['id'])['startsAt'] ?? null]), $spaces),
            'review' => sp_review_items($ctx, $me['id']),
            'rooms' => $live,
        ];
    })
    ->get('spaces', function (Ctx $ctx) {
        $me = require_me($ctx);
        return sp_my_spaces($ctx, $me['id']);
    })
    ->post('spaces', function (Ctx $ctx, array $p, array $in) {
        $me = require_me($ctx);
        $name = str($in['name'] ?? null, 60);
        if ($name === '') throw new BadRequest('Give the space a name');
        $mode = is_string($in['mode'] ?? null) && array_key_exists($in['mode'], SPACE_MODES) ? $in['mode'] : 'team';
        $base = slugify($name);
        $slug = $base !== '' ? $base : 'space';
        $taken = [];
        foreach ($ctx->db->list('spaces') as $s) $taken[(string) ($s['slug'] ?? '')] = true;
        for ($i = 2; isset($taken[$slug]); $i++) $slug = ($base !== '' ? $base : 'space') . "-$i";
        $now = $ctx->nowIso();
        $code = mb_strtoupper(str($in['code'] ?? null, 4));
        $space = [
            'id' => new_id('sp'),
            'orgId' => null,
            'mode' => $mode,
            'code' => $code !== '' ? $code : space_code($name),
            'name' => $name,
            'sub' => str($in['sub'] ?? null, 80) ?: space_mode($mode)['label'],
            'slug' => $slug,
            'colour' => str($in['colour'] ?? null, 12) ?: 'blue',
            'roomSlug' => $slug,
            'createdBy' => $me['id'],
            'createdAt' => $now,
        ];
        $ctx->db->put('spaces', $space);
        $ctx->db->put('memberships', ['id' => "{$space['id']}:{$me['id']}", 'spaceId' => $space['id'], 'userId' => $me['id'], 'role' => 'host', 'lastReadAt' => $now]);
        $ctx->changed('spaces');
        return $space;
    })
    ->get('spaces/:key', function (Ctx $ctx, array $p) {
        $s = sp_space($ctx, $p['key']);
        ['m' => $m, 'isHost' => $isHost] = sp_require_member($ctx, $s['id']);
        $members = $ctx->db->list('memberships', fn ($x) => $x['spaceId'] === $s['id']);
        $u = sp_users($ctx);
        $t = $ctx->nowIso();
        $upcoming = sorted($ctx->db->list('posts', fn ($x) => $x['spaceId'] === $s['id'] && $x['kind'] === 'task' && !empty($x['dueAt']) && strcmp((string) $x['dueAt'], $t) > 0), fn ($a, $b) => strcmp((string) $a['dueAt'], (string) $b['dueAt']));
        $sessions = sorted($ctx->db->list('sessions', fn ($x) => ($x['spaceId'] ?? '') === $s['id'] && strcmp((string) $x['startsAt'], $t) > 0), fn ($a, $b) => strcmp((string) $a['startsAt'], (string) $b['startsAt']));
        $people = array_map(fn ($x) => ['userId' => $x['userId'], 'role' => $x['role'], 'name' => $u[$x['userId']]['name'] ?? '?', 'status' => $u[$x['userId']]['status'] ?? 'offline', 'title' => $u[$x['userId']]['title'] ?? ''], $members);
        $people = sorted($people, fn ($a, $b) => $a['role'] === 'host' ? -1 : ($b['role'] === 'host' ? 1 : strcasecmp((string) $a['name'], (string) $b['name'])));
        $up = array_merge(
            array_map(fn ($x) => ['kind' => 'task', 'title' => $x['title'], 'at' => $x['dueAt']], $upcoming),
            array_map(fn ($x) => ['kind' => 'session', 'title' => $x['title'], 'at' => $x['startsAt']], $sessions)
        );
        $up = array_slice(sorted($up, fn ($a, $b) => strcmp((string) $a['at'], (string) $b['at'])), 0, 4);
        return array_merge($s, [
            'modeConfig' => space_mode((string) $s['mode']),
            'myRole' => $m['role'],
            'isHost' => $isHost,
            'joinCode' => sp_join_code($s),
            'members' => $people,
            'upcoming' => $up,
        ]);
    })
    ->post('spaces/:id/read', function (Ctx $ctx, array $p) {
        $m = sp_require_member($ctx, $p['id'])['m'];
        $ctx->db->patch('memberships', $m['id'], ['lastReadAt' => $ctx->nowIso()]);
        $ctx->changed('memberships');
        return ['ok' => true];
    })
    ->get('spaces/:id/posts', function (Ctx $ctx, array $p) {
        $me = sp_require_member($ctx, $p['id'])['me'];
        $members = $ctx->db->list('memberships', fn ($x) => $x['spaceId'] === $p['id']);
        $u = sp_users($ctx);
        $t = $ctx->nowIso();
        // Agenda posts appear at start − 1 h.
        $posts = sorted($ctx->db->list('posts', fn ($x) => $x['spaceId'] === $p['id'] && (empty($x['publishAt']) || strcmp((string) $x['publishAt'], $t) <= 0)), fn ($a, $b) => strcmp((string) $b['createdAt'], (string) $a['createdAt']));
        return array_map(fn ($x) => sp_post_view($ctx, $x, $me['id'], $members, $u), $posts);
    })
    ->post('spaces/:id/posts', function (Ctx $ctx, array $p, array $in) {
        ['me' => $me, 'isHost' => $isHost] = sp_require_member($ctx, $p['id']);
        $kind = in_array($in['kind'] ?? null, ['post', 'notice', 'task', 'recap', 'file'], true) ? $in['kind'] : 'post';
        if (($kind === 'task' || $kind === 'notice') && !$isHost) throw new Forbidden('Only hosts can post tasks and must-read notices');
        $body = str($in['body'] ?? null, 5000);
        $title = str($in['title'] ?? null, 160);
        if ($body === '' && $title === '') throw new BadRequest('Write something first');
        $post = ['id' => sortable_id('po'), 'spaceId' => $p['id'], 'kind' => $kind, 'title' => $title, 'body' => $body, 'mustRead' => $kind === 'notice' || ($in['mustRead'] ?? null) === true];
        $due = str($in['dueAt'] ?? null, 40);
        if ($due !== '') $post['dueAt'] = $due;
        $post['createdBy'] = $me['id'];
        $post['createdAt'] = $ctx->nowIso();
        $post['attachments'] = is_array($in['attachments'] ?? null) && array_is_list($in['attachments']) ? array_slice($in['attachments'], 0, 10) : [];
        $ctx->db->put('posts', $post);
        $space = sp_space($ctx, $p['id']);
        if ($post['mustRead'] || $kind === 'task') {
            $what = $title !== '' ? $title : mb_substr($body, 0, 60);
            foreach ($ctx->db->list('memberships', fn ($x) => $x['spaceId'] === $p['id'] && $x['userId'] !== $me['id']) as $m) {
                sp_notify($ctx, (string) $m['userId'], $kind === 'task' ? 'task' : 'notice', $kind === 'task' ? "New task: $what" : "Please confirm: $what", (string) $space['name'], "/s/{$space['slug']}");
            }
        }
        $ctx->changed('posts', 'notifications');
        return $post;
    })
    ->post('posts/:id/ack', function (Ctx $ctx, array $p) {
        $me = require_me($ctx);
        $post = $ctx->db->get('posts', $p['id']);
        if (!$post) throw new NotFound('Post not found');
        sp_require_member($ctx, (string) $post['spaceId']);
        $ctx->db->put('post_acks', ['id' => "{$post['id']}:{$me['id']}", 'postId' => $post['id'], 'userId' => $me['id'], 'at' => $ctx->nowIso()]);
        $ctx->changed('posts');
        return ['ok' => true];
    })
    ->post('posts/:id/remind', function (Ctx $ctx, array $p) {
        $post = $ctx->db->get('posts', $p['id']);
        if (!$post) throw new NotFound('Post not found');
        if (!sp_require_member($ctx, (string) $post['spaceId'])['isHost']) throw new Forbidden('Only hosts can send reminders');
        $members = $ctx->db->list('memberships', fn ($x) => $x['spaceId'] === $post['spaceId']);
        $acks = $ctx->db->list('post_acks', fn ($a) => $a['postId'] === $post['id']);
        $space = sp_space($ctx, (string) $post['spaceId']);
        $waiting = unacknowledged(array_map(fn ($m) => (string) $m['userId'], $members), array_map(fn ($a) => (string) $a['userId'], $acks), (string) $post['createdBy']);
        $what = (string) ($post['title'] ?? '') !== '' ? (string) $post['title'] : 'please confirm';
        foreach ($waiting as $uid) sp_notify($ctx, $uid, 'notice', "Reminder: $what", (string) $space['name'], "/s/{$space['slug']}");
        $ctx->changed('notifications');
        return ['reminded' => count($waiting)];
    })
    ->post('posts/:id/handin', function (Ctx $ctx, array $p, array $in) {
        $me = require_me($ctx);
        $post = $ctx->db->get('posts', $p['id']);
        if (!$post || $post['kind'] !== 'task') throw new NotFound('Task not found');
        sp_require_member($ctx, (string) $post['spaceId']);
        $ctx->db->put('submissions', ['id' => "{$post['id']}:{$me['id']}", 'postId' => $post['id'], 'spaceId' => $post['spaceId'], 'userId' => $me['id'], 'status' => 'handed-in', 'note' => str($in['note'] ?? null, 2000), 'at' => $ctx->nowIso()]);
        $space = sp_space($ctx, (string) $post['spaceId']);
        $first = first_name((string) $me['name']);
        foreach ($ctx->db->list('memberships', fn ($x) => $x['spaceId'] === $post['spaceId'] && ($x['role'] === 'host' || $x['role'] === 'cohost')) as $m) {
            sp_notify($ctx, (string) $m['userId'], 'handin', "$first handed in {$post['title']}", (string) $space['name'], "/s/{$space['slug']}/work");
        }
        $ctx->changed('submissions', 'notifications');
        return ['ok' => true];
    })
    ->get('spaces/:id/work', function (Ctx $ctx, array $p) {
        ['me' => $me, 'isHost' => $isHost] = sp_require_member($ctx, $p['id']);
        $u = sp_users($ctx);
        $tasks = sorted($ctx->db->list('posts', fn ($x) => $x['spaceId'] === $p['id'] && $x['kind'] === 'task'), fn ($a, $b) => strcmp((string) ($a['dueAt'] ?? ''), (string) ($b['dueAt'] ?? '')));
        $members = $ctx->db->list('memberships', fn ($x) => $x['spaceId'] === $p['id'] && $x['role'] !== 'host' && $x['role'] !== 'cohost');
        return array_map(function ($t) use ($ctx, $u, $isHost, $me, $members) {
            $subs = $ctx->db->list('submissions', fn ($s) => $s['postId'] === $t['id']);
            return array_merge($t, [
                'assigned' => count($members),
                'submissions' => $isHost ? array_map(fn ($s) => array_merge($s, ['name' => $u[$s['userId']]['name'] ?? '?']), $subs) : array_values(array_filter($subs, fn ($s) => $s['userId'] === $me['id'])),
            ]);
        }, $tasks);
    })
    ->post('submissions/:id/review', function (Ctx $ctx, array $p, array $in) {
        $sub = $ctx->db->get('submissions', $p['id']);
        if (!$sub) throw new NotFound('Hand-in not found');
        if (!sp_require_member($ctx, (string) $sub['spaceId'])['isHost']) throw new Forbidden('Only hosts review hand-ins');
        $next = $ctx->db->patch('submissions', $sub['id'], ['status' => ($in['status'] ?? null) === 'returned' ? 'returned' : 'done', 'feedback' => str($in['feedback'] ?? null, 2000)]);
        $ctx->changed('submissions');
        return $next;
    })
    ->get('spaces/:id/files', function (Ctx $ctx, array $p) {
        sp_require_member($ctx, $p['id']);
        $u = sp_users($ctx);
        $files = sorted($ctx->db->list('files', fn ($f) => ($f['spaceId'] ?? null) === $p['id']), fn ($a, $b) => strcmp((string) $b['createdAt'], (string) $a['createdAt']));
        return array_map(fn ($f) => sp_file_view($f, $u), $files);
    })
    ->post('spaces/:id/files', function (Ctx $ctx, array $p, array $in) {
        $me = sp_require_member($ctx, $p['id'])['me'];
        $ref = is_array($in['ref'] ?? null) ? $in['ref'] : [];
        $refId = is_string($ref['id'] ?? null) ? $ref['id'] : '';
        if ($refId === '') throw new BadRequest('Upload the file first');
        // Server: POST files already stored a row for this upload (with the space). Use it rather
        // than adding a second row, so the file is listed once.
        $up = $ctx->db->get('files', $refId);
        if ($up && empty($up['fileId']) && ($up['ownerId'] ?? null) === $me['id'] && (empty($up['spaceId']) || $up['spaceId'] === $p['id'])) {
            $row = empty($up['spaceId']) ? $ctx->db->patch('files', $refId, ['spaceId' => $p['id']]) : $up;
            $ctx->changed('files');
            return sp_file_view($row, sp_users($ctx));
        }
        $row = ['id' => sortable_id('fl'), 'fileId' => $refId, 'name' => str($ref['name'] ?? null, 200), 'mime' => $ref['mime'] ?? null, 'bytes' => $ref['bytes'] ?? ($ref['size'] ?? null), 'sha256' => $ref['sha256'] ?? null, 'spaceId' => $p['id'], 'ownerId' => $me['id'], 'createdAt' => $ctx->nowIso()];
        $ctx->db->put('files', $row);
        $ctx->changed('files');
        return $row;
    })
    ->get('spaces/:id/messages', function (Ctx $ctx, array $p) {
        sp_require_member($ctx, $p['id']);
        $msgs = $ctx->db->list('messages', fn ($m) => ($m['channelType'] ?? '') === 'space' && ($m['channelId'] ?? '') === $p['id']);
        return sorted($msgs, fn ($a, $b) => strcmp((string) $a['id'], (string) $b['id']));
    })
    ->post('spaces/:id/messages', function (Ctx $ctx, array $p, array $in) {
        $me = sp_require_member($ctx, $p['id'])['me'];
        $body = str($in['body'] ?? null, 2000);
        if ($body === '') throw new BadRequest('Empty message');
        $m = ['id' => sortable_id('msg'), 'channelType' => 'space', 'channelId' => $p['id'], 'userId' => $me['id'], 'name' => $me['name'], 'body' => $body, 'createdAt' => $ctx->nowIso()];
        $ctx->db->put('messages', $m);
        $ctx->changed('messages');
        return $m;
    })
    ->post('spaces/:id/members', function (Ctx $ctx, array $p, array $in) {
        if (!sp_require_member($ctx, $p['id'])['isHost']) throw new Forbidden('Only hosts add people');
        $name = str($in['name'] ?? null, 60);
        if ($name === '') throw new BadRequest('Name required');
        $role = in_array($in['role'] ?? null, ['member', 'cohost', 'payer', 'guest'], true) ? $in['role'] : 'member';
        $email = str($in['email'] ?? null, 200);
        $now = $ctx->nowIso();
        // Server: an email is a sign-in identity, so someone who already has an account joins as
        // themselves instead of getting a duplicate user (sign-in links pick users by email).
        $existing = $email !== '' ? find($ctx->db->list('users'), fn ($x) => empty($x['guest']) && strtolower((string) ($x['email'] ?? '')) === strtolower($email)) : null;
        if ($existing) {
            if (!sp_membership($ctx, $p['id'], (string) $existing['id'])) {
                $ctx->db->put('memberships', ['id' => "{$p['id']}:{$existing['id']}", 'spaceId' => $p['id'], 'userId' => $existing['id'], 'role' => $role, 'lastReadAt' => $now]);
                $ctx->changed('memberships');
            }
            return ['id' => $existing['id'], 'name' => $existing['name'], 'email' => $existing['email'] ?? '', 'tz' => $existing['tz'] ?? 'UTC', 'status' => $existing['status'] ?? 'offline', 'title' => $existing['title'] ?? '', 'createdAt' => $existing['createdAt'] ?? $now];
        }
        $user = ['id' => new_id('u'), 'name' => $name, 'email' => $email, 'tz' => 'UTC', 'status' => 'offline', 'title' => '', 'createdAt' => $now];
        $ctx->db->put('users', $user);
        $ctx->db->put('memberships', ['id' => "{$p['id']}:{$user['id']}", 'spaceId' => $p['id'], 'userId' => $user['id'], 'role' => $role, 'lastReadAt' => $now]);
        $ctx->changed('memberships');
        return $user;
    })
    ->get('dms', function (Ctx $ctx) {
        $me = require_me($ctx);
        return sp_dm_list($ctx, $me['id']);
    })
    ->get('dms/:userId', function (Ctx $ctx, array $p) {
        $me = require_me($ctx);
        $peer = $ctx->db->get('users', $p['userId']);
        if (!$peer) throw new NotFound('Person not found');
        $key = sp_dm_key($me['id'], (string) $peer['id']);
        $msgs = sorted($ctx->db->list('messages', fn ($m) => ($m['channelType'] ?? '') === 'dm' && ($m['channelId'] ?? '') === $key), fn ($a, $b) => strcmp((string) $a['id'], (string) $b['id']));
        return ['peer' => ['id' => $peer['id'], 'name' => $peer['name'], 'status' => $peer['status'] ?? 'offline', 'title' => $peer['title'] ?? ''], 'messages' => $msgs];
    })
    ->post('dms/:userId/messages', function (Ctx $ctx, array $p, array $in) {
        $me = require_me($ctx);
        $body = str($in['body'] ?? null, 2000);
        if ($body === '') throw new BadRequest('Empty message');
        $m = ['id' => sortable_id('msg'), 'channelType' => 'dm', 'channelId' => sp_dm_key($me['id'], $p['userId']), 'userId' => $me['id'], 'name' => $me['name'], 'body' => $body, 'createdAt' => $ctx->nowIso()];
        $ctx->db->put('messages', $m);
        $ctx->db->put('dm_reads', ['id' => "{$me['id']}:{$m['channelId']}", 'at' => $m['createdAt']]);
        $ctx->changed('messages');
        return $m;
    })
    ->post('dms/:userId/read', function (Ctx $ctx, array $p) {
        $me = require_me($ctx);
        $ctx->db->put('dm_reads', ['id' => $me['id'] . ':' . sp_dm_key($me['id'], $p['userId']), 'at' => $ctx->nowIso()]);
        $ctx->changed('dm_reads');
        return ['ok' => true];
    })
    // "Start a room together": a room plus an invite card in the DM. Knock does the same with a nudge.
    ->post('dms/:userId/room', function (Ctx $ctx, array $p, array $in) {
        $me = require_me($ctx);
        $peer = $ctx->db->get('users', $p['userId']);
        if (!$peer) throw new NotFound('Person not found');
        $code = sp_unique_room_code($ctx);
        $first = first_name((string) $me['name']);
        $name = str($in['name'] ?? null, 60);
        if ($name === '') $name = $first . ' + ' . first_name((string) $peer['name']);
        $room = ['id' => new_id('rm'), 'spaceId' => null, 'slug' => strtolower($code), 'code' => $code, 'name' => $name, 'capacity' => ROOM_CAPACITY, 'guestJoin' => false, 'createdBy' => $me['id'], 'createdAt' => $ctx->nowIso(), 'endedAt' => null];
        $ctx->db->put('rooms', $room);
        $knock = ($in['knock'] ?? null) === true;
        $ctx->db->put('messages', ['id' => sortable_id('msg'), 'channelType' => 'dm', 'channelId' => sp_dm_key($me['id'], (string) $peer['id']), 'userId' => $me['id'], 'name' => $me['name'], 'body' => $knock ? 'knocked' : "Room · $name", 'kind' => 'room', 'roomCode' => $code, 'roomName' => $name, 'createdAt' => $ctx->nowIso()]);
        sp_notify($ctx, (string) $peer['id'], 'knock', $knock ? "$first knocked" : "$first started a room", $name, "/r/$code");
        $ctx->changed('rooms', 'messages', 'notifications');
        return $room;
    })
    ->get('notifications', function (Ctx $ctx) {
        $me = require_me($ctx);
        sp_deliver_due($ctx);
        $mine = sorted($ctx->db->list('notifications', fn ($n) => $n['userId'] === $me['id']), fn ($a, $b) => strcmp((string) $b['createdAt'], (string) $a['createdAt']));
        return array_slice($mine, 0, 50);
    })
    ->post('notifications/read-all', function (Ctx $ctx) {
        $me = require_me($ctx);
        foreach ($ctx->db->list('notifications', fn ($x) => $x['userId'] === $me['id'] && empty($x['readAt'])) as $n) {
            $ctx->db->patch('notifications', (string) $n['id'], ['readAt' => $ctx->nowIso()]);
        }
        $ctx->changed('notifications');
        return ['ok' => true];
    })
    ->post('notifications/:id/read', function (Ctx $ctx, array $p) {
        $me = require_me($ctx);
        // Server: only your own notifications.
        $n = $ctx->db->get('notifications', $p['id']);
        if (!$n || ($n['userId'] ?? null) !== $me['id']) throw new NotFound("notifications/{$p['id']} not found");
        $ctx->db->patch('notifications', $p['id'], ['readAt' => $ctx->nowIso()]);
        $ctx->changed('notifications');
        return ['ok' => true];
    })
    ->get('review', function (Ctx $ctx) {
        $me = require_me($ctx);
        return sp_review_items($ctx, $me['id']);
    });
