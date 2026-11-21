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
