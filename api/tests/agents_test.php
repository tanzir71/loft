<?php
declare(strict_types=1);

namespace Loft;

// Mirrors packages/core/src/agents.test.ts and packages/data/src/local/agents.test.ts, with a small fixture
// instead of the demo seed. Agent errors are AgentError exceptions here (HTTP status on the server).

const AG_TEST_WS = 'w7Rk2mXq9Lp4Tz8Vb3Nc';
const AG_TEST_SP = 's9k2mQx7Hd4Rw8Pf1Lc6';

test('agents: creates seats from the User-Agent and an optional name', function () {
    eq(seat_from_request('codex-cli/0.9.1 (darwin)', null), ['name' => 'codex', 'runtime' => 'codex-cli', 'version' => '0.9.1']);
    eq(seat_from_request('claude-code/1.2', 'planner'), ['name' => 'planner', 'runtime' => 'claude-code', 'version' => '1.2']);
    eq(seat_from_request('', ''), ['name' => 'agent', 'runtime' => 'agent', 'version' => '']);
    eq(seat_from_request('MyBot', null), ['name' => 'mybot', 'runtime' => 'mybot', 'version' => '']);
});

test('agents: rate-limits each seat to 60 requests a minute', function () {
    $b = null;
    $t = 1_000_000;
    for ($i = 0; $i < 60; $i++) {
        $r = take_token($b, $t);
        ok($r['ok'], "request $i");
        $b = $r['bucket'];
    }
    $blocked = take_token($b, $t);
    eq($blocked['ok'], false);
    eq($blocked['retryAfterMs'], 1000);
    eq(take_token($b, $t + 1000)['ok'], true);
});

test('agents: redacts payer contacts, tokens and DMs from context', function () {
    eq(redact(['name' => 'Shirin', 'email' => 's@x', 'phone' => '1', 'payToken' => 'p', 'nested' => [['payerContact' => 'x', 'ok' => 1]]]), ['name' => 'Shirin', 'nested' => [['ok' => 1]]]);
    eq(json_encode(redact([['channelType' => 'dm', 'body' => 'secret'], ['channelType' => 'space', 'body' => 'hi']])), '[{},{"channelType":"space","body":"hi"}]');
    eq(json_encode(redact(['token' => 'x'])), '{}');
});

test('agents: validates draft kinds and the 500-op batch cap', function () {
    ok(str_contains((string) validate_draft('email', []), 'Unknown draft kind'), 'unknown kind');
    ok(str_contains((string) validate_draft('board_ops', ['ops' => array_fill(0, MAX_BOARD_OPS + 1, [])]), 'At most 500'), 'cap');
    eq(validate_draft('board_ops', ['ops' => []]), 'board_ops needs ops');
    eq(validate_draft('plan', ['blocks' => []]), null);
    ok(str_contains((string) validate_draft('post', ['body' => 1]), 'body'), 'post body');
    eq(validate_draft('invoice_draft', 'x'), 'payload must be an object');
});

test('agents: next.md starts with the capabilities list', function () {
    $md = next_markdown(['title' => 'Design sprint', 'seat' => ['name' => 'codex', 'runtime' => 'codex-cli', 'version' => '0.9'], 'seatNo' => 1, 'expiresAt' => '2026-12-21T00:00:00Z', 'paused' => false, 'next' => ['title' => 'Agenda for Thu 26 Nov 15:00', 'when' => '', 'readyBy' => 'Thu 13:00', 'inputs' => ['brief.pdf'], 'doneWhen' => 'a plan is drafted'], 'queue' => [['title' => 'Board from the brief', 'note' => 'queued']], 'rejected' => []]);
    $lines = explode("\n", $md);
    eq($lines[0], '# Loft · Design sprint · agent link');
    eq($lines[1], 'capabilities: v1 · seat: codex-cli 0.9 (seat 1) · expires 21 Dec 2026');
    eq($lines[3], '## What you can do');
    ok(every(array_slice($lines, 4, count(CAPABILITIES)), fn ($l) => str_starts_with($l, '- ')), 'capability lines');
    eq($lines[4], '- claim the next prep task .... POST /claim');
    contains($md, 'drafts only · never send, invite, charge or confirm payments · 60 requests/min');
    contains($md, '## Queue (1)');
    contains($md, 'inputs: brief.pdf');
    contains(next_markdown(['title' => 'X', 'seat' => null, 'seatNo' => null, 'expiresAt' => '2026-12-21T00:00:00Z', 'paused' => true, 'next' => null, 'queue' => [], 'rejected' => [['title' => 'Post', 'reason' => 'No']]]), "seat: new (waiting for approval)");
});

function ag_test_claude(array $extra = []): array
{
    return array_merge(['agent' => ['userAgent' => 'claude-code/1.4', 'name' => 'planner']], $extra);
}

function ag_test_error(callable $fn): AgentError
{
    try {
        $fn();
    } catch (AgentError $e) {
        return $e;
    }
    fail('expected an AgentError');
}

function ag_test_task(array $over): array
{
    return array_merge([
        'hostId' => 'u_host', 'spaceId' => 'sp_1', 'sessionId' => null, 'roomId' => null, 'template' => 'agenda', 'title' => 'Task', 'brief' => '', 'attachments' => [],
        'readyBy' => null, 'who' => null, 'post' => false, 'status' => 'queued', 'seatId' => null, 'claimedAt' => null, 'doneAt' => null, 'minutes' => 0,
        'report' => '', 'question' => null, 'feedback' => null, 'createdAt' => iso(now_ms() - DAY),
    ], $over);
}

function ag_test_seat(array $over): array
{
    return array_merge(['hostId' => 'u_host', 'version' => '', 'seatNo' => 1, 'status' => 'approved', 'createdAt' => iso(now_ms() - DAY), 'lastSeenAt' => iso(now_ms()), 'bucket' => null], $over);
}

/** A host with Physics, a workspace link and a space link, a session on Thursday, a recap, a plan and a file. */
function ag_test_fixture(Db $db): int
{
    $GLOBALS['loft_now'] = ms('2026-11-21T09:00:00.000Z');
    fixture($db, 'course', ['u_ayaan' => 'member']);
    $now = now_ms();
    $db->patch('users', 'u_ayaan', ['phone' => '+15550100']);
    $link = ['hostId' => 'u_host', 'expiresAt' => iso($now + 30 * DAY), 'paused' => false, 'liveEdits' => false, 'createdAt' => iso($now - DAY)];
    put(
        $db,
        'agent_links',
        $link + ['id' => 'al_ws', 'scope' => 'workspace', 'scopeId' => null, 'token' => AG_TEST_WS],
        $link + ['id' => 'al_sp', 'scope' => 'space', 'scopeId' => 'sp_1', 'token' => AG_TEST_SP]
    );
    put($db, 'sessions', ['id' => 'se_thu', 'spaceId' => 'sp_1', 'title' => 'Day 4 · Decide', 'startsAt' => '2026-11-26T15:00:00.000Z', 'minutes' => 90, 'status' => 'scheduled', 'planId' => null]);
    put($db, 'posts', ['id' => 'po_recap3', 'spaceId' => 'sp_1', 'kind' => 'recap', 'title' => 'Recap Day 3', 'body' => 'We mapped the journey.', 'mustRead' => false, 'createdBy' => 'u_host', 'createdAt' => iso($now - DAY), 'attachments' => []]);
    put($db, 'plans', ['id' => 'pl_3', 'spaceId' => 'sp_1', 'title' => 'Day 3', 'blocks' => [['title' => 'Map', 'minutes' => 30, 'memberText' => 'Bring notes', 'hostNotes' => 'host only']]]);
    put($db, 'files', ['id' => 'f_brief', 'sha256' => 'x', 'name' => 'brief.pdf', 'mime' => 'application/pdf', 'size' => 10, 'ownerId' => 'u_host', 'spaceId' => 'sp_1', 'createdAt' => iso($now - DAY)]);
    return $now;
}

test('agents routes: the Agents page lists seats, working, needs you and ready', function () {
    $db = fresh();
    $now = ag_test_fixture($db);
    put(
        $db,
        'agent_seats',
        ag_test_seat(['id' => 'seat_codex', 'linkId' => 'al_sp', 'name' => 'codex', 'runtime' => 'codex-cli', 'version' => '0.9', 'createdAt' => iso($now - 3 * DAY)]),
        ag_test_seat(['id' => 'seat_claude', 'linkId' => 'al_ws', 'name' => 'claude', 'runtime' => 'claude-code', 'version' => '1.2', 'createdAt' => iso($now - 2 * DAY)]),
        ag_test_seat(['id' => 'seat_laptop', 'linkId' => 'al_ws', 'name' => 'codex (laptop)', 'runtime' => 'codex-cli', 'status' => 'pending', 'createdAt' => iso($now - DAY)])
    );
    put(
        $db,
        'prep_tasks',
        ag_test_task(['id' => 'pt_board', 'template' => 'board_brief', 'title' => 'Board from the brief', 'status' => 'working', 'seatId' => 'seat_codex', 'claimedAt' => iso($now - 3600000)]),
        ag_test_task(['id' => 'pt_vote', 'title' => 'Vote format', 'status' => 'needs_you', 'seatId' => 'seat_claude', 'question' => ['text' => 'Should the vote be dot-voting (3 dots each) or one vote per person?', 'options' => [], 'answer' => null, 'at' => iso($now)]]),
        ag_test_task(['id' => 'pt_check', 'template' => 'check', 'title' => '5-question check on pricing basics', 'status' => 'ready', 'seatId' => 'seat_codex', 'doneAt' => iso($now - 1800000)]),
        ag_test_task(['id' => 'pt_recap', 'template' => 'recap', 'title' => 'Recap from Day 3', 'status' => 'ready', 'seatId' => 'seat_claude'])
    );
    $draft = ['hostId' => 'u_host', 'sub' => '', 'payload' => ['body' => 'x'], 'status' => 'pending', 'reason' => null, 'createdAt' => iso($now)];
    put(
        $db,
        'agent_drafts',
        $draft + ['id' => 'dr_1', 'taskId' => 'pt_check', 'seatId' => 'seat_codex', 'kind' => 'check', 'title' => '5-question check'],
        $draft + ['id' => 'dr_2', 'taskId' => 'pt_recap', 'seatId' => 'seat_claude', 'kind' => 'post', 'title' => 'Recap']
    );
    $ev = ['hostId' => 'u_host', 'taskId' => null, 'linkId' => 'al_sp', 'seatId' => 'seat_codex', 'kind' => 'done', 'text' => 'finished'];
    put($db, 'agent_events', $ev + ['id' => 'ae_1', 'at' => iso($now - DAY), 'minutes' => 120], $ev + ['id' => 'ae_2', 'at' => iso($now - 2 * DAY), 'minutes' => 100], $ev + ['id' => 'ae_3', 'at' => iso($now - 10 * DAY), 'minutes' => 50]);
    $ag = call($db, 'u_host', 'GET', 'agents');
    eq(array_map(fn ($s) => "{$s['name']}:{$s['state']}", $ag['seats']), ['codex:active', 'claude:needs you', 'codex (laptop):new']);
    eq(array_map(fn ($s) => $s['linkLabel'], $ag['seats']), ['Physics link', 'Workspace link', 'Workspace link']);
    eq($ag['working'][0]['title'], 'Board from the brief');
    eq([$ag['working'][0]['doneToday'], $ag['working'][0]['totalToday']], [1, 1]);
    ok(str_contains($ag['needsYou'][0]['question']['text'], 'dot-voting'), 'needs you');
    $ready = array_map(fn ($t) => $t['title'], $ag['ready']['tasks']);
    sort($ready);
    eq($ready, ['5-question check on pricing basics', 'Recap from Day 3']);
    eq($ag['ready']['count'], 2);
    eq(find($ag['seats'], fn ($s) => $s['name'] === 'codex')['minutesWeek'], 220);
    eq(array_map(fn ($s) => $s['label'], $ag['scopes']), ['Whole workspace', 'Physics · space']);
    eq(array_map(fn ($l) => $l['label'], $ag['links']), ['Physics', 'Workspace']);
    eq([$ag['paused'], $ag['builtIn'][0]], [false, 'claim the next prep task']);
});

test('agents routes: next.md starts with capabilities; a workspace link makes new seats wait for approval', function () {
    $db = fresh();
    $now = ag_test_fixture($db);
    put(
        $db,
        'prep_tasks',
        ag_test_task(['id' => 'pt_client', 'template' => 'client_agenda', 'title' => 'Client-call agenda from the last 3 recaps', 'readyBy' => iso($now + DAY)]),
        ag_test_task(['id' => 'pt_agenda', 'title' => 'Agenda for Day 4', 'sessionId' => 'se_thu', 'readyBy' => iso($now + 2 * DAY)])
    );
    $md = call($db, null, 'GET', 'a/' . AG_TEST_WS, ag_test_claude())['markdown'];
    eq(explode("\n", $md)[3], '## What you can do');
    contains($md, 'seat: new (waiting for approval)');
    contains($md, "## Next task\nClient-call agenda from the last 3 recaps · ready by Sun 22 Nov, 09:00\ninputs: last 1 recap\ndone when: an agenda built from the last 3 recaps is drafted");
    contains($md, "## Queue (1)\n1. Agenda for Day 4 · ready by Mon 23 Nov, 09:00");
    $e = ag_test_error(fn () => call($db, null, 'POST', 'a/' . AG_TEST_WS . '/claim', ag_test_claude()));
    eq([$e->getMessage(), $e->status], ['Waiting for the host to approve this seat.', 403]);
    $seat = find(call($db, 'u_host', 'GET', 'agents')['seats'], fn ($s) => $s['name'] === 'planner');
    eq([$seat['state'], $seat['runtime'], $seat['version']], ['new', 'claude-code', '1.4']);
    call($db, 'u_host', 'POST', "agents/seats/{$seat['id']}", ['action' => 'approve']);
    $claimed = call($db, null, 'POST', 'a/' . AG_TEST_WS . '/claim', ag_test_claude());
    eq($claimed['paused'], false);
    eq($claimed['task']['title'], 'Client-call agenda from the last 3 recaps');
    eq($claimed['task']['context'], ['/context/pt_client']);
    eq($claimed['task']['done_when'], DONE_WHEN['client_agenda']);
    eq($db->get('prep_tasks', 'pt_client')['status'], 'working');
    $audit = $db->pdo->query("SELECT actor, action FROM audit WHERE action LIKE 'agent.%'")->fetchAll(\PDO::FETCH_ASSOC);
    eq($audit, [['actor' => "agent:{$seat['id']}", 'action' => 'agent.claim']]);
    $md = call($db, null, 'GET', 'a/' . AG_TEST_WS, ag_test_claude())['markdown'];
    contains($md, 'seat: claude-code 1.4 (seat 1)');
    contains($md, 'Agenda for Day 4 · Thu 26 Nov, 15:00 · ready by Mon 23 Nov, 09:00');
    $json = call($db, null, 'GET', 'a/' . AG_TEST_WS . '/next.json', ag_test_claude());
    eq([$json['capabilities'], $json['seatStatus'], $json['seatNo']], ['v1', 'approved', 1]);
});

test('agents routes: claim → redacted context → drafts → done; the host accepts one draft and rejects one with a reason', function () {
    $db = fresh();
    $now = ag_test_fixture($db);
    $task = call($db, 'u_host', 'POST', 'spaces/sp_1/prep', ['template' => 'board_brief', 'brief' => 'Two sections: Ideas, Votes.', 'title' => 'Board for the retro']);
    eq([$task['status'], $task['title'], $task['sub']], ['queued', 'Board for the retro', 'queued']);
    $claimed = null;
    for ($i = 0; $i < 4 && ($claimed['id'] ?? null) !== $task['id']; $i++) $claimed = call($db, null, 'POST', 'a/' . AG_TEST_SP . '/claim', ag_test_claude())['task'];
    eq($claimed['id'], $task['id']);
    eq($claimed['session'], null);
    $ctx = call($db, null, 'GET', 'a/' . AG_TEST_SP . "/context/{$task['id']}", ag_test_claude());
    ok(preg_match('/@example\.test|pay_|"phone"|host only/', (string) json_encode($ctx)) === 0, 'context is redacted');
    eq($ctx['space']['name'], 'Physics');
    eq($ctx['recaps'][0]['title'], 'Recap Day 3');
    eq($ctx['plans'][0]['blocks'][0], ['title' => 'Map', 'minutes' => 30, 'memberText' => 'Bring notes']);
    eq($ctx['files'], [['name' => 'brief.pdf']]);
    eq($ctx['board'], null);
    $e = ag_test_error(fn () => call($db, null, 'POST', 'a/' . AG_TEST_SP . '/drafts', ag_test_claude(['taskId' => $task['id'], 'kind' => 'email', 'payload' => []])));
    eq([$e->getMessage(), $e->status], ['Unknown draft kind "email"', 422]);
    $other = ['agent' => ['userAgent' => 'codex-cli/0.9', 'name' => '']];
    $e = ag_test_error(fn () => call($db, null, 'POST', 'a/' . AG_TEST_SP . '/drafts', $other + ['taskId' => $task['id'], 'kind' => 'post', 'payload' => ['body' => 'x']]));
    eq([$e->getMessage(), $e->status], ['Claim the task first', 409]);
    eq(call($db, null, 'POST', 'a/' . AG_TEST_SP . '/drafts', ag_test_claude(['taskId' => $task['id'], 'kind' => 'post', 'title' => 'Stream post', 'payload' => ['title' => 'Retro', 'body' => 'Bring one idea.']]))['status'], 'pending');
    $GLOBALS['loft_now'] = $now + 1000;
    call($db, null, 'POST', 'a/' . AG_TEST_SP . '/drafts', ag_test_claude(['taskId' => $task['id'], 'kind' => 'post', 'title' => 'Second post', 'payload' => ['title' => 'Extra', 'body' => 'Not needed.']]));
    eq(call($db, null, 'POST', 'a/' . AG_TEST_SP . '/report', ag_test_claude(['taskId' => $task['id'], 'status' => 'done', 'note' => 'Two posts.', 'minutes' => 7])), ['ok' => true]);
    $review = call($db, 'u_host', 'GET', "prep/{$task['id']}/review");
    eq([$review['task']['status'], $review['task']['minutes'], $review['task']['report']], ['ready', 7, 'Two posts.']);
    eq(array_map(fn ($d) => $d['title'], $review['drafts']), ['Stream post', 'Second post']);
    [$keep, $drop] = $review['drafts'];
    eq(call($db, 'u_host', 'POST', "prep/{$task['id']}/review", ['accept' => [$keep['id']], 'reject' => [$drop['id']], 'reason' => 'One post is enough']), ['accepted' => 1, 'left' => 0]);
    eq($db->get('prep_tasks', $task['id'])['status'], 'accepted');
    $md = call($db, null, 'GET', 'a/' . AG_TEST_SP, ag_test_claude())['markdown'];
    contains($md, "## Sent back by the host\n- Second post: One post is enough");
    $post = find($db->list('posts'), fn ($x) => ($x['title'] ?? '') === 'Retro');
    eq([$post['kind'], $post['body'], $post['createdBy'], $post['spaceId']], ['post', 'Bring one idea.', 'u_host', 'sp_1']);
    $actions = $db->pdo->query("SELECT action FROM audit WHERE actor LIKE 'agent:%' ORDER BY id")->fetchAll(\PDO::FETCH_COLUMN);
    eq($actions, ['agent.claim', 'agent.draft', 'agent.draft', 'agent.report']);
    $changes = call($db, null, 'GET', 'a/' . AG_TEST_SP . '/changes', ag_test_claude(['since' => iso(0)]));
    eq(array_map(fn ($c) => $c['kind'], $changes['changes']), ['reject', 'accept']);
    eq($changes['paused'], false);
});

test('agents routes: accepted board drafts move onto the room op-log without the draft flag', function () {
    $db = fresh();
    ag_test_fixture($db);
    $task = call($db, 'u_host', 'POST', 'spaces/sp_1/prep', ['template' => 'board_brief', 'sessionId' => 'se_thu', 'brief' => 'Sections: Map, Decide, Storyboard']);
    eq([$task['title'], $task['readyBy'], $task['session']['id']], ['Board from the brief', '2026-11-26T13:00:00.000Z', 'se_thu']);
    $claimed = call($db, null, 'POST', 'a/' . AG_TEST_SP . '/claim', ag_test_claude())['task'];
    eq($claimed['session'], ['title' => 'Day 4 · Decide', 'startsAt' => '2026-11-26T15:00:00.000Z', 'minutes' => 90]);
    $roomId = $db->get('prep_tasks', $task['id'])['roomId'];
    ok(is_string($roomId) && $roomId !== '', 'the session got a room');
    eq($db->get('sessions', 'se_thu')['prepared']['roomId'], $roomId);
    eq([$db->get('rooms', $roomId)['createdBy'], $db->get('rooms', $roomId)['capacity']], ['u_host', ROOM_CAPACITY]);
    $db->appendOps($roomId, [['actor' => 'u_host', 'kind' => 'add', 'payload' => ['page' => ['id' => 'pg1', 'x' => 100, 'y' => 200]]]]);
    eq(call($db, null, 'GET', 'a/' . AG_TEST_SP . "/context/{$task['id']}", ag_test_claude())['board'], ['anchor' => ['x' => 140, 'y' => 260]]);
    $sec = fn (string $id, string $title) => ['kind' => 'add', 'payload' => ['obj' => ['id' => $id, 'kind' => 'section', 'z' => 1, 'x' => 0, 'y' => 0, 'w' => 440, 'h' => 340, 'title' => $title]]];
    call($db, null, 'POST', 'a/' . AG_TEST_SP . '/drafts', ag_test_claude(['taskId' => $task['id'], 'kind' => 'board_ops', 'title' => 'Section · Map', 'payload' => ['ops' => [$sec('s_map', 'Map'), $sec('s_decide', 'Decide'), ['kind' => 'update', 'payload' => ['id' => 's_map', 'patch' => ['title' => 'Map it']]]]]]));
    call($db, null, 'POST', 'a/' . AG_TEST_SP . '/drafts', ag_test_claude(['taskId' => $task['id'], 'kind' => 'board_ops', 'title' => 'Section · Storyboard', 'payload' => ['ops' => [$sec('s_story', 'Storyboard'), ['kind' => 'add', 'payload' => ['obj' => ['id' => 's_story_s0', 'kind' => 'sticky', 'text' => 'Frame 1']]]]]]));
    $layer = call($db, 'u_host', 'GET', "rooms/$roomId/agent");
    eq(count($layer['ops']), 5);
    ok(every(array_filter($layer['ops'], fn ($o) => $o['kind'] === 'add'), fn ($o) => $o['payload']['obj']['draft'] === true && $o['payload']['obj']['by'] === 'agent:planner'), 'draft layer ops are flagged');
    eq([$layer['pending'], $layer['taskId'], $layer['working']], [2, $task['id'], ['title' => 'Board from the brief', 'seat' => 'planner']]);
    ok(some($layer['activity'], fn ($a) => $a['text'] === "added section 'Map'"), 'activity names the section');
    eq(call($db, 'u_ayaan', 'GET', "rooms/$roomId/agent")['pending'], 0, 'members never see the draft layer');
    $review = call($db, 'u_host', 'GET', "prep/{$task['id']}/review");
    eq(call($db, 'u_host', 'POST', "prep/{$task['id']}/review", ['accept' => array_map(fn ($d) => $d['id'], $review['drafts'])]), ['accepted' => 2, 'left' => 0]);
    $objs = [];
    foreach ($db->opsSince($roomId, 0) as $o) if (isset($o['payload']['obj'])) $objs[] = $o + ['obj' => $o['payload']['obj']];
    eq(count(array_filter($objs, fn ($o) => $o['obj']['kind'] === 'section')), 3);
    ok(!some($objs, fn ($o) => array_key_exists('draft', $o['obj'])), 'no draft flag on the main op-log');
    ok(every($objs, fn ($o) => $o['obj']['by'] === 'u_host' && $o['actor'] === 'u_host'), 're-issued as the host');
    eq(count($db->opsSince($roomId, 0)), 6, 'page + 5 accepted ops');
    eq(call($db, 'u_host', 'GET', "rooms/$roomId/agent")['pending'], 0);
    eq($db->get('prep_tasks', $task['id'])['status'], 'accepted');
});

test('agents routes: ask moves the agent on; the host answer re-queues the task with the answer as feedback', function () {
    $db = fresh();
    $now = ag_test_fixture($db);
    $claude = ['agent' => ['userAgent' => 'claude-code/1.0', 'name' => 'claude']];
    put($db, 'agent_seats', ag_test_seat(['id' => 'seat_claude', 'linkId' => 'al_ws', 'name' => 'claude', 'runtime' => 'claude-code', 'version' => '1.0']));
    put($db, 'prep_tasks', ag_test_task(['id' => 'pt_vote', 'title' => 'Vote format', 'readyBy' => iso($now + 3600000)]));
    eq(call($db, null, 'POST', 'a/' . AG_TEST_WS . '/claim', $claude)['task']['id'], 'pt_vote');
    $q = 'Should the vote be dot-voting (3 dots each) or one vote per person?';
    eq(call($db, null, 'POST', 'a/' . AG_TEST_WS . '/ask', $claude + ['taskId' => 'pt_vote', 'question' => $q, 'options' => ['3 dots each', 'one vote', 5]]), ['ok' => true, 'next' => 'moved on: claim the next task']);
    $t = $db->get('prep_tasks', 'pt_vote');
    eq([$t['status'], $t['question']['options']], ['needs_you', ['3 dots each', 'one vote']]);
    $note = find($db->list('notifications'), fn ($n) => $n['userId'] === 'u_host' && $n['kind'] === 'agent');
    eq([$note['title'], $note['link']], ['claude needs you · Vote format', '/agents']);
    $ag = call($db, 'u_host', 'GET', 'agents');
    eq([$ag['needsYou'][0]['id'], $ag['needsYou'][0]['sub']], ['pt_vote', $q]);
    eq(find($ag['seats'], fn ($s) => $s['id'] === 'seat_claude')['state'], 'needs you');
    throws(fn () => call($db, 'u_host', 'POST', 'prep/pt_vote/answer', ['answer' => ' ']), '/Write an answer/', BadRequest::class);
    throws(fn () => call($db, 'u_ayaan', 'POST', 'prep/pt_vote/answer', ['answer' => 'x']), '/Nothing to answer/', NotFound::class);
    eq(call($db, 'u_host', 'POST', 'prep/pt_vote/answer', ['answer' => '3 dots each']), ['ok' => true]);
    eq($db->get('prep_tasks', 'pt_vote')['status'], 'queued');
    $md = call($db, null, 'GET', 'a/' . AG_TEST_WS, $claude)['markdown'];
    contains($md, "host asked: $q → 3 dots each");
    $kinds = array_map(fn ($c) => $c['kind'], call($db, null, 'GET', 'a/' . AG_TEST_WS . '/changes', $claude)['changes']);
    eq($kinds, ['answer']);
    eq((int) $db->pdo->query("SELECT COUNT(*) FROM audit WHERE action = 'agent.ask'")->fetchColumn(), 1);
});

test('agents routes: pausing stops claims and drafts; revoking a seat blocks it; 60 requests a minute per seat', function () {
    $db = fresh();
    $now = ag_test_fixture($db);
    put($db, 'prep_tasks', ag_test_task(['id' => 'pt_a', 'title' => 'Agenda A', 'readyBy' => iso($now + 3600000)]));
    eq(call($db, 'u_host', 'POST', 'agents/pause', ['paused' => true]), ['paused' => true]);
    eq(call($db, null, 'POST', 'a/' . AG_TEST_SP . '/claim', ag_test_claude()), ['paused' => true, 'task' => null]);
    $e = ag_test_error(fn () => call($db, null, 'POST', 'a/' . AG_TEST_SP . '/drafts', ag_test_claude(['taskId' => 'pt_a', 'kind' => 'post', 'payload' => ['body' => 'x']])));
    eq($e->status, 423);
    eq(call($db, 'u_host', 'GET', 'agents')['paused'], true);
    contains(call($db, null, 'GET', 'a/' . AG_TEST_SP, ag_test_claude())['markdown'], "## Paused\nThe host paused this link.");
    call($db, 'u_host', 'POST', 'agents/pause', ['paused' => false]);
    $okCount = 0;
    $limited = null;
    for ($i = 0; $i < 61 && !$limited; $i++) {
        try {
            call($db, null, 'GET', 'a/' . AG_TEST_SP . '/next.json', ag_test_claude());
            $okCount++;
        } catch (AgentError $err) {
            $limited = $err;
        }
    }
    ok($limited !== null, 'rate limited');
    eq([$limited->status, $limited->getMessage(), $okCount], [429, 'Too many requests. Try again in 1 s.', 57]);
    $GLOBALS['loft_now'] = $now + 60000;
    eq(call($db, null, 'POST', 'a/' . AG_TEST_SP . '/claim', ag_test_claude())['task']['id'], 'pt_a');
    $seat = find(call($db, 'u_host', 'GET', 'agents')['seats'], fn ($s) => $s['name'] === 'planner');
    call($db, 'u_host', 'POST', "agents/seats/{$seat['id']}", ['action' => 'revoke']);
    $t = $db->get('prep_tasks', 'pt_a');
    eq([$t['status'], $t['seatId']], ['queued', null], 'claimed tasks go back to the queue');
    $e = ag_test_error(fn () => call($db, null, 'POST', 'a/' . AG_TEST_SP . '/claim', ag_test_claude()));
    eq([$e->getMessage(), $e->status], ['This seat was revoked by the host.', 403]);
    eq(call($db, 'u_host', 'GET', 'agents')['seats'], [], 'revoked seats leave the list');
    $db->patch('agent_links', 'al_sp', ['expiresAt' => iso($now - 1000)]);
    eq(ag_test_error(fn () => call($db, null, 'GET', 'a/' . AG_TEST_SP, ['agent' => ['userAgent' => 'x/1']]))->status, 410);
    eq(ag_test_error(fn () => call($db, null, 'GET', 'a/nope', ag_test_claude()))->status, 404);
});

test('agents routes: links, rotation, the host preview of next.md and the Prep tab', function () {
    $db = fresh();
    ag_test_fixture($db);
    eq(call($db, 'u_host', 'POST', 'agents/links', ['scope' => 'space', 'scopeId' => 'sp_1'])['id'], 'al_sp', 'one link per scope');
    eq(call($db, 'u_host', 'POST', 'agents/links', ['scope' => 'nonsense'])['id'], 'al_ws');
    throws(fn () => call($db, 'u_ayaan', 'POST', 'agents/links', ['scope' => 'space', 'scopeId' => 'sp_1']), '/Only hosts manage agents/', Forbidden::class);
    throws(fn () => call($db, 'u_ayaan', 'POST', 'agents/links/al_sp', ['paused' => true]), '/Link not found/', NotFound::class);
    $rotated = call($db, 'u_host', 'POST', 'agents/links/al_sp', ['rotate' => true, 'liveEdits' => true]);
    ok(strlen($rotated['token']) === 32 && $rotated['token'] !== AG_TEST_SP, 'new token');
    eq($rotated['liveEdits'], true);
    eq(ag_test_error(fn () => call($db, null, 'GET', 'a/' . AG_TEST_SP, ag_test_claude()))->getMessage(), 'Unknown agent link');
    $read = call($db, 'u_host', 'GET', 'agents/read', ['link' => 'al_ws']);
    ok(str_starts_with($read['markdown'], '# Loft · Workspace · agent link'), 'host preview');
    eq([$read['json']['capabilities'], $read['label']], ['v1', 'Workspace']);
    eq(call($db, 'u_host', 'GET', 'agents/read')['label'], 'Physics', 'space link first');
    $check = call($db, 'u_host', 'POST', 'spaces/sp_1/prep', ['template' => 'check', 'brief' => 'Make 7 questions on vectors']);
    eq($check['title'], '7-question check');
    eq(call($db, 'u_host', 'POST', 'spaces/sp_1/prep', ['template' => 'agenda', 'sessionId' => 'se_thu'])['title'], 'Agenda for Day 4 · Decide');
    eq(call($db, 'u_host', 'POST', 'spaces/sp_1/prep', ['template' => 'recap'])['title'], 'Recap');
    throws(fn () => call($db, 'u_ayaan', 'POST', 'spaces/sp_1/prep', ['template' => 'recap']), '/Only hosts manage agents/', Forbidden::class);
    $prep = call($db, 'u_host', 'GET', 'spaces/sp_1/prep');
    eq(count($prep['templates']), 6);
    eq(count($prep['queued']), 3);
    eq([$prep['next']['id'], $prep['next']['total']], ['se_thu', 1]);
    eq([$prep['link']['id'], $prep['link']['liveEdits']], ['al_sp', true]);
    eq(array_map(fn ($s) => $s['id'], $prep['sessions']), ['se_thu']);
});
