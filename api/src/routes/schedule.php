<?php
declare(strict_types=1);

namespace Loft;

// Port of packages/data/src/local/routes-schedule.ts (M5): calendar, sessions + series (clash check),
// .ics, availability, booking types, the public booking page, manage links, and change/booking requests.
//
// Server-only (the preview simulates these):
// - Calendar invites: creating, moving or cancelling a session, and confirming a booking, emails each
//   member/guest with an email an .ics attachment (same UID, stored SEQUENCE, METHOD CANCEL on cancel).
// - Busy times from a private https feed (`busyUrl`, alias `busyIcsUrl`): fetched when slots are computed
//   if the cached copy is older than 15 minutes, stored on the availability row (`busyFetchedIcs`,
//   `busyFetchedAt`). A failed fetch never fails the request; the last good copy stays in use.

const SCH_LATE_WINDOW_H = 24;
const SCH_FEED_TTL_MS = 15 * 60000;
const SCH_FEED_MAX_BYTES = 1048576;

/** @return array{spaces: list<array>, ids: array<string, true>, hostOf: array<string, true>} */
function sch_hosted_spaces(Ctx $ctx, string $meId): array
{
    $ids = [];
    $hostOf = [];
    foreach ($ctx->db->list('memberships', fn ($m) => $m['userId'] === $meId) as $m) {
        $ids[$m['spaceId']] = true;
        if ($m['role'] === 'host' || $m['role'] === 'cohost') $hostOf[$m['spaceId']] = true;
    }
    $spaces = $ctx->db->list('spaces', fn ($s) => isset($ids[$s['id']]));
    return ['spaces' => $spaces, 'ids' => $ids, 'hostOf' => $hostOf];
}

function sch_default_handle(?array $user): string
{
    return mb_strtolower(explode(' ', (string) ($user['name'] ?? 'host'))[0]);
}

/** The saved availability, or the default one (not saved: TS `availabilityFor`). */
function sch_availability_for(Ctx $ctx, string $userId): array
{
    $a = $ctx->db->get('availability', $userId);
    if ($a && isset($a['handle'])) return $a;
    $user = $ctx->db->get('users', $userId);
    // A row saved only to keep the private feed token has no handle yet (so no public booking page).
    if ($a) return $a + ['handle' => sch_default_handle($user), 'bio' => ''];
    // The browser uses its own zone; the server uses the user's, then the install's.
    $cfg = Config::get('timezone');
    $tz = sch_valid_tz($user['tz'] ?? null) ? (string) $user['tz'] : (sch_valid_tz($cfg) ? (string) $cfg : 'UTC');
    return array_merge(['id' => $userId], default_availability($tz), ['handle' => sch_default_handle($user), 'bio' => '', 'feedToken' => new_id()]);
}

/** Sessions in every space the host is in (not cancelled). */
function sch_host_sessions(Ctx $ctx, string $hostId): array
{
    $ids = sch_hosted_spaces($ctx, $hostId)['ids'];
    return $ctx->db->list('sessions', fn ($s) => isset($ids[$s['spaceId']]) && ($s['status'] ?? '') !== 'cancelled');
}

/** Busy blocks from the pasted ICS plus the cached copy of the feed URL. */
function sch_busy_from(array $av, int $from, int $to): array
{
    $busy = sch_filled($av['busyIcs'] ?? null) ? parse_ics_busy($av['busyIcs'], $from, $to) : [];
    if (sch_filled($av['busyFetchedIcs'] ?? null)) {
        $busy = array_merge($busy, parse_ics_busy($av['busyFetchedIcs'], $from, $to));
        usort($busy, fn ($a, $b) => $a['start'] <=> $b['start']);
    }
    return $busy;
}

function sch_feed_url(array $av): string
{
    $url = $av['busyIcsUrl'] ?? null;
    if (!sch_filled($url)) $url = $av['busyUrl'] ?? null;
    return is_string($url) ? trim($url) : '';
}

/** Refresh the cached feed copy when it is older than 15 minutes. Never throws. */
function sch_refresh_busy(Ctx $ctx, array $av): array
{
    $url = sch_feed_url($av);
    if ($url === '') return $av;
    $at = $av['busyFetchedAt'] ?? null;
    if (sch_filled($at) && $ctx->now() - ms($at) < SCH_FEED_TTL_MS) return $av;
    try {
        $text = sch_fetch_ics($url);
    } catch (\Throwable) {
        $text = null;
    }
    // Stamp the attempt even when it failed, so a dead feed is retried every 15 minutes, not every request.
    $patch = ['busyFetchedAt' => $ctx->nowIso()];
    if ($text !== null) $patch['busyFetchedIcs'] = $text;
    try {
        if ($ctx->db->get('availability', (string) $av['id'])) return $ctx->db->patch('availability', (string) $av['id'], $patch);
    } catch (\Throwable) {
    }
    return array_merge($av, $patch);
}

/** A host name that resolves only to public addresses (no requests into the hosting network). */
function sch_public_ip(string $host): ?string
{
    $ips = filter_var($host, FILTER_VALIDATE_IP) ? [$host] : (gethostbynamel($host) ?: []);
    if (!$ips) return null;
    foreach ($ips as $ip) {
        if (!filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) return null;
    }
    return $ips[0];
}

/** Fetch a private calendar feed: https only (webcal:// is read as https), 5 s, at most 1 MB. Null on any failure. */
function sch_fetch_ics(string $url): ?string
{
    $hook = $GLOBALS['loft_fetch_ics'] ?? null; // tests replace the network
    if (is_callable($hook)) {
        $text = $hook($url);
        return is_string($text) ? $text : null;
    }
    if (!function_exists('curl_init')) return null;
    if (stripos($url, 'webcal://') === 0) $url = 'https://' . substr($url, 9);
    $deadline = microtime(true) + 5;
    for ($hop = 0; $hop < 4; $hop++) {
        $u = parse_url($url);
        if (!is_array($u) || strtolower((string) ($u['scheme'] ?? '')) !== 'https' || empty($u['host'])) return null;
        $host = trim((string) $u['host'], '[]');
        $port = (int) ($u['port'] ?? 443);
        $ip = sch_public_ip($host);
        $left = (int) (($deadline - microtime(true)) * 1000);
        if ($ip === null || $left <= 0) return null;
        $body = '';
        $ch = curl_init($url);
        if ($ch === false) return null;
        curl_setopt_array($ch, [
            CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_RESOLVE => ["$host:$port:" . (str_contains($ip, ':') ? "[$ip]" : $ip)],
            CURLOPT_CONNECTTIMEOUT_MS => $left,
            CURLOPT_TIMEOUT_MS => $left,
            CURLOPT_USERAGENT => 'Loft calendar sync',
            CURLOPT_HTTPHEADER => ['Accept: text/calendar, text/plain;q=0.8, */*;q=0.1'],
            CURLOPT_ENCODING => '',
            CURLOPT_WRITEFUNCTION => function ($handle, string $chunk) use (&$body): int {
                if (strlen($body) + strlen($chunk) > SCH_FEED_MAX_BYTES) return 0; // abort: over 1 MB
                $body .= $chunk;
                return strlen($chunk);
            },
        ]);
        $ok = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $next = (string) (curl_getinfo($ch, CURLINFO_REDIRECT_URL) ?: '');
        unset($ch);
        if ($ok === false) return null;
        if ($status >= 300 && $status < 400 && $next !== '') {
            $url = $next; // each hop is checked again (https, public address)
            continue;
        }
        return $status === 200 && str_contains($body, 'BEGIN:VCALENDAR') ? $body : null;
    }
    return null;
}

function sch_notify(Ctx $ctx, string $userId, string $kind, string $title, string $sub, string $link): void
{
    $ctx->db->put('notifications', ['id' => sortable_id('nt'), 'userId' => $userId, 'kind' => $kind, 'title' => $title, 'sub' => $sub, 'link' => $link, 'createdAt' => $ctx->nowIso(), 'readAt' => null]);
}

function sch_notify_members(Ctx $ctx, string $spaceId, string $exceptId, string $kind, string $title, string $sub, string $link): void
{
    foreach ($ctx->db->list('memberships', fn ($x) => $x['spaceId'] === $spaceId && $x['userId'] !== $exceptId) as $m) {
        sch_notify($ctx, (string) $m['userId'], $kind, $title, $sub, $link);
    }
}

function sch_require_host_of(Ctx $ctx, array $s): array
{
    $me = require_me($ctx);
    $m = $ctx->db->get('memberships', "{$s['spaceId']}:{$me['id']}");
    if (!$m || ($m['role'] !== 'host' && $m['role'] !== 'cohost')) throw new Forbidden('Only the host can change sessions');
    return $me;
}

function sch_series_targets(array $all, array $s, string $scope): array
{
    if (empty($s['seriesId']) || $scope === 'this') return [$s];
    $same = array_values(array_filter($all, fn ($x) => ($x['seriesId'] ?? null) === $s['seriesId'] && ($x['status'] ?? '') !== 'cancelled'));
    return $scope === 'following' ? array_values(array_filter($same, fn ($x) => strcmp((string) $x['startsAt'], (string) $s['startsAt']) >= 0)) : $same;
}

/** @return array{av: array, slots: list<string>} */
function sch_slots_for(Ctx $ctx, string $hostId, int|float $minutes): array
{
    $av = sch_refresh_busy($ctx, sch_availability_for($ctx, $hostId));
    $now = $ctx->now();
    $taken = array_merge(array_map(fn ($s) => to_interval($s), sch_host_sessions($ctx, $hostId)), sch_busy_from($av, $now, (int) ($now + $av['rules']['horizonDays'] * DAY)));
    return ['av' => $av, 'slots' => free_slots($av, $minutes, $taken, $now)];
}

function sch_host_by_handle(Ctx $ctx, string $handle): array
{
    $host = find($ctx->db->list('availability'), fn ($a) => ($a['handle'] ?? null) === $handle);
    if (!$host) throw new NotFound('No booking page here');
    return $host;
}

function sch_booking_by_token(Ctx $ctx, string $token): array
{
    $b = find($ctx->db->list('bookings'), fn ($x) => ($x['manageToken'] ?? null) === $token);
    if (!$b) throw new NotFound("This link isn't valid any more");
    return $b;
}

function sch_user_name(Ctx $ctx, string $id, string $fallback): string
{
    $u = $ctx->db->get('users', $id);
    return $u ? (string) $u['name'] : $fallback;
}

/** Date.parse() would succeed (the app sends ISO strings). */
function sch_valid_date(string $s): bool
{
    if (!preg_match('/^\d{4}-\d{2}-\d{2}/', $s)) return false;
    try {
        new \DateTimeImmutable($s);
        return true;
    } catch (\Throwable) {
        return false;
    }
}

/** Weekly ranges always go out (and are stored) as an object keyed by weekday, never a JSON list. */
function sch_weekly_out(mixed $weekly): object
{
    return (object) (is_array($weekly) || is_object($weekly) ? (array) $weekly : []);
}

/** An availability row as the app sees it (the cached feed copy stays on the server). */
function sch_av_out(array $av): array
{
    unset($av['busyFetchedIcs']);
    $av['weekly'] = sch_weekly_out($av['weekly'] ?? []);
    return $av;
}

/** Another user's page already uses this handle → nusrat-2, nusrat-3 … */
function sch_unique_handle(Ctx $ctx, string $handle, string $userId): string
{
    if ($handle === '') return $handle;
    $rows = $ctx->db->list('availability', fn ($a) => $a['id'] !== $userId);
    $taken = fn (string $h) => some($rows, fn ($a) => ($a['handle'] ?? null) === $h);
    if (!$taken($handle)) return $handle;
    $i = 2;
    while ($taken("$handle-$i")) $i++;
    return "$handle-$i";
}

/** The room link for a session's space (TS hard-codes the hosted URL; the server uses app_url). */
function sch_room_link(Ctx $ctx, ?array $space): string
{
    $slug = (string) ($space['slug'] ?? '');
    $base = (string) ($ctx->baseUrl ?: Config::get('app_url', ''));
    return $base !== '' ? $ctx->appUrl('/r/' . $slug) : 'https://tanziro.com/spaces/r/' . $slug;
}

function sch_ics_event(Ctx $ctx, array $s, ?array $space): array
{
    $start = ms((string) $s['startsAt']);
    return [
        'id' => (string) $s['id'],
        'startsAt' => $start,
        'endsAt' => $start + $s['minutes'] * 60000,
        'summary' => $s['title'] . ' · ' . ($space['name'] ?? ''),
        'location' => ($s['room'] ?? '') === 'external' && sch_filled($s['externalUrl'] ?? null) ? $s['externalUrl'] : sch_room_link($ctx, $space),
        'sequence' => $s['sequence'] ?? 0,
    ];
}

/** The .ics attached to an invite: one event, its stable UID and stored SEQUENCE, organised by the space's host. */
function sch_invite_ics(Ctx $ctx, array $s, string $method, ?array $space): string
{
    $host = sch_filled($space['createdBy'] ?? null) ? $ctx->db->get('users', $space['createdBy']) : null;
    $organizer = $host && filter_var($host['email'] ?? '', FILTER_VALIDATE_EMAIL) ? ['name' => (string) $host['name'], 'email' => (string) $host['email']] : null;
    return build_ics_calendar(['name' => $space['name'] ?? 'Loft', 'method' => $method, 'organizer' => $organizer, 'events' => [sch_ics_event($ctx, $s, $space)]]);
}

/** "Tue 24 Nov 2026, 16:00 +06" in the recipient's zone (the install's zone for guests). */
function sch_when(string $startsAt, mixed $tz): string
{
    $zone = sch_valid_tz($tz) ? sch_zone($tz) : tz();
    return (new \DateTimeImmutable('@' . (int) floor(ms($startsAt) / 1000)))->setTimezone($zone)->format('D j M Y, H:i T');
}

/**
 * Email calendar invites for sessions that were created ("new"), moved ("update") or cancelled ("cancel").
 * Members of the space (or the one member of a private session) and booking guests, except `$exceptId`,
 * get one email each with one .ics per session. Returns how many emails went out; never throws.
 */
function sch_send_invites(Ctx $ctx, array $sessions, string $kind, ?string $exceptId = null): int
{
    $method = $kind === 'cancel' ? 'CANCEL' : 'REQUEST';
    $to = [];
    foreach ($sessions as $s) {
        $space = $ctx->db->get('spaces', (string) $s['spaceId']);
        $people = [];
        if (!empty($s['bookingId'])) {
            // A booking belongs to its guest, never to the rest of the space; invites start once it's confirmed.
            $b = $ctx->db->get('bookings', (string) $s['bookingId']);
            $st = $b['status'] ?? '';
            if ($b && ($st === 'scheduled' || ($kind === 'cancel' && $st === 'cancelled')) && filter_var($b['guestEmail'] ?? '', FILTER_VALIDATE_EMAIL)) {
                $people[] = ['name' => (string) $b['guestName'], 'email' => (string) $b['guestEmail'], 'tz' => null];
            }
        } else {
            $ids = !empty($s['forUserId']) ? [(string) $s['forUserId']] : array_map(fn ($m) => (string) $m['userId'], $ctx->db->list('memberships', fn ($m) => $m['spaceId'] === $s['spaceId']));
            foreach ($ids as $uid) {
                if ($uid === $exceptId) continue;
                $u = $ctx->db->get('users', $uid);
                if ($u && filter_var($u['email'] ?? '', FILTER_VALIDATE_EMAIL)) $people[] = ['name' => (string) $u['name'], 'email' => (string) $u['email'], 'tz' => $u['tz'] ?? null];
            }
        }
        foreach ($people as $r) {
            $key = strtolower($r['email']);
            $to[$key] ??= $r + ['items' => []];
            $to[$key]['items'][] = ['session' => $s, 'space' => $space];
        }
    }
    $sent = 0;
    foreach ($to as $r) {
        try {
            $items = $r['items'];
            $n = count($items);
            $first = $items[0]['session'];
            $what = $first['title'] . ' (' . ($items[0]['space']['name'] ?? 'Loft') . ')';
            if ($kind === 'cancel') {
                $subject = 'Cancelled: ' . $first['title'];
                $intro = ($n > 1 ? 'These sessions are cancelled: ' : 'This session is cancelled: ') . $what;
                $outro = 'Open the attached invite to remove it from your calendar.';
            } elseif ($kind === 'update') {
                $subject = 'Updated: ' . $first['title'];
                $intro = 'New time for ' . $what;
                $outro = 'The updated calendar invite is attached.';
            } else {
                $subject = 'Invite: ' . $first['title'] . ($n > 1 ? " · $n sessions" : '');
                $intro = "You're invited: " . $what;
                $outro = 'The calendar invite is attached.';
            }
            $lines = [];
            $attachments = [];
            foreach ($items as $i => $it) {
                $s = $it['session'];
                $lines[] = '• ' . sch_when((string) $s['startsAt'], $r['tz']) . ' · ' . $s['minutes'] . ' min';
                $attachments[] = ['name' => $n > 1 ? 'invite-' . ($i + 1) . '.ics' : 'invite.ics', 'type' => "text/calendar; method=$method; charset=utf-8", 'body' => sch_invite_ics($ctx, $s, $method, $it['space'])];
            }
            $join = $kind === 'cancel' ? '' : "\n\nJoin: " . sch_ics_event($ctx, $first, $items[0]['space'])['location'];
            $body = 'Hi ' . first_name($r['name']) . ",\n\n$intro\n\n" . implode("\n", $lines) . "$join\n\n$outro";
            if (send_mail($r['email'], $subject, $body, $attachments)) $sent++;
        } catch (\Throwable $e) {
            error_log('[loft] invite email failed: ' . $e->getMessage());
        }
    }
    return $sent;
}

routes()
    ->get('calendar', function (Ctx $ctx, array $p, array $q) {
        $me = require_me($ctx);
        ['spaces' => $spaces, 'ids' => $ids, 'hostOf' => $hostOf] = sch_hosted_spaces($ctx, $me['id']);
        $from = str($q['from'] ?? null, 40) ?: iso($ctx->now() - 7 * DAY);
        $to = str($q['to'] ?? null, 40) ?: iso($ctx->now() + 35 * DAY);
        $sp = index_by($spaces, fn ($s) => $s['id']);
        $list = $ctx->db->list('sessions', fn ($s) => isset($ids[$s['spaceId']]) && strcmp((string) $s['startsAt'], $from) >= 0 && strcmp((string) $s['startsAt'], $to) <= 0 && (empty($s['forUserId']) || $s['forUserId'] === $me['id'] || isset($hostOf[$s['spaceId']])));
        $sessions = array_map(fn ($s) => array_merge($s, [
            'spaceName' => $sp[$s['spaceId']]['name'] ?? '',
            'code' => $sp[$s['spaceId']]['code'] ?? '',
            'colour' => $sp[$s['spaceId']]['colour'] ?? 'blue',
            'slug' => $sp[$s['spaceId']]['slug'] ?? '',
            'isHost' => isset($hostOf[$s['spaceId']]),
        ]), sorted($list, fn ($a, $b) => strcmp((string) $a['startsAt'], (string) $b['startsAt'])));
        $av = sch_availability_for($ctx, $me['id']);
        // Server-only: keep the private feed token, so GET ics/<token>.ics works before availability is saved.
        // No handle is stored, so this creates no public booking page.
        if (!$ctx->db->get('availability', $me['id'])) {
            $ctx->db->put('availability', ['id' => $me['id'], 'tz' => $av['tz'], 'weekly' => sch_weekly_out($av['weekly']), 'rules' => $av['rules'], 'bio' => '', 'feedToken' => $av['feedToken']]);
        }
        $requests = pending_requests($ctx, $me['id']);
        return [
            'tz' => $av['tz'],
            'sessions' => $sessions,
            'requests' => $requests,
            'availability' => ['tz' => $av['tz'], 'weekly' => sch_weekly_out($av['weekly'])],
            'spaces' => array_map(fn ($s) => ['id' => $s['id'], 'name' => $s['name'] ?? '', 'code' => $s['code'] ?? '', 'colour' => $s['colour'] ?? null, 'isHost' => isset($hostOf[$s['id']])], $spaces),
            'feedToken' => $av['feedToken'],
            'handle' => $av['handle'],
        ];
    })
    ->post('sessions', function (Ctx $ctx, array $p, array $in) {
        $me = require_me($ctx);
        $spaceId = str($in['spaceId'] ?? null, 60);
        $m = $ctx->db->get('memberships', "$spaceId:{$me['id']}");
        if (!$m || ($m['role'] !== 'host' && $m['role'] !== 'cohost')) throw new Forbidden('Pick a space you host');
        $title = str($in['title'] ?? null, 120) ?: 'Session';
        $minutes = max(15, min(480, sch_or(sch_num($in['minutes'] ?? null), 60)));
        $av = sch_availability_for($ctx, $me['id']);
        $rule = is_array($in['series'] ?? null) && $in['series'] ? $in['series'] : null;
        $starts = $rule ? expand_series(array_merge($rule, ['minutes' => $minutes, 'tz' => sch_truthy($rule['tz'] ?? null) ? (string) $rule['tz'] : $av['tz']])) : [str($in['startsAt'] ?? null, 40)];
        if (!sch_filled($starts[0] ?? null) || !sch_valid_date($starts[0])) throw new BadRequest('Pick a date and time');
        $skip = is_array($in['skip'] ?? null) ? $in['skip'] : [];
        $existing = sch_host_sessions($ctx, $me['id']);
        $av = sch_refresh_busy($ctx, $av);
        $now = $ctx->now();
        $clashes = find_clashes($starts, $minutes, $existing, sch_busy_from($av, $now - DAY, $now + 400 * DAY));
        if (sch_truthy($in['dryRun'] ?? null)) return ['starts' => $starts, 'clashes' => $clashes];
        $seriesId = $rule ? new_id('sr') : null;
        if ($seriesId) $ctx->db->put('series', ['id' => $seriesId, 'spaceId' => $spaceId, 'rule' => array_merge($rule, ['minutes' => $minutes]), 'createdAt' => $ctx->nowIso()]);
        $created = [];
        foreach ($starts as $s) {
            if (in_array($s, $skip, true)) continue;
            $row = ['id' => new_id('se'), 'spaceId' => $spaceId, 'seriesId' => $seriesId, 'title' => $title, 'startsAt' => $s, 'minutes' => $minutes, 'room' => ($in['room'] ?? null) === 'external' ? 'external' : 'loft', 'externalUrl' => str($in['externalUrl'] ?? null, 300) ?: null, 'status' => 'scheduled', 'sequence' => 0];
            $ctx->db->put('sessions', $row);
            $created[] = $row;
        }
        $space = $ctx->db->get('spaces', $spaceId);
        if ($created) {
            $n = count($created);
            sch_notify_members($ctx, $spaceId, $me['id'], 'invite', $title . ($n > 1 ? " · $n sessions" : ''), ($space['name'] ?? '') . ' · calendar invite', '/calendar');
            sch_send_invites($ctx, $created, 'new', $me['id']);
        }
        $ctx->changed('sessions', 'notifications');
        return ['created' => count($created), 'sessions' => $created, 'clashes' => $clashes];
    })
    ->post('sessions/:id/move', function (Ctx $ctx, array $p, array $in) {
        $s = $ctx->db->get('sessions', $p['id']);
        if (!$s) throw new NotFound('Session not found');
        $me = sch_require_host_of($ctx, $s);
        $to = str($in['startsAt'] ?? null, 40);
        if ($to === '' || !sch_valid_date($to)) throw new BadRequest('Pick a new time');
        $delta = ms($to) - ms((string) $s['startsAt']);
        $all = $ctx->db->list('sessions', fn ($x) => $x['spaceId'] === $s['spaceId']);
        $moved = [];
        foreach (sch_series_targets($all, $s, str($in['scope'] ?? null, 12) ?: 'this') as $t) {
            $moved[] = $ctx->db->patch('sessions', $t['id'], ['startsAt' => iso(ms((string) $t['startsAt']) + $delta), 'minutes' => sch_or(sch_num($in['minutes'] ?? null), $t['minutes']), 'sequence' => ($t['sequence'] ?? 0) + 1]);
        }
        sch_notify_members($ctx, $s['spaceId'], $me['id'], 'move', "{$s['title']} moved", 'Updated calendar invite sent', '/calendar');
        sch_send_invites($ctx, $moved, 'update', $me['id']);
        $ctx->changed('sessions', 'notifications');
        return ['ok' => true];
    })
    ->post('sessions/:id/cancel', function (Ctx $ctx, array $p, array $in) {
        $s = $ctx->db->get('sessions', $p['id']);
        if (!$s) throw new NotFound('Session not found');
        $me = sch_require_host_of($ctx, $s);
        $all = $ctx->db->list('sessions', fn ($x) => $x['spaceId'] === $s['spaceId']);
        $cancelled = [];
        foreach (sch_series_targets($all, $s, str($in['scope'] ?? null, 12) ?: 'this') as $t) {
            $cancelled[] = $ctx->db->patch('sessions', $t['id'], ['status' => 'cancelled', 'sequence' => ($t['sequence'] ?? 0) + 1]);
        }
        sch_notify_members($ctx, $s['spaceId'], $me['id'], 'move', "{$s['title']} cancelled", 'Calendar updated', '/calendar');
        sch_send_invites($ctx, $cancelled, 'cancel', $me['id']);
        $ctx->changed('sessions', 'notifications');
        return ['ok' => true];
    })
    ->get('sessions/:id/ics', function (Ctx $ctx, array $p) {
        $s = $ctx->db->get('sessions', $p['id']);
        if (!$s) throw new NotFound('Session not found');
        $space = $ctx->db->get('spaces', (string) $s['spaceId']);
        return [
            'filename' => preg_replace('/[^\w-]+/', '-', (string) $s['title']) . '.ics',
            'text' => build_ics_calendar(['name' => $space['name'] ?? 'Loft', 'method' => ($s['status'] ?? '') === 'cancelled' ? 'CANCEL' : 'REQUEST', 'events' => [sch_ics_event($ctx, $s, $space)]]),
        ];
    })
    // Private calendar feed (production: GET /ics/<token>.ics, text/calendar — see system.php).
    ->get('feed', function (Ctx $ctx) {
        $me = require_me($ctx);
        ['ids' => $ids, 'spaces' => $spaces] = sch_hosted_spaces($ctx, $me['id']);
        $sp = index_by($spaces, fn ($s) => $s['id']);
        $list = $ctx->db->list('sessions', fn ($s) => isset($ids[$s['spaceId']]) && ($s['status'] ?? '') !== 'cancelled' && (empty($s['forUserId']) || $s['forUserId'] === $me['id']));
        $events = array_map(fn ($s) => ['id' => (string) $s['id'], 'startsAt' => ms((string) $s['startsAt']), 'endsAt' => ms((string) $s['startsAt']) + $s['minutes'] * 60000, 'summary' => $s['title'] . ' · ' . ($sp[$s['spaceId']]['name'] ?? ''), 'sequence' => $s['sequence'] ?? 0], $list);
        return ['filename' => 'loft.ics', 'text' => build_ics_calendar(['name' => 'Loft', 'events' => $events])];
    })
    ->get('availability', function (Ctx $ctx) {
        $me = require_me($ctx);
        $av = sch_refresh_busy($ctx, sch_availability_for($ctx, $me['id']));
        $types = $ctx->db->list('booking_types', fn ($t) => $t['userId'] === $me['id']);
        ['spaces' => $spaces, 'hostOf' => $hostOf] = sch_hosted_spaces($ctx, $me['id']);
        $now = $ctx->now();
        return array_merge(sch_av_out($av), [
            'busyCount' => count(sch_busy_from($av, $now, $now + 30 * DAY)),
            'types' => $types,
            'spaces' => array_values(array_map(fn ($s) => ['id' => $s['id'], 'name' => $s['name'] ?? ''], array_filter($spaces, fn ($s) => isset($hostOf[$s['id']])))),
        ]);
    })
    ->post('availability', function (Ctx $ctx, array $p, array $in) {
        $me = require_me($ctx);
        $cur = sch_availability_for($ctx, $me['id']);
        $rules = is_array($in['rules'] ?? null) ? $in['rules'] : [];
        $rule = function (string $k) use ($rules, $cur) {
            $n = sch_num($rules[$k] ?? $cur['rules'][$k]);
            return is_float($n) && is_nan($n) ? $cur['rules'][$k] : sch_or($n, 0);
        };
        $handle = preg_replace('/[^a-z0-9-]/', '', mb_strtolower(str($in['handle'] ?? null, 40) ?: (string) $cur['handle'])) ?? '';
        $url = array_key_exists('busyIcsUrl', $in) ? str($in['busyIcsUrl'], 500) : (array_key_exists('busyUrl', $in) ? str($in['busyUrl'], 500) : null);
        $next = array_merge($cur, [
            'tz' => str($in['tz'] ?? null, 60) ?: $cur['tz'],
            'weekly' => sch_weekly_out(is_array($in['weekly'] ?? null) ? $in['weekly'] : $cur['weekly']),
            'rules' => ['bufferMin' => $rule('bufferMin'), 'noticeHours' => $rule('noticeHours'), 'maxPerDay' => $rule('maxPerDay'), 'horizonDays' => $rule('horizonDays')],
            'handle' => sch_unique_handle($ctx, $handle, $me['id']),
            'bio' => array_key_exists('bio', $in) ? str($in['bio'], 160) : ($cur['bio'] ?? ''),
            'busyUrl' => $url ?? ($cur['busyUrl'] ?? null),
            'busyIcs' => array_key_exists('busyIcs', $in) ? mb_substr(is_scalar($in['busyIcs']) ? (string) $in['busyIcs'] : '', 0, 200000) : ($cur['busyIcs'] ?? null),
        ]);
        if ($url !== null) {
            $next['busyIcsUrl'] = $url;
            // A new feed URL drops the cached copy so the next slot lookup fetches it.
            if ($url !== sch_feed_url($cur)) {
                $next['busyFetchedIcs'] = '';
                $next['busyFetchedAt'] = null;
            }
        }
        $ctx->db->put('availability', $next);
        $ctx->changed('availability');
        return sch_av_out($next);
    })
    ->post('booking-types', function (Ctx $ctx, array $p, array $in) {
        $me = require_me($ctx);
        $id = str($in['id'] ?? null, 60) ?: new_id('bt');
        $cur = $ctx->db->get('booking_types', $id);
        if ($cur && $cur['userId'] !== $me['id']) throw new NotFound('Booking type not found');
        $row = [
            'id' => $id,
            'userId' => $me['id'],
            'name' => str($in['name'] ?? null, 60) ?: 'Call',
            'minutes' => max(15, min(240, sch_or(sch_num($in['minutes'] ?? null), 30))),
            'priceCents' => max(0, sch_round(sch_or(sch_num($in['priceCents'] ?? null), 0))),
            'destSpaceId' => str($in['destSpaceId'] ?? null, 60) ?: null,
            'approval' => ($in['approval'] ?? null) === 'manual' ? 'manual' : 'auto',
            'blurb' => str($in['blurb'] ?? null, 200),
        ];
        $ctx->db->put('booking_types', $row);
        $ctx->changed('booking_types');
        return $row;
    })
    ->post('booking-types/:id/delete', function (Ctx $ctx, array $p) {
        $me = require_me($ctx);
        $t = $ctx->db->get('booking_types', $p['id']);
        if (!$t || $t['userId'] !== $me['id']) throw new NotFound('Booking type not found');
        $ctx->db->del('booking_types', $t['id']);
        $ctx->changed('booking_types');
        return ['ok' => true];
    })
    // ---- public booking page (no account) ----
    ->get('book/:handle', function (Ctx $ctx, array $p) {
        $host = sch_host_by_handle($ctx, $p['handle']);
        $user = $ctx->db->get('users', (string) $host['id']);
        $types = $ctx->db->list('booking_types', fn ($t) => $t['userId'] === $host['id']);
        return [
            'name' => $user['name'] ?? '',
            'bio' => $host['bio'] ?? '',
            'tz' => $host['tz'],
            'types' => array_map(fn ($t) => ['id' => $t['id'], 'name' => $t['name'], 'minutes' => $t['minutes'], 'priceCents' => $t['priceCents'], 'approval' => $t['approval'], 'blurb' => $t['blurb'] ?? ''], $types),
        ];
    })
    ->get('book/:handle/slots', function (Ctx $ctx, array $p, array $q) {
        $host = sch_host_by_handle($ctx, $p['handle']);
        $type = $ctx->db->get('booking_types', str($q['type'] ?? null, 60));
        if (!$type || $type['userId'] !== $host['id']) throw new NotFound('Pick a booking type');
        return sch_slots_for($ctx, (string) $host['id'], $type['minutes'])['slots'];
    })
    ->post('book/:handle', function (Ctx $ctx, array $p, array $in) {
        if (str($in['website'] ?? null, 200) !== '') return ['ok' => true, 'manageToken' => '']; // honeypot: pretend success
        $host = sch_host_by_handle($ctx, $p['handle']);
        $type = $ctx->db->get('booking_types', str($in['typeId'] ?? null, 60));
        if (!$type || $type['userId'] !== $host['id']) throw new NotFound('Pick a booking type');
        $name = str($in['name'] ?? null, 80);
        $email = str($in['email'] ?? null, 200);
        if ($name === '' || !preg_match('/^[^@\s]+@[^@\s]+\.[^@\s]+$/u', $email)) throw new BadRequest('Add your name and a valid email');
        $startsAt = str($in['startsAt'] ?? null, 40);
        $slots = sch_slots_for($ctx, (string) $host['id'], $type['minutes'])['slots'];
        if (!in_array($startsAt, $slots, true)) throw new BadRequest('That time was just taken. Pick another.');
        $spaceId = $type['destSpaceId'] ?? null;
        if (!$spaceId) {
            ['spaces' => $spaces, 'hostOf' => $hostOf] = sch_hosted_spaces($ctx, (string) $host['id']);
            $first = find($spaces, fn ($s) => isset($hostOf[$s['id']]));
            $spaceId = $first['id'] ?? null;
        }
        if (!$spaceId) throw new BadRequest("This host isn't taking bookings yet");
        $status = ($type['approval'] ?? '') === 'manual' ? 'requested' : 'scheduled';
        $session = ['id' => new_id('se'), 'spaceId' => $spaceId, 'title' => "{$type['name']} · $name", 'startsAt' => $startsAt, 'minutes' => $type['minutes'], 'room' => 'loft', 'status' => $status, 'sequence' => 0];
        $booking = ['id' => new_id('bk'), 'typeId' => $type['id'], 'hostId' => $host['id'], 'sessionId' => $session['id'], 'guestName' => $name, 'guestEmail' => $email, 'note' => str($in['note'] ?? null, 500), 'status' => $status, 'manageToken' => new_id(), 'createdAt' => $ctx->nowIso()];
        $session['bookingId'] = $booking['id'];
        $ctx->db->put('sessions', $session);
        $ctx->db->put('bookings', $booking);
        sch_notify($ctx, (string) $host['id'], 'booking', "New booking · {$type['name']}", "$name · " . ($status === 'requested' ? 'needs your approval' : 'confirmed'), '/calendar');
        if ($status === 'scheduled') sch_send_invites($ctx, [$session], 'new');
        $ctx->changed('sessions', 'bookings', 'notifications');
        return ['ok' => true, 'status' => $status, 'manageToken' => $booking['manageToken'], 'startsAt' => $startsAt, 'minutes' => $type['minutes'], 'typeName' => $type['name']];
    })
    ->get('manage/:token', function (Ctx $ctx, array $p) {
        $b = sch_booking_by_token($ctx, $p['token']);
        $s = $ctx->db->get('sessions', (string) $b['sessionId']);
        $type = $ctx->db->get('booking_types', (string) $b['typeId']);
        $host = sch_availability_for($ctx, (string) $b['hostId']);
        return ['booking' => $b, 'session' => $s, 'typeName' => $type['name'] ?? '', 'handle' => $host['handle'], 'minutes' => $type['minutes'] ?? ($s['minutes'] ?? 30)];
    })
    ->post('manage/:token/cancel', function (Ctx $ctx, array $p) {
        $b = sch_booking_by_token($ctx, $p['token']);
        $wasConfirmed = ($b['status'] ?? '') === 'scheduled';
        $ctx->db->patch('bookings', $b['id'], ['status' => 'cancelled']);
        $s = $ctx->db->get('sessions', (string) $b['sessionId']);
        if ($s) {
            $s = $ctx->db->patch('sessions', $s['id'], ['status' => 'cancelled', 'sequence' => ($s['sequence'] ?? 0) + 1]);
            if ($wasConfirmed) sch_send_invites($ctx, [$s], 'cancel');
        }
        sch_notify($ctx, (string) $b['hostId'], 'move', "{$b['guestName']} cancelled", (string) ($s['title'] ?? ''), '/calendar');
        $ctx->changed('sessions', 'bookings', 'notifications');
        return ['ok' => true];
    })
    ->post('manage/:token/move', function (Ctx $ctx, array $p, array $in) {
        $b = sch_booking_by_token($ctx, $p['token']);
        $s = $ctx->db->get('sessions', (string) $b['sessionId']);
        if (!$s) throw new NotFound('Session not found');
        $to = str($in['startsAt'] ?? null, 40);
        $slots = sch_slots_for($ctx, (string) $b['hostId'], $s['minutes'])['slots'];
        if (!in_array($to, $slots, true)) throw new BadRequest("That time isn't free. Pick another.");
        $next = $ctx->db->patch('sessions', $s['id'], ['startsAt' => $to, 'sequence' => ($s['sequence'] ?? 0) + 1]);
        sch_notify($ctx, (string) $b['hostId'], 'move', "{$b['guestName']} moved their booking", (string) $s['title'], '/calendar');
        sch_send_invites($ctx, [$next], 'update'); // reaches the guest once the booking is confirmed
        $ctx->changed('sessions', 'notifications');
        return ['ok' => true];
    })
    // ---- change requests (members propose; the host answers in one tap) ----
    ->post('sessions/:id/requests', function (Ctx $ctx, array $p, array $in) {
        $me = require_me($ctx);
        $s = $ctx->db->get('sessions', $p['id']);
        if (!$s) throw new NotFound('Session not found');
        if (!$ctx->db->get('memberships', "{$s['spaceId']}:{$me['id']}")) throw new Forbidden("You're not in this space");
        $kind = ($in['kind'] ?? null) === 'cancel' ? 'cancel' : 'move';
        $proposed = $kind === 'move' ? str($in['proposedStartsAt'] ?? null, 40) : null;
        if ($kind === 'move') {
            $host = find($ctx->db->list('memberships'), fn ($m) => $m['spaceId'] === $s['spaceId'] && $m['role'] === 'host');
            $slots = sch_slots_for($ctx, (string) ($host['userId'] ?? $me['id']), $s['minutes'])['slots'];
            if ($proposed === '' || !in_array($proposed, $slots, true)) throw new BadRequest("Pick one of the host's free times");
        }
        $r = ['id' => new_id('rq'), 'sessionId' => $s['id'], 'memberId' => $me['id'], 'kind' => $kind, 'proposedStartsAt' => $proposed, 'note' => str($in['note'] ?? null, 300), 'status' => 'pending', 'createdAt' => $ctx->nowIso()];
        $ctx->db->put('change_requests', $r);
        $ctx->changed('change_requests');
        return $r;
    })
    ->get('requests', function (Ctx $ctx) {
        $me = require_me($ctx);
        return pending_requests($ctx, $me['id']);
    })
    ->post('requests/:id', function (Ctx $ctx, array $p, array $in) {
        $me = require_me($ctx);
        $approve = ($in['decision'] ?? null) === 'approve';
        $booking = $ctx->db->get('bookings', $p['id']);
        if ($booking) {
            if ($booking['hostId'] !== $me['id']) throw new Forbidden('Not your booking');
            $ctx->db->patch('bookings', $booking['id'], ['status' => $approve ? 'scheduled' : 'declined']);
            $s = $ctx->db->patch('sessions', (string) $booking['sessionId'], ['status' => $approve ? 'scheduled' : 'cancelled']);
            if ($approve) sch_send_invites($ctx, [$s], 'new');
            $ctx->changed('bookings', 'sessions');
            return ['ok' => true, 'suggest' => $approve ? [] : next_free(sch_slots_for($ctx, $me['id'], 30)['slots'], $ctx->now())];
        }
        $r = $ctx->db->get('change_requests', $p['id']);
        if (!$r || ($r['status'] ?? '') !== 'pending') throw new NotFound('Request not found');
        $s = $ctx->db->get('sessions', (string) $r['sessionId']);
        if (!$s) throw new NotFound('Session not found');
        sch_require_host_of($ctx, $s);
        $ctx->db->patch('change_requests', $r['id'], ['status' => $approve ? 'approved' : 'declined']);
        $member = $ctx->db->get('users', (string) $r['memberId']);
        if ($approve && $r['kind'] === 'move' && sch_filled($r['proposedStartsAt'] ?? null)) {
            $others = count($ctx->db->list('memberships', fn ($m) => $m['spaceId'] === $s['spaceId'] && $m['role'] !== 'host' && $m['role'] !== 'cohost'));
            if ($others <= 1) {
                $moved = $ctx->db->patch('sessions', $s['id'], ['startsAt' => $r['proposedStartsAt'], 'sequence' => ($s['sequence'] ?? 0) + 1]);
                sch_send_invites($ctx, [$moved], 'update', $me['id']);
            } else {
                $own = array_merge($s, ['id' => new_id('se'), 'startsAt' => $r['proposedStartsAt'], 'title' => $s['title'] . ' · ' . ($member ? first_name((string) $member['name']) : ''), 'forUserId' => $r['memberId'], 'seriesId' => null, 'sequence' => 0]);
                $ctx->db->put('sessions', $own);
                sch_send_invites($ctx, [$own], 'new', $me['id']);
            }
        } elseif ($approve && $r['kind'] === 'cancel') {
            // A member cancelling a group session only drops their own attendance (recorded for billing in M7).
            $ctx->db->put('attendance_exceptions', ['id' => "{$s['id']}:{$r['memberId']}", 'sessionId' => $s['id'], 'userId' => $r['memberId'], 'kind' => 'cancelled']);
        }
        sch_notify($ctx, (string) $r['memberId'], 'move', $approve ? "Approved: {$s['title']}" : "Not this time: {$s['title']}", $approve ? 'Updated calendar invite sent' : 'Here are the next free times', '/calendar');
        $ctx->changed('sessions', 'change_requests', 'notifications');
        return ['ok' => true, 'suggest' => $approve ? [] : next_free(sch_slots_for($ctx, $me['id'], $s['minutes'])['slots'], $ctx->now())];
    });

/** Members' change requests and bookings waiting for the host (cross-module: Home and To review). */
function pending_requests(Ctx $ctx, string $hostId): array
{
    $now = $ctx->now();
    $hostOf = sch_hosted_spaces($ctx, $hostId)['hostOf'];
    $sessions = sch_host_sessions($ctx, $hostId);
    $out = [];
    foreach ($ctx->db->list('change_requests', fn ($x) => ($x['status'] ?? '') === 'pending') as $r) {
        $s = $ctx->db->get('sessions', (string) $r['sessionId']);
        if (!$s || !isset($hostOf[$s['spaceId']])) continue;
        if (ms((string) $s['startsAt']) < $now) {
            $ctx->db->patch('change_requests', $r['id'], ['status' => 'expired']); // unanswered requests expire at the original start
            continue;
        }
        $who = sch_user_name($ctx, (string) $r['memberId'], 'Someone');
        $clash = null;
        if (sch_filled($r['proposedStartsAt'] ?? null)) {
            $hits = find_clashes([$r['proposedStartsAt']], $s['minutes'], array_values(array_filter($sessions, fn ($x) => $x['id'] !== $s['id'])));
            $clash = $hits[0]['with'] ?? null;
        }
        $out[] = ['id' => $r['id'], 'kind' => $r['kind'], 'who' => $who, 'title' => $s['title'], 'from' => $s['startsAt'], 'to' => $r['proposedStartsAt'] ?? null, 'free' => !$clash, 'clash' => $clash, 'late' => is_late_change((string) $s['startsAt'], $now, SCH_LATE_WINDOW_H), 'note' => $r['note'] ?? ''];
    }
    foreach ($ctx->db->list('bookings', fn ($x) => $x['hostId'] === $hostId && ($x['status'] ?? '') === 'requested') as $b) {
        $s = $ctx->db->get('sessions', (string) $b['sessionId']);
        if (!$s) continue;
        $hits = find_clashes([$s['startsAt']], $s['minutes'], array_values(array_filter($sessions, fn ($x) => $x['id'] !== $s['id'] && ($x['status'] ?? '') !== 'requested')));
        $clash = $hits[0]['with'] ?? null;
        $out[] = ['id' => $b['id'], 'kind' => 'booking', 'who' => $b['guestName'], 'title' => $s['title'], 'from' => $s['startsAt'], 'to' => null, 'free' => !$clash, 'clash' => $clash, 'late' => false, 'note' => $b['note'] ?? ''];
    }
    return sorted($out, fn ($a, $b) => strcmp((string) $a['from'], (string) $b['from']));
}
