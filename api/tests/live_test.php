<?php
declare(strict_types=1);

namespace Loft;

test('presence: heartbeat returns the other tabs, expires after 30 s, leave removes you', function () {
    $db = fresh();
    fixture($db);
    put($db, 'rooms', ['id' => 'rm1', 'spaceId' => 'sp_1', 'code' => 'ABC-DEF', 'createdBy' => 'u_host', 'endedAt' => null]);
    $GLOBALS['loft_now'] = 1_000_000;
    eq(call($db, 'u_host', 'POST', 'rooms/rm1/presence', ['tabId' => 't1', 'state' => ['cursor' => ['x' => 1, 'y' => 2], 'status' => 'in', 'userId' => 'spoofed']]), []);
    $peers = call($db, 'u_a', 'POST', 'rooms/rm1/presence', ['tabId' => 't2', 'state' => ['status' => 'in']]);
    eq(count($peers), 1);
    eq([$peers[0]['userId'], $peers[0]['name'], $peers[0]['tabId']], ['u_host', 'Nusrat Rahman', 't1'], 'identity comes from the session');
    $GLOBALS['loft_now'] = 1_000_000 + 31_000;
    eq(call($db, 'u_a', 'POST', 'rooms/rm1/presence', ['tabId' => 't2', 'state' => []]), [], 'host expired');
    call($db, 'u_a', 'POST', 'rooms/rm1/presence/leave', ['tabId' => 't2']);
    eq(call($db, 'u_host', 'GET', 'rooms/rm1/presence'), []);
});

test('signalling: addressed messages reach only their tab; old ones are not replayed', function () {
    $db = fresh();
    fixture($db);
    put($db, 'rooms', ['id' => 'rm1', 'spaceId' => 'sp_1', 'code' => 'ABC-DEF', 'createdBy' => 'u_host', 'endedAt' => null]);
    call($db, 'u_host', 'POST', 'signal', ['roomId' => 'rm1', 'msg' => ['from' => 't1', 'type' => 'old', 'data' => 1]]);
    $start = call($db, 'u_a', 'GET', 'signal', ['roomId' => 'rm1', 'since' => 0, 'tabId' => 't2']);
    eq($start['msgs'], []);
    call($db, 'u_host', 'POST', 'signal', ['roomId' => 'rm1', 'msg' => ['from' => 't1', 'to' => 't2', 'type' => 'offer', 'data' => ['sdp' => 'x']]]);
    call($db, 'u_host', 'POST', 'signal', ['roomId' => 'rm1', 'msg' => ['from' => 't1', 'to' => 't3', 'type' => 'offer', 'data' => ['sdp' => 'y']]]);
    call($db, 'u_host', 'POST', 'signal', ['roomId' => 'rm1', 'msg' => ['from' => 't1', 'type' => 'hello']]);
    $got = call($db, 'u_a', 'GET', 'signal', ['roomId' => 'rm1', 'since' => $start['seq'], 'tabId' => 't2']);
    eq(array_column($got['msgs'], 'type'), ['offer', 'hello']);
    eq($got['msgs'][0]['data'], ['sdp' => 'x']);
    throws(fn () => call($db, 'u_a', 'POST', 'signal', ['roomId' => 'rm1', 'msg' => []]), '/needs a type/');
});

test('calls & budget: keys are sealed and only the last 4 come back; usage feeds the daily pool', function () {
    $db = fresh();
    fixture($db);
    Config::load(TEST_CONFIG + ['key' => base64_encode(str_repeat('k', 32))]);
    $GLOBALS['loft_now'] = ms('2026-11-21T10:00:00Z');
    $s = call($db, 'u_host', 'POST', 'admin/calls', ['ownLink' => 'https://meet.example/abc', 'budgetCents' => 3000, 'providers' => ['cloudflare' => ['on' => true, 'key' => 'id-0000-7c2f', 'token' => 'secret-token-a8d1']]]);
    eq([$s['cloudflare']['keyLast4'], $s['cloudflare']['tokenLast4']], ['7c2f', 'a8d1']);
    ok(!isset($s['cloudflare']['tokenSealed']), 'sealed token never leaves the server');
    $row = $db->get('call_settings', 'u_host');
    eq(unseal($row['cloudflare']['tokenSealed']), 'secret-token-a8d1');
    throws(fn () => call($db, 'u_host', 'POST', 'admin/calls', ['ownLink' => 'http://insecure']), '/https/');
    put($db, 'rooms', ['id' => 'rm1', 'spaceId' => 'sp_1', 'code' => 'ABC-DEF', 'createdBy' => 'u_host', 'endedAt' => null]);
    call($db, 'u_a', 'POST', 'rooms/rm1/usage', ['minutes' => 1, 'video' => true]);
    call($db, 'u_b', 'POST', 'rooms/rm1/usage', ['minutes' => 1]);
    $a = call($db, 'u_host', 'GET', 'admin/calls');
    eq($a['pool'], 250, '(0 free + 3000 / 0.4) / 30 days');
    eq($a['today'], ['minutes' => 2.0, 'videoMinutes' => 1.0]);
    eq($a['step'], 'full');
    eq(call($db, 'u_a', 'GET', 'rooms/rm1/call-config'), ['iceServers' => [['urls' => 'stun:stun.l.google.com:19302']], 'ownLink' => 'https://meet.example/abc']);
});
