<?php
declare(strict_types=1);

namespace Loft;

// M9 resources: the agent link protocol (handoff §12) at a/<token>/* and the host's side of it: links and
// seats, prep tasks per space, the draft layer, "Needs you" questions and "Ready for you" review.
// Agents create drafts only. PHP twin of packages/data/src/local/routes-agents.ts. Server-only extras:
// errors are real HTTP statuses (AgentError), every agent write lands in the audit log, claims run in one
// transaction, and agents can upload files (POST a/<token>/files).

function ag_or(string $a, string $b): string
{
    return $a !== '' ? $a : $b;
}

/** JS `Number(v) || $or` for JSON input. */
function ag_num(mixed $v, int|float $or = 0): int|float
{
    if (is_bool($v)) $v = (int) $v;
    elseif (is_string($v)) {
        $t = trim($v);
        $v = $t === '' ? 0 : (is_numeric($t) ? $t + 0 : null);
    }
    if (!is_int($v) && !is_float($v)) return $or;
    if (is_float($v) && is_nan($v)) return $or;
    return $v == 0 ? $or : $v;
}

/** JS `String(v)`. */
function ag_js_string(mixed $v): string
{
    if (is_string($v)) return $v;
    if ($v === null) return 'null';
    if (is_bool($v)) return $v ? 'true' : 'false';
    if (is_int($v) || is_float($v)) return (string) $v;
    return '[object Object]';
}

function ag_iso(string $v): string
{
    try {
        $d = new \DateTimeImmutable($v);
    } catch (\Throwable) {
        throw new BadRequest('Invalid time value');
    }
    return iso((int) $d->format('U') * 1000 + (int) $d->format('v'));
}

/** An agent-protocol error with its HTTP status. Changes recorded so far are flushed first (the TS returned instead of throwing). */
function ag_fail(Ctx $ctx, string $message, int $status): never
{
    $ctx->flush();
    throw new AgentError($message, $status);
}

function ag_event(Ctx $ctx, string $hostId, ?string $taskId, ?string $seatId, ?string $linkId, string $kind, string $text, int|float $minutes = 0): void
{
    $ctx->db->put('agent_events', ['id' => sortable_id('ae'), 'at' => $ctx->nowIso(), 'hostId' => $hostId, 'taskId' => $taskId, 'seatId' => $seatId, 'linkId' => $linkId, 'kind' => $kind, 'text' => $text, 'minutes' => $minutes]);
}

function ag_host_spaces(Ctx $ctx, string $hostId): array
{
    $ids = array_flip(array_map(fn ($m) => (string) $m['spaceId'], $ctx->db->list('memberships', fn ($m) => ($m['userId'] ?? null) === $hostId && (($m['role'] ?? '') === 'host' || ($m['role'] ?? '') === 'cohost'))));
    return $ctx->db->list('spaces', fn ($s) => isset($ids[(string) $s['id']]));
}

function ag_link_label(Ctx $ctx, array $l): string
{
    if ($l['scope'] === 'workspace') return 'Workspace';
    if ($l['scope'] === 'space') return (string) ($ctx->db->get('spaces', (string) ($l['scopeId'] ?? ''))['name'] ?? 'Space');
    return (string) ($ctx->db->get('rooms', (string) ($l['scopeId'] ?? ''))['name'] ?? 'Room');
}

/** Which tasks a link can see: the whole workspace, one space, or one room's session. */
function ag_tasks_for(Ctx $ctx, array $l): array
{
    $all = $ctx->db->list('prep_tasks', fn ($t) => ($t['hostId'] ?? null) === $l['hostId']);
    if ($l['scope'] === 'workspace') return $all;
    if ($l['scope'] === 'space') return array_values(array_filter($all, fn ($t) => ($t['spaceId'] ?? null) === $l['scopeId']));
    return array_values(array_filter($all, fn ($t) => ($t['roomId'] ?? null) === $l['scopeId']));
}

/** Oldest "ready by" first, then oldest created. */
function ag_sort_tasks(array $tasks): array
{
    return sorted($tasks, fn ($a, $b) => strcmp((string) ($a['readyBy'] ?? '9'), (string) ($b['readyBy'] ?? '9')) ?: strcmp((string) $a['createdAt'], (string) $b['createdAt']));
}

/** The room a task's board drafts land in: the session's prepared room, created on first use. */
function ag_room_for(Ctx $ctx, array $t): ?string
{
    if (!empty($t['roomId'])) return (string) $t['roomId'];
    if (empty($t['sessionId'])) return null;
    $s = $ctx->db->get('sessions', (string) $t['sessionId']);
    if (!$s) return null;
    $prepared = is_array($s['prepared'] ?? null) ? $s['prepared'] : [];
    if (!empty($prepared['roomId']) && $ctx->db->get('rooms', (string) $prepared['roomId'])) return (string) $prepared['roomId'];
    $code = room_code();
    $room = ['id' => new_id('rm'), 'spaceId' => $s['spaceId'], 'sessionId' => $s['id'], 'slug' => strtolower($code), 'code' => $code, 'name' => $s['title'], 'capacity' => ROOM_CAPACITY, 'guestJoin' => false, 'createdBy' => $t['hostId'], 'createdAt' => $ctx->nowIso(), 'endedAt' => null];
    $ctx->db->put('rooms', $room);
    $ctx->db->update('sessions', $s['id'], fn (array $cur) => array_merge($cur, ['prepared' => array_merge(is_array($cur['prepared'] ?? null) ? $cur['prepared'] : [], ['roomId' => $room['id']])]));
    return $room['id'];
}

/**
 * Resolve token → link + seat, creating the seat on first contact. Enforces expiry, approval, revocation
 * and 60 requests a minute (the token bucket lives on the seat row, like the TS).
 * @return array{0: array, 1: array} [link, seat]
 */
function ag_auth(Ctx $ctx, string $token, array $in, bool $allowPending = false): array
{
    $link = find($ctx->db->list('agent_links'), fn ($l) => is_string($l['token'] ?? null) && hash_equals($l['token'], $token));
    if (!$link) ag_fail($ctx, 'Unknown agent link', 404);
    if (ms((string) $link['expiresAt']) < $ctx->now()) ag_fail($ctx, 'This agent link expired. Ask the host for a new one.', 410);
    $id = is_array($in['agent'] ?? null) ? $in['agent'] : [];
    $who = seat_from_request(is_string($id['userAgent'] ?? null) ? $id['userAgent'] : null, is_string($id['name'] ?? null) ? $id['name'] : null);
    $seats = $ctx->db->list('agent_seats', fn ($s) => ($s['linkId'] ?? null) === $link['id']);
    $seat = find($seats, fn ($s) => $s['runtime'] === $who['runtime'] && $s['name'] === $who['name']);
    if (!$seat) {
        $seat = [
            'id' => new_id('seat'),
            'linkId' => $link['id'],
            'hostId' => $link['hostId'],
            'name' => $who['name'],
            'runtime' => $who['runtime'],
            'version' => $who['version'],
            'seatNo' => count(array_filter($seats, fn ($s) => $s['runtime'] === $who['runtime'])) + 1,
            'status' => $link['scope'] === 'workspace' ? 'pending' : 'approved',
            'createdAt' => $ctx->nowIso(),
            'lastSeenAt' => $ctx->nowIso(),
            'bucket' => null,
        ];
        $ctx->db->put('agent_seats', $seat);
        ag_event($ctx, $link['hostId'], null, $seat['id'], $link['id'], 'seat', "{$seat['name']} connected ({$seat['runtime']}" . ($seat['version'] !== '' ? " {$seat['version']}" : '') . ')');
        $ctx->changed('agent_seats');
    }
    if ($seat['status'] === 'revoked') ag_fail($ctx, 'This seat was revoked by the host.', 403);
    if ($seat['status'] === 'pending' && !$allowPending) ag_fail($ctx, 'Waiting for the host to approve this seat.', 403);
    // Read-modify-write of the bucket in one transaction, so parallel requests can't both spend the last token.
    $rate = ['ok' => true, 'retryAfterMs' => 0];
    $now = $ctx->now();
    $seat = $ctx->db->update('agent_seats', $seat['id'], function (array $cur) use (&$rate, $now) {
        $rate = take_token(is_array($cur['bucket'] ?? null) ? $cur['bucket'] : null, $now);
        return array_merge($cur, ['bucket' => $rate['bucket'], 'lastSeenAt' => iso($now)]);
    });
    if (!$rate['ok']) ag_fail($ctx, 'Too many requests. Try again in ' . (int) ceil($rate['retryAfterMs'] / 1000) . ' s.', 429);
    return [$link, $seat];
}

function ag_next_view(Ctx $ctx, array $link, ?array $seat): array
{
    $tasks = ag_sort_tasks(ag_tasks_for($ctx, $link));
    $queued = array_values(array_filter($tasks, fn ($t) => $t['status'] === 'queued' || $t['status'] === 'changes'));
    $first = $queued[0] ?? null;
    $next = null;
    if ($first) {
        $inputs = strings($first['attachments'] ?? []);
        $recaps = count($ctx->db->list('posts', fn ($p) => ($p['spaceId'] ?? null) === $first['spaceId'] && ($p['kind'] ?? '') === 'recap'));
        if ($recaps) $inputs[] = 'last ' . min(3, $recaps) . ' recap' . ($recaps === 1 ? '' : 's');
        $s = !empty($first['sessionId']) ? $ctx->db->get('sessions', (string) $first['sessionId']) : null;
        $doneWhen = DONE_WHEN[$first['template']] ?? '';
        $next = [
            'title' => $first['title'] . ($s ? ' · ' . short_when((string) $s['startsAt']) : ''),
            'when' => $s['startsAt'] ?? '',
            'readyBy' => !empty($first['readyBy']) ? short_when((string) $first['readyBy']) : 'when you can',
            'inputs' => $inputs,
            'doneWhen' => !empty($first['feedback']) ? "$doneWhen · host asked: {$first['feedback']}" : $doneWhen,
        ];
    }
    $taskIds = array_map(fn ($t) => $t['id'], $tasks);
    $rejected = $ctx->db->list('agent_drafts', fn ($d) => ($d['status'] ?? '') === 'rejected' && !empty($d['reason']) && in_array($d['taskId'] ?? null, $taskIds, true));
    return [
        'title' => ag_link_label($ctx, $link),
        'seat' => $seat ? ['name' => $seat['name'], 'runtime' => $seat['runtime'], 'version' => $seat['version']] : null,
        'seatNo' => $seat['seatNo'] ?? null,
        'expiresAt' => $link['expiresAt'],
        'paused' => (bool) ($link['paused'] ?? false),
        'next' => $next,
        'queue' => array_map(fn ($t) => ['title' => $t['title'], 'note' => !empty($t['readyBy']) ? 'ready by ' . short_when((string) $t['readyBy']) : 'queued'], array_slice($queued, 1)),
        'rejected' => array_map(fn ($d) => ['title' => $d['title'], 'reason' => $d['reason']], array_slice($rejected, -5)),
    ];
}

/** The task a seat has claimed on this link, or 409. */
function ag_claimed_task(Ctx $ctx, array $link, array $seat, mixed $taskId): array
{
    $t = find(ag_tasks_for($ctx, $link), fn ($x) => $x['id'] === $taskId);
    if (!$t || ($t['seatId'] ?? null) !== $seat['id']) ag_fail($ctx, 'Claim the task first', 409);
    return $t;
}

function ag_claim(Ctx $ctx, array $link, array $seat): array
{
    $tasks = ag_sort_tasks(array_values(array_filter(ag_tasks_for($ctx, $link), fn ($t) => ($t['status'] === 'queued' || $t['status'] === 'changes') && (empty($t['who']) || $t['who'] === $seat['id']))));
    $t = $tasks[0] ?? null;
    if (!$t) return ['paused' => false, 'task' => null];
    $tpl = find(PREP_TEMPLATES, fn ($x) => $x['id'] === $t['template']);
    $roomId = $tpl && in_array('board_ops', $tpl['output'], true) ? ag_room_for($ctx, $t) : ($t['roomId'] ?? null);
    if ($roomId) {
        $busy = array_values(array_unique(array_map(fn ($x) => $x['seatId'] ?? null, $ctx->db->list('prep_tasks', fn ($x) => ($x['roomId'] ?? null) === $roomId && $x['status'] === 'working' && $x['id'] !== $t['id'])), SORT_REGULAR));
        if (count($busy) >= MAX_AGENTS_PER_ROOM && !in_array($seat['id'], $busy, true)) ag_fail($ctx, 'At most ' . MAX_AGENTS_PER_ROOM . ' agents per room. Try another task.', 409);
    }
    $next = array_merge($t, ['status' => 'working', 'seatId' => $seat['id'], 'claimedAt' => $ctx->nowIso(), 'roomId' => $roomId]);
    $ctx->db->put('prep_tasks', $next);
    ag_event($ctx, $t['hostId'], $t['id'], $seat['id'], $link['id'], 'claim', "claimed {$t['title']}");
    $ctx->db->audit('agent:' . $seat['id'], 'agent.claim', ['link' => $link['id'], 'task' => $t['id'], 'title' => $t['title']]);
    $ctx->changed('prep_tasks');
    $s = !empty($t['sessionId']) ? $ctx->db->get('sessions', (string) $t['sessionId']) : null;
    return ['paused' => false, 'task' => [
        'id' => $t['id'],
        'template' => $t['template'],
        'title' => $t['title'],
        'brief' => $t['brief'],
        'attachments' => $t['attachments'] ?? [],
        'readyBy' => $t['readyBy'] ?? null,
        'session' => $s ? ['title' => $s['title'], 'startsAt' => $s['startsAt'], 'minutes' => $s['minutes'] ?? null] : null,
        'feedback' => $t['feedback'] ?? null,
        'done_when' => DONE_WHEN[$t['template']] ?? '',
        'context' => ["/context/{$t['id']}"],
    ]];
}

// ---- the host's side ----

function ag_seat_views(Ctx $ctx, string $hostId): array
{
    $seats = sorted($ctx->db->list('agent_seats', fn ($s) => ($s['hostId'] ?? null) === $hostId && $s['status'] !== 'revoked'), fn ($a, $b) => strcmp((string) $a['createdAt'], (string) $b['createdAt']));
    $links = index_by($ctx->db->list('agent_links', fn ($l) => ($l['hostId'] ?? null) === $hostId), fn ($l) => $l['id']);
    $tasks = $ctx->db->list('prep_tasks', fn ($t) => ($t['hostId'] ?? null) === $hostId);
    $weekAgo = iso($ctx->now() - 7 * DAY);
    $evs = $ctx->db->list('agent_events', fn ($e) => ($e['hostId'] ?? null) === $hostId && strcmp((string) $e['at'], $weekAgo) > 0);
    $out = [];
    foreach ($seats as $s) {
        $l = $links[(string) $s['linkId']] ?? null;
        $mine = array_values(array_filter($tasks, fn ($t) => ($t['seatId'] ?? null) === $s['id']));
        $state = $s['status'] === 'pending' ? 'new' : (some($mine, fn ($t) => $t['status'] === 'needs_you') ? 'needs you' : (some($mine, fn ($t) => $t['status'] === 'working') ? 'active' : 'idle'));
        $out[] = [
            'id' => $s['id'],
            'name' => $s['name'],
            'runtime' => $s['runtime'],
            'version' => $s['version'],
            'seatNo' => $s['seatNo'],
            'status' => $s['status'],
            'linkLabel' => $l ? ag_link_label($ctx, $l) . ' link' : 'link',
            'state' => $state,
            'lastSeenAt' => $s['lastSeenAt'],
            'minutesWeek' => sum(array_filter($evs, fn ($e) => ($e['seatId'] ?? null) === $s['id']), fn ($e) => $e['minutes'] ?? 0),
        ];
    }
    return $out;
}

function ag_task_view(Ctx $ctx, array $t): array
{
    $seat = !empty($t['seatId']) ? $ctx->db->get('agent_seats', (string) $t['seatId']) : null;
    $drafts = $ctx->db->list('agent_drafts', fn ($d) => ($d['taskId'] ?? null) === $t['id']);
    $s = !empty($t['sessionId']) ? $ctx->db->get('sessions', (string) $t['sessionId']) : null;
    $space = $ctx->db->get('spaces', (string) $t['spaceId']);
    $n = count($drafts);
    $sub = match ($t['status']) {
        'working' => "$n draft" . ($n === 1 ? '' : 's') . ' so far' . (!empty($t['roomId']) ? ' · drafting in the room' : ''),
        'queued' => !empty($t['readyBy']) ? 'ready by ' . short_when((string) $t['readyBy']) : 'queued',
        'needs_you' => (string) ($t['question']['text'] ?? ''),
        default => implode(' · ', array_slice(array_map(fn ($d) => ag_or((string) ($d['sub'] ?? ''), (string) $d['title']), $drafts), 0, 2)),
    };
    return [
        'id' => $t['id'],
        'template' => $t['template'],
        'title' => $t['title'],
        'status' => $t['status'],
        'brief' => $t['brief'],
        'readyBy' => $t['readyBy'] ?? null,
        'minutes' => $t['minutes'] ?? 0,
        'report' => $t['report'] ?? '',
        'question' => $t['question'] ?? null,
        'feedback' => $t['feedback'] ?? null,
        'seat' => $seat ? ['id' => $seat['id'], 'name' => $seat['name']] : null,
        'session' => $s ? ['id' => $s['id'], 'title' => $s['title'], 'startsAt' => $s['startsAt']] : null,
        'space' => $space ? ['id' => $space['id'], 'name' => $space['name'], 'slug' => $space['slug'] ?? '', 'code' => $space['code'] ?? ''] : null,
        'roomId' => $t['roomId'] ?? null,
        'pending' => count(array_filter($drafts, fn ($d) => $d['status'] === 'pending')),
        'drafts' => $n,
        'sub' => $sub,
    ];
}

function ag_require_host_space(Ctx $ctx, string $spaceId): array
{
    $me = require_me($ctx);
    $m = $ctx->db->get('memberships', "$spaceId:{$me['id']}");
    if (!$m || (($m['role'] ?? '') !== 'host' && ($m['role'] ?? '') !== 'cohost')) throw new Forbidden('Only hosts manage agents');
    return $me;
}

function ag_link_for(Ctx $ctx, string $hostId, string $scope, ?string $scopeId, bool $create = true): ?array
{
    $found = $ctx->db->list('agent_links', fn ($l) => ($l['hostId'] ?? null) === $hostId && $l['scope'] === $scope && ($l['scopeId'] ?? null) === $scopeId)[0] ?? null;
    if ($found || !$create) return $found;
    $l = ['id' => new_id('al'), 'hostId' => $hostId, 'scope' => $scope, 'scopeId' => $scopeId, 'token' => new_id() . new_id(), 'expiresAt' => iso($ctx->now() + LINK_DAYS * DAY), 'paused' => false, 'liveEdits' => false, 'createdAt' => $ctx->nowIso()];
    $ctx->db->put('agent_links', $l);
    return $l;
}

function ag_apply_draft(Ctx $ctx, array $me, array $t, array $d): void
{
    $payload = is_array($d['payload'] ?? null) ? $d['payload'] : [];
    if ($d['kind'] === 'board_ops') {
        $roomId = ag_room_for($ctx, $t);
        if (!$roomId) throw new BadRequest('No board for this task');
        $ops = array_map(function ($o) use ($me, $ctx) {
            $o = is_array($o) ? $o : [];
            $op = is_array($o['payload'] ?? null) ? $o['payload'] : [];
            if (($o['kind'] ?? null) === 'add' && !empty($op['obj']) && is_array($op['obj'])) {
                $obj = $op['obj'];
                unset($obj['draft']);
                $obj['by'] = $me['id'];
                return ['actor' => $me['id'], 'ts' => $ctx->now(), 'kind' => 'add', 'payload' => array_merge($op, ['obj' => $obj])];
            }
            return ['actor' => $me['id'], 'ts' => $ctx->now(), 'kind' => ag_js_string($o['kind'] ?? 'update'), 'payload' => $o['payload'] ?? null];
        }, is_array($payload['ops'] ?? null) ? array_values($payload['ops']) : []);
        $ctx->db->appendOps($roomId, $ops);
        $ctx->opsChanged($roomId);
    } elseif ($d['kind'] === 'plan') {
        $id = new_id('pl');
        $ctx->db->put('plans', [
            'id' => $id,
            'spaceId' => $t['spaceId'],
            'title' => ag_js_string($payload['title'] ?? $t['title']),
            'minutes' => ag_num($payload['minutes'] ?? 60, 0),
            'objective' => '',
            'tags' => [],
            'unit' => 'Agent drafts',
            'order' => 99,
            'status' => 'draft',
            'aiDraft' => true,
            'blocks' => $payload['blocks'] ?? [],
            'sessionId' => $t['sessionId'] ?? null,
            'version' => 1,
            'createdAt' => $ctx->nowIso(),
            'updatedAt' => $ctx->nowIso(),
        ]);
        if (!empty($t['sessionId'])) $ctx->db->patch('sessions', (string) $t['sessionId'], ['planId' => $id]);
        $ctx->changed('plans', 'sessions');
    } elseif ($d['kind'] === 'post') {
        $ctx->db->put('posts', ['id' => sortable_id('po'), 'spaceId' => $t['spaceId'], 'kind' => 'post', 'title' => ag_js_string($payload['title'] ?? ''), 'body' => ag_js_string($payload['body'] ?? ''), 'mustRead' => false, 'createdBy' => $me['id'], 'createdAt' => $ctx->nowIso(), 'attachments' => []]);
        $ctx->changed('posts');
    } elseif ($d['kind'] === 'check') {
        // Agent input is untrusted on the server: questions go through the same cleaning as the check builder.
        $ctx->db->put('checks', ['id' => new_id('ck'), 'spaceId' => $t['spaceId'], 'title' => ag_js_string($payload['title'] ?? $t['title']), 'instructions' => '', 'questions' => ck_clean_questions($payload['questions'] ?? []), 'status' => 'draft', 'openAt' => null, 'closeAt' => null, 'timeLimitMin' => 10, 'maxAttempts' => 1, 'shuffle' => true, 'integrity' => true, 'createdAt' => $ctx->nowIso(), 'createdBy' => $me['id']]);
        $ctx->changed('checks');
    } elseif ($d['kind'] === 'invoice_draft') {
        build_drafts($ctx, $me['id'], month_key($ctx->now()));
    }
}

// ---- the protocol (what an agent calls) ----

routes()
    ->get('a/:token', function (Ctx $ctx, array $p, array $in) {
        [$link, $seat] = ag_auth($ctx, $p['token'], $in, true);
        return ['markdown' => next_markdown(ag_next_view($ctx, $link, $seat['status'] === 'approved' ? $seat : null))];
    })
    ->get('a/:token/next.json', function (Ctx $ctx, array $p, array $in) {
        [$link, $seat] = ag_auth($ctx, $p['token'], $in, true);
        return array_merge(['capabilities' => 'v1'], ag_next_view($ctx, $link, $seat), ['seatStatus' => $seat['status']]);
    })
    ->post('a/:token/claim', function (Ctx $ctx, array $p, array $in) {
        [$link, $seat] = ag_auth($ctx, $p['token'], $in);
        if (!empty($link['paused'])) return ['paused' => true, 'task' => null];
        $ctx->flush();
        // One immediate transaction: two agents claiming at once never get the same task.
        $pdo = $ctx->db->pdo;
        $own = !$pdo->inTransaction();
        if ($own) {
            $pdo->exec('BEGIN IMMEDIATE');
            $ctx->db->clearCache();
        }
        try {
            $out = ag_claim($ctx, $link, $seat);
            if ($own) $pdo->exec('COMMIT');
        } catch (\Throwable $e) {
            if ($own) $pdo->exec('ROLLBACK');
            $ctx->db->clearCache();
            throw $e;
        }
        return $out;
    })
    ->get('a/:token/context/:id', function (Ctx $ctx, array $p, array $in) {
        [$link] = ag_auth($ctx, $p['token'], $in);
        $t = find(ag_tasks_for($ctx, $link), fn ($x) => $x['id'] === $p['id']);
        if (!$t) ag_fail($ctx, 'No such task on this link', 404);
        $space = $ctx->db->get('spaces', (string) $t['spaceId']);
        $plans = $ctx->db->list('plans', fn ($x) => ($x['spaceId'] ?? null) === $t['spaceId']);
        $recaps = array_slice(sorted($ctx->db->list('posts', fn ($x) => ($x['spaceId'] ?? null) === $t['spaceId'] && ($x['kind'] ?? '') === 'recap'), fn ($a, $b) => strcmp((string) $b['createdAt'], (string) $a['createdAt'])), 0, 3);
        $files = $ctx->db->list('files', fn ($x) => ($x['spaceId'] ?? null) === $t['spaceId']);
        $board = null;
        if (!empty($t['roomId'])) {
            $pages = [];
            foreach ($ctx->db->opsSince((string) $t['roomId'], 0) as $o) {
                if ($o['kind'] === 'add' && is_array($o['payload']) && is_array($o['payload']['page'] ?? null)) $pages[] = $o['payload']['page'];
            }
            $board = ['anchor' => $pages ? ['x' => ($pages[0]['x'] ?? 0) + 40, 'y' => ($pages[0]['y'] ?? 0) + 60] : ['x' => 80, 'y' => 80]];
        }
        return redact([
            'task' => ['id' => $t['id'], 'title' => $t['title'], 'brief' => $t['brief']],
            'space' => ['name' => $space['name'] ?? null, 'mode' => $space['mode'] ?? null, 'code' => $space['code'] ?? null],
            'plans' => array_map(fn ($x) => ['title' => $x['title'] ?? '', 'blocks' => array_map(fn ($b) => ['title' => $b['title'] ?? '', 'minutes' => $b['minutes'] ?? 0, 'memberText' => $b['memberText'] ?? ''], array_values(array_filter(is_array($x['blocks'] ?? null) ? $x['blocks'] : [], 'is_array')))], $plans),
            'recaps' => array_map(fn ($r) => ['title' => $r['title'] ?? '', 'body' => $r['body'] ?? '', 'at' => $r['createdAt']], $recaps),
            'files' => array_map(fn ($f) => ['name' => $f['name'] ?? ''], $files),
            'board' => $board,
        ]);
    })
    ->post('a/:token/drafts', function (Ctx $ctx, array $p, array $in) {
        [$link, $seat] = ag_auth($ctx, $p['token'], $in);
        if (!empty($link['paused'])) ag_fail($ctx, 'The host paused agents. Stop and check back later.', 423);
        $t = ag_claimed_task($ctx, $link, $seat, $in['taskId'] ?? null);
        $kind = array_key_exists('kind', $in) ? ag_js_string($in['kind']) : 'undefined';
        $payload = $in['payload'] ?? [];
        if ($payload instanceof \stdClass) $payload = (array) $payload;
        $err = validate_draft($kind, $payload);
        if ($err !== null) ag_fail($ctx, $err, 422);
        if ($kind === 'board_ops') {
            $by = "agent:{$seat['name']}";
            $payload['ops'] = array_map(fn ($o) => is_array($o) && ($o['kind'] ?? null) === 'add' && is_array($o['payload'] ?? null) && !empty($o['payload']['obj']) && is_array($o['payload']['obj'])
                ? array_merge($o, ['payload' => array_merge($o['payload'], ['obj' => array_merge($o['payload']['obj'], ['draft' => true, 'by' => $by])])])
                : $o, $payload['ops']);
        }
        $title = ag_or(str($in['title'] ?? '', 120), $kind);
        $d = ['id' => new_id('dr'), 'taskId' => $t['id'], 'hostId' => $t['hostId'], 'seatId' => $seat['id'], 'kind' => $kind, 'title' => $title, 'sub' => str($in['sub'] ?? '', 160), 'payload' => obj($payload), 'status' => 'pending', 'reason' => null, 'createdAt' => $ctx->nowIso()];
        $ctx->db->put('agent_drafts', $d);
        $what = str_starts_with(mb_strtolower($title), 'section') ? "section '" . (explode(' · ', $title)[1] ?? 'undefined') . "'" : $title;
        ag_event($ctx, $t['hostId'], $t['id'], $seat['id'], $link['id'], 'draft', "added $what");
        $ctx->db->audit('agent:' . $seat['id'], 'agent.draft', ['task' => $t['id'], 'draft' => $d['id'], 'kind' => $kind, 'title' => $title]);
        $ctx->changed('agent_drafts');
        return ['id' => $d['id'], 'status' => 'pending'];
    })
    ->post('a/:token/files', function (Ctx $ctx, array $p, array $in) {
        // PHP server only: a file (≤ 20 MB, multipart field "file") an agent can attach to its drafts.
        [$link, $seat] = ag_auth($ctx, $p['token'], $in);
        if (!empty($link['paused'])) ag_fail($ctx, 'The host paused agents. Stop and check back later.', 423);
        $spaceId = $link['scope'] === 'space' ? $link['scopeId'] : null;
        if (!empty($in['taskId'])) $spaceId = ag_claimed_task($ctx, $link, $seat, $in['taskId'])['spaceId'];
        $f = $_FILES['file'] ?? null;
        if (!is_array($f) || ($f['error'] ?? 1) !== UPLOAD_ERR_OK) ag_fail($ctx, 'Upload failed: send multipart/form-data with the file in the "file" field', 400);
        if ((int) $f['size'] > FILE_CAP_MB * 1024 * 1024) ag_fail($ctx, 'That file is too big (at most ' . FILE_CAP_MB . ' MB)', 413);
        $tmp = (string) $f['tmp_name'];
        $sha = (string) hash_file('sha256', $tmp);
        $dir = data_dir() . '/files';
        if (!is_dir($dir)) mkdir($dir, 0700, true);
        $mime = (string) (mime_content_type($tmp) ?: 'application/octet-stream');
        if (!is_file("$dir/$sha") && !move_uploaded_file($tmp, "$dir/$sha")) ag_fail($ctx, 'Upload failed', 400);
        $ctx->db->pdo->prepare('INSERT OR IGNORE INTO blobs (sha256, mime, bytes, created_at) VALUES (?, ?, ?, ?)')->execute([$sha, $mime, (int) $f['size'], $ctx->nowIso()]);
        $name = ag_or(str((string) ($f['name'] ?? 'file'), 200), 'file');
        $row = ['id' => new_id('f'), 'sha256' => $sha, 'name' => $name, 'mime' => $mime, 'size' => (int) $f['size'], 'ownerId' => $link['hostId'], 'spaceId' => $spaceId, 'createdAt' => $ctx->nowIso()];
        $ctx->db->put('files', $row);
        $ctx->db->audit('agent:' . $seat['id'], 'agent.file', ['file' => $row['id'], 'name' => $name, 'size' => $row['size']]);
        $ctx->changed('files');
        return ['id' => $row['id'], 'name' => $name, 'mime' => $mime, 'size' => $row['size']];
    })
    ->post('a/:token/report', function (Ctx $ctx, array $p, array $in) {
        [$link, $seat] = ag_auth($ctx, $p['token'], $in);
        $t = ag_claimed_task($ctx, $link, $seat, $in['taskId'] ?? null);
        $want = $in['status'] ?? null;
        $status = $want === 'done' ? 'done' : ($want === 'blocker' ? 'blocker' : 'progress');
        $minutes = (int) max(0, min(600, round(ag_num($in['minutes'] ?? null, 0))));
        $note = str($in['note'] ?? '', 2000);
        $now = $ctx->nowIso();
        $ctx->db->update('prep_tasks', $t['id'], function (array $cur) use ($status, $minutes, $note, $now) {
            $patch = ['minutes' => ($cur['minutes'] ?? 0) + $minutes];
            if ($status === 'done') $patch += ['status' => 'ready', 'doneAt' => $now, 'report' => ag_or($note, (string) ($cur['report'] ?? '')), 'feedback' => null];
            if ($status === 'blocker') $patch += ['status' => 'needs_you', 'question' => ['text' => ag_or($note, "I'm blocked."), 'options' => [], 'answer' => null, 'at' => $now]];
            return array_merge($cur, $patch);
        });
        ag_event($ctx, $t['hostId'], $t['id'], $seat['id'], $link['id'], $status, $status === 'done' ? "finished {$t['title']}" : ag_or($note, $status), $minutes);
        $ctx->db->audit('agent:' . $seat['id'], 'agent.report', ['task' => $t['id'], 'status' => $status, 'minutes' => $minutes, 'note' => mb_substr($note, 0, 200)]);
        $ctx->changed('prep_tasks', 'agent_events');
        return ['ok' => true];
    })
    ->post('a/:token/ask', function (Ctx $ctx, array $p, array $in) {
        [$link, $seat] = ag_auth($ctx, $p['token'], $in);
        $t = ag_claimed_task($ctx, $link, $seat, $in['taskId'] ?? null);
        $options = array_slice(strings($in['options'] ?? []), 0, 4);
        $question = str($in['question'] ?? '', 500);
        $ctx->db->patch('prep_tasks', $t['id'], ['status' => 'needs_you', 'question' => ['text' => $question, 'options' => $options, 'answer' => null, 'at' => $ctx->nowIso()]]);
        ag_event($ctx, $t['hostId'], $t['id'], $seat['id'], $link['id'], 'ask', 'asked: ' . str($in['question'] ?? '', 120));
        $ctx->db->put('notifications', ['id' => sortable_id('nt'), 'userId' => $t['hostId'], 'kind' => 'agent', 'title' => "{$seat['name']} needs you · {$t['title']}", 'sub' => str($in['question'] ?? '', 120), 'link' => '/agents', 'createdAt' => $ctx->nowIso(), 'readAt' => null]);
        $ctx->db->audit('agent:' . $seat['id'], 'agent.ask', ['task' => $t['id'], 'question' => $question, 'options' => $options]);
        $ctx->changed('prep_tasks', 'notifications');
        return ['ok' => true, 'next' => 'moved on: claim the next task'];
    })
    ->get('a/:token/changes', function (Ctx $ctx, array $p, array $in) {
        [$link] = ag_auth($ctx, $p['token'], $in);
        $since = ag_or(str($in['since'] ?? '', 40), iso(0));
        $ids = array_map(fn ($t) => $t['id'], ag_tasks_for($ctx, $link));
        $evs = $ctx->db->list('agent_events', fn ($e) => !empty($e['taskId']) && in_array($e['taskId'], $ids, true) && strcmp((string) $e['at'], $since) > 0 && in_array($e['kind'], ['answer', 'accept', 'reject', 'changes', 'pause'], true));
        return ['paused' => (bool) ($link['paused'] ?? false), 'changes' => array_map(fn ($e) => ['at' => $e['at'], 'kind' => $e['kind'], 'taskId' => $e['taskId'], 'text' => $e['text']], $evs)];
    });

routes()
    ->get('agents', function (Ctx $ctx) {
        $me = require_me($ctx);
        $spaces = ag_host_spaces($ctx, $me['id']);
        $links = $ctx->db->list('agent_links', fn ($l) => ($l['hostId'] ?? null) === $me['id']);
        $tasks = $ctx->db->list('prep_tasks', fn ($t) => ($t['hostId'] ?? null) === $me['id']);
        $views = array_map(fn ($t) => ag_task_view($ctx, $t), $tasks);
        $today = iso((int) local($ctx->now())->setTime(0, 0)->format('U') * 1000);
        $working = array_values(array_filter($views, fn ($v) => $v['status'] === 'working'));
        $ready = array_values(array_filter($views, fn ($v) => $v['status'] === 'ready' && $v['pending'] > 0));
        $evs = sorted($ctx->db->list('agent_events', fn ($e) => ($e['hostId'] ?? null) === $me['id']), fn ($a, $b) => strcmp((string) $b['at'], (string) $a['at']));
        return [
            'scopes' => array_merge([['scope' => 'workspace', 'scopeId' => null, 'label' => 'Whole workspace']], array_map(fn ($s) => ['scope' => 'space', 'scopeId' => $s['id'], 'label' => "{$s['name']} · space"], $spaces)),
            'links' => array_map(fn ($l) => ['id' => $l['id'], 'scope' => $l['scope'], 'scopeId' => $l['scopeId'] ?? null, 'label' => ag_link_label($ctx, $l), 'token' => $l['token'], 'expiresAt' => $l['expiresAt'], 'paused' => $l['paused'] ?? false, 'liveEdits' => $l['liveEdits'] ?? false], $links),
            'seats' => ag_seat_views($ctx, $me['id']),
            'working' => array_map(function ($w) use ($tasks, $today) {
                $sid = $w['seat']['id'] ?? null;
                $mine = $sid === null ? [] : array_filter($tasks, fn ($t) => ($t['seatId'] ?? null) === $sid);
                return array_merge($w, [
                    'doneToday' => count(array_filter($mine, fn ($t) => !empty($t['doneAt']) && strcmp((string) $t['doneAt'], $today) >= 0)),
                    'totalToday' => count(array_filter($mine, fn ($t) => strcmp((string) ($t['claimedAt'] ?? ''), $today) >= 0)) + count(array_filter($mine, fn ($t) => $t['status'] === 'queued')),
                ]);
            }, $working),
            'needsYou' => array_values(array_filter($views, fn ($v) => $v['status'] === 'needs_you')),
            'ready' => ['count' => sum($ready, fn ($r) => $r['pending']), 'tasks' => $ready],
            'queued' => count(array_filter($views, fn ($v) => $v['status'] === 'queued' || $v['status'] === 'changes')),
            'activity' => array_map(fn ($e) => ['at' => $e['at'], 'text' => $e['text'], 'kind' => $e['kind']], array_slice($evs, 0, 8)),
            'builtIn' => BUILT_IN,
            'paused' => count($links) > 0 && every($links, fn ($l) => !empty($l['paused'])),
        ];
    })
    ->post('agents/links', function (Ctx $ctx, array $p, array $in) {
        $me = require_me($ctx);
        $scope = in_array($in['scope'] ?? null, ['workspace', 'space', 'room'], true) ? $in['scope'] : 'workspace';
        $scopeId = $scope === 'workspace' ? null : str($in['scopeId'] ?? '', 80);
        if ($scope === 'space') ag_require_host_space($ctx, (string) $scopeId);
        $l = ag_link_for($ctx, $me['id'], $scope, $scopeId);
        $ctx->changed('agent_links');
        return $l;
    })
    ->post('agents/links/:id', function (Ctx $ctx, array $p, array $in) {
        $me = require_me($ctx);
        $l = $ctx->db->get('agent_links', $p['id']);
        if (!$l || ($l['hostId'] ?? null) !== $me['id']) throw new NotFound('Link not found');
        $patch = [];
        if (is_bool($in['paused'] ?? null)) $patch['paused'] = $in['paused'];
        if (is_bool($in['liveEdits'] ?? null)) $patch['liveEdits'] = $in['liveEdits'];
        if (($in['rotate'] ?? null) === true) $patch += ['token' => new_id() . new_id(), 'expiresAt' => iso($ctx->now() + LINK_DAYS * DAY)];
        $next = $ctx->db->patch('agent_links', $l['id'], $patch);
        $ctx->changed('agent_links');
        return $next;
    })
    ->post('agents/pause', function (Ctx $ctx, array $p, array $in) {
        $me = require_me($ctx);
        $paused = ($in['paused'] ?? null) !== false;
        foreach ($ctx->db->list('agent_links', fn ($x) => ($x['hostId'] ?? null) === $me['id']) as $l) $ctx->db->patch('agent_links', $l['id'], ['paused' => $paused]);
        ag_event($ctx, $me['id'], null, null, null, 'pause', $paused ? 'host paused agents' : 'host resumed agents');
        $ctx->changed('agent_links');
        return ['paused' => $paused];
    })
    ->post('agents/seats/:id', function (Ctx $ctx, array $p, array $in) {
        $me = require_me($ctx);
        $s = $ctx->db->get('agent_seats', $p['id']);
        if (!$s || ($s['hostId'] ?? null) !== $me['id']) throw new NotFound('Seat not found');
        $action = $in['action'] ?? null;
        $patch = match ($action) {
            'approve' => ['status' => 'approved'],
            'revoke' => ['status' => 'revoked'],
            'rename' => ['name' => ag_or(str($in['name'] ?? '', 40), (string) $s['name'])],
            default => [],
        };
        if ($action === 'revoke') {
            foreach ($ctx->db->list('prep_tasks', fn ($x) => ($x['seatId'] ?? null) === $s['id'] && $x['status'] === 'working') as $t) $ctx->db->patch('prep_tasks', $t['id'], ['status' => 'queued', 'seatId' => null]);
        }
        $ctx->db->patch('agent_seats', $s['id'], $patch);
        $ctx->changed('agent_seats', 'prep_tasks');
        return ['ok' => true];
    })
    ->get('agents/read', function (Ctx $ctx, array $p, array $in) {
        $me = require_me($ctx);
        $links = $ctx->db->list('agent_links', fn ($l) => ($l['hostId'] ?? null) === $me['id']);
        $l = find($links, fn ($x) => $x['id'] === ($in['link'] ?? null)) ?? find($links, fn ($x) => $x['scope'] === 'space') ?? ($links[0] ?? null) ?? ag_link_for($ctx, $me['id'], 'workspace', null);
        $seat = $ctx->db->list('agent_seats', fn ($s) => ($s['linkId'] ?? null) === $l['id'] && $s['status'] === 'approved')[0] ?? null;
        $view = ag_next_view($ctx, $l, $seat);
        return ['markdown' => next_markdown($view), 'json' => array_merge(['capabilities' => 'v1'], $view), 'label' => ag_link_label($ctx, $l)];
    })
    ->get('spaces/:id/prep', function (Ctx $ctx, array $p) {
        $me = ag_require_host_space($ctx, $p['id']);
        $tasks = sorted($ctx->db->list('prep_tasks', fn ($t) => ($t['spaceId'] ?? null) === $p['id']), fn ($a, $b) => strcmp((string) ($a['readyBy'] ?? '9'), (string) ($b['readyBy'] ?? '9')));
        $views = array_map(fn ($t) => ag_task_view($ctx, $t), $tasks);
        $t = $ctx->nowIso();
        $sessions = sorted($ctx->db->list('sessions', fn ($s) => ($s['spaceId'] ?? null) === $p['id'] && strcmp((string) ($s['startsAt'] ?? ''), $t) > 0 && ($s['status'] ?? '') !== 'cancelled'), fn ($a, $b) => strcmp((string) $a['startsAt'], (string) $b['startsAt']));
        $next = $sessions[0] ?? null;
        $forNext = $next ? array_values(array_filter($views, fn ($v) => ($v['session']['id'] ?? null) === $next['id'])) : [];
        $link = ag_link_for($ctx, $me['id'], 'space', $p['id'], false) ?? ag_link_for($ctx, $me['id'], 'workspace', null, false);
        $seats = array_values(array_filter(ag_seat_views($ctx, $me['id']), fn ($s) => $link && str_starts_with((string) $s['linkLabel'], $link['scope'] === 'workspace' ? 'Workspace' : '')));
        return [
            'next' => $next ? ['id' => $next['id'], 'title' => $next['title'], 'startsAt' => $next['startsAt'], 'done' => count(array_filter($forNext, fn ($v) => in_array($v['status'], ['ready', 'accepted'], true))), 'total' => count($forNext)] : null,
            'ready' => array_values(array_filter($views, fn ($v) => $v['status'] === 'ready' && $v['pending'] > 0)),
            'working' => array_values(array_filter($views, fn ($v) => $v['status'] === 'working')),
            'needsYou' => array_values(array_filter($views, fn ($v) => $v['status'] === 'needs_you')),
            'queued' => array_values(array_filter($views, fn ($v) => $v['status'] === 'queued' || $v['status'] === 'changes')),
            'done' => array_slice(array_values(array_filter($views, fn ($v) => $v['status'] === 'accepted' || $v['status'] === 'rejected' || ($v['status'] === 'ready' && $v['pending'] === 0))), -5),
            'templates' => PREP_TEMPLATES,
            'link' => $link ? ['id' => $link['id'], 'scope' => $link['scope'], 'token' => $link['token'], 'liveEdits' => $link['liveEdits'] ?? false, 'paused' => $link['paused'] ?? false] : null,
            'seats' => $seats,
            'sessions' => array_map(fn ($s) => ['id' => $s['id'], 'title' => $s['title'], 'startsAt' => $s['startsAt']], array_slice($sessions, 0, 8)),
        ];
    })
    ->post('spaces/:id/prep', function (Ctx $ctx, array $p, array $in) {
        $me = ag_require_host_space($ctx, $p['id']);
        $template = find(PREP_TEMPLATES, fn ($x) => $x['id'] === ($in['template'] ?? null))['id'] ?? 'agenda';
        $label = find(PREP_TEMPLATES, fn ($x) => $x['id'] === $template);
        $sessionId = str($in['sessionId'] ?? '', 80);
        $sessionId = $sessionId !== '' ? $sessionId : null;
        $s = $sessionId !== null ? $ctx->db->get('sessions', $sessionId) : null;
        $briefHead = str($in['brief'] ?? '', 500);
        $title = ag_or(str($in['title'] ?? '', 120), match ($template) {
            'board_brief' => 'Board from the brief',
            'check' => (preg_match('/(\d+)/', $briefHead, $m) === 1 ? (int) $m[1] : 5) . '-question check',
            default => str_replace(' for a session', '', explode(' from ', $label['label'])[0]) . ($s ? " for {$s['title']}" : ''),
        });
        $readyByIn = str($in['readyBy'] ?? '', 40);
        $readyBy = $readyByIn !== '' ? ag_iso($readyByIn) : ($s ? iso(ms((string) $s['startsAt']) - 2 * 3600000) : null);
        $who = str($in['who'] ?? '', 80);
        $t = [
            'id' => new_id('pt'),
            'hostId' => $me['id'],
            'spaceId' => $p['id'],
            'sessionId' => $sessionId,
            'roomId' => null,
            'template' => $template,
            'title' => $title,
            'brief' => str($in['brief'] ?? '', 2000),
            'attachments' => array_slice(strings($in['attachments'] ?? []), 0, 8),
            'readyBy' => $readyBy,
            'who' => $who !== '' ? $who : null,
            'post' => ($in['post'] ?? null) === true,
            'status' => 'queued',
            'seatId' => null,
            'claimedAt' => null,
            'doneAt' => null,
            'minutes' => 0,
            'report' => '',
            'question' => null,
            'feedback' => null,
            'createdAt' => $ctx->nowIso(),
        ];
        $ctx->db->put('prep_tasks', $t);
        $ctx->changed('prep_tasks');
        return ag_task_view($ctx, $t);
    })
    ->post('prep/:id/answer', function (Ctx $ctx, array $p, array $in) {
        $me = require_me($ctx);
        $t = $ctx->db->get('prep_tasks', $p['id']);
        if (!$t || ($t['hostId'] ?? null) !== $me['id'] || empty($t['question'])) throw new NotFound('Nothing to answer');
        $answer = str($in['answer'] ?? '', 1000);
        if ($answer === '') throw new BadRequest('Write an answer');
        $ctx->db->patch('prep_tasks', $t['id'], ['status' => 'queued', 'question' => array_merge($t['question'], ['answer' => $answer]), 'feedback' => "{$t['question']['text']} → $answer", 'seatId' => $t['seatId'] ?? null]);
        ag_event($ctx, $me['id'], $t['id'], $t['seatId'] ?? null, null, 'answer', "host answered: $answer");
        $ctx->changed('prep_tasks');
        return ['ok' => true];
    })
    ->get('prep/:id/review', function (Ctx $ctx, array $p) {
        $me = require_me($ctx);
        $t = $ctx->db->get('prep_tasks', $p['id']);
        if (!$t || ($t['hostId'] ?? null) !== $me['id']) throw new NotFound('Task not found');
        $drafts = sorted($ctx->db->list('agent_drafts', fn ($d) => ($d['taskId'] ?? null) === $t['id']), fn ($a, $b) => strcmp((string) $a['createdAt'], (string) $b['createdAt']));
        return ['task' => ag_task_view($ctx, $t), 'drafts' => array_map(fn ($d) => ['id' => $d['id'], 'kind' => $d['kind'], 'title' => $d['title'], 'sub' => $d['sub'] ?? '', 'status' => $d['status'], 'reason' => $d['reason'] ?? null, 'payload' => obj(is_array($d['payload'] ?? null) ? $d['payload'] : [])], $drafts)];
    })
    ->post('prep/:id/review', function (Ctx $ctx, array $p, array $in) {
        $me = require_me($ctx);
        $t = $ctx->db->get('prep_tasks', $p['id']);
        if (!$t || ($t['hostId'] ?? null) !== $me['id']) throw new NotFound('Task not found');
        $drafts = $ctx->db->list('agent_drafts', fn ($d) => ($d['taskId'] ?? null) === $t['id'] && $d['status'] === 'pending');
        $accept = strings($in['accept'] ?? []);
        $reject = strings($in['reject'] ?? []);
        $reason = ag_or(str($in['reason'] ?? '', 500), 'Not needed');
        $accepted = 0;
        foreach ($drafts as $d) {
            if (in_array($d['id'], $accept, true)) {
                ag_apply_draft($ctx, $me, $t, $d);
                $ctx->db->patch('agent_drafts', $d['id'], ['status' => 'accepted']);
                $accepted++;
            } elseif (in_array($d['id'], $reject, true)) {
                $ctx->db->patch('agent_drafts', $d['id'], ['status' => 'rejected', 'reason' => $reason]);
                ag_event($ctx, $me['id'], $t['id'], $d['seatId'] ?? null, null, 'reject', "host rejected {$d['title']}: $reason");
            }
        }
        $changes = str($in['changes'] ?? '', 1000);
        $left = count($ctx->db->list('agent_drafts', fn ($d) => ($d['taskId'] ?? null) === $t['id'] && $d['status'] === 'pending'));
        if ($changes !== '') {
            $ctx->db->patch('prep_tasks', $t['id'], ['status' => 'changes', 'feedback' => $changes]);
            ag_event($ctx, $me['id'], $t['id'], $t['seatId'] ?? null, null, 'changes', "host asked for changes: $changes");
        } elseif (!$left) {
            $anyAccepted = $accepted > 0 || count($ctx->db->list('agent_drafts', fn ($d) => ($d['taskId'] ?? null) === $t['id'] && $d['status'] === 'accepted')) > 0;
            $ctx->db->patch('prep_tasks', $t['id'], ['status' => $anyAccepted ? 'accepted' : 'rejected']);
        }
        if ($accepted) ag_event($ctx, $me['id'], $t['id'], $t['seatId'] ?? null, null, 'accept', "host accepted $accepted draft" . ($accepted === 1 ? '' : 's'));
        $ctx->changed('agent_drafts', 'prep_tasks');
        return ['accepted' => $accepted, 'left' => $left];
    })
    // The room's draft layer (A4): pending board drafts and agent activity, for hosts only.
    ->get('rooms/:id/agent', function (Ctx $ctx, array $p) {
        $me = require_me($ctx);
        $room = $ctx->db->get('rooms', $p['id']);
        if (!$room) throw new NotFound('Room not found');
        if (($room['createdBy'] ?? null) !== $me['id']) return ['drafts' => [], 'activity' => [], 'working' => null, 'pending' => 0, 'taskId' => null, 'paused' => false];
        $tasks = $ctx->db->list('prep_tasks', fn ($t) => ($t['roomId'] ?? null) === $room['id']);
        $ids = array_map(fn ($t) => $t['id'], $tasks);
        $drafts = $ctx->db->list('agent_drafts', fn ($d) => in_array($d['taskId'] ?? null, $ids, true) && $d['status'] === 'pending' && $d['kind'] === 'board_ops');
        $evs = array_slice(sorted($ctx->db->list('agent_events', fn ($e) => !empty($e['taskId']) && in_array($e['taskId'], $ids, true)), fn ($a, $b) => strcmp((string) $b['at'], (string) $a['at'])), 0, 6);
        $working = find($tasks, fn ($t) => $t['status'] === 'working');
        $seat = !empty($working['seatId']) ? $ctx->db->get('agent_seats', (string) $working['seatId']) : null;
        $reviewTask = find($tasks, fn ($t) => some($drafts, fn ($d) => $d['taskId'] === $t['id']));
        $links = $ctx->db->list('agent_links', fn ($l) => ($l['hostId'] ?? null) === $me['id']);
        $ops = [];
        foreach ($drafts as $d) foreach ((is_array($d['payload']['ops'] ?? null) ? $d['payload']['ops'] : []) as $o) $ops[] = $o;
        return [
            'ops' => $ops,
            'pending' => count($ctx->db->list('agent_drafts', fn ($d) => in_array($d['taskId'] ?? null, $ids, true) && $d['status'] === 'pending')),
            'activity' => array_map(fn ($e) => ['at' => $e['at'], 'text' => $e['text']], $evs),
            'working' => $working ? ['title' => $working['title'], 'seat' => $seat['name'] ?? 'agent'] : null,
            'taskId' => $reviewTask['id'] ?? null,
            'paused' => count($links) > 0 && every($links, fn ($l) => !empty($l['paused'])),
        ];
    });
