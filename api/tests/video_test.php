<?php
declare(strict_types=1);

namespace Loft;

// Video with the org's own keys. Provider APIs are scripted: each request is matched by "METHOD path-regex"
// and logged, so the tests check exactly what Loft sends to Cloudflare, Daily and 8x8 and what it hands back.

/** @param array<string, array{0: int, 1: ?array}> $script */
function fake_providers(array $script): void
{
    $GLOBALS['loft_http_log'] = [];
    $GLOBALS['loft_http'] = function (string $method, string $url, array $headers, ?array $body) use ($script): array {
        $GLOBALS['loft_http_log'][] = ['method' => $method, 'url' => $url, 'headers' => $headers, 'body' => $body];
        foreach ($script as $pattern => [$status, $json]) {
            [$m, $re] = explode(' ', $pattern, 2);
            if ($m === $method && preg_match("#$re#", $url)) return ['status' => $status, 'json' => is_callable($json) ? $json($body) : $json];
        }
        return ['status' => 404, 'json' => ['error' => 'not-found']];
    };
}

function http_calls(string $needle): array
{
    return array_values(array_filter($GLOBALS['loft_http_log'], fn ($c) => str_contains($c['url'], $needle)));
}

function video_fixture(Db $db): void
{
    fixture($db);
    Config::load(TEST_CONFIG + ['key' => base64_encode(str_repeat('k', 32))]);
    $GLOBALS['loft_now'] = ms('2026-11-21T10:00:00Z');
    put($db, 'rooms', ['id' => 'rm1', 'spaceId' => 'sp_1', 'code' => 'ABC-DEF', 'createdBy' => 'u_host', 'endedAt' => null]);
    put($db, 'rooms', ['id' => 'rm2', 'spaceId' => 'sp_1', 'code' => 'XYZ-QRS', 'createdBy' => 'u_host', 'endedAt' => null]);
    // u_a and u_host are in rm1; u_b is signed in but not in the room.
    call($db, 'u_a', 'POST', 'rooms/rm1/presence', ['tabId' => 'tab_a', 'state' => ['status' => 'in']]);
    call($db, 'u_host', 'POST', 'rooms/rm1/presence', ['tabId' => 'tab_h', 'state' => ['status' => 'in']]);
}

test('video: nothing set up → no video, STUN only; joining explains', function () {
    $db = fresh();
    video_fixture($db);
    eq(call($db, 'u_a', 'GET', 'rooms/rm1/call-config'), ['iceServers' => [['urls' => 'stun:stun.l.google.com:19302']], 'ownLink' => null, 'video' => null]);
    throws(fn () => call($db, 'u_a', 'POST', 'rooms/rm1/video/join'), "/Video isn't set up/");
    eq($GLOBALS['loft_http_log'], [], 'no provider was called');
});

test('video · Cloudflare: TURN credentials cached, SFU sessions per person, negotiation relayed with the app token', function () {
    $db = fresh();
    video_fixture($db);
    $turn = ['urls' => ['turn:turn.cloudflare.com:3478?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'], 'username' => 'u-1', 'credential' => 'c-1'];
    $n = 0;
    fake_providers([
        'POST /v1/turn/keys/turnkey-1234/credentials/generate$' => [201, ['iceServers' => $turn]],
        'POST /v1/apps/app-abcd/sessions/new$' => [201, function () use (&$n) { return ['sessionId' => 'sess-' . (++$n)]; }],
        'POST /v1/apps/app-abcd/sessions/sess-1/tracks/new$' => [200, fn ($b) => ['sessionDescription' => ['type' => 'answer', 'sdp' => 'v=0 answer'], 'tracks' => array_map(fn ($t) => ['mid' => $t['mid'] ?? '0', 'trackName' => $t['trackName']], $b['tracks'])]],
        'POST /v1/apps/app-abcd/sessions/sess-2/tracks/new$' => [200, ['requiresImmediateRenegotiation' => true, 'sessionDescription' => ['type' => 'offer', 'sdp' => 'v=0 offer'], 'tracks' => [['mid' => '3', 'trackName' => 'cam-a', 'sessionId' => 'sess-1']]]],
        'PUT /v1/apps/app-abcd/sessions/sess-2/renegotiate$' => [200, []],
        'PUT /v1/apps/app-abcd/sessions/sess-2/tracks/close$' => [200, ['tracks' => [['mid' => '3']]]],
    ]);
    $saved = call($db, 'u_host', 'POST', 'admin/calls', ['budgetCents' => 3000, 'providers' => ['cloudflare' => ['on' => true, 'key' => 'turnkey-1234', 'token' => 'turntoken-5678', 'appId' => 'app-abcd', 'appToken' => 'apptoken-efgh']]]);
    eq([$saved['cloudflare']['appIdLast4'], $saved['cloudflare']['appTokenLast4']], ['abcd', 'efgh']);
    ok(!array_filter(array_keys($saved['cloudflare']), fn ($k) => str_ends_with($k, 'Sealed')), 'no sealed field leaves the server');

    $cfg = call($db, 'u_a', 'GET', 'rooms/rm1/call-config');
    eq($cfg['iceServers'], [['urls' => 'stun:stun.l.google.com:19302'], $turn], 'TURN is added to every call');
    eq($cfg['video'], ['provider' => 'cloudflare', 'step' => 'full', 'allowed' => true]);
    eq(http_calls('/turn/')[0]['headers'], ['Authorization' => 'Bearer turntoken-5678']);
    eq(http_calls('/turn/')[0]['body'], ['ttl' => 86400]);
    call($db, 'u_host', 'GET', 'rooms/rm1/call-config');
    eq(count(http_calls('/turn/')), 1, 'credentials are cached for their lifetime');

    throws(fn () => call($db, 'u_b', 'POST', 'rooms/rm1/video/join'), '/Join the room first/', Forbidden::class);
    $a = call($db, 'u_a', 'POST', 'rooms/rm1/video/join');
    eq($a, ['provider' => 'cloudflare', 'sessionId' => 'sess-1', 'iceServers' => [['urls' => 'stun:stun.cloudflare.com:3478'], $turn]]);
    eq(http_calls('/sessions/new')[0]['headers'], ['Authorization' => 'Bearer apptoken-efgh'], 'the app token stays on the server');

    // u_a publishes a microphone and a camera.
    $pub = call($db, 'u_a', 'POST', 'rooms/rm1/video/cf', ['sessionId' => 'sess-1', 'op' => 'tracks/new', 'body' => ['sessionDescription' => ['type' => 'offer', 'sdp' => 'v=0 offer'], 'tracks' => [['location' => 'local', 'mid' => '0', 'trackName' => 'mic-a'], ['location' => 'local', 'mid' => '1', 'trackName' => 'cam-a']]]]);
    eq($pub['sessionDescription'], ['type' => 'answer', 'sdp' => 'v=0 answer']);
    $c = http_calls('/sessions/sess-1/tracks/new')[0];
    eq([$c['method'], $c['body']['tracks'][1]], ['POST', ['location' => 'local', 'mid' => '1', 'trackName' => 'cam-a']]);

    // The host joins and pulls u_a's camera; Cloudflare asks to renegotiate; the answer goes back with PUT.
    call($db, 'u_host', 'POST', 'rooms/rm1/video/join');
    $pull = call($db, 'u_host', 'POST', 'rooms/rm1/video/cf', ['sessionId' => 'sess-2', 'op' => 'tracks/new', 'body' => ['tracks' => [['location' => 'remote', 'sessionId' => 'sess-1', 'trackName' => 'cam-a']]]]);
    ok($pull['requiresImmediateRenegotiation']);
    call($db, 'u_host', 'POST', 'rooms/rm1/video/cf', ['sessionId' => 'sess-2', 'op' => 'renegotiate', 'body' => ['sessionDescription' => ['type' => 'answer', 'sdp' => 'v=0 a']]]);
    eq(http_calls('/sess-2/renegotiate')[0]['method'], 'PUT');
    call($db, 'u_host', 'POST', 'rooms/rm1/video/cf', ['sessionId' => 'sess-2', 'op' => 'tracks/close', 'body' => ['tracks' => [['mid' => '3']], 'force' => true]]);
    eq(http_calls('/sess-2/tracks/close')[0]['method'], 'PUT');

    // Nobody drives someone else's session, pulls from another room, or calls other endpoints.
    throws(fn () => call($db, 'u_host', 'POST', 'rooms/rm1/video/cf', ['sessionId' => 'sess-1', 'op' => 'tracks/new', 'body' => []]), '/not yours/', Forbidden::class);
    throws(fn () => call($db, 'u_a', 'POST', 'rooms/rm2/video/cf', ['sessionId' => 'sess-1', 'op' => 'tracks/new', 'body' => []]), '/not yours/', Forbidden::class);
    throws(fn () => call($db, 'u_host', 'POST', 'rooms/rm1/video/cf', ['sessionId' => 'sess-2', 'op' => 'tracks/new', 'body' => ['tracks' => [['location' => 'remote', 'sessionId' => 'sess-elsewhere', 'trackName' => 'x']]]]), '/not in this room/', Forbidden::class);
    throws(fn () => call($db, 'u_host', 'POST', 'rooms/rm1/video/cf', ['sessionId' => 'sess-2', 'op' => '../../apps', 'body' => []]), '/Unknown video operation/');

    // Leaving forgets the session.
    call($db, 'u_a', 'POST', 'rooms/rm1/video/leave', ['sessionId' => 'sess-1']);
    eq($db->get('video_sessions', 'sess-1'), null);
});

test('video · budget: new video joins only while today is under 80% of the pool', function () {
    $db = fresh();
    video_fixture($db);
    fake_providers(['POST /sessions/new$' => [201, ['sessionId' => 'sess-1']]]);
    call($db, 'u_host', 'POST', 'admin/calls', ['budgetCents' => 1200, 'ownLink' => 'https://meet.example/abc', 'providers' => ['cloudflare' => ['on' => true, 'appId' => 'app-abcd', 'appToken' => 'apptoken-efgh']]]);
    // pool = 1200 ¢ / 0.4 ¢ a minute / 30 days = 100 video-minutes a day
    for ($i = 0; $i < 15; $i++) call($db, 'u_a', 'POST', 'rooms/rm1/usage', ['minutes' => 5, 'video' => true]);
    eq(call($db, 'u_a', 'GET', 'rooms/rm1/call-config')['video'], ['provider' => 'cloudflare', 'step' => 'full', 'allowed' => true], '75 of 100');
    call($db, 'u_a', 'POST', 'rooms/rm1/video/join');
    call($db, 'u_a', 'POST', 'rooms/rm1/usage', ['minutes' => 5, 'video' => true]);
    eq(call($db, 'u_a', 'GET', 'rooms/rm1/call-config')['video'], ['provider' => 'cloudflare', 'step' => 'warn', 'allowed' => false], '80 of 100');
    throws(fn () => call($db, 'u_host', 'POST', 'rooms/rm1/video/join'), '/nearly used up.*Audio still works/');
    for ($i = 0; $i < 4; $i++) call($db, 'u_a', 'POST', 'rooms/rm1/usage', ['minutes' => 5, 'video' => true]);
    throws(fn () => call($db, 'u_host', 'POST', 'rooms/rm1/video/join'), "/used up\. Audio still works, or use the host's own link/");
    eq(call($db, 'u_host', 'GET', 'admin/calls')['step'], 'audio-only');
    // A session that's already live keeps going (never cut): its negotiation is still relayed.
    fake_providers(['POST /sessions/sess-1/tracks/new$' => [200, ['tracks' => []]]]);
    eq(call($db, 'u_a', 'POST', 'rooms/rm1/video/cf', ['sessionId' => 'sess-1', 'op' => 'tracks/new', 'body' => ['tracks' => []]]), ['tracks' => []]);
    // No budget at all means no paid video.
    call($db, 'u_host', 'POST', 'admin/calls', ['budgetCents' => 0]);
    eq(call($db, 'u_a', 'GET', 'rooms/rm2/call-config')['video']['allowed'], false);
});

test('video · Daily: one private room per Loft room, a meeting token per person (owner for hosts)', function () {
    $db = fresh();
    video_fixture($db);
    $now = intdiv(ms('2026-11-21T10:00:00Z'), 1000);
    fake_providers([
        'GET /v1/rooms/loft-abc-def$' => [404, ['error' => 'not-found']],
        'POST /v1/rooms$' => [200, fn ($b) => ['name' => $b['name'], 'url' => 'https://acme.daily.co/' . $b['name'], 'config' => $b['properties']]],
        'POST /v1/meeting-tokens$' => [200, fn ($b) => ['token' => 'tok-' . $b['properties']['user_id']]],
    ]);
    call($db, 'u_host', 'POST', 'admin/calls', ['budgetCents' => 3000, 'providers' => ['daily' => ['on' => true, 'key' => 'daily-key-9999']]]);
    eq(call($db, 'u_a', 'GET', 'rooms/rm1/call-config')['video'], ['provider' => 'daily', 'step' => 'full', 'allowed' => true]);
    eq(call($db, 'u_a', 'POST', 'rooms/rm1/video/join'), ['provider' => 'daily', 'url' => 'https://acme.daily.co/loft-abc-def?t=tok-u_a']);
    $create = http_calls('/v1/rooms')[1];
    eq([$create['headers'], $create['body']['name'], $create['body']['privacy'], $create['body']['properties']['max_participants'], $create['body']['properties']['exp']], [['Authorization' => 'Bearer daily-key-9999'], 'loft-abc-def', 'private', 12, $now + 86400]);
    $tok = http_calls('/meeting-tokens')[0]['body']['properties'];
    eq([$tok['room_name'], $tok['user_name'], $tok['is_owner'], $tok['exp']], ['loft-abc-def', 'A Member', false, $now + 4 * 3600]);
    // The host is the owner; an existing room that's about to expire is extended rather than recreated.
    fake_providers([
        'GET /v1/rooms/loft-abc-def$' => [200, ['name' => 'loft-abc-def', 'url' => 'https://acme.daily.co/loft-abc-def', 'config' => ['exp' => $now + 60]]],
        'POST /v1/rooms/loft-abc-def$' => [200, ['name' => 'loft-abc-def', 'url' => 'https://acme.daily.co/loft-abc-def', 'config' => ['exp' => $now + 86400]]],
        'POST /v1/meeting-tokens$' => [200, ['token' => 'tok-host']],
    ]);
    eq(call($db, 'u_host', 'POST', 'rooms/rm1/video/join')['url'], 'https://acme.daily.co/loft-abc-def?t=tok-host');
    eq(count(http_calls('/v1/rooms/loft-abc-def')), 2, 'looked up, then extended');
    ok(http_calls('/meeting-tokens')[0]['body']['properties']['is_owner']);
    // Daily says no → a clear message, audio carries on.
    fake_providers(['GET /v1/rooms/loft-abc-def$' => [401, ['error' => 'authentication-error', 'info' => 'bad API key']]]);
    throws(fn () => call($db, 'u_a', 'POST', 'rooms/rm1/video/join'), "/Couldn't start video with Daily \(401: bad API key\)\. Audio still works/");
});

test('video · Jitsi as a Service: an RS256 room token signed with the org key; bad keys are refused on save', function () {
    $db = fresh();
    video_fixture($db);
    $key = openssl_pkey_new(['private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_RSA]);
    openssl_pkey_export($key, $pem);
    $pub = openssl_pkey_get_details($key)['key'];
    throws(fn () => call($db, 'u_host', 'POST', 'admin/calls', ['providers' => ['jitsi' => ['on' => true, 'privateKey' => 'not a key at all']]]), '/could not be read/');
    $saved = call($db, 'u_host', 'POST', 'admin/calls', ['budgetCents' => 3000, 'providers' => ['jitsi' => ['on' => true, 'appId' => 'vpaas-magic-cookie-1234', 'key' => 'abcd12', 'privateKey' => $pem]]]);
    eq($saved['jitsi']['privateKeyLast4'], 'PEM');
    $j = call($db, 'u_a', 'POST', 'rooms/rm1/video/join');
    eq($j['provider'], 'jitsi');
    ok(str_starts_with($j['url'], 'https://8x8.vc/vpaas-magic-cookie-1234/loft-abc-def?jwt='));
    [$h, $p, $sig] = explode('.', substr($j['url'], strpos($j['url'], '?jwt=') + 5));
    $dec = fn (string $x) => base64_decode(strtr($x, '-_', '+/') . str_repeat('=', (4 - strlen($x) % 4) % 4));
    eq(openssl_verify("$h.$p", $dec($sig), $pub, OPENSSL_ALGO_SHA256), 1, 'signed with the org key');
    $header = json_decode($dec($h), true);
    $claims = json_decode($dec($p), true);
    eq($header, ['alg' => 'RS256', 'typ' => 'JWT', 'kid' => 'vpaas-magic-cookie-1234/abcd12']);
    eq([$claims['aud'], $claims['iss'], $claims['sub'], $claims['room'], $claims['exp'] - $claims['iat']], ['jitsi', 'chat', 'vpaas-magic-cookie-1234', 'loft-abc-def', 4 * 3600]);
    eq([$claims['context']['user']['name'], $claims['context']['user']['moderator'], $claims['context']['user']['email']], ['A Member', 'false', ''], 'no email shared');
    eq($claims['context']['features']['recording'], 'false');
    $hostClaims = json_decode($dec(explode('.', explode('?jwt=', call($db, 'u_host', 'POST', 'rooms/rm1/video/join')['url'])[1])[1]), true);
    eq($hostClaims['context']['user']['moderator'], 'true');
    eq($GLOBALS['loft_http_log'], [], 'tokens are signed locally; no request to 8x8');
});
