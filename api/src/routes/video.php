<?php
declare(strict_types=1);

namespace Loft;

// Video with the org's own provider keys: the last rung of the call ladder (handoff §7: own link → P2P
// audio → stage → optional SFU/video with the org's own Cloudflare/Daily keys). The server keeps every
// key; browsers only ever get short-lived sessions, tokens or links.
//
// - Cloudflare Realtime (SFU): the server opens one SFU session per person and relays their track
//   negotiation (tracks/new, renegotiate, tracks/close), so the app token never reaches a browser.
//   People publish their session id + track names in room presence and pull each other's tracks.
// - Cloudflare TURN: short-lived credentials are added to every call's ICE servers (P2P too).
// - Daily: one private Daily room per Loft room and a meeting token per person (Daily Prebuilt).
// - Jitsi as a Service (8x8): a room token (RS256 JWT) signed with the org's private key.
//
// New video joins follow the daily budget (call_budget): only at "full". A live call is never cut.

const CF_API = 'https://rtc.live.cloudflare.com/v1';
const CF_STUN = 'stun:stun.cloudflare.com:3478';
const DAILY_API = 'https://api.daily.co/v1';
const JAAS_HOST = 'https://8x8.vc';
const VIDEO_TOKEN_TTL = 4 * 3600;

/**
 * JSON over HTTPS to a provider (fixed hosts above, never a user-supplied URL).
 * Tests replace the network with $GLOBALS['loft_http'] = fn ($method, $url, $headers, $body) => ['status' => …, 'json' => …].
 * @return array{status: int, json: ?array}
 */
function provider_http(string $method, string $url, array $headers, ?array $body = null): array
{
    $hook = $GLOBALS['loft_http'] ?? null;
    if (is_callable($hook)) return $hook($method, $url, $headers, $body);
    if (!function_exists('curl_init')) return ['status' => 0, 'json' => null];
    $h = ['Accept: application/json'];
    foreach ($headers as $k => $v) $h[] = "$k: $v";
    if ($body !== null) $h[] = 'Content-Type: application/json';
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_CUSTOMREQUEST => $method, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 10, CURLOPT_CONNECTTIMEOUT => 5, CURLOPT_HTTPHEADER => $h, CURLOPT_FOLLOWLOCATION => false]);
    if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, (string) json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
    $raw = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    if ($raw === false) error_log('[loft] provider request failed: ' . curl_error($ch) . " ($method " . preg_replace('#/(keys|apps|sessions)/[^/]+#', '/$1/…', $url) . ')');
    $json = is_string($raw) ? json_decode($raw, true) : null;
    return ['status' => $status, 'json' => is_array($json) ? $json : null];
}

/** Which video provider a host's org has switched on with complete keys (first match wins). */
function video_provider(array $s): ?string
{
    if (!empty($s['cloudflare']['on']) && provider_secret($s, 'cloudflare', 'appId') && provider_secret($s, 'cloudflare', 'appToken')) return 'cloudflare';
    if (!empty($s['daily']['on']) && provider_secret($s, 'daily', 'key')) return 'daily';
    if (!empty($s['jitsi']['on']) && provider_secret($s, 'jitsi', 'appId') && provider_secret($s, 'jitsi', 'key') && provider_secret($s, 'jitsi', 'privateKey')) return 'jitsi';
    return null;
}

/**
 * Cloudflare TURN credentials for a host's calls, cached for their 24 h lifetime (refreshed with an hour to
 * spare). A failed fetch is retried after 15 minutes; calls carry on with STUN meanwhile.
 */
function cf_turn_servers(Ctx $ctx, string $hostId, array $s): ?array
{
    if (empty($s['cloudflare']['on'])) return null;
    $keyId = provider_secret($s, 'cloudflare', 'key');
    $token = provider_secret($s, 'cloudflare', 'token');
    if (!$keyId || !$token) return null;
    $now = $ctx->now();
    $cache = $ctx->db->get('turn_cache', $hostId);
    $cached = $cache && ($cache['expiresAt'] ?? 0) > $now && is_array($cache['iceServers'] ?? null) ? $cache['iceServers'] : null;
    if ($cached && $cache['expiresAt'] > $now + 3600_000) return $cached;
    if ($cache && ($cache['failedAt'] ?? 0) > $now - 15 * 60_000) return $cached;
    $r = provider_http('POST', CF_API . '/turn/keys/' . rawurlencode($keyId) . '/credentials/generate', ['Authorization' => "Bearer $token"], ['ttl' => 86400]);
    $ice = $r['json']['iceServers'] ?? null;
    if ($r['status'] >= 200 && $r['status'] < 300 && is_array($ice) && !empty($ice['urls']) && isset($ice['username'], $ice['credential'])) {
        $ice = ['urls' => array_values((array) $ice['urls']), 'username' => (string) $ice['username'], 'credential' => (string) $ice['credential']];
        $ctx->db->put('turn_cache', ['id' => $hostId, 'iceServers' => $ice, 'expiresAt' => $now + 86400_000, 'failedAt' => 0]);
        return $ice;
    }
    $ctx->db->put('turn_cache', ['id' => $hostId, 'iceServers' => $cached, 'expiresAt' => $cached ? $cache['expiresAt'] : 0, 'failedAt' => $now]);
    return $cached;
}

function b64url(string $raw): string
{
    return rtrim(strtr(base64_encode($raw), '+/', '-_'), '=');
}

/** A Jitsi as a Service room token: RS256 JWT with the org's app ID, key ID and private key. */
function jaas_jwt(string $appId, string $keyId, string $pem, string $roomName, array $user, bool $moderator, int $now): string
{
    $kid = str_contains($keyId, '/') ? $keyId : "$appId/$keyId";
    $header = ['alg' => 'RS256', 'typ' => 'JWT', 'kid' => $kid];
    $payload = [
        'aud' => 'jitsi', 'iss' => 'chat', 'sub' => $appId, 'room' => $roomName,
        'iat' => $now, 'nbf' => $now - 10, 'exp' => $now + VIDEO_TOKEN_TTL,
        'context' => [
            'user' => ['id' => (string) $user['id'], 'name' => (string) $user['name'], 'avatar' => '', 'email' => '', 'moderator' => $moderator ? 'true' : 'false'],
            'features' => ['livestreaming' => 'false', 'recording' => 'false', 'transcription' => 'false', 'outbound-call' => 'false', 'sip-outbound-call' => 'false'],
        ],
    ];
    $input = b64url((string) json_encode($header, JSON_UNESCAPED_SLASHES)) . '.' . b64url((string) json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
    $key = openssl_pkey_get_private($pem);
    if (!$key || !openssl_sign($input, $sig, $key, OPENSSL_ALGO_SHA256)) throw new BadRequest("Couldn't sign the Jitsi room token: check the private key in Admin → Calls & budget.");
    return $input . '.' . b64url($sig);
}

/** You're in a room's video only if you're in the room (fresh presence), so tokens can't be minted from outside. */
function in_room(Ctx $ctx, string $roomId, string $userId): bool
{
    live_tables($ctx->db);
    $st = $ctx->db->pdo->prepare('SELECT 1 FROM presence WHERE room_id = ? AND user_id = ? AND last_seen > ? LIMIT 1');
    $st->execute([$roomId, $userId, $ctx->now() - PRESENCE_TTL_MS]);
    return (bool) $st->fetchColumn();
}

function video_fail(string $provider, array $r): never
{
    $why = $r['json']['errorDescription'] ?? $r['json']['info'] ?? $r['json']['error'] ?? null;
    throw new BadRequest("Couldn't start video with $provider (" . ($r['status'] ?: 'no answer') . ($why ? ': ' . str((string) $why, 120) : '') . '). Audio still works.');
}

routes()
    // Start video in a room: an SFU session (Cloudflare) or a link to the provider's call (Daily, Jitsi).
    ->post('rooms/:id/video/join', function (Ctx $ctx, array $p) {
        $me = require_me($ctx);
        $room = $ctx->db->get('rooms', $p['id']);
        if (!$room || !empty($room['endedAt'])) throw new NotFound('Room not found');
        if (!in_room($ctx, $room['id'], $me['id'])) throw new Forbidden('Join the room first');
        $host = (string) $room['createdBy'];
        $s = call_settings($ctx, $host);
        $provider = video_provider($s);
        if (!$provider) throw new BadRequest("Video isn't set up for this room. Audio still works.");
        $budget = call_budget($ctx, $s);
        if ($budget['step'] !== 'full') {
            throw new BadRequest($budget['step'] === 'warn' ? "Today's video minutes are nearly used up, so new video is paused until tomorrow. Audio still works." : "Today's video minutes are used up. Audio still works" . ($s['ownLink'] ? ', or use the host\'s own link.' : '.'));
        }
        $isHost = $me['id'] === $host || in_array(($ctx->db->get('memberships', ($room['spaceId'] ?? '') . ':' . $me['id'])['role'] ?? ''), ['host', 'cohost'], true);
        $now = intdiv($ctx->now(), 1000);
        $name = 'loft-' . preg_replace('/[^a-z0-9-]/', '', strtolower((string) $room['code']));

        if ($provider === 'cloudflare') {
            $appId = (string) provider_secret($s, 'cloudflare', 'appId');
            $token = (string) provider_secret($s, 'cloudflare', 'appToken');
            $r = provider_http('POST', CF_API . '/apps/' . rawurlencode($appId) . '/sessions/new', ['Authorization' => "Bearer $token"]);
            $sid = $r['json']['sessionId'] ?? null;
            if ($r['status'] < 200 || $r['status'] >= 300 || !is_string($sid) || $sid === '') video_fail('Cloudflare', $r);
            foreach ($ctx->db->list('video_sessions', fn ($v) => ($v['createdAt'] ?? '') < iso($ctx->now() - 12 * 3600_000)) as $old) $ctx->db->del('video_sessions', $old['id']);
            $ctx->db->put('video_sessions', ['id' => $sid, 'roomId' => $room['id'], 'userId' => $me['id'], 'hostId' => $host, 'createdAt' => $ctx->nowIso()]);
            $ice = [['urls' => CF_STUN]];
            $turn = cf_turn_servers($ctx, $host, $s);
            if ($turn) $ice[] = $turn;
            return ['provider' => 'cloudflare', 'sessionId' => $sid, 'iceServers' => $ice];
        }

        if ($provider === 'daily') {
            $auth = ['Authorization' => 'Bearer ' . provider_secret($s, 'daily', 'key')];
            $props = ['max_participants' => ROOM_CAPACITY, 'exp' => $now + 86400, 'enable_prejoin_ui' => false, 'enable_knocking' => false, 'enable_chat' => false];
            $r = provider_http('GET', DAILY_API . "/rooms/$name", $auth);
            if ($r['status'] === 404) {
                $r = provider_http('POST', DAILY_API . '/rooms', $auth, ['name' => $name, 'privacy' => 'private', 'properties' => $props]);
            } elseif ($r['status'] >= 200 && $r['status'] < 300 && (int) ($r['json']['config']['exp'] ?? 0) < $now + VIDEO_TOKEN_TTL) {
                $r = provider_http('POST', DAILY_API . "/rooms/$name", $auth, ['properties' => $props]); // extend an older room
            }
            $url = $r['json']['url'] ?? null;
            if ($r['status'] < 200 || $r['status'] >= 300 || !is_string($url) || !str_starts_with($url, 'https://')) video_fail('Daily', $r);
            $t = provider_http('POST', DAILY_API . '/meeting-tokens', $auth, ['properties' => ['room_name' => $name, 'user_name' => (string) $me['name'], 'user_id' => (string) $me['id'], 'is_owner' => $isHost, 'exp' => $now + VIDEO_TOKEN_TTL, 'eject_at_token_exp' => true]]);
            $tok = $t['json']['token'] ?? null;
            if ($t['status'] < 200 || $t['status'] >= 300 || !is_string($tok)) video_fail('Daily', $t);
            return ['provider' => 'daily', 'url' => $url . '?t=' . rawurlencode($tok)];
        }

        $appId = (string) provider_secret($s, 'jitsi', 'appId');
        $jwt = jaas_jwt($appId, (string) provider_secret($s, 'jitsi', 'key'), (string) provider_secret($s, 'jitsi', 'privateKey'), $name, $me, $isHost, $now);
        return ['provider' => 'jitsi', 'url' => JAAS_HOST . '/' . rawurlencode($appId) . '/' . $name . '?jwt=' . $jwt];
    })
    // Cloudflare Realtime negotiation for your own SFU session, relayed with the org's app token.
    ->post('rooms/:id/video/cf', function (Ctx $ctx, array $p, array $in) {
        $me = require_me($ctx);
        $sid = str($in['sessionId'] ?? '', 120);
        $sess = $sid !== '' ? $ctx->db->get('video_sessions', $sid) : null;
        if (!$sess || $sess['userId'] !== $me['id'] || $sess['roomId'] !== $p['id']) throw new Forbidden('That video session is not yours');
        $op = (string) ($in['op'] ?? '');
        $method = ['tracks/new' => 'POST', 'renegotiate' => 'PUT', 'tracks/close' => 'PUT'][$op] ?? null;
        if (!$method) throw new BadRequest('Unknown video operation');
        $body = is_array($in['body'] ?? null) ? $in['body'] : [];
        // You can only pull tracks from people in this room.
        foreach ((array) ($body['tracks'] ?? []) as $t) {
            if (is_array($t) && ($t['location'] ?? '') === 'remote') {
                $other = $ctx->db->get('video_sessions', (string) ($t['sessionId'] ?? ''));
                if (!$other || $other['roomId'] !== $p['id']) throw new Forbidden('That video is not in this room');
            }
        }
        $s = call_settings($ctx, (string) $sess['hostId']);
        $appId = provider_secret($s, 'cloudflare', 'appId');
        $token = provider_secret($s, 'cloudflare', 'appToken');
        if (!$appId || !$token) throw new BadRequest('Video was switched off for this room');
        $r = provider_http($method, CF_API . '/apps/' . rawurlencode($appId) . '/sessions/' . rawurlencode($sid) . '/' . $op, ['Authorization' => "Bearer $token"], $body);
        if ($r['status'] < 200 || $r['status'] >= 300 || $r['json'] === null) video_fail('Cloudflare', $r);
        return $r['json'];
    })
    ->post('rooms/:id/video/leave', function (Ctx $ctx, array $p, array $in) {
        $me = require_me($ctx);
        $sess = $ctx->db->get('video_sessions', str($in['sessionId'] ?? '', 120));
        if ($sess && $sess['userId'] === $me['id']) $ctx->db->del('video_sessions', $sess['id']);
        return ['ok' => true];
    });
