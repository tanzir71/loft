<?php
declare(strict_types=1);

namespace Loft;

// Ports packages/core/src/plans.test.ts (core) and packages/data/src/local/plans.test.ts (routes).

function pln_test_block(string $id, int $minutes, array $extra = []): array
{
    return array_merge(['id' => $id, 'title' => $id, 'type' => 'talk', 'minutes' => $minutes, 'memberText' => '', 'hostNotes' => 'secret', 'resources' => [], 'visible' => true], $extra);
}

function pln_test_session(string $id, string $startsAt, array $extra = []): array
{
    return array_merge(['id' => $id, 'spaceId' => 'sp_1', 'seriesId' => null, 'title' => 'Lesson', 'startsAt' => $startsAt, 'minutes' => 60, 'room' => 'loft', 'externalUrl' => null, 'status' => 'scheduled', 'sequence' => 0], $extra);
}

test('plans core: timeline, status, agenda, templates, AI blocks, carry-over, attendance → log lines', function () {
    $b = fn (string $id, int $m, array $x = []) => pln_test_block($id, $m, $x);
    $t = timeline([$b('a', 5), $b('b', 10), $b('c', 40)], 60);
    eq(array_map(fn ($s) => [$s['id'], $s['start']], $t['segments']), [['a', 0], ['b', 5], ['c', 15], ['free', 55]]);
    eq([$t['planned'], $t['free'], $t['over']], [55, 5, 0]);
    $over = timeline([$b('a', 50), $b('b', 20)], 60);
    eq($over['over'], 10);
    eq(end($over['segments']), ['id' => 'over', 'type' => 'over', 'start' => 60, 'minutes' => 10]);
    $moved = move_block([$b('a', 5), $b('b', 10), $b('c', 15)], 2, 0);
    eq(array_column($moved, 'id'), ['c', 'a', 'b']);
    eq(timeline($moved, 30)['segments'][1]['start'], 15);
    eq(mmss(75), '1:15');
    eq(mmss(5), '0:05');

    eq(derive_plan_status(['minutes' => 60, 'blocks' => [$b('a', 30)], 'status' => 'draft', 'sessionId' => 's1']), 'draft');
    eq(derive_plan_status(['minutes' => 60, 'blocks' => [$b('a', 55)], 'status' => 'draft', 'sessionId' => 's1']), 'ready');
    eq(derive_plan_status(['minutes' => 60, 'blocks' => [$b('a', 55)], 'status' => 'draft', 'sessionId' => null]), 'draft');
    eq(derive_plan_status(['minutes' => 60, 'blocks' => [], 'status' => 'taught']), 'taught');

    $agenda = member_agenda([$b('a', 5, ['memberText' => 'Hi']), $b('hidden', 10, ['visible' => false]), $b('c', 5)], '2026-11-26T10:00:00');
    eq(array_map(fn ($x) => "{$x['time']} {$x['title']}", $agenda), ['10:00 a', '10:15 c']);
    ok(!str_contains(json_encode($agenda), 'secret'), 'never host notes');
    eq(array_column(member_agenda([$b('a', 5), $b('c', 5)]), 'time'), ['0:00', '0:05'], 'no start: offsets');
    eq(array_column(member_agenda([$b('a', 5)], '2026-11-26T10:00:00.000Z', new \DateTimeZone('Asia/Dhaka')), 'time'), ['16:00'], 'host zone');

    foreach (['lesson', 'workshop', 'sprint', 'client', 'retro'] as $key) {
        eq(sum(plan_template_blocks($key), fn ($x) => $x['minutes']), TEMPLATES[$key]['minutes'], "$key adds up");
    }
    $lesson = plan_template_blocks('lesson');
    eq(count(array_unique(array_column($lesson, 'id'))), 6, 'fresh block ids');
    eq($lesson[1]['resources'], [['kind' => 'board', 'label' => 'Board · blank page']]);
    eq(plan_template_blocks('nope'), null);
    eq(array_map(fn ($x) => [$x['title'], $x['type']], blocks_from_pages([['title' => 'Projectiles'], []])), [['Projectiles', 'board'], ['Page 2', 'board']]);

    $ai = parse_ai_blocks([['title' => 'Warm-up', 'minutes' => '7', 'type' => 'activity', 'instructions' => 'Pairs', 'hostNotes' => 'watch Rafi'], ['title' => 'X', 'minutes' => 999, 'type' => 'dance']]);
    eq([$ai[0]['title'], $ai[0]['minutes'], $ai[0]['type'], $ai[0]['memberText'], $ai[0]['hostNotes']], ['Warm-up', 7, 'activity', 'Pairs', 'watch Rafi']);
    eq([$ai[1]['minutes'], $ai[1]['type']], [240, 'talk']);
    throws(fn () => parse_ai_blocks(['not' => 'a list']), '/Expected a list of blocks/');

    $blocks = [$b('a', 5), $b('b', 10), $b('c', 5)];
    $carried = carry_over(['a' => 'done', 'b' => 'partly', 'c' => 'skipped'], $blocks, ['b']);
    eq(array_column($carried, 'title'), ['b']);
    ok($carried[0]['id'] !== 'b', 'carried blocks get new ids');

    $att = attendance_from_presence(['u1', 'u2', 'u3'], ['u1' => 58.4, 'u2' => 0], ['u3']);
    eq(array_column($att, 'status'), ['attended', 'absent', 'late_cancel']);
    eq($att[0]['minutes'], 58);
    $lines = session_log_lines($att, ['unitPriceCents' => 1500] + DEFAULT_POLICY);
    eq(array_column($lines, 'amountCents'), [1500, 0, 1500]);
    eq(count(array_filter($lines, fn ($l) => $l['billable'])), 2);
});

test('plans: create from a template, autosave versions, restore, library by unit', function () {
    $db = fresh();
    $GLOBALS['loft_now'] = ms('2026-11-20T09:00:00Z');
    fixture($db);
    $p = call($db, 'u_host', 'POST', 'spaces/sp_1/plans', ['title' => 'Sprint retro', 'from' => 'template:retro', 'tags' => ['Retro', 7]]);
    eq([count($p['blocks']), $p['minutes'], $p['version'], $p['status'], $p['unit'], $p['order'], $p['aiDraft']], [5, 45, 1, 'draft', 'Unit 1', 0, false]);
    eq($p['tags'], ['Retro', '7']);
    throws(fn () => call($db, 'u_a', 'POST', 'spaces/sp_1/plans', ['title' => 'Mine']), '/Plans are for hosts/', Forbidden::class);
    $blank = call($db, 'u_host', 'POST', 'spaces/sp_1/plans', []);
    eq([$blank['title'], $blank['minutes'], $blank['blocks'], $blank['order']], ['Untitled plan', 60, [], 1]);

    $edited = call($db, 'u_host', 'POST', "plans/{$p['id']}", ['blocks' => array_slice($p['blocks'], 0, 2), 'minutes' => 2, 'title' => '']);
    eq([$edited['version'], count($edited['blocks']), $edited['minutes'], $edited['title'], $edited['status']], [2, 2, 5, 'Sprint retro', 'draft']);
    $restored = call($db, 'u_host', 'POST', "plans/{$p['id']}/restore", ['version' => 1]);
    eq([count($restored['blocks']), $restored['version']], [5, 3]);
    throws(fn () => call($db, 'u_host', 'POST', "plans/{$p['id']}/restore", ['version' => 9]), '/Version not found/', NotFound::class);
    $got = call($db, 'u_host', 'GET', "plans/{$p['id']}");
    eq(array_column($got['versions'], 'version'), [3, 2, 1]);
    eq($got['space'], ['id' => 'sp_1', 'name' => 'Physics', 'slug' => 'physics']);
    eq(array_column($got['agenda'], 'time'), ['0:00', '0:05', '0:20', '0:30', '0:40']);
    throws(fn () => call($db, 'u_host', 'GET', 'plans/pl_nope'), '/Plan not found/', NotFound::class);

    call($db, 'u_host', 'POST', "plans/{$p['id']}/reorder", ['ids' => [$blank['id'], $p['id']]]);
    eq([$db->get('plans', $blank['id'])['order'], $db->get('plans', $p['id'])['order']], [0, 1]);
    put($db, 'sessions', pln_test_session('se_soon', '2026-11-24T10:00:00.000Z'));
    $lib = call($db, 'u_host', 'GET', 'spaces/sp_1/plans');
    eq(array_column($lib['plans'], 'id'), [$blank['id'], $p['id']]);
    eq($lib['plans'][1]['planned'], 45);
    eq($lib['units'], [['unit' => 'Unit 1', 'objectives' => 3, 'covered' => 0]]);
    eq(array_column($lib['unplanned'], 'id'), ['se_soon']);
    call($db, 'u_host', 'POST', "plans/{$blank['id']}/delete");
    eq($db->get('plans', $blank['id']), null);
});

test('plans: attach & prepare is idempotent (room, pages, agenda, reminder), detach cleans up', function () {
    $db = fresh();
    $GLOBALS['loft_now'] = ms('2026-11-20T09:00:00Z');
    fixture($db);
    put($db, 'sessions', pln_test_session('se_1', '2026-11-24T10:00:00.000Z', ['title' => 'Lesson 7']), pln_test_session('se_2', '2026-11-26T10:00:00.000Z', ['planId' => 'pl_other']));
    $p = call($db, 'u_host', 'POST', 'spaces/sp_1/plans', ['title' => 'Vectors', 'from' => 'template:lesson']);
    throws(fn () => call($db, 'u_host', 'POST', "plans/{$p['id']}/attach", ['sessionId' => 'se_missing']), '/Pick a session in this space/', NotFound::class);
    $r1 = call($db, 'u_host', 'POST', "plans/{$p['id']}/attach", ['sessionId' => 'se_1']);
    eq($r1['status'], 'ready');
    eq($r1['sessionId'], 'se_1');
    eq(count($r1['prepared']['pages']), 3, 'Predict, Share findings (boards) and Set homework (hand-out)');
    $r2 = call($db, 'u_host', 'POST', "plans/{$p['id']}/attach", ['sessionId' => 'se_1']);
    eq($r2['prepared']['roomId'], $r1['prepared']['roomId']);
    eq($r2['prepared']['agendaPostId'], $r1['prepared']['agendaPostId']);
    eq($r2['prepared']['reminderId'], $r1['prepared']['reminderId']);
    eq($r2['prepared']['pages'], $r1['prepared']['pages']);
    eq(count($db->list('rooms')), 1);
    eq(count($db->list('posts', fn ($x) => $x['kind'] === 'agenda')), 1);
    $ops = $db->opsSince($r1['prepared']['roomId'], 0);
    eq([count(array_filter($ops, fn ($o) => $o['kind'] === 'add')), count(array_filter($ops, fn ($o) => $o['kind'] === 'update'))], [3, 3], 'pages added once, then updated');
    eq($ops[0]['payload']['page']['x'], 1280);
    $room = $db->get('rooms', $r1['prepared']['roomId']);
    eq([$room['sessionId'], $room['capacity'], $room['createdBy']], ['se_1', ROOM_CAPACITY, 'u_host']);
    $post = $db->get('posts', $r1['prepared']['agendaPostId']);
    eq([$post['title'], $post['publishAt']], ['Agenda · Lesson 7', '2026-11-24T09:00:00.000Z']);
    eq(explode("\n", $post['body'])[0], '10:00  Check-in');
    ok(!str_contains($post['body'], 'hostNotes'), 'titles and times only');
    eq($db->get('scheduled_reminders', $r1['prepared']['reminderId'])['deliverAt'], '2026-11-23T10:00:00.000Z');
    eq($db->get('sessions', 'se_1')['planId'], $p['id']);
    throws(fn () => call($db, 'u_host', 'POST', "plans/{$p['id']}/attach", ['sessionId' => 'se_2']), '/already has a plan/');

    // Editing blocks re-prepares the attached session: a new board block gets its page.
    $blocks = array_merge($r2['blocks'], [['id' => 'b_extra', 'title' => 'Extra board', 'type' => 'board', 'minutes' => 5, 'memberText' => '', 'hostNotes' => '', 'resources' => [], 'visible' => true]]);
    call($db, 'u_host', 'POST', "plans/{$p['id']}", ['blocks' => $blocks]);
    eq($db->get('sessions', 'se_1')['prepared']['pages']['b_extra'], 'pg_b_extra');

    call($db, 'u_host', 'POST', "plans/{$p['id']}/detach");
    $s = $db->get('sessions', 'se_1');
    eq([$s['planId'], $s['prepared']], [null, ['roomId' => $r1['prepared']['roomId']]]);
    eq($db->get('posts', $r1['prepared']['agendaPostId']), null);
    eq($db->get('scheduled_reminders', $r1['prepared']['reminderId']), null);
    eq($db->get('plans', $p['id'])['sessionId'], null);
});

test('plans: a session room opened again after it ended gets a new room with its own pages', function () {
    $db = fresh();
    $GLOBALS['loft_now'] = ms('2026-11-20T09:00:00Z');
    fixture($db);
    put($db, 'sessions', pln_test_session('se_1', '2026-11-24T10:00:00.000Z', ['title' => 'Lesson 7']));
    $p = call($db, 'u_host', 'POST', 'spaces/sp_1/plans', ['title' => 'Vectors', 'from' => 'template:lesson']);
    $first = call($db, 'u_host', 'POST', "plans/{$p['id']}/attach", ['sessionId' => 'se_1'])['prepared']['roomId'];
    call($db, 'u_host', 'POST', "rooms/$first/end");
    $room = call($db, 'u_host', 'POST', 'sessions/se_1/room');
    ok($room['id'] !== $first, 'a new room');
    eq(array_values(array_unique(array_map(fn ($o) => $o['kind'], $db->opsSince($room['id'], 0)))), ['add'], 'pages are added, not updated in a room that never had them');
});

test('plans: the room rail, host notes stay with the host, attendance from presence', function () {
    $db = fresh();
    $GLOBALS['loft_now'] = ms('2026-11-24T09:55:00Z');
    fixture($db);
    put($db, 'sessions', pln_test_session('se_1', '2026-11-24T10:00:00.000Z'));
    $p = call($db, 'u_host', 'POST', 'spaces/sp_1/plans', ['title' => 'Vectors', 'blocks' => [
        pln_test_block('b1', 10, ['hostNotes' => 'watch Rafi']),
        pln_test_block('b2', 20, ['type' => 'board', 'resources' => [['kind' => 'board', 'label' => 'Board']]]),
        pln_test_block('b3', 5, ['visible' => false]),
    ]]);
    eq(call($db, 'u_host', 'GET', 'sessions/se_1/plan'), null, 'no plan attached yet');
    call($db, 'u_host', 'POST', "plans/{$p['id']}/attach", ['sessionId' => 'se_1']);
    $fresh = call($db, 'u_host', 'GET', 'sessions/se_1/plan');
    eq([$fresh['rail']['current'], $fresh['rail']['startedAt'], json_encode($fresh['rail']['extensions'])], [0, null, '{}']);

    $rail = call($db, 'u_host', 'POST', 'sessions/se_1/rail', ['current' => 2, 'startedAt' => '2026-11-24T10:00:00.000Z', 'extensions' => ['b2' => 5]]);
    eq([$rail['current'], $rail['startedAt'], $rail['extensions']], [2, '2026-11-24T10:00:00.000Z', ['b2' => 5]]);
    throws(fn () => call($db, 'u_a', 'POST', 'sessions/se_1/rail', ['current' => 1]), '/Plans are for hosts/', Forbidden::class);
    $host = call($db, 'u_host', 'GET', 'sessions/se_1/plan');
    eq([$host['isHost'], $host['rail']['current'], count($host['blocks'])], [true, 2, 3]);
    ok(some($host['blocks'], fn ($x) => $x['hostNotes'] === 'watch Rafi'), 'the host sees notes');
    eq($host['pages'], ['b2' => 'pg_b2']);
    $member = call($db, 'u_a', 'GET', 'sessions/se_1/plan');
    eq([$member['isHost'], array_column($member['blocks'], 'id')], [false, ['b1', 'b2']]);
    ok(every($member['blocks'], fn ($x) => $x['hostNotes'] === '' && $x['resources'] === []), 'members never get notes or resources');
    ok(!str_contains(json_encode($member), 'watch Rafi'), 'notes never leave the host');

    // "Open board" returns the prepared room; presence is recorded per room.
    $room = call($db, 'u_a', 'POST', 'sessions/se_1/room');
    eq($room['id'], $db->get('sessions', 'se_1')['prepared']['roomId']);
    throws(fn () => call($db, 'u_nobody', 'POST', 'sessions/se_1/room'), '/Not signed in/', Unauthorized::class);
    $GLOBALS['loft_now'] = ms('2026-11-24T10:00:00Z');
    call($db, 'u_a', 'POST', "rooms/{$room['id']}/attendance", ['event' => 'join']);
    $GLOBALS['loft_now'] = ms('2026-11-24T10:45:00Z');
    call($db, 'u_a', 'POST', "rooms/{$room['id']}/attendance", ['event' => 'leave']);
    eq($db->get('attendance_events', "{$room['id']}:u_a")['leftAt'], '2026-11-24T10:45:00.000Z');
    eq(pln_attendance_minutes(new Ctx($db, 'u_host'), 'se_1'), ['u_a' => 45]);
    // An ended room is replaced by a fresh one on "Open board".
    $db->patch('rooms', $room['id'], ['endedAt' => '2026-11-24T11:00:00.000Z']);
    $again = call($db, 'u_host', 'POST', 'sessions/se_1/room');
    ok($again['id'] !== $room['id'] && $again['endedAt'] === null, 'new room');
});

test('wrap-up writes session_log lines through record_attendance, posts a recap, carries blocks over', function () {
    $db = fresh();
    $GLOBALS['loft_now'] = ms('2026-11-24T09:00:00Z');
    fixture($db);
    // A minimal billed space: $15 per attended session per member, invoiced monthly.
    $db->patch('spaces', 'sp_1', ['billing' => ['model' => 'per_session', 'unitPriceCents' => 1500, 'per' => 'member', 'schedule' => 'monthly']]);
    put($db, 'sessions', pln_test_session('se_1', '2026-11-24T10:00:00.000Z', ['title' => 'Vectors lesson']));
    $p = call($db, 'u_host', 'POST', 'spaces/sp_1/plans', ['title' => 'Vectors', 'from' => 'template:lesson']);
    $prepared = call($db, 'u_host', 'POST', "plans/{$p['id']}/attach", ['sessionId' => 'se_1'])['prepared'];
    put($db, 'attendance_events', ['id' => "{$prepared['roomId']}:u_a", 'roomId' => $prepared['roomId'], 'userId' => 'u_a', 'joinedAt' => '2026-11-24T10:05:00.000Z', 'leftAt' => '2026-11-24T10:55:00.000Z']);
    eq(wrapups_pending(new Ctx($db, 'u_host'), 'u_host'), [], 'not ended yet');
    $GLOBALS['loft_now'] = ms('2026-11-24T12:00:00Z');
    eq(array_column(wrapups_pending(new Ctx($db, 'u_host'), 'u_host'), 'id'), ['se_1']);

    $w = call($db, 'u_host', 'GET', 'sessions/se_1/wrapup');
    eq($w['policy'], ['unitPriceCents' => 1500, 'billable' => ['attended', 'late_cancel', 'no_show'], 'model' => 'per_session', 'per' => 'member']);
    $att = index_by($w['attendance'], fn ($a) => $a['memberId']);
    eq([$att['u_a']['status'], $att['u_a']['minutes'], $att['u_a']['name']], ['attended', 50, 'A Member']);
    eq($att['u_b']['status'], 'absent');
    eq($w['homework'], ['title' => 'Set homework']);
    eq($w['nextPlan'], null);
    throws(fn () => call($db, 'u_a', 'GET', 'sessions/se_1/wrapup'), '/Plans are for hosts/', Forbidden::class);

    $outcomes = [];
    foreach ($w['plan']['blocks'] as $i => $b) $outcomes[$b['id']] = $i === 2 ? 'partly' : 'done';
    $res = call($db, 'u_host', 'POST', 'sessions/se_1/wrapup', ['outcomes' => $outcomes, 'carry' => [$w['plan']['blocks'][2]['id']], 'attendance' => $w['attendance'], 'homework' => ['title' => 'Worksheet 6 p2'], 'recapText' => 'Good work.']);
    eq([$res['ok'], $res['lines'], $res['billable'], $res['totalCents'], $res['packaged'], $res['carried']], [true, 2, 1, 1500, 0, 1]);
    $log = $db->list('session_log', fn ($r) => $r['sessionId'] === 'se_1');
    eq(count($log), 2);
    $byMember = index_by($log, fn ($r) => $r['memberId']);
    eq([$byMember['u_a']['status'], $byMember['u_a']['billable'], $byMember['u_a']['amountCents']], ['attended', true, 1500]);
    eq([$byMember['u_b']['billable'], $byMember['u_b']['amountCents']], [false, 0]);
    eq($db->get('plans', $p['id'])['status'], 'taught');
    $recap = find($db->list('posts'), fn ($x) => $x['kind'] === 'recap');
    eq($recap['title'], 'Recap: Vectors');
    contains($recap['body'], 'What we covered: Check-in, Predict, Activity, Share findings, Exit ticket, Set homework.');
    contains($recap['body'], 'Good work.');
    $task = find($db->list('posts'), fn ($x) => $x['kind'] === 'task');
    eq([$task['title'], $task['dueAt']], ['Worksheet 6 p2', '2026-11-26T12:00:00.000Z']);
    eq(array_column($db->get('carry_tray', 'sp_1')['blocks'], 'title'), ['Activity'], 'no next plan: kept in the tray');
    eq($db->get('sessions', 'se_1')['wrapped'], true);
    eq(wrapups_pending(new Ctx($db, 'u_host'), 'u_host'), []);
});

test('auto-wrap writes lines from presence 24 h after an unwrapped session', function () {
    $db = fresh();
    $GLOBALS['loft_now'] = ms('2026-11-24T09:00:00Z');
    fixture($db);
    $db->patch('spaces', 'sp_1', ['billing' => ['model' => 'per_session', 'unitPriceCents' => 2000, 'per' => 'member', 'schedule' => 'monthly']]);
    put($db, 'sessions', pln_test_session('se_1', '2026-11-24T10:00:00.000Z'));
    $p = call($db, 'u_host', 'POST', 'spaces/sp_1/plans', ['title' => 'Forces', 'from' => 'template:lesson']);
    $roomId = call($db, 'u_host', 'POST', "plans/{$p['id']}/attach", ['sessionId' => 'se_1'])['prepared']['roomId'];
    put($db, 'attendance_events', ['id' => "$roomId:u_b", 'roomId' => $roomId, 'userId' => 'u_b', 'joinedAt' => '2026-11-24T10:00:00.000Z', 'leftAt' => '2026-11-24T11:00:00.000Z']);
    $GLOBALS['loft_now'] = ms('2026-11-25T10:30:00Z'); // ended 23.5 h ago
    auto_wrap_stale(new Ctx($db, 'u_host'), 'u_host');
    eq($db->list('session_log'), [], 'the host still has time');
    $GLOBALS['loft_now'] = ms('2026-11-25T11:30:00Z');
    $db->clearCache();
    auto_wrap_stale(new Ctx($db, 'u_host'), 'u_host');
    $db->clearCache();
    $log = index_by($db->list('session_log'), fn ($r) => $r['memberId']);
    eq([$log['u_b']['status'], $log['u_b']['minutes'], $log['u_b']['amountCents']], ['attended', 60, 2000]);
    eq($log['u_a']['status'], 'absent');
    eq($db->get('sessions', 'se_1')['wrapped'], true);
});
