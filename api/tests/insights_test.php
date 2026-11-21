<?php
declare(strict_types=1);

namespace Loft;

// Mirrors the "insights" block of packages/core/src/checks.test.ts and the "insights (M8)" half of
// packages/data/src/local/insights.test.ts, with a small fixture instead of the demo seed.

test('insights: computes attendance, on-time homework and an at-risk reason list', function () {
    $now = ms('2026-11-21T12:00:00Z');
    $base = ['lastSeenAt' => '2026-11-21T10:00:00Z', 'lastLoginAt' => null, 'inRoom' => false, 'sessions' => [], 'work' => [], 'fee' => 'paid'];
    $m = member_insight(array_merge($base, [
        'lastSeenAt' => '2026-11-18T12:00:00Z',
        'sessions' => [
            ['at' => '2026-11-02T16:00:00Z', 'status' => 'attended', 'minutes' => 60],
            ['at' => '2026-11-04T16:00:00Z', 'status' => 'attended', 'minutes' => 55],
            ['at' => '2026-11-09T16:00:00Z', 'status' => 'excused', 'minutes' => 0],
            ['at' => '2026-11-16T16:00:00Z', 'status' => 'absent', 'minutes' => 0],
            ['at' => '2026-11-18T16:00:00Z', 'status' => 'no_show', 'minutes' => 0],
        ],
        'work' => [['dueAt' => '2026-11-10T00:00:00Z', 'doneAt' => '2026-11-09T00:00:00Z'], ['dueAt' => '2026-11-17T00:00:00Z', 'doneAt' => null], ['dueAt' => '2026-11-25T00:00:00Z', 'doneAt' => null]],
        'fee' => 'overdue',
    ]), $now);
    foreach (['attendance' => 50, 'attended' => 2, 'expected' => 4, 'missedInARow' => 2, 'homeworkDue' => 2, 'onTime' => 1, 'notSeenDays' => 3, 'atRisk' => true] as $k => $v) eq($m[$k], $v, $k);
    eq($m['reasons'], ['missed 2 sessions in a row', 'fee overdue']);
    eq(member_insight(array_merge($base, ['lastSeenAt' => '2026-11-10T00:00:00Z']), $now)['reasons'], ['not seen for 11 days']);
    eq(member_insight($base, $now)['atRisk'], false);
    eq(member_insight(array_merge($base, ['lastSeenAt' => null]), $now)['reasons'], ['never seen']);
});

test('insights: labels last seen and totals with deltas', function () {
    $now = ms('2026-11-21T12:00:00Z');
    $base = ['lastSeenAt' => '2026-11-21T10:00:00Z', 'lastLoginAt' => null, 'inRoom' => false, 'sessions' => [], 'work' => [], 'fee' => 'paid'];
    eq(seen_label(['inRoom' => true, 'lastSeenAt' => null], $now), 'in a room');
    eq(seen_label(['inRoom' => false, 'lastSeenAt' => '2026-11-21T10:00:00Z'], $now), '2 h ago');
    eq(seen_label(['inRoom' => false, 'lastSeenAt' => '2026-11-20T08:00:00Z'], $now), 'yesterday');
    eq(seen_label(['inRoom' => false, 'lastSeenAt' => '2026-11-18T08:00:00Z'], $now), '3 days ago');
    eq(seen_label(['inRoom' => false, 'lastSeenAt' => null], $now), 'never');
    $a = array_merge($base, ['sessions' => [['at' => '2026-11-02T16:00:00Z', 'status' => 'attended', 'minutes' => 60]]]);
    eq(totals([['activity' => $a, 'insight' => member_insight($a, $now)]], $now - 30 * DAY), ['active' => 1, 'members' => 1, 'attendance' => 100, 'onTime' => null, 'avgMinutes' => 60]);
    eq(delta(91, 93, '%'), '−2%');
    eq(delta(23, 20), '+3');
    eq(delta(58, 58), 'steady');
    eq(delta(null, 3), '');
});

/**
 * Physics with three learners and a co-host, plus a team space (colleagues are not learners):
 * Ayaan is in a room and has a payment claim open, Dipa hasn't been seen for 9 days, Tania's fee is overdue.
 */
function ins_test_fixture(Db $db): int
{
    $GLOBALS['loft_now'] = ms('2026-11-21T12:00:00.000Z');
    fixture($db, 'course', ['u_ayaan' => 'member', 'u_dipa' => 'member', 'u_tania' => 'member', 'u_leena' => 'cohost']);
    $now = now_ms();
    $db->patch('users', 'u_ayaan', ['status' => 'busy', 'lastSeenAt' => iso($now - 3600000)]);
    $db->patch('users', 'u_dipa', ['lastSeenAt' => iso($now - 9 * DAY - 3600000), 'phone' => '+8801700000001']);
    $db->patch('users', 'u_tania', ['lastSeenAt' => iso($now - DAY)]);
    put($db, 'users', ['id' => 'u_colleague', 'name' => 'Colleague Person', 'email' => 'colleague@example.test', 'tz' => 'UTC', 'status' => 'available', 'createdAt' => iso($now)]);
    put($db, 'spaces', ['id' => 'sp_team', 'orgId' => null, 'mode' => 'team', 'code' => 'OPS', 'name' => 'Ops', 'sub' => 'Team', 'slug' => 'ops', 'colour' => 'teal', 'roomSlug' => 'ops', 'createdAt' => iso($now), 'createdBy' => 'u_host']);
    put(
        $db,
        'memberships',
        ['id' => 'sp_team:u_host', 'spaceId' => 'sp_team', 'userId' => 'u_host', 'role' => 'host', 'lastReadAt' => iso($now)],
        ['id' => 'sp_team:u_colleague', 'spaceId' => 'sp_team', 'userId' => 'u_colleague', 'role' => 'member', 'lastReadAt' => iso($now)]
    );
    foreach ([20, 13, 6] as $i => $daysAgo) {
        put($db, 'session_log', ['id' => "log_a$i", 'spaceId' => 'sp_1', 'memberId' => 'u_ayaan', 'sessionId' => "se_a$i", 'at' => iso($now - $daysAgo * DAY), 'status' => 'attended', 'minutes' => 60]);
    }
    put($db, 'posts', ['id' => 'po_ws7', 'spaceId' => 'sp_1', 'kind' => 'task', 'title' => 'Worksheet 7 p2', 'dueAt' => iso($now + 47 * 3600000), 'createdAt' => iso($now - 3 * DAY)]);
    put($db, 'submissions', ['id' => 'sub_t', 'postId' => 'po_ws7', 'userId' => 'u_tania', 'status' => 'handed-in', 'at' => iso($now - DAY)]);
    $inv = ['hostId' => 'u_host', 'period' => '2026-11', 'kind' => 'monthly', 'lines' => [], 'status' => 'sent', 'needsAttention' => null, 'createdAt' => iso($now - 10 * DAY), 'viewedAt' => null, 'viewCount' => 0, 'payments' => [], 'comments' => [], 'waPending' => null, 'activity' => []];
    put(
        $db,
        'invoices',
        $inv + ['id' => 'inv_ayaan', 'number' => 'LF-0001', 'payerId' => 'u_ayaan', 'memberIds' => ['u_ayaan'], 'totalCents' => 12000, 'sentAt' => iso($now - 3 * DAY), 'dueAt' => iso($now + 4 * DAY), 'claims' => [['id' => 'cl_1', 'status' => 'open', 'at' => iso($now - DAY)]], 'remindersSent' => [], 'payToken' => 'pay_ayaan_secret'],
        $inv + ['id' => 'inv_tania', 'number' => 'LF-0002', 'payerId' => 'u_tania', 'memberIds' => ['u_tania'], 'totalCents' => 9000, 'sentAt' => iso($now - 12 * DAY), 'dueAt' => iso($now - 5 * DAY), 'claims' => [], 'remindersSent' => [3], 'payToken' => 'pay_tania_secret']
    );
    // Last week's nudges: one opened and acted on (Tania handed in), one not.
    put(
        $db,
        'notifications',
        ['id' => 'nt_old1', 'userId' => 'u_tania', 'kind' => 'nudge', 'title' => 'Due tomorrow', 'sub' => '', 'link' => '/', 'createdAt' => iso($now - 2 * DAY), 'readAt' => iso($now - 2 * DAY + 60000)],
        ['id' => 'nt_old2', 'userId' => 'u_tania', 'kind' => 'nudge', 'title' => 'Overdue', 'sub' => '', 'link' => '/', 'createdAt' => iso($now - DAY), 'readAt' => null],
        ['id' => 'nt_old3', 'userId' => 'u_tania', 'kind' => 'nudge', 'title' => 'Old', 'sub' => '', 'link' => '/', 'createdAt' => iso($now - 10 * DAY), 'readAt' => null]
    );
    put(
        $db,
        'nudge_log',
        ['id' => 'nl_1', 'hostId' => 'u_host', 'nudgeId' => null, 'rule' => 'deadline', 'userId' => 'u_tania', 'notificationId' => 'nt_old1', 'at' => iso($now - 2 * DAY), 'taskId' => 'po_ws7'],
        ['id' => 'nl_2', 'hostId' => 'u_host', 'nudgeId' => null, 'rule' => 'fee3', 'userId' => 'u_tania', 'notificationId' => 'nt_old2', 'at' => iso($now - DAY), 'invoiceId' => 'inv_tania'],
        ['id' => 'nl_3', 'hostId' => 'u_host', 'nudgeId' => null, 'rule' => 'deadline', 'userId' => 'u_tania', 'notificationId' => 'nt_old3', 'at' => iso($now - 10 * DAY), 'taskId' => 'po_ws7']
    );
    return $now;
}

/** Nudge notifications created at or after a time, oldest first. */
function ins_test_nudges(Db $db, int $since, ?string $userId = null): array
{
    $db->clearCache();
    return sorted($db->list('notifications', fn ($n) => $n['kind'] === 'nudge' && strcmp($n['createdAt'], iso($since)) >= 0 && ($userId === null || $n['userId'] === $userId)), fn ($a, $b) => strcmp($a['id'], $b['id']));
}

test('insights routes: lists learners and clients with last seen, attendance, homework, fees and at-risk reasons', function () {
    $db = fresh();
    ins_test_fixture($db);
    $ins = call($db, 'u_host', 'GET', 'insights', ['days' => '30']);
    eq($ins['days'], 30);
    eq(array_map(fn ($s) => $s['code'], $ins['spaces']), ['PHY'], 'team spaces are left out');
    $by = index_by($ins['people'], fn ($p) => $p['name']);
    eq(array_keys($by), ['Dipa Member', 'Tania Member', 'Ayaan Member'], 'at risk first; co-hosts and colleagues are not learners');
    eq([$by['Ayaan Member']['seen'], $by['Ayaan Member']['atRisk'], $by['Ayaan Member']['fee']], ['in a room', false, 'claimed']);
    ok($by['Ayaan Member']['attendance'] >= 90, 'Ayaan attends');
    eq([$by['Dipa Member']['atRisk'], $by['Dipa Member']['notSeen7'], $by['Dipa Member']['phone']], [true, true, '+8801700000001']);
    ok(in_array('not seen for 9 days', $by['Dipa Member']['reasons'], true), 'Dipa not seen');
    ok(in_array('fee overdue', $by['Tania Member']['reasons'], true), 'Tania overdue');
    eq($by['Tania Member']['fee'], 'overdue');
    eq($ins['people'][0]['atRisk'], true);
    eq([$ins['kpis']['members'], $ins['kpis']['active'], $ins['kpis']['attendance'], $ins['kpis']['avgMinutes']], [3, 3, 100, 60]);
    eq($ins['stats'], ['sent' => 2, 'opened' => 1, 'acted' => 1]);
    $aud = index_by($ins['audiences'], fn ($a) => $a['id']);
    eq($aud['at_risk']['count'], 2);
    eq($aud['not_seen']['count'], 1);
    eq($aud['task:po_ws7']['label'], "2 who haven't handed in Worksheet 7 p2");
    eq($aud['space:sp_1']['label'], 'Everyone in Physics (3)');
    ok(!isset($aud['space:sp_team']), 'no team audience');
    eq($ins['template'], DEFAULT_NUDGE_TEXT);
    eq(call($db, 'u_host', 'GET', 'insights', ['days' => 12])['days'], 30, 'only 7, 30 or 90 days');
});

test('insights routes: sends a custom nudge now or schedules it; WhatsApp comes back as links, email is sent', function () {
    $db = fresh();
    $start = ins_test_fixture($db);
    $ins = call($db, 'u_host', 'GET', 'insights');
    $aud = find($ins['audiences'], fn ($x) => str_contains($x['label'], 'Worksheet 7 p2'));
    $now = call($db, 'u_host', 'POST', 'nudges', ['audience' => $aud['id'], 'text' => 'Hi {first_name}, {task} is due {due}.', 'channels' => ['inapp', 'whatsapp', 'email']]);
    eq([$now['recipients'], $now['scheduled']], [$aud['count'], false]);
    eq($now['whatsapp'][0]['text'], 'Hi Ayaan, Worksheet 7 p2 is due Mon 23 Nov.');
    eq($now['whatsapp'][1]['phone'], '+8801700000001');
    $dipa = ins_test_nudges($db, $start, 'u_dipa');
    eq($dipa[0]['title'], 'Nusrat: Hi Dipa, Worksheet 7 p2 is due Mon 23 Nov.');
    eq($dipa[0]['link'], '/s/sp_1/work');
    eq(array_map(fn ($m) => $m['to'], $GLOBALS['loft_mail']), ['ayaan@example.test', 'dipa@example.test']);
    contains($GLOBALS['loft_mail'][1]['body'], 'https://example.test/spaces/#/s/sp_1/work');
    eq(count($db->list('nudge_log', fn ($l) => ($l['nudgeId'] ?? null) !== null)), 2);
    $later = call($db, 'u_host', 'POST', 'nudges', ['userId' => 'u_dipa', 'text' => 'See you Monday, {first_name}!', 'channels' => ['inapp'], 'sendAt' => iso($start + 3600000)]);
    eq($later['scheduled'], true);
    eq(array_map(fn ($s) => $s['label'], call($db, 'u_host', 'GET', 'insights')['scheduled']), ['Dipa Member']);
    eq(count(ins_test_nudges($db, $start, 'u_dipa')), 1, 'not yet');
    $GLOBALS['loft_now'] = $start + 2 * 3600000;
    deliver_nudges(new Ctx($db, 'u_host'), 'u_host');
    $dipa = ins_test_nudges($db, $start, 'u_dipa');
    eq(end($dipa)['title'], 'Nusrat: See you Monday, Dipa!');
    deliver_nudges(new Ctx($db, 'u_host'), 'u_host');
    eq(count(ins_test_nudges($db, $start, 'u_dipa')), 2, 'delivered once');
    eq(call($db, 'u_host', 'GET', 'insights')['scheduled'], []);
    throws(fn () => call($db, 'u_host', 'POST', 'nudges', ['audience' => 'nope']), '/Nobody to nudge/', BadRequest::class);
});

test('insights routes: automatic nudges run once a day, each fires once; the host turns rules on and off', function () {
    $db = fresh();
    $start = ins_test_fixture($db);
    $db->patch('invoices', 'inv_tania', ['remindersSent' => []]);
    put(
        $db,
        'session_log',
        ['id' => 'log_d1', 'spaceId' => 'sp_1', 'memberId' => 'u_dipa', 'sessionId' => 'se_d1', 'at' => iso($start - 7 * DAY), 'status' => 'absent', 'minutes' => 0],
        ['id' => 'log_d2', 'spaceId' => 'sp_1', 'memberId' => 'u_dipa', 'sessionId' => 'se_d2', 'at' => iso($start - 3 * DAY), 'status' => 'no_show', 'minutes' => 0]
    );
    put($db, 'posts', ['id' => 'po_ws8', 'spaceId' => 'sp_1', 'kind' => 'task', 'title' => 'Worksheet 8', 'dueAt' => iso($start + 20 * 3600000), 'createdAt' => iso($start - DAY)]);
    put($db, 'files', ['id' => 'f_notes', 'sha256' => 'x', 'name' => 'notes.pdf', 'mime' => 'application/pdf', 'size' => 10, 'ownerId' => 'u_host', 'spaceId' => 'sp_1', 'createdAt' => iso($start - 5 * DAY)]);
    eq(call($db, 'u_ayaan', 'POST', 'files/f_notes/open'), ['ok' => true]);
    ok($db->get('file_opens', 'f_notes:u_ayaan') !== null, 'open recorded');
    throws(fn () => call($db, 'u_host', 'POST', 'nudges/rules', ['rule' => 'nope', 'on' => true]), '/Unknown rule/', NotFound::class);
    call($db, 'u_host', 'POST', 'nudges/rules', ['rule' => 'files3', 'on' => true]);
    $ins = call($db, 'u_host', 'GET', 'insights');
    $rules = index_by($ins['rules'], fn ($r) => $r['id']);
    eq([$rules['files3']['on'], $rules['deadline']['on']], [true, true]);
    eq($rules['files3']['title'], "Hasn't opened shared files");
    $titles = array_map(fn ($n) => "{$n['userId']}: {$n['title']}", ins_test_nudges($db, $start));
    sort($titles);
    eq($titles, [
        'u_ayaan: Due tomorrow: Worksheet 8',
        'u_dipa: Dipa missed 2 sessions in a row',
        'u_dipa: Due tomorrow: Worksheet 8',
        'u_dipa: Have a look at notes.pdf',
        'u_tania: Due tomorrow: Worksheet 8',
        'u_tania: Have a look at notes.pdf',
        'u_tania: LF-0002 is overdue · $90.00',
    ]);
    $fee = find(ins_test_nudges($db, $start, 'u_tania'), fn ($n) => str_contains($n['title'], 'overdue'));
    eq($fee['link'], '/pay/pay_tania_secret');
    call($db, 'u_host', 'GET', 'insights');
    insights_daily(new Ctx($db, 'u_host'), 'u_host');
    eq(count(ins_test_nudges($db, $start)), 7, 'once a day');
    // Next day: Worksheet 7 p2 is now due tomorrow; everything else already fired.
    $GLOBALS['loft_now'] = $start + DAY;
    call($db, 'u_host', 'GET', 'insights');
    $new = array_map(fn ($n) => "{$n['userId']}: {$n['title']}", ins_test_nudges($db, $start + DAY));
    sort($new);
    eq($new, ['u_ayaan: Due tomorrow: Worksheet 7 p2', 'u_dipa: Due tomorrow: Worksheet 7 p2']);
    eq($db->get('nudge_settings', 'u_host')['lastDaily'], '2026-11-22');
    call($db, 'u_host', 'POST', 'nudges/rules', ['rule' => 'deadline', 'on' => false]);
    eq(index_by(call($db, 'u_host', 'GET', 'insights')['rules'], fn ($r) => $r['id'])['deadline']['on'], false);
});

test('insights: touch_seen counts last seen every 5 minutes and a new login after 30 minutes away', function () {
    $db = fresh();
    $GLOBALS['loft_now'] = ms('2026-11-21T12:00:00.000Z');
    fixture($db);
    $ctx = new Ctx($db, 'u_a');
    touch_seen($ctx);
    $u = $db->get('users', 'u_a');
    eq([$u['lastSeenAt'], $u['lastLoginAt']], ['2026-11-21T12:00:00.000Z', '2026-11-21T12:00:00.000Z']);
    $GLOBALS['loft_now'] += 3 * 60000;
    touch_seen($ctx);
    eq($db->get('users', 'u_a')['lastSeenAt'], '2026-11-21T12:00:00.000Z', 'throttled');
    $GLOBALS['loft_now'] += 3 * 60000;
    touch_seen($ctx);
    $u = $db->get('users', 'u_a');
    eq([$u['lastSeenAt'], $u['lastLoginAt']], ['2026-11-21T12:06:00.000Z', '2026-11-21T12:00:00.000Z']);
    $GLOBALS['loft_now'] += 45 * 60000;
    touch_seen($ctx);
    eq($db->get('users', 'u_a')['lastLoginAt'], '2026-11-21T12:51:00.000Z', 'a new visit');
    touch_seen(new Ctx($db, null));
});
