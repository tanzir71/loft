<?php
declare(strict_types=1);

namespace Loft;

// Spaces, stream, chat, DMs, rooms, notifications and To review (routes/spaces.php, routes/rooms.php).

test('core spaces: codes, tab labels, must-read audience', function () {
    eq(space_code('Acme pricing'), 'ACM');
    eq(space_code('Product team'), 'PRO');
    eq(space_code('Q3'), 'QXX');
    eq(space_code('123'), 'LFT');
    eq(tab_label('course', 'work'), 'Classwork');
    eq(tab_label('team', 'files'), 'Files');
    eq(unacknowledged(['u_host', 'u_a', 'u_b'], ['u_a'], 'u_host'), ['u_b']);
    eq(space_mode('nope')['label'], 'Team');
});

test('spaces: create a space and see it in nav and home', function () {
    $db = fresh();
    $GLOBALS['loft_now'] = ms('2026-11-21T09:00:00.000Z');
    fixture($db);
    $db->patch('users', 'u_host', ['passwordHash' => 'not-for-the-wire']);
    $GLOBALS['loft_now'] += 1000;
    $s = call($db, 'u_host', 'POST', 'spaces', ['name' => 'Acme pricing', 'mode' => 'client']);
    eq([$s['slug'], $s['code'], $s['mode'], $s['sub'], $s['colour']], ['acme-pricing', 'ACM', 'client', 'Client / consulting', 'blue']);
    eq($db->get('memberships', "{$s['id']}:u_host")['role'], 'host');
    $GLOBALS['loft_now'] += 1000;
    $s2 = call($db, 'u_host', 'POST', 'spaces', ['name' => 'Acme pricing', 'mode' => 'bogus']);
    eq([$s2['slug'], $s2['mode']], ['acme-pricing-2', 'team']);
    throws(fn () => call($db, 'u_host', 'POST', 'spaces', ['name' => '  ']), '/Give the space a name/', BadRequest::class);

    $view = call($db, 'u_host', 'GET', 'spaces/acme-pricing');
    eq([$view['isHost'], $view['myRole']], [true, 'host']);
    ok(in_array('billing', $view['modeConfig']['tabs'], true), 'client mode has billing');
    ok(preg_match('/^acm-[a-z2-9]{3}$/', $view['joinCode']) === 1, 'join code');
    eq($view['joinCode'], call($db, 'u_host', 'GET', "spaces/{$s['id']}")['joinCode'], 'join code is stable');
    throws(fn () => call($db, 'u_a', 'GET', 'spaces/acme-pricing'), "/You're not in this space/", Forbidden::class);
    throws(fn () => call($db, 'u_a', 'GET', 'spaces/nowhere'), '/Space not found/', NotFound::class);

    eq(array_column(call($db, 'u_host', 'GET', 'spaces'), 'slug'), ['physics', 'acme-pricing', 'acme-pricing-2']);
    $nav = call($db, 'u_host', 'GET', 'nav');
    eq(array_column($nav['spaces'], 'slug'), ['physics', 'acme-pricing', 'acme-pricing-2']);
    eq($nav['spaces'][1]['to'], '/s/acme-pricing');
    eq($nav['brand'], ['name' => 'Loft', 'monogram' => 'L']);
    ok(!array_key_exists('passwordHash', $nav['me']), 'nav never sends passwordHash');
    ok(!array_key_exists('passwordHash', call($db, 'u_host', 'GET', 'me')), 'me never sends passwordHash');
    eq(call($db, null, 'GET', 'me'), null);

    // Branded organisation: the host sees their brand in the side panel; members still see Loft.
    $org = find($db->list('orgs'), fn ($o) => $o['hostId'] === 'u_host');
    $db->patch('orgs', $org['id'], ['branded' => true, 'brandedUntil' => '2026-12-31', 'theme' => 'sunrise']);
    eq(call($db, 'u_host', 'GET', 'nav')['brand'], ['name' => 'Nusrat Rahman', 'monogram' => 'NR', 'theme' => 'sunrise']);
    eq(call($db, 'u_a', 'GET', 'nav')['brand'], ['name' => 'Loft', 'monogram' => 'L']);

    // Home: spaces with mode labels, today's sessions with the live room, default settings.
    put($db, 'sessions', ['id' => 'se_1', 'spaceId' => 'sp_1', 'title' => 'Physics · Lesson 4', 'startsAt' => '2026-11-21T10:00:00.000Z', 'minutes' => 60, 'room' => 'loft', 'status' => 'scheduled', 'sequence' => 0]);
    $room = call($db, 'u_host', 'POST', 'rooms', ['name' => 'Physics', 'spaceId' => 'sp_1']);
    $home = call($db, 'u_host', 'GET', 'home');
    eq(array_column($home['spaces'], 'slug'), ['physics', 'acme-pricing', 'acme-pricing-2']);
    eq($home['spaces'][1]['modeLabel'], 'Client / consulting');
    eq($home['spaces'][0]['next'], '2026-11-21T10:00:00.000Z');
    eq($home['spaces'][1]['next'], null);
    eq(count($home['today']), 1);
    eq([$home['today'][0]['spaceName'], $home['today'][0]['live'], $home['today'][0]['roomCode']], ['Physics', false, $room['code']]);
    eq($home['settings'], ['id' => 'u_host', 'roomLink' => '', 'bookingPage' => null, 'paymentLink' => null]);
    ok(!array_key_exists('passwordHash', $home['me']), 'home never sends passwordHash');

    // Rooms in the side panel: the space's room shows for its members, a stranger's room never does.
    put($db, 'users', ['id' => 'u_x', 'name' => 'Stranger Danger', 'email' => 'x@example.test', 'tz' => 'UTC', 'status' => 'available', 'createdAt' => iso(now_ms())]);
    call($db, 'u_x', 'POST', 'rooms', ['name' => 'Elsewhere']);
    eq(array_column(call($db, 'u_a', 'GET', 'nav')['rooms'], 'name'), ['Physics']);
    eq(array_column(call($db, 'u_host', 'GET', 'nav')['rooms'], 'to'), ["/r/{$room['code']}"]);
});

test('spaces: a post, a must-read notice and who has not seen it', function () {
    $db = fresh();
    $GLOBALS['loft_now'] = ms('2026-11-21T09:00:00.000Z');
    fixture($db);
    throws(fn () => call($db, 'u_a', 'POST', 'spaces/sp_1/posts', ['kind' => 'notice', 'title' => 'Not mine to say']), '/Only hosts can post tasks and must-read notices/', Forbidden::class);
    throws(fn () => call($db, 'u_host', 'POST', 'spaces/sp_1/posts', ['body' => '   ']), '/Write something first/', BadRequest::class);
    $plain = call($db, 'u_a', 'POST', 'spaces/sp_1/posts', ['body' => 'Is the lab open on Sunday?', 'attachments' => [['id' => 'f_1']]]);
    eq([$plain['kind'], $plain['mustRead'], count($plain['attachments'])], ['post', false, 1]);
    ok(!array_key_exists('dueAt', $plain), 'no dueAt unless given');

    $GLOBALS['loft_now'] += 1000;
    $notice = call($db, 'u_host', 'POST', 'spaces/sp_1/posts', ['kind' => 'notice', 'title' => 'Exam moved', 'body' => 'Now on Friday']);
    eq($notice['mustRead'], true);
    eq(call($db, 'u_a', 'POST', "posts/{$notice['id']}/ack"), ['ok' => true]);

    $posts = call($db, 'u_host', 'GET', 'spaces/sp_1/posts');
    eq(array_column($posts, 'id'), [$notice['id'], $plain['id']], 'newest first');
    $p = $posts[0];
    eq([$p['authorName'], $p['audience'], $p['acked'], $p['notSeen'], $p['ackedByMe']], ['Nusrat Rahman', 2, 1, ['B Member'], false]);
    eq(call($db, 'u_a', 'GET', 'spaces/sp_1/posts')[0]['ackedByMe'], true);

    // The member who hasn't confirmed has it in To review; the one who did doesn't.
    ok(some(call($db, 'u_b', 'GET', 'review'), fn ($i) => $i['id'] === "ack:{$notice['id']}" && $i['title'] === 'Please confirm: Exam moved' && $i['link'] === '/s/sp_1'), 'ack item for u_b');
    ok(!some(call($db, 'u_a', 'GET', 'review'), fn ($i) => $i['kind'] === 'ack'), 'no ack item for u_a');

    throws(fn () => call($db, 'u_a', 'POST', "posts/{$notice['id']}/remind"), '/Only hosts can send reminders/', Forbidden::class);
    $GLOBALS['loft_now'] += 1000;
    eq(call($db, 'u_host', 'POST', "posts/{$notice['id']}/remind"), ['reminded' => 1]);
    eq(array_column(call($db, 'u_b', 'GET', 'notifications'), 'title'), ['Reminder: Exam moved', 'Please confirm: Exam moved']);
    eq(array_column(call($db, 'u_a', 'GET', 'notifications'), 'title'), ['Please confirm: Exam moved']);
    throws(fn () => call($db, 'u_a', 'POST', 'posts/po_missing/ack'), '/Post not found/', NotFound::class);
});

test('spaces: a task hand-in shows in work and in the review list', function () {
    $db = fresh();
    $GLOBALS['loft_now'] = ms('2026-11-21T09:00:00.000Z');
    fixture($db);
    throws(fn () => call($db, 'u_a', 'POST', 'spaces/sp_1/posts', ['kind' => 'task', 'title' => 'Sneaky']), '/Only hosts/', Forbidden::class);
    $task = call($db, 'u_host', 'POST', 'spaces/sp_1/posts', ['kind' => 'task', 'title' => 'Worksheet 3', 'dueAt' => '2026-11-23T09:00:00.000Z']);
    eq($task['dueAt'], '2026-11-23T09:00:00.000Z');
    ok(some(call($db, 'u_a', 'GET', 'notifications'), fn ($n) => $n['kind'] === 'task' && $n['title'] === 'New task: Worksheet 3' && $n['link'] === '/s/physics'), 'members hear about the task');

    $work = call($db, 'u_host', 'GET', 'spaces/sp_1/work');
    eq([count($work), $work[0]['assigned'], $work[0]['submissions']], [1, 2, []]);
    eq(call($db, 'u_a', 'GET', 'spaces/sp_1')['upcoming'][0], ['kind' => 'task', 'title' => 'Worksheet 3', 'at' => '2026-11-23T09:00:00.000Z']);

    eq(call($db, 'u_a', 'POST', "posts/{$task['id']}/handin", ['note' => 'Done, page 2 too']), ['ok' => true]);
    ok(some(call($db, 'u_host', 'GET', 'notifications'), fn ($n) => $n['title'] === 'A handed in Worksheet 3' && $n['link'] === '/s/physics/work'), 'host hears about the hand-in');

    $review = call($db, 'u_host', 'GET', 'review');
    $h = find($review, fn ($i) => $i['kind'] === 'handin');
    ok($h !== null, 'hand-in in To review');
    eq([$h['id'], $h['title'], $h['sub'], $h['action'], $h['link']], ["handin:{$task['id']}", '1 hand-in to review', 'Worksheet 3 · Physics', 'Review', '/s/physics/work']);
    ok(call($db, 'u_host', 'GET', 'nav')['counts']['review'] >= 1, 'nav counts it');

    // Hosts see every hand-in with names; members only their own.
    $hostWork = call($db, 'u_host', 'GET', 'spaces/sp_1/work')[0]['submissions'];
    eq([count($hostWork), $hostWork[0]['name'], $hostWork[0]['note']], [1, 'A Member', 'Done, page 2 too']);
    eq(call($db, 'u_b', 'GET', 'spaces/sp_1/work')[0]['submissions'], []);
    eq(count(call($db, 'u_a', 'GET', 'spaces/sp_1/work')[0]['submissions']), 1);
    $mine = call($db, 'u_a', 'GET', 'spaces/sp_1/posts')[0];
    eq([$mine['handIns'], $mine['mySubmission']['status']], [1, 'handed-in']);

    throws(fn () => call($db, 'u_a', 'POST', "submissions/{$task['id']}:u_a/review", ['status' => 'done']), '/Only hosts review hand-ins/', Forbidden::class);
    $done = call($db, 'u_host', 'POST', "submissions/{$task['id']}:u_a/review", ['status' => 'done', 'feedback' => 'Nice work']);
    eq([$done['status'], $done['feedback']], ['done', 'Nice work']);
    ok(!some(call($db, 'u_host', 'GET', 'review'), fn ($i) => $i['kind'] === 'handin'), 'reviewed hand-ins leave the list');

    $note = call($db, 'u_host', 'POST', 'spaces/sp_1/posts', ['body' => 'Just a note']);
    throws(fn () => call($db, 'u_a', 'POST', "posts/{$note['id']}/handin"), '/Task not found/', NotFound::class);
});

test('spaces: space chat and DMs drive unread counts, knock and room invites', function () {
    $db = fresh();
    $GLOBALS['loft_now'] = ms('2026-11-21T09:00:00.000Z');
    fixture($db);
    $GLOBALS['loft_now'] += 60000;
    call($db, 'u_a', 'POST', 'spaces/sp_1/messages', ['body' => 'Hello class']);
    throws(fn () => call($db, 'u_a', 'POST', 'spaces/sp_1/messages', ['body' => '   ']), '/Empty message/', BadRequest::class);
    throws(fn () => call($db, 'u_a', 'GET', 'spaces/sp_other/messages'), "/You're not in this space/", Forbidden::class);
    eq(array_column(call($db, 'u_host', 'GET', 'spaces/sp_1/messages'), 'body'), ['Hello class']);

    $nav = call($db, 'u_host', 'GET', 'nav');
    eq([$nav['spaces'][0]['unread'], $nav['counts']['chats']], [1, 1]);
    eq(call($db, 'u_a', 'GET', 'nav')['spaces'][0]['unread'], 0, 'your own messages are never unread');
    eq(call($db, 'u_host', 'POST', 'spaces/sp_1/read'), ['ok' => true]);
    eq(call($db, 'u_host', 'GET', 'nav')['spaces'][0]['unread'], 0);

    // DMs: two unread from A; B is reachable before the first message.
    $GLOBALS['loft_now'] += 60000;
    call($db, 'u_a', 'POST', 'dms/u_host/messages', ['body' => 'Can we talk?']);
    $GLOBALS['loft_now'] += 1000;
    call($db, 'u_a', 'POST', 'dms/u_host/messages', ['body' => 'About the exam']);
    $dms = call($db, 'u_host', 'GET', 'dms');
    eq(array_column($dms, 'id'), ['u_a', 'u_b']);
    eq([$dms[0]['unread'], $dms[0]['last']['body'], $dms[0]['last']['mine']], [2, 'About the exam', false]);
    eq([$dms[1]['unread'], $dms[1]['last']], [0, null]);
    eq(find(call($db, 'u_a', 'GET', 'dms'), fn ($d) => $d['id'] === 'u_host')['unread'], 0, 'sending marks the thread read');
    $nav = call($db, 'u_host', 'GET', 'nav');
    eq($nav['counts']['chats'], 2);
    eq($nav['dms'][0], ['id' => 'u_a', 'name' => 'A Member', 'to' => '/dm/u_a', 'presence' => 'available', 'canKnock' => true]);
    eq(call($db, 'u_host', 'POST', 'dms/u_a/read'), ['ok' => true]);
    eq(call($db, 'u_host', 'GET', 'dms')[0]['unread'], 0);
    eq(call($db, 'u_host', 'GET', 'nav')['counts']['chats'], 0);

    $db->patch('users', 'u_b', ['status' => 'busy']);
    $busy = find(call($db, 'u_host', 'GET', 'nav')['dms'], fn ($d) => $d['id'] === 'u_b');
    eq([$busy['note'], $busy['canKnock']], ['in a room', false]);

    // Knock from a DM: a room, an invite card in the thread and a knock in To review.
    $GLOBALS['loft_now'] += 1000;
    $room = call($db, 'u_host', 'POST', 'dms/u_a/room', ['knock' => true]);
    eq([$room['name'], $room['guestJoin'], $room['capacity']], ['Nusrat + A', false, 12]);
    $thread = call($db, 'u_a', 'GET', 'dms/u_host');
    eq($thread['peer'], ['id' => 'u_host', 'name' => 'Nusrat Rahman', 'status' => 'available', 'title' => '']);
    $last = $thread['messages'][count($thread['messages']) - 1];
    eq([$last['kind'], $last['roomCode'], $last['body']], ['room', $room['code'], 'knocked']);
    eq(find(call($db, 'u_a', 'GET', 'dms'), fn ($d) => $d['id'] === 'u_host')['last']['body'], 'Room · Nusrat + A');
    ok(some(call($db, 'u_a', 'GET', 'review'), fn ($i) => $i['kind'] === 'knock' && $i['title'] === 'Nusrat knocked' && $i['link'] === "/r/{$room['code']}"), 'knock in To review');
    eq(array_column(call($db, 'u_a', 'GET', 'nav')['rooms'], 'to'), ["/r/{$room['code']}"], 'invited rooms show in the side panel');
    throws(fn () => call($db, 'u_host', 'GET', 'dms/u_nobody'), '/Person not found/', NotFound::class);
});

test('rooms: create, knock with guest join on and off, admit, chat, end', function () {
    $db = fresh();
    fixture($db);
    eq(call($db, 'u_host', 'GET', 'settings'), ['id' => 'u_host', 'roomLink' => '', 'bookingPage' => null, 'paymentLink' => null]);
    $set = call($db, 'u_host', 'POST', 'settings', ['bookingPage' => 'https://cal.example.test/nusrat', 'roomLink' => 'ignored']);
    eq([$set['bookingPage'], array_key_exists('roomLink', $set)], ['https://cal.example.test/nusrat', false]);

    $room = call($db, 'u_host', 'POST', 'rooms', ['name' => 'Kickoff']);
    ok(preg_match('/^[A-Z2-9]{3}-[A-Z2-9]{3}$/', $room['code']) === 1, 'readable code');
    eq([$room['capacity'], $room['guestJoin'], $room['endedAt'], $room['slug']], [12, true, null, strtolower($room['code'])]);
    eq(call($db, 'u_host', 'POST', 'rooms', [])['name'], 'Quick room · Nusrat');
    $found = call($db, null, 'GET', 'rooms/by-code/' . strtolower(str_replace('-', '', $room['code'])));
    eq([$found['id'], $found['hostName']], [$room['id'], 'Nusrat Rahman']);
    eq(call($db, null, 'GET', "rooms/{$room['id']}")['hostName'], 'Nusrat Rahman');
    throws(fn () => call($db, null, 'GET', 'rooms/by-code/ZZZ-ZZZ'), '/No room with that code/', NotFound::class);

    // Guest join on: a guest (with a session) walks straight in.
    throws(fn () => call($db, null, 'POST', 'guests', ['name' => '  ']), '/Name required/', BadRequest::class);
    unset($GLOBALS['loft_session_token']);
    $g = call($db, null, 'POST', 'guests', ['name' => 'Rahim Uddin']);
    eq([$g['guest'], $g['email'], $g['status']], [true, '', 'available']);
    ok(isset($GLOBALS['loft_session_token']), 'guest gets a session');
    $st = $db->pdo->prepare('SELECT user_id FROM auth_sessions WHERE token_hash = ?');
    $st->execute([hash('sha256', $GLOBALS['loft_session_token'])]);
    eq($st->fetchColumn(), $g['id']);
    eq(call($db, $g['id'], 'POST', "rooms/{$room['id']}/knock")['status'], 'admitted');
    eq(call($db, 'u_host', 'POST', "rooms/{$room['id']}/knock"), ['id' => 'host', 'status' => 'admitted']);
    eq(call($db, 'u_host', 'GET', "rooms/{$room['id']}/admission"), ['id' => 'host', 'status' => 'admitted']);

    // Guest join off: the host admits.
    throws(fn () => call($db, $g['id'], 'POST', "rooms/{$room['id']}/settings", ['guestJoin' => false]), '/Only the host/', Forbidden::class);
    eq(call($db, 'u_host', 'POST', "rooms/{$room['id']}/settings", ['guestJoin' => false])['guestJoin'], false);
    $g2 = call($db, null, 'POST', 'guests', ['name' => 'Ayaan']);
    eq(call($db, $g2['id'], 'GET', "rooms/{$room['id']}/admission"), null);
    $adm = call($db, $g2['id'], 'POST', "rooms/{$room['id']}/knock");
    eq($adm['status'], 'pending');
    eq(call($db, $g2['id'], 'POST', "rooms/{$room['id']}/knock")['id'], $adm['id'], 'knocking again keeps the same request');
    throws(fn () => call($db, $g2['id'], 'GET', "rooms/{$room['id']}/admissions"), '/Only the host/', Forbidden::class);
    eq(array_column(call($db, 'u_host', 'GET', "rooms/{$room['id']}/admissions"), 'name'), ['Ayaan']);
    eq(call($db, 'u_host', 'POST', "rooms/{$room['id']}/admissions/{$adm['id']}", ['decision' => 'admit'])['status'], 'admitted');
    eq(call($db, $g2['id'], 'GET', "rooms/{$room['id']}/admission")['status'], 'admitted');
    eq(call($db, 'u_host', 'GET', "rooms/{$room['id']}/admissions"), []);

    // Room chat stays in order.
    call($db, 'u_host', 'POST', "rooms/{$room['id']}/messages", ['body' => 'Welcome']);
    call($db, $g2['id'], 'POST', "rooms/{$room['id']}/messages", ['body' => 'sir page 2 also?']);
    $msgs = call($db, 'u_host', 'GET', "rooms/{$room['id']}/messages");
    eq(array_map(fn ($m) => "{$m['name']}: {$m['body']}", $msgs), ['Nusrat Rahman: Welcome', 'Ayaan: sir page 2 also?']);
    throws(fn () => call($db, $g2['id'], 'POST', "rooms/{$room['id']}/messages", ['body' => '   ']), '/Empty message/', BadRequest::class);

    // Only the host ends it; then nobody can knock.
    throws(fn () => call($db, $g['id'], 'POST', "rooms/{$room['id']}/end"), '/host/', Forbidden::class);
    ok(call($db, 'u_host', 'POST', "rooms/{$room['id']}/end")['endedAt'] !== null, 'ended');
    throws(fn () => call($db, $g2['id'], 'POST', "rooms/{$room['id']}/knock"), '/ended/', Forbidden::class);
    throws(fn () => call($db, 'u_a', 'GET', 'rooms/rm_missing'), '/Room not found/', NotFound::class);
});

test('notifications: reminders delivered once, newest first, read-all', function () {
    $db = fresh();
    $GLOBALS['loft_now'] = ms('2026-11-21T09:00:00.000Z');
    fixture($db);
    call($db, 'u_host', 'POST', 'spaces/sp_1/posts', ['kind' => 'task', 'title' => 'Worksheet 3']);
    $GLOBALS['loft_now'] += 1000;
    call($db, 'u_host', 'POST', 'spaces/sp_1/posts', ['kind' => 'notice', 'title' => 'Exam moved']);
    put($db, 'scheduled_reminders',
        ['id' => 'sr_due', 'spaceId' => 'sp_1', 'kind' => 'reminder', 'title' => 'Lesson in 1 hour', 'sub' => 'Physics', 'link' => '/s/physics', 'deliverAt' => '2026-11-21T08:59:00.000Z'],
        ['id' => 'sr_later', 'spaceId' => 'sp_1', 'kind' => 'reminder', 'title' => 'Tomorrow', 'sub' => 'Physics', 'link' => '/s/physics', 'deliverAt' => '2026-11-22T08:00:00.000Z']);

    $before = call($db, 'u_a', 'GET', 'notifications');
    eq(array_column($before, 'title'), ['Please confirm: Exam moved', 'New task: Worksheet 3', 'Lesson in 1 hour']);
    eq($db->get('scheduled_reminders', 'sr_due'), null, 'delivered reminders are removed');
    ok($db->get('scheduled_reminders', 'sr_later') !== null, 'future reminders wait');
    eq(count(call($db, 'u_a', 'GET', 'notifications')), 3, 'delivered once');
    eq(count(call($db, 'u_host', 'GET', 'notifications')), 1, 'every member got the reminder');
    ok(some($before, fn ($n) => $n['readAt'] === null), 'unread at first');
    eq(call($db, 'u_a', 'GET', 'nav')['counts']['inbox'], 4, 'review (1 ack) + 3 unread');

    eq(call($db, 'u_a', 'POST', 'notifications/read-all'), ['ok' => true]);
    ok(every(call($db, 'u_a', 'GET', 'notifications'), fn ($n) => $n['readAt'] !== null), 'all read');
    eq(call($db, 'u_a', 'GET', 'nav')['counts']['inbox'], 1, 'only the must-read ack is left');
    ok(some(call($db, 'u_b', 'GET', 'notifications'), fn ($n) => $n['readAt'] === null), "others' notifications untouched");

    $nb = call($db, 'u_b', 'GET', 'notifications')[0];
    throws(fn () => call($db, 'u_a', 'POST', "notifications/{$nb['id']}/read"), '/not found/', NotFound::class);
    eq(call($db, 'u_b', 'POST', "notifications/{$nb['id']}/read"), ['ok' => true]);
    ok($db->get('notifications', $nb['id'])['readAt'] !== null, 'marked read');
});

test('spaces: files list server uploads once, people are added by hosts', function () {
    $db = fresh();
    fixture($db);
    // What POST files (system.php) stores for an upload into the space.
    $upload = ['id' => 'f_1', 'sha256' => str_repeat('a', 64), 'name' => 'notes.pdf', 'mime' => 'application/pdf', 'size' => 2048, 'ownerId' => 'u_a', 'spaceId' => 'sp_1', 'createdAt' => iso(now_ms())];
    put($db, 'files', $upload);
    $row = call($db, 'u_a', 'POST', 'spaces/sp_1/files', ['ref' => $upload]);
    eq([$row['id'], $row['fileId'], $row['bytes']], ['f_1', 'f_1', 2048]);
    $list = call($db, 'u_host', 'GET', 'spaces/sp_1/files');
    eq(count($list), 1, 'listed once');
    eq([$list[0]['fileId'], $list[0]['name'], $list[0]['bytes'], $list[0]['ownerName']], ['f_1', 'notes.pdf', 2048, 'A Member']);
    throws(fn () => call($db, 'u_a', 'POST', 'spaces/sp_1/files', []), '/Upload the file first/', BadRequest::class);
    throws(fn () => call($db, 'u_a', 'GET', 'spaces/sp_2/files'), "/You're not in this space/", Forbidden::class);

    throws(fn () => call($db, 'u_a', 'POST', 'spaces/sp_1/members', ['name' => 'Friend']), '/Only hosts add people/', Forbidden::class);
    throws(fn () => call($db, 'u_host', 'POST', 'spaces/sp_1/members', ['name' => ' ']), '/Name required/', BadRequest::class);
    $kid = call($db, 'u_host', 'POST', 'spaces/sp_1/members', ['name' => 'New Kid', 'email' => 'kid@example.test', 'role' => 'payer']);
    eq([$kid['name'], $kid['status'], $db->get('memberships', "sp_1:{$kid['id']}")['role']], ['New Kid', 'offline', 'payer']);
    // An existing account joins as itself (no duplicate user, never a passwordHash).
    put($db, 'users', ['id' => 'u_c', 'name' => 'Cara Existing', 'email' => 'cara@example.test', 'tz' => 'UTC', 'status' => 'available', 'passwordHash' => 'secret', 'createdAt' => iso(now_ms())]);
    $cara = call($db, 'u_host', 'POST', 'spaces/sp_1/members', ['name' => 'Cara', 'email' => 'Cara@Example.test']);
    eq([$cara['id'], array_key_exists('passwordHash', $cara)], ['u_c', false]);
    eq($db->get('memberships', 'sp_1:u_c')['role'], 'member');
    $people = call($db, 'u_host', 'GET', 'spaces/sp_1')['members'];
    eq($people[0]['role'], 'host');
    eq(count($people), 5);
    ok(every($people, fn ($x) => !array_key_exists('passwordHash', $x) && !array_key_exists('email', $x)), 'member rows are minimal');
});
