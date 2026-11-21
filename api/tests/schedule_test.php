<?php
declare(strict_types=1);

namespace Loft;

// Ports packages/core/src/schedule.test.ts (core) and packages/data/src/local/schedule.test.ts (routes),
// plus the server-only parts: emailed .ics invites and the cached https busy feed.

/** The host's availability used by the booking tests: Tuesdays 10:00–12:00 UTC, 14-day horizon. */
function sch_test_availability(array $extra = []): array
{
    return array_merge(['id' => 'u_host', 'tz' => 'UTC', 'weekly' => [2 => [['start' => '10:00', 'end' => '12:00']]], 'rules' => ['bufferMin' => 15, 'noticeHours' => 12, 'maxPerDay' => 4, 'horizonDays' => 14], 'handle' => 'nusrat', 'bio' => 'Pricing and product strategy', 'feedToken' => 'feedtoken123', 'busyIcs' => ''], $extra);
}

function sch_test_mail_to(): array
{
    $to = array_column($GLOBALS['loft_mail'], 'to');
    sort($to);
    return $to;
}

test('schedule core: wall time → UTC across time zones and DST changes', function () {
    eq(iso(zoned_to_utc('2026-11-24', '16:00', 'Asia/Dhaka')), '2026-11-24T10:00:00.000Z');
    eq(iso(zoned_to_utc('2026-07-01', '09:00', 'Europe/London')), '2026-07-01T08:00:00.000Z');
    eq(iso(zoned_to_utc('2026-12-01', '09:00', 'Europe/London')), '2026-12-01T09:00:00.000Z');
    eq(iso(zoned_to_utc('2026-03-09', '09:00', 'America/New_York')), '2026-03-09T13:00:00.000Z');
    eq(tz_offset(ms('2026-01-01T00:00:00Z'), 'Asia/Dhaka'), 6 * 3600000);
    // The days the clocks change.
    eq(iso(zoned_to_utc('2026-03-08', '09:00', 'America/New_York')), '2026-03-08T13:00:00.000Z', 'US spring forward');
    eq(iso(zoned_to_utc('2026-11-01', '09:00', 'America/New_York')), '2026-11-01T14:00:00.000Z', 'US fall back');
    eq(iso(zoned_to_utc('2026-03-28', '09:00', 'Europe/London')), '2026-03-28T09:00:00.000Z', 'before BST');
    eq(iso(zoned_to_utc('2026-03-29', '09:00', 'Europe/London')), '2026-03-29T08:00:00.000Z', 'BST starts');
    // A wall time inside the spring-forward gap lands where the TS re-check puts it (01:30 EST).
    eq(iso(zoned_to_utc('2026-03-08', '02:30', 'America/New_York')), '2026-03-08T06:30:00.000Z', 'DST gap');
    $t = ms('2026-11-23T20:00:00Z'); // Mon 20:00 UTC = Tue 02:00 in Dhaka
    eq(date_in($t, 'Asia/Dhaka'), '2026-11-24');
    eq(weekday_in($t, 'Asia/Dhaka'), 2);
    eq(add_days('2026-12-31', 1), '2027-01-01');
    throws(fn () => zoned_to_utc('2026-11-24', '10:00', 'Not/AZone'), '/Invalid time zone/');
});

test('schedule core: weekly series and clashes', function () {
    $byCount = expand_series(['days' => [1, 3], 'time' => '16:00', 'minutes' => 60, 'tz' => 'Asia/Dhaka', 'from' => '2026-11-23', 'count' => 4]);
    eq($byCount, ['2026-11-23T10:00:00.000Z', '2026-11-25T10:00:00.000Z', '2026-11-30T10:00:00.000Z', '2026-12-02T10:00:00.000Z']);
    eq(count(expand_series(['days' => [4], 'time' => '09:00', 'minutes' => 30, 'tz' => 'UTC', 'from' => '2026-11-01', 'until' => '2026-11-30'])), 4);
    eq(count(expand_series(['days' => [0, 1, 2, 3, 4, 5, 6], 'time' => '09:00', 'tz' => 'UTC', 'from' => '2026-01-01'])), 200, 'capped at 200');
    // A London series keeps its wall time across the October change.
    eq(expand_series(['days' => [6], 'time' => '10:00', 'tz' => 'Europe/London', 'from' => '2026-10-24', 'count' => 2]), ['2026-10-24T09:00:00.000Z', '2026-10-31T10:00:00.000Z']);
    $existing = [
        ['id' => 'a', 'startsAt' => '2026-11-23T10:30:00.000Z', 'minutes' => 60, 'title' => 'Pricing workshop'],
        ['id' => 'b', 'startsAt' => '2026-11-25T10:00:00.000Z', 'minutes' => 60, 'status' => 'cancelled'],
    ];
    $busy = [['start' => ms('2026-11-30T09:30:00Z'), 'end' => ms('2026-11-30T10:30:00Z')]];
    $clashes = find_clashes(['2026-11-23T10:00:00.000Z', '2026-11-25T10:00:00.000Z', '2026-11-30T10:00:00.000Z'], 60, $existing, $busy);
    eq($clashes, [['startsAt' => '2026-11-23T10:00:00.000Z', 'with' => 'Pricing workshop'], ['startsAt' => '2026-11-30T10:00:00.000Z', 'with' => 'busy in your calendar']]);
});

test('schedule core: free slots, notice, late changes, next free', function () {
    $av = array_merge(default_availability('UTC'), ['weekly' => [2 => [['start' => '10:00', 'end' => '12:00']]], 'rules' => ['bufferMin' => 15, 'noticeHours' => 12, 'maxPerDay' => 4, 'horizonDays' => 14]]);
    $now = ms('2026-11-20T09:00:00Z'); // Fri 20 Nov
    $taken = [['start' => ms('2026-11-24T10:30:00Z'), 'end' => ms('2026-11-24T11:00:00Z')]];
    $slots = free_slots($av, 30, $taken, $now);
    // 10:00 clashes with the 10:30 buffer; 10:30 is taken; 11:00 is inside the buffer; 11:30 is free.
    eq(array_values(array_filter($slots, fn ($s) => str_starts_with($s, '2026-11-24'))), ['2026-11-24T11:30:00.000Z']);
    ok(every($slots, fn ($s) => gmdate('w', intdiv(ms($s), 1000)) === '2'), 'only Tuesdays');
    ok(!some($slots, fn ($s) => str_starts_with($s, '2026-12-08')), '14-day horizon');
    eq(array_values(array_filter(free_slots($av, 30, [], ms('2026-11-24T00:00:00Z')), fn ($s) => str_starts_with($s, '2026-11-24'))), [], 'minimum notice');
    // Availability in a zone with DST: 10:00 London is 10:00Z in winter.
    $london = array_merge($av, ['tz' => 'Europe/London']);
    eq(array_slice(free_slots($london, 60, [], $now), 0, 2), ['2026-11-24T10:00:00.000Z', '2026-11-24T10:30:00.000Z']);
    // The per-day cap counts what's already booked that day.
    $full = array_merge($av, ['rules' => ['bufferMin' => 0, 'noticeHours' => 0, 'maxPerDay' => 1, 'horizonDays' => 14]]);
    ok(!some(free_slots($full, 30, $taken, $now), fn ($s) => str_starts_with($s, '2026-11-24')), 'day already has its maximum');
    ok(is_late_change('2026-11-24T10:00:00Z', ms('2026-11-24T00:00:00Z'), 24));
    ok(!is_late_change('2026-11-26T10:00:00Z', ms('2026-11-24T00:00:00Z'), 24));
    eq(next_free(['2026-11-24T10:00:00.000Z', '2026-11-24T10:30:00.000Z', '2026-12-01T10:00:00.000Z', '2026-12-01T10:30:00.000Z'], ms('2026-11-24T10:00:00Z'), 2), ['2026-11-24T10:30:00.000Z', '2026-12-01T10:00:00.000Z']);
});

test('ics: escaping, UTC stamps, stable UID + SEQUENCE + METHOD, 75-octet folding', function () {
    $cal = build_ics_calendar([
        'name' => 'TutorLoft, Schedule',
        'now' => ms('2026-01-01T00:00:00Z'),
        'events' => [['description' => "Line one\nLine two; bring x,y", 'endsAt' => ms('2026-01-05T10:30:00Z'), 'id' => 'session_1', 'startsAt' => ms('2026-01-05T09:00:00Z'), 'summary' => 'Algebra \\ Linear']],
    ]);
    contains($cal, 'BEGIN:VCALENDAR');
    contains($cal, 'METHOD:PUBLISH');
    contains($cal, 'X-WR-CALNAME:TutorLoft\\, Schedule');
    contains($cal, 'DTSTAMP:20260101T000000Z');
    contains($cal, 'DTSTART:20260105T090000Z');
    contains($cal, 'DTEND:20260105T103000Z');
    contains($cal, 'SUMMARY:Algebra \\\\ Linear');
    contains($cal, 'DESCRIPTION:Line one\\nLine two\\; bring x\\,y');
    contains($cal, "END:VCALENDAR\r\n");

    $ev = ['id' => 'se_1', 'startsAt' => ms('2026-11-24T10:00:00Z'), 'endsAt' => ms('2026-11-24T11:00:00Z'), 'summary' => 'Steering review', 'location' => 'https://tanziro.com/spaces/r/acme-pricing'];
    $v1 = build_ics_calendar(['name' => 'Loft', 'method' => 'REQUEST', 'events' => [$ev]]);
    $v2 = build_ics_calendar(['name' => 'Loft', 'method' => 'REQUEST', 'events' => [$ev + ['sequence' => 1]]]);
    $cancel = build_ics_calendar(['name' => 'Loft', 'method' => 'CANCEL', 'events' => [$ev + ['sequence' => 2]]]);
    contains($v1, 'UID:se_1@loft');
    contains($v1, 'SEQUENCE:0');
    contains($v2, 'UID:se_1@loft');
    contains($v2, 'SEQUENCE:1');
    contains($v1, 'METHOD:REQUEST');
    contains($v1, 'STATUS:CONFIRMED');
    contains($cancel, 'STATUS:CANCELLED');
    ok(every(explode("\r\n", $v1), fn ($l) => strlen($l) <= 75), 'every line ≤ 75 octets');

    $long = 'DESCRIPTION:' . str_repeat('x', 200);
    $folded = fold_ics_line($long);
    ok(every(explode("\r\n ", $folded), fn ($l) => strlen($l) <= 75), 'folded pieces ≤ 75');
    eq(str_replace("\r\n ", '', $folded), $long);
    eq(fold_ics_line('SUMMARY:short'), 'SUMMARY:short');
    // Multi-byte text folds on character boundaries, by octets.
    $wide = 'SUMMARY:' . str_repeat('é', 60);
    $pieces = explode("\r\n ", fold_ics_line($wide));
    ok(count($pieces) > 1 && every($pieces, fn ($l) => strlen($l) <= 75 && mb_check_encoding($l, 'UTF-8')), 'utf-8 safe folding');
    eq(implode('', $pieces), $wide);
    $org = build_ics_calendar(['name' => 'Loft', 'method' => 'REQUEST', 'organizer' => ['name' => 'Nusrat, R', 'email' => 'host@example.test'], 'events' => [$ev]]);
    contains($org, 'ORGANIZER;CN=Nusrat\\, R:mailto:host@example.test');
});

test('ics: busy times from a feed (single events, weekly RRULE, cancelled skipped)', function () {
    $feed = implode("\r\n", ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'DTSTART:20261124T090000Z', 'DTEND:20261124T100000Z', 'SUMMARY:Dentist', 'END:VEVENT', 'BEGIN:VEVENT', 'DTSTART:20261123T150000Z', 'DTEND:20261123T160000Z', 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4', 'END:VEVENT', 'BEGIN:VEVENT', 'DTSTART:20261125T120000Z', 'DTEND:20261125T130000Z', 'STATUS:CANCELLED', 'END:VEVENT', 'END:VCALENDAR']);
    $busy = parse_ics_busy($feed, ms('2026-11-20T00:00:00Z'), ms('2026-12-31T00:00:00Z'));
    eq(count($busy), 5);
    eq(iso($busy[0]['start']), '2026-11-23T15:00:00.000Z');
    $starts = array_map(fn ($b) => iso($b['start']), $busy);
    ok(in_array('2026-11-24T09:00:00.000Z', $starts, true), 'single event');
    ok(in_array('2026-11-25T15:00:00.000Z', $starts, true), 'RRULE Wednesday');
    ok(!in_array('2026-11-25T12:00:00.000Z', $starts, true), 'cancelled skipped');
    // Folded lines, TZID parameters and LF-only files.
    $lf = "BEGIN:VEVENT\nDTSTART;TZID=Europe/London:20261201T10\n 0000\nTRANSP:OPAQUE\nEND:VEVENT\nBEGIN:VEVENT\nDTSTART:20261202T100000Z\nTRANSP:TRANSPARENT\nEND:VEVENT";
    $b2 = parse_ics_busy($lf, ms('2026-11-20T00:00:00Z'), ms('2026-12-31T00:00:00Z'));
    eq(array_map(fn ($b) => [iso($b['start']), iso($b['end'])], $b2), [['2026-12-01T10:00:00.000Z', '2026-12-01T11:00:00.000Z']]);
});

test('schedule routes: a series with a clash warning, emailed invites, move + cancel bump SEQUENCE, ics + feed', function () {
    $db = fresh();
    $GLOBALS['loft_now'] = ms('2026-11-20T09:00:00Z');
    fixture($db);
    $series = ['days' => [2], 'time' => '09:00', 'tz' => 'UTC', 'from' => '2026-11-23', 'count' => 3];
    $dry = call($db, 'u_host', 'POST', 'sessions', ['spaceId' => 'sp_1', 'title' => 'Standup', 'minutes' => 30, 'series' => $series, 'dryRun' => true]);
    eq($dry['starts'], ['2026-11-24T09:00:00.000Z', '2026-12-01T09:00:00.000Z', '2026-12-08T09:00:00.000Z']);
    eq($dry['clashes'], []);
    eq($GLOBALS['loft_mail'], [], 'a dry run sends nothing');
    throws(fn () => call($db, 'u_a', 'POST', 'sessions', ['spaceId' => 'sp_1', 'title' => 'X', 'startsAt' => '2026-11-24T09:00:00.000Z']), '/Pick a space you host/', Forbidden::class);
    throws(fn () => call($db, 'u_host', 'POST', 'sessions', ['spaceId' => 'sp_1', 'title' => 'X', 'startsAt' => 'soon']), '/Pick a date and time/');

    $made = call($db, 'u_host', 'POST', 'sessions', ['spaceId' => 'sp_1', 'title' => 'Standup', 'minutes' => 30, 'series' => $series, 'skip' => [$dry['starts'][1]]]);
    eq($made['created'], 2);
    eq($made['sessions'][0]['seriesId'], $made['sessions'][1]['seriesId']);
    eq($made['sessions'][0]['sequence'], 0);
    eq($db->get('series', $made['sessions'][0]['seriesId'])['rule']['minutes'], 30);
    eq(count($db->list('notifications', fn ($n) => $n['kind'] === 'invite')), 2, 'one notification per member');
    // Invites: one email per member (not the host), one .ics per session.
    eq(sch_test_mail_to(), ['a@example.test', 'b@example.test']);
    eq($GLOBALS['loft_mail'][0]['subject'], 'Invite: Standup · 2 sessions');
    contains($GLOBALS['loft_mail'][0]['body'], 'Tue 24 Nov 2026, 09:00 UTC · 30 min');
    contains($GLOBALS['loft_mail'][0]['body'], 'Join: https://example.test/spaces/#/r/physics');

    $again = call($db, 'u_host', 'POST', 'sessions', ['spaceId' => 'sp_1', 'title' => 'Clash', 'minutes' => 30, 'startsAt' => $made['sessions'][0]['startsAt'], 'dryRun' => true]);
    eq($again['clashes'], [['startsAt' => '2026-11-24T09:00:00.000Z', 'with' => 'Standup']]);
    $forced = call($db, 'u_host', 'POST', 'sessions', ['spaceId' => 'sp_1', 'title' => 'Clash', 'minutes' => 30, 'startsAt' => $made['sessions'][0]['startsAt']]);
    eq([$forced['created'], count($forced['clashes'])], [1, 1], 'created anyway, with the warning');

    // Move "this and following" by an hour: SEQUENCE 1 and an updated invite.
    $GLOBALS['loft_mail'] = [];
    [$first, $last] = $made['sessions'];
    call($db, 'u_host', 'POST', "sessions/{$first['id']}/move", ['startsAt' => '2026-11-24T10:00:00.000Z', 'scope' => 'following']);
    $cal = call($db, 'u_host', 'GET', 'calendar', ['from' => '2000-01-01', 'to' => '2100-01-01']);
    $byId = index_by($cal['sessions'], fn ($s) => $s['id']);
    eq($byId[$first['id']]['startsAt'], '2026-11-24T10:00:00.000Z');
    eq($byId[$last['id']]['startsAt'], '2026-12-08T10:00:00.000Z');
    eq([$byId[$first['id']]['sequence'], $byId[$last['id']]['sequence']], [1, 1]);
    eq($byId[$first['id']]['isHost'], true);
    eq($byId[$first['id']]['spaceName'], 'Physics');
    eq(json_encode($cal['availability']['weekly'])[0], '{', 'weekly is an object');
    eq(sch_test_mail_to(), ['a@example.test', 'b@example.test']);
    eq($GLOBALS['loft_mail'][0]['subject'], 'Updated: Standup');
    $ics = call($db, 'u_a', 'GET', "sessions/{$first['id']}/ics");
    eq($ics['filename'], 'Standup.ics');
    contains($ics['text'], "UID:{$first['id']}@loft");
    contains($ics['text'], 'SEQUENCE:1');
    contains($ics['text'], 'METHOD:REQUEST');
    contains($ics['text'], 'DTSTART:20261124T100000Z');

    // Cancel just this one: SEQUENCE 2, METHOD:CANCEL, cancellation emailed.
    $GLOBALS['loft_mail'] = [];
    throws(fn () => call($db, 'u_a', 'POST', "sessions/{$first['id']}/cancel"), '/Only the host can change sessions/', Forbidden::class);
    call($db, 'u_host', 'POST', "sessions/{$first['id']}/cancel", ['scope' => 'this']);
    eq($db->get('sessions', $last['id'])['status'], 'scheduled');
    $ics = call($db, 'u_host', 'GET', "sessions/{$first['id']}/ics");
    contains($ics['text'], 'METHOD:CANCEL');
    contains($ics['text'], 'SEQUENCE:2');
    contains($ics['text'], 'STATUS:CANCELLED');
    eq($GLOBALS['loft_mail'][0]['subject'], 'Cancelled: Standup');
    $invite = sch_invite_ics(new Ctx($db, 'u_host'), $db->get('sessions', $first['id']), 'CANCEL', $db->get('spaces', 'sp_1'));
    contains($invite, 'METHOD:CANCEL');
    contains($invite, "UID:{$first['id']}@loft");
    contains($invite, 'SEQUENCE:2');
    contains($invite, 'ORGANIZER;CN=Nusrat Rahman:mailto:host@example.test');
    contains($invite, 'LOCATION:https://example.test/spaces/#/r/physics');

    // The private feed leaves out cancelled sessions; GET ics/<token>.ics serves it before availability is saved.
    $feed = call($db, 'u_a', 'GET', 'feed');
    eq($feed['filename'], 'loft.ics');
    contains($feed['text'], "UID:{$last['id']}@loft");
    ok(!str_contains($feed['text'], "UID:{$first['id']}@loft"), 'cancelled session not in the feed');
    $calA = call($db, 'u_a', 'GET', 'calendar');
    $raw = call($db, null, 'GET', 'ics/' . $calA['feedToken'] . '.ics');
    ok($raw instanceof Raw, 'feed served as text/calendar');
    contains($raw->body, "UID:{$last['id']}@loft");
    throws(fn () => call($db, null, 'GET', 'book/a'), '/No booking page here/', NotFound::class);
});

test('booking page: slots, a booking that needs approval, the guest invite, manage link', function () {
    $db = fresh();
    $GLOBALS['loft_now'] = ms('2026-11-20T09:00:00Z');
    fixture($db, 'client');
    put($db, 'availability', sch_test_availability());
    put($db, 'booking_types', ['id' => 'bt_discovery', 'userId' => 'u_host', 'name' => 'Discovery call', 'minutes' => 30, 'priceCents' => 0, 'destSpaceId' => null, 'approval' => 'manual', 'blurb' => 'A short call']);
    $page = call($db, null, 'GET', 'book/nusrat');
    eq($page['name'], 'Nusrat Rahman');
    eq($page['tz'], 'UTC');
    eq($page['types'][0]['approval'], 'manual');
    throws(fn () => call($db, null, 'GET', 'book/nusrat/slots', ['type' => 'bt_missing']), '/Pick a booking type/');
    $slots = call($db, null, 'GET', 'book/nusrat/slots', ['type' => 'bt_discovery']);
    eq(count($slots), 8, 'Tue 24 Nov + Tue 1 Dec, four half-hours each');
    eq($slots[0], '2026-11-24T10:00:00.000Z');

    $res = call($db, null, 'POST', 'book/nusrat', ['typeId' => 'bt_discovery', 'startsAt' => $slots[0], 'name' => 'Rina Saha', 'email' => 'rina@example.com', 'note' => 'Snack prices']);
    eq($res['status'], 'requested');
    eq($res['typeName'], 'Discovery call');
    eq($GLOBALS['loft_mail'], [], 'no invite until the host approves');
    throws(fn () => call($db, null, 'POST', 'book/nusrat', ['typeId' => 'bt_discovery', 'startsAt' => '2000-01-01T00:00:00.000Z', 'name' => 'X', 'email' => 'x@example.com']), '/taken/');
    throws(fn () => call($db, null, 'POST', 'book/nusrat', ['typeId' => 'bt_discovery', 'startsAt' => $slots[1], 'name' => 'X', 'email' => 'nope']), '/email/');
    eq(call($db, null, 'POST', 'book/nusrat', ['website' => 'spam', 'typeId' => 'bt_discovery'])['manageToken'], '');
    ok(!in_array($slots[0], call($db, null, 'GET', 'book/nusrat/slots', ['type' => 'bt_discovery']), true), 'the requested time is held');
    eq(count($db->list('notifications', fn ($n) => $n['userId'] === 'u_host' && $n['kind'] === 'booking')), 1);

    $reqs = call($db, 'u_host', 'GET', 'requests');
    eq(count($reqs), 1);
    eq([$reqs[0]['kind'], $reqs[0]['who'], $reqs[0]['free'], $reqs[0]['note']], ['booking', 'Rina Saha', true, 'Snack prices']);
    throws(fn () => call($db, 'u_a', 'POST', "requests/{$reqs[0]['id']}", ['decision' => 'approve']), '/Not your booking/', Forbidden::class);
    eq(call($db, 'u_host', 'POST', "requests/{$reqs[0]['id']}", ['decision' => 'approve']), ['ok' => true, 'suggest' => []]);
    $booking = $db->get('bookings', $reqs[0]['id']);
    eq($booking['status'], 'scheduled');
    eq($db->get('sessions', $booking['sessionId'])['status'], 'scheduled');
    eq(sch_test_mail_to(), ['rina@example.com'], 'only the guest, not the space');
    eq($GLOBALS['loft_mail'][0]['subject'], 'Invite: Discovery call · Rina Saha');

    $m = call($db, null, 'GET', "manage/{$res['manageToken']}");
    eq([$m['booking']['status'], $m['typeName'], $m['handle'], $m['minutes']], ['scheduled', 'Discovery call', 'nusrat', 30]);
    throws(fn () => call($db, null, 'POST', "manage/{$res['manageToken']}/move", ['startsAt' => '2026-11-24T10:30:00.000Z']), "/isn't free/");
    $GLOBALS['loft_mail'] = [];
    call($db, null, 'POST', "manage/{$res['manageToken']}/move", ['startsAt' => '2026-12-01T11:00:00.000Z']);
    $s = $db->get('sessions', $booking['sessionId']);
    eq([$s['startsAt'], $s['sequence']], ['2026-12-01T11:00:00.000Z', 1]);
    eq($GLOBALS['loft_mail'][0]['subject'], 'Updated: Discovery call · Rina Saha');
    call($db, null, 'POST', "manage/{$res['manageToken']}/cancel");
    eq(call($db, null, 'GET', "manage/{$res['manageToken']}")['booking']['status'], 'cancelled');
    eq($db->get('sessions', $booking['sessionId'])['sequence'], 2);
    eq(end($GLOBALS['loft_mail'])['subject'], 'Cancelled: Discovery call · Rina Saha');
    throws(fn () => call($db, null, 'GET', 'manage/nope'), "/isn't valid any more/", NotFound::class);
});

test("a member's move request: checked against the host's free times, approved, invite updated", function () {
    $db = fresh();
    $GLOBALS['loft_now'] = ms('2026-11-20T09:00:00Z');
    fixture($db, 'course', ['u_a' => 'member']);
    put($db, 'availability', sch_test_availability());
    put($db, 'sessions', ['id' => 'se_1', 'spaceId' => 'sp_1', 'seriesId' => null, 'title' => 'Algebra', 'startsAt' => '2026-11-24T10:00:00.000Z', 'minutes' => 30, 'room' => 'loft', 'externalUrl' => null, 'status' => 'scheduled', 'sequence' => 0]);
    throws(fn () => call($db, 'u_a', 'POST', 'sessions/se_1/requests', ['kind' => 'move', 'proposedStartsAt' => '2026-11-24T10:30:00.000Z']), "/host's free times/");
    $r = call($db, 'u_a', 'POST', 'sessions/se_1/requests', ['kind' => 'move', 'proposedStartsAt' => '2026-12-01T10:00:00.000Z', 'note' => 'Travelling']);
    eq([$r['status'], $r['kind'], $r['memberId']], ['pending', 'move', 'u_a']);
    $list = call($db, 'u_host', 'GET', 'requests');
    eq(count($list), 1);
    eq([$list[0]['who'], $list[0]['free'], $list[0]['clash'], $list[0]['late'], $list[0]['to']], ['A Member', true, null, false, '2026-12-01T10:00:00.000Z']);
    throws(fn () => call($db, 'u_a', 'POST', "requests/{$r['id']}", ['decision' => 'approve']), '/Only the host/', Forbidden::class);
    eq(call($db, 'u_host', 'POST', "requests/{$r['id']}", ['decision' => 'approve']), ['ok' => true, 'suggest' => []]);
    $s = $db->get('sessions', 'se_1');
    eq([$s['startsAt'], $s['sequence']], ['2026-12-01T10:00:00.000Z', 1]);
    eq(call($db, 'u_host', 'GET', 'requests'), []);
    eq(sch_test_mail_to(), ['a@example.test']);
    eq($GLOBALS['loft_mail'][0]['subject'], 'Updated: Algebra');
    ok(some($db->list('notifications'), fn ($n) => $n['userId'] === 'u_a' && $n['title'] === 'Approved: Algebra'), 'member told');
    throws(fn () => call($db, 'u_host', 'POST', "requests/{$r['id']}", ['decision' => 'approve']), '/Request not found/');
    // A declined request suggests the next free times; requests expire at the original start.
    $r2 = call($db, 'u_a', 'POST', 'sessions/se_1/requests', ['kind' => 'cancel']);
    $out = call($db, 'u_host', 'POST', "requests/{$r2['id']}", ['decision' => 'decline']);
    eq(count($out['suggest']), 3);
    $r3 = call($db, 'u_a', 'POST', 'sessions/se_1/requests', ['kind' => 'cancel']);
    $GLOBALS['loft_now'] = ms('2026-12-01T10:05:00Z');
    eq(call($db, 'u_host', 'GET', 'requests'), []);
    eq($db->get('change_requests', $r3['id'])['status'], 'expired');
});

test('availability: rules, unique handle, booking types, busy times from pasted ICS and a cached https feed', function () {
    $db = fresh();
    $GLOBALS['loft_now'] = ms('2026-11-20T09:00:00Z');
    fixture($db);
    put($db, 'availability', sch_test_availability(['id' => 'u_other', 'handle' => 'taken']));
    $av = call($db, 'u_host', 'POST', 'availability', ['handle' => 'Nusrat!', 'bio' => 'Hello', 'weekly' => [2 => [['start' => '10:00', 'end' => '12:00']]], 'rules' => ['bufferMin' => 0, 'noticeHours' => 0, 'maxPerDay' => 8, 'horizonDays' => 14], 'busyIcs' => "BEGIN:VEVENT\nDTSTART:20261124T100000Z\nDTEND:20261124T110000Z\nEND:VEVENT"]);
    eq([$av['handle'], $av['bio'], $av['tz']], ['nusrat', 'Hello', 'UTC']);
    eq(call($db, 'u_a', 'POST', 'availability', ['handle' => 'taken'])['handle'], 'taken-2', 'handles stay unique');
    $t = call($db, 'u_host', 'POST', 'booking-types', ['name' => 'Office hours', 'minutes' => '20', 'priceCents' => 1999.6, 'approval' => 'auto']);
    eq([$t['minutes'], $t['priceCents'], $t['approval'], $t['destSpaceId']], [20, 2000, 'auto', null]);
    throws(fn () => call($db, 'u_a', 'POST', 'booking-types', ['id' => $t['id'], 'name' => 'Mine now']), '/Booking type not found/');
    $got = call($db, 'u_host', 'GET', 'availability');
    eq($got['rules'], ['bufferMin' => 0, 'noticeHours' => 0, 'maxPerDay' => 8, 'horizonDays' => 14]);
    eq($got['busyCount'], 1);
    ok(some($got['types'], fn ($x) => $x['id'] === $t['id']), 'type listed');
    eq($got['spaces'], [['id' => 'sp_1', 'name' => 'Physics']]);
    $slots = call($db, null, 'GET', 'book/nusrat/slots', ['type' => $t['id']]);
    eq(array_values(array_filter($slots, fn ($s) => str_starts_with($s, '2026-11-24'))), ['2026-11-24T11:00:00.000Z', '2026-11-24T11:30:00.000Z'], 'pasted busy time blocks 10–11');

    // An https feed URL: fetched when slots are computed, cached 15 minutes, a failure never breaks the page.
    $calls = 0;
    $GLOBALS['loft_fetch_ics'] = function (string $url) use (&$calls) {
        $calls++;
        return "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART:20261201T100000Z\r\nDTEND:20261201T120000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
    };
    try {
        $saved = call($db, 'u_host', 'POST', 'availability', ['busyUrl' => 'https://calendar.example.test/private.ics']);
        eq([$saved['busyUrl'], $saved['busyIcsUrl'], $calls], ['https://calendar.example.test/private.ics', 'https://calendar.example.test/private.ics', 0]);
        $slots = call($db, null, 'GET', 'book/nusrat/slots', ['type' => $t['id']]);
        eq($calls, 1);
        ok(!some($slots, fn ($s) => str_starts_with($s, '2026-12-01')), 'feed busy time removes the slots');
        ok(some($slots, fn ($s) => str_starts_with($s, '2026-11-24')), 'other days stay open');
        eq($db->get('availability', 'u_host')['busyFetchedAt'], '2026-11-20T09:00:00.000Z');
        ok(!array_key_exists('busyFetchedIcs', call($db, 'u_host', 'GET', 'availability')), 'the cached copy stays on the server');
        call($db, null, 'GET', 'book/nusrat/slots', ['type' => $t['id']]);
        eq($calls, 1, 'cached for 15 minutes');
        $GLOBALS['loft_now'] += 16 * 60000;
        $GLOBALS['loft_fetch_ics'] = function (string $url) use (&$calls) {
            $calls++;
            throw new \RuntimeException('network down');
        };
        $slots = call($db, null, 'GET', 'book/nusrat/slots', ['type' => $t['id']]);
        eq($calls, 2);
        ok(!some($slots, fn ($s) => str_starts_with($s, '2026-12-01')), 'a failed fetch keeps the last good copy');
        $re = call($db, 'u_host', 'POST', 'availability', ['busyIcsUrl' => 'https://calendar.example.test/other.ics']);
        eq([$re['busyUrl'], $re['busyFetchedAt']], ['https://calendar.example.test/other.ics', null], 'a new URL drops the cache');
    } finally {
        unset($GLOBALS['loft_fetch_ics']);
    }
    eq(sch_fetch_ics('http://calendar.example.test/plain.ics'), null, 'https only');

    call($db, 'u_host', 'POST', "booking-types/{$t['id']}/delete");
    ok(!some(call($db, 'u_host', 'GET', 'availability')['types'], fn ($x) => $x['id'] === $t['id']), 'type deleted');
    throws(fn () => call($db, 'u_host', 'POST', "booking-types/{$t['id']}/delete"), '/Booking type not found/', NotFound::class);
});
