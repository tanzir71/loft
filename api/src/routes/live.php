<?php
declare(strict_types=1);

namespace Loft;

// Live features over plain HTTP polling (no WebSockets on shared hosting): presence (heartbeat 5 s,
// TTL 30 s, pruned on read) and WebRTC signalling (offers, answers, ICE; kept for 60 s).

const PRESENCE_TTL_MS = 30000;
const SIGNAL_TTL_MS = 60000;

function live_tables(Db $db): void
{
    static $done = false;
    if ($done) return;
    $db->pdo->exec('CREATE TABLE IF NOT EXISTS presence (room_id TEXT NOT NULL, tab_id TEXT NOT NULL, user_id TEXT NOT NULL, state TEXT NOT NULL, last_seen INTEGER NOT NULL, PRIMARY KEY (room_id, tab_id))');
    $db->pdo->exec('CREATE TABLE IF NOT EXISTS signals (seq INTEGER PRIMARY KEY AUTOINCREMENT, room_id TEXT NOT NULL, sender TEXT NOT NULL, recipient TEXT, msg TEXT NOT NULL, at INTEGER NOT NULL)');
    $db->pdo->exec('CREATE INDEX IF NOT EXISTS signals_room ON signals (room_id, seq)');
    $done = true;
}

/** @return list<array<string, mixed>> live peers in a room (expired rows pruned). */
function live_peers(Db $db, string $roomId, int $now): array
{
    live_tables($db);
    $db->pdo->prepare('DELETE FROM presence WHERE last_seen < ?')->execute([$now - PRESENCE_TTL_MS]);
    $st = $db->pdo->prepare('SELECT tab_id, state, last_seen FROM presence WHERE room_id = ? ORDER BY last_seen');
    $st->execute([$roomId]);
    return array_map(fn ($r) => array_merge((array) json_decode((string) $r['state'], true), ['tabId' => $r['tab_id'], 'lastSeen' => (int) $r['last_seen']]), $st->fetchAll(\PDO::FETCH_ASSOC));
}

/** The tab id: one per browser tab, sent by the client (falls back to the session). */
function live_tab(array $in, string $userId): string
{
    $t = str($in['tabId'] ?? '', 40);
    return $t !== '' ? $t : 'u:' . $userId;
}

routes()
    ->post('rooms/:id/presence', function (Ctx $ctx, array $p, array $in) {
        $me = require_me($ctx);
        $room = $ctx->db->get('rooms', $p['id']);
        if (!$room) throw new NotFound('Room not found');
        live_tables($ctx->db);
        $state = is_array($in['state'] ?? null) ? $in['state'] : [];
        // The server decides who you are; the rest of the state (cursor, status, hand, …) is yours.
        $state['userId'] = $me['id'];
        $state['name'] = $me['name'];
        unset($state['isAgent']);
        $json = json_encode($state, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        if (strlen((string) $json) > 4096) throw new BadRequest('Presence state is too big');
        $tab = live_tab($in, $me['id']);
        $ctx->db->pdo->prepare('INSERT INTO presence (room_id, tab_id, user_id, state, last_seen) VALUES (?, ?, ?, ?, ?) ON CONFLICT(room_id, tab_id) DO UPDATE SET state = excluded.state, last_seen = excluded.last_seen, user_id = excluded.user_id')
            ->execute([$p['id'], $tab, $me['id'], $json, $ctx->now()]);
        return array_values(array_filter(live_peers($ctx->db, $p['id'], $ctx->now()), fn ($x) => $x['tabId'] !== $tab));
    })
    ->post('rooms/:id/presence/leave', function (Ctx $ctx, array $p, array $in) {
        $me = require_me($ctx);
        live_tables($ctx->db);
        $ctx->db->pdo->prepare('DELETE FROM presence WHERE room_id = ? AND tab_id = ?')->execute([$p['id'], live_tab($in, $me['id'])]);
        return ['ok' => true];
    })
    ->get('rooms/:id/presence', function (Ctx $ctx, array $p) {
        require_me($ctx);
        return live_peers($ctx->db, $p['id'], $ctx->now());
    })
    ->post('signal', function (Ctx $ctx, array $p, array $in) {
        $me = require_me($ctx);
        live_tables($ctx->db);
        $roomId = str($in['roomId'] ?? '', 80);
        if (!$ctx->db->get('rooms', $roomId)) throw new NotFound('Room not found');
        $msg = is_array($in['msg'] ?? null) ? $in['msg'] : [];
        $type = str($msg['type'] ?? '', 40);
        if ($type === '') throw new BadRequest('Signal needs a type');
        $json = json_encode(['from' => (string) ($msg['from'] ?? $me['id']), 'to' => isset($msg['to']) ? (string) $msg['to'] : null, 'type' => $type, 'data' => $msg['data'] ?? null, 'userId' => $me['id']], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        if (strlen((string) $json) > 65536) throw new BadRequest('Signal is too big');
        $ctx->db->pdo->prepare('INSERT INTO signals (room_id, sender, recipient, msg, at) VALUES (?, ?, ?, ?, ?)')->execute([$roomId, (string) ($msg['from'] ?? $me['id']), isset($msg['to']) ? (string) $msg['to'] : null, $json, $ctx->now()]);
        $ctx->db->pdo->prepare('DELETE FROM signals WHERE at < ?')->execute([$ctx->now() - SIGNAL_TTL_MS]);
        return ['ok' => true];
    })
    ->get('signal', function (Ctx $ctx, array $p, array $in) {
        require_me($ctx);
        live_tables($ctx->db);
        $roomId = str($in['roomId'] ?? '', 80);
        $since = (int) ($in['since'] ?? 0);
        $tab = str($in['tabId'] ?? '', 40);
        if ($since === 0) {
            // First poll: start from now, don't replay old offers.
            $max = (int) $ctx->db->pdo->query('SELECT COALESCE(MAX(seq), 0) FROM signals')->fetchColumn();
            return ['seq' => $max, 'msgs' => []];
        }
        $st = $ctx->db->pdo->prepare('SELECT seq, sender, recipient, msg FROM signals WHERE room_id = ? AND seq > ? ORDER BY seq LIMIT 200');
        $st->execute([$roomId, $since]);
        $rows = $st->fetchAll(\PDO::FETCH_ASSOC);
        $seq = $since;
        $msgs = [];
        foreach ($rows as $r) {
            $seq = max($seq, (int) $r['seq']);
            if ($tab !== '' && $r['sender'] === $tab) continue;
            if ($r['recipient'] !== null && $tab !== '' && $r['recipient'] !== $tab) continue;
            $msgs[] = json_decode((string) $r['msg'], true);
        }
        return ['seq' => $seq, 'msgs' => $msgs];
    });

// ---- org admin · Calls & budget (mirrors packages/data/src/local/routes-admin.ts) ----

const DEFAULT_STUN = 'stun.l.google.com:19302';
const UNIT_CENTS_PER_MIN = 0.4;

/** Keys stored in the DB are encrypted with the key the install wizard generated (handoff §3.9). */
function seal(string $plain): string
{
    $key = base64_decode((string) Config::get('key', ''), true);
    if (!$key || strlen($key) !== SODIUM_CRYPTO_SECRETBOX_KEYBYTES) throw new BadRequest('The install key is missing; re-run the install wizard');
    $nonce = random_bytes(SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
    return base64_encode($nonce . sodium_crypto_secretbox($plain, $nonce, $key));
}

function unseal(string $sealed): ?string
{
    $key = base64_decode((string) Config::get('key', ''), true);
    $raw = base64_decode($sealed, true);
    if (!$key || !$raw || strlen($raw) <= SODIUM_CRYPTO_SECRETBOX_NONCEBYTES) return null;
    $out = sodium_crypto_secretbox_open(substr($raw, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES), substr($raw, 0, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES), $key);
    return $out === false ? null : $out;
}

function call_settings(Ctx $ctx, string $hostId): array
{
    return $ctx->db->get('call_settings', $hostId) ?? ['id' => $hostId, 'ownLink' => '', 'stun' => DEFAULT_STUN, 'p2p' => true, 'cloudflare' => ['on' => false], 'daily' => ['on' => false], 'jitsi' => ['on' => false], 'budgetCents' => 0, 'freeMinutes' => 0, 'neverCut' => true, 'usage' => [], 'savedAt' => null];
}

/** Never send sealed secrets to the browser: only on/off and the last 4 characters. */
function call_settings_public(array $s): array
{
    foreach (['cloudflare', 'daily', 'jitsi'] as $p) unset($s[$p]['keySealed'], $s[$p]['tokenSealed']);
    $s['usage'] = obj($s['usage'] ?? []);
    return $s;
}

routes()
    ->get('admin/calls', function (Ctx $ctx) {
        $me = require_me($ctx);
        $s = call_settings($ctx, $me['id']);
        $now = local($ctx->now());
        $days = (int) $now->format('t');
        $sfu = !empty($s['cloudflare']['on']) || !empty($s['daily']['on']) || !empty($s['jitsi']['on']);
        $pool = (int) floor(((int) ($s['freeMinutes'] ?? 0) + ((int) $s['budgetCents']) / UNIT_CENTS_PER_MIN) / max(1, $days));
        $hosted = array_map(fn ($m) => $m['spaceId'], $ctx->db->list('memberships', fn ($m) => $m['userId'] === $me['id'] && $m['role'] === 'host'));
        $members = array_unique(array_map(fn ($m) => $m['userId'], $ctx->db->list('memberships', fn ($m) => in_array($m['spaceId'], $hosted, true) && $m['userId'] !== $me['id'])));
        $since = iso($ctx->now() - 30 * DAY);
        $active = count($ctx->db->list('users', fn ($u) => in_array($u['id'], $members, true) && (string) ($u['lastSeenAt'] ?? '') > $since));
        $today = gmdate('Y-m-d', intdiv($ctx->now(), 1000));
        $usage = (array) ($s['usage'] ?? []);
        $last14 = [];
        for ($i = 13; $i >= 0; $i--) {
            $d = gmdate('Y-m-d', intdiv($ctx->now() - $i * DAY, 1000));
            $last14[] = ['day' => $d, 'minutes' => (float) ($usage[$d]['minutes'] ?? 0), 'videoMinutes' => (float) ($usage[$d]['videoMinutes'] ?? 0)];
        }
        $usedVideo = (float) ($usage[$today]['videoMinutes'] ?? 0);
        $step = !$sfu ? 'full' : ($pool <= 0 ? 'own-link' : ($usedVideo < $pool * 0.8 ? 'full' : ($usedVideo < $pool ? 'warn' : ($usedVideo < $pool + 10 ? 'audio-only' : 'own-link'))));
        $month = month_key($ctx->now());
        $spent = 0.0;
        foreach ($usage as $d => $u) if (str_starts_with((string) $d, $month)) $spent += (float) ($u['videoMinutes'] ?? 0);
        return ['settings' => call_settings_public($s), 'pool' => $sfu ? $pool : null, 'activeMembers' => $active, 'perMember' => $sfu && $active ? (int) round($pool / $active) : null, 'today' => $usage[$today] ?? ['minutes' => 0, 'videoMinutes' => 0], 'step' => $step, 'last14' => $last14, 'month' => $month, 'spentCents' => (int) round($spent * UNIT_CENTS_PER_MIN)];
    })
    ->post('admin/calls', function (Ctx $ctx, array $p, array $in) {
        $me = require_me($ctx);
        $s = call_settings($ctx, $me['id']);
        if (is_string($in['ownLink'] ?? null)) {
            $l = str($in['ownLink'], 300);
            if ($l !== '' && !preg_match('#^https://#i', $l)) throw new BadRequest('Your own link must start with https://');
            $s['ownLink'] = $l;
        }
        if (is_string($in['stun'] ?? null)) $s['stun'] = preg_replace('/^stun:/', '', str($in['stun'], 200)) ?: DEFAULT_STUN;
        if (is_int($in['budgetCents'] ?? null)) $s['budgetCents'] = max(0, min(1000000, $in['budgetCents']));
        if (is_int($in['freeMinutes'] ?? null)) $s['freeMinutes'] = max(0, min(10000000, $in['freeMinutes']));
        if (is_bool($in['neverCut'] ?? null)) $s['neverCut'] = $in['neverCut'];
        foreach (['cloudflare', 'daily', 'jitsi'] as $name) {
            $pv = $in['providers'][$name] ?? null;
            if (!is_array($pv)) continue;
            $cur = (array) ($s[$name] ?? ['on' => false]);
            if (is_bool($pv['on'] ?? null)) $cur['on'] = $pv['on'];
            foreach (['key' => 'keyLast4', 'token' => 'tokenLast4'] as $field => $last) {
                $v = is_string($pv[$field] ?? null) ? trim($pv[$field]) : '';
                if (strlen($v) >= 4) {
                    $cur[$field . 'Sealed'] = seal($v);
                    $cur[$last] = substr($v, -4);
                }
            }
            $s[$name] = $cur;
        }
        $s['savedAt'] = $ctx->nowIso();
        $ctx->db->put('call_settings', $s);
        $ctx->db->audit($me['id'], 'admin.calls', ['providers' => array_map(fn ($n) => !empty($s[$n]['on']), ['cloudflare' => 'cloudflare', 'daily' => 'daily', 'jitsi' => 'jitsi'])]);
        $ctx->changed('call_settings');
        return call_settings_public($s);
    })
    ->get('rooms/:id/call-config', function (Ctx $ctx, array $p) {
        require_me($ctx);
        $room = $ctx->db->get('rooms', $p['id']);
        $s = call_settings($ctx, (string) ($room['createdBy'] ?? ''));
        return ['iceServers' => [['urls' => 'stun:' . ($s['stun'] ?: DEFAULT_STUN)]], 'ownLink' => $s['ownLink'] ?: null];
    })
    ->post('rooms/:id/usage', function (Ctx $ctx, array $p, array $in) {
        require_me($ctx);
        $room = $ctx->db->get('rooms', $p['id']);
        if (!$room) return ['ok' => false];
        $host = (string) $room['createdBy'];
        $day = gmdate('Y-m-d', intdiv($ctx->now(), 1000));
        $m = max(0, min(5, (float) ($in['minutes'] ?? 0)));
        $video = ($in['video'] ?? false) === true;
        if (!$ctx->db->get('call_settings', $host)) $ctx->db->put('call_settings', call_settings($ctx, $host));
        $ctx->db->update('call_settings', $host, function (array $s) use ($day, $m, $video) {
            $u = (array) ($s['usage'] ?? []);
            $cur = $u[$day] ?? ['minutes' => 0, 'videoMinutes' => 0];
            $u[$day] = ['minutes' => $cur['minutes'] + $m, 'videoMinutes' => $cur['videoMinutes'] + ($video ? $m : 0)];
            $s['usage'] = $u;
            return $s;
        });
        return ['ok' => true];
    });

// ---- screen-share stills for viewers who can't get video (overwritten, not kept) ----
routes()
    ->post('rooms/:id/still', function (Ctx $ctx, array $p, array $in) {
        require_me($ctx);
        if (!$ctx->db->get('rooms', $p['id'])) throw new NotFound('Room not found');
        $url = (string) ($in['dataUrl'] ?? '');
        if (!preg_match('#^data:image/(webp|jpeg|png);base64,(.+)$#', $url, $m)) throw new BadRequest('Send an image');
        $bytes = base64_decode($m[2], true);
        if ($bytes === false || strlen($bytes) > 1_500_000) throw new BadRequest('That still is too big');
        $dir = data_dir() . '/stills';
        if (!is_dir($dir)) mkdir($dir, 0700, true);
        file_put_contents("$dir/" . preg_replace('/[^a-zA-Z0-9_-]/', '', $p['id']) . '.img', $bytes);
        file_put_contents("$dir/" . preg_replace('/[^a-zA-Z0-9_-]/', '', $p['id']) . '.type', 'image/' . $m[1]);
        return ['ok' => true];
    })
    ->get('rooms/:id/still', function (Ctx $ctx, array $p) {
        require_me($ctx);
        $base = data_dir() . '/stills/' . preg_replace('/[^a-zA-Z0-9_-]/', '', $p['id']);
        if (!is_file("$base.img")) throw new NotFound('No still yet');
        return new FileOut("$base.img", (string) @file_get_contents("$base.type") ?: 'image/webp', 'still.webp');
    });
