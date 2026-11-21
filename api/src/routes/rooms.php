<?php
declare(strict_types=1);

namespace Loft;

// Port of packages/data/src/local/routes.ts: me, settings, rooms (M2), knock + admissions,
// room chat and guests. Keep in step with the TS twin.

function sp_room_or_404(Ctx $ctx, string $id): array
{
    $r = $ctx->db->get('rooms', $id);
    if (!$r) throw new NotFound('Room not found');
    return $r;
}

function sp_host_only(Ctx $ctx, array $room): void
{
    if ($ctx->meId !== ($room['createdBy'] ?? null)) throw new Forbidden('Only the host can do that');
}

function sp_with_host(Ctx $ctx, array $room): array
{
    $host = $ctx->db->get('users', (string) ($room['createdBy'] ?? ''));
    return array_merge($room, ['hostName' => $host['name'] ?? 'the host']);
}

/** A room code nobody is using yet ("K7P-42Q"). */
function sp_unique_room_code(Ctx $ctx): string
{
    $code = room_code();
    while ($ctx->db->list('rooms', fn ($r) => ($r['code'] ?? '') === $code)) $code = room_code();
    return $code;
}

/** Settings before the host has saved any (TS `settings` GET fallback). */
function sp_default_settings(string $userId): array
{
    return ['id' => $userId, 'roomLink' => '', 'bookingPage' => null, 'paymentLink' => null];
}

routes()
    ->get('me', function (Ctx $ctx) {
        $me = $ctx->meId ? $ctx->db->get('users', $ctx->meId) : null;
        return $me ? public_user($me) : null;
    })
    ->get('settings', function (Ctx $ctx) {
        $me = require_me($ctx);
        return $ctx->db->get('settings', $me['id']) ?? sp_default_settings($me['id']);
    })
    ->post('settings', function (Ctx $ctx, array $p, array $in) {
        $me = require_me($ctx);
        $cur = $ctx->db->get('settings', $me['id']) ?? ['id' => $me['id']];
        $next = array_merge($cur, ['id' => $me['id']]);
        foreach (['bookingPage', 'paymentLink'] as $k) {
            if (array_key_exists($k, $in)) $next[$k] = is_string($in[$k]) ? str($in[$k], 500) : null;
        }
        $ctx->db->put('settings', $next);
        $ctx->changed('settings');
        return $next;
    })
    // ---- rooms (M2) ----
    ->post('rooms', function (Ctx $ctx, array $p, array $in) {
        $me = require_me($ctx);
        $code = sp_unique_room_code($ctx);
        $name = str($in['name'] ?? null, 60);
        $room = [
            'id' => new_id('rm'),
            'spaceId' => str($in['spaceId'] ?? null) ?: null,
            'sessionId' => str($in['sessionId'] ?? null) ?: null,
            'slug' => strtolower($code),
            'code' => $code,
            'name' => $name !== '' ? $name : 'Quick room · ' . first_name((string) $me['name']),
            'capacity' => ROOM_CAPACITY,
            'guestJoin' => ($in['guestJoin'] ?? null) !== false,
            'createdBy' => $me['id'],
            'createdAt' => $ctx->nowIso(),
            'endedAt' => null,
        ];
        $ctx->db->put('rooms', $room);
        $ctx->changed('rooms');
        return $room;
    })
    ->get('rooms/by-code/:code', function (Ctx $ctx, array $p) {
        $code = normalise_code((string) ($p['code'] ?? ''));
        $room = $ctx->db->list('rooms', fn ($r) => ($r['code'] ?? '') === $code)[0] ?? null;
        if (!$room) throw new NotFound('No room with that code');
        return sp_with_host($ctx, $room);
    })
    ->get('rooms/:id', function (Ctx $ctx, array $p) {
        return sp_with_host($ctx, sp_room_or_404($ctx, $p['id']));
    })
    ->post('rooms/:id/settings', function (Ctx $ctx, array $p, array $in) {
        $room = sp_room_or_404($ctx, $p['id']);
        sp_host_only($ctx, $room);
        $patch = [];
        if (is_bool($in['guestJoin'] ?? null)) $patch['guestJoin'] = $in['guestJoin'];
        $name = str($in['name'] ?? null, 60);
        if ($name !== '') $patch['name'] = $name;
        $next = $ctx->db->patch('rooms', $room['id'], $patch);
        $ctx->changed('rooms');
        return $next;
    })
    ->post('rooms/:id/end', function (Ctx $ctx, array $p) {
        $room = sp_room_or_404($ctx, $p['id']);
        sp_host_only($ctx, $room);
        $next = $ctx->db->patch('rooms', $room['id'], ['endedAt' => $ctx->nowIso()]);
        $ctx->changed('rooms');
        return $next;
    })
    // A guest asks to join. With guest join on they walk straight in; off, the host admits them.
    ->post('rooms/:id/knock', function (Ctx $ctx, array $p) {
        $room = sp_room_or_404($ctx, $p['id']);
        $me = require_me($ctx);
        if (!empty($room['endedAt'])) throw new Forbidden('This session has ended');
        if ($me['id'] === $room['createdBy']) return ['id' => 'host', 'status' => 'admitted'];
        $existing = $ctx->db->list('admissions', fn ($a) => $a['roomId'] === $room['id'] && $a['guestId'] === $me['id'])[0] ?? null;
        if ($existing && $existing['status'] !== 'denied') return $existing;
        $adm = ['id' => new_id('adm'), 'roomId' => $room['id'], 'guestId' => $me['id'], 'name' => $me['name'], 'status' => !empty($room['guestJoin']) ? 'admitted' : 'pending', 'at' => $ctx->nowIso()];
        $ctx->db->put('admissions', $adm);
        $ctx->changed('admissions');
        return $adm;
    })
    ->get('rooms/:id/admissions', function (Ctx $ctx, array $p) {
        $room = sp_room_or_404($ctx, $p['id']);
        sp_host_only($ctx, $room);
        $pending = $ctx->db->list('admissions', fn ($a) => $a['roomId'] === $room['id'] && $a['status'] === 'pending');
        return sorted($pending, fn ($a, $b) => strcmp((string) $a['at'], (string) $b['at']));
    })
    ->get('rooms/:id/admission', function (Ctx $ctx, array $p) {
        $me = require_me($ctx);
        $room = sp_room_or_404($ctx, $p['id']);
        if ($me['id'] === $room['createdBy']) return ['id' => 'host', 'status' => 'admitted'];
        return $ctx->db->list('admissions', fn ($a) => $a['roomId'] === $room['id'] && $a['guestId'] === $me['id'])[0] ?? null;
    })
    ->post('rooms/:id/admissions/:aid', function (Ctx $ctx, array $p, array $in) {
        $room = sp_room_or_404($ctx, $p['id']);
        sp_host_only($ctx, $room);
        $status = ($in['decision'] ?? null) === 'admit' ? 'admitted' : 'denied';
        // Server: a host can only decide admissions to their own room.
        $adm = $ctx->db->get('admissions', $p['aid']);
        if (!$adm || ($adm['roomId'] ?? null) !== $room['id']) throw new NotFound("admissions/{$p['aid']} not found");
        $next = $ctx->db->patch('admissions', $p['aid'], ['status' => $status]);
        $ctx->changed('admissions');
        return $next;
    })
    ->get('rooms/:id/messages', function (Ctx $ctx, array $p) {
        // Server: room chat needs a session (guests get one when they join).
        require_me($ctx);
        sp_room_or_404($ctx, $p['id']);
        $msgs = $ctx->db->list('messages', fn ($m) => ($m['channelType'] ?? '') === 'room' && ($m['channelId'] ?? '') === $p['id']);
        return sorted($msgs, fn ($a, $b) => strcmp((string) $a['id'], (string) $b['id']));
    })
    ->post('rooms/:id/messages', function (Ctx $ctx, array $p, array $in) {
        $room = sp_room_or_404($ctx, $p['id']);
        $me = require_me($ctx);
        $body = str($in['body'] ?? null, 2000);
        if ($body === '') throw new BadRequest('Empty message');
        $m = ['id' => sortable_id('msg'), 'channelType' => 'room', 'channelId' => $room['id'], 'userId' => $me['id'], 'name' => $me['name'], 'body' => $body, 'createdAt' => $ctx->nowIso()];
        $ctx->db->put('messages', $m);
        $ctx->changed('messages');
        return $m;
    })
    // Guests get a lightweight user (no account) and a session cookie so the tab stays the same person.
    ->post('guests', function (Ctx $ctx, array $p, array $in) {
        $name = str($in['name'] ?? null, 40);
        if ($name === '') throw new BadRequest('Name required');
        $g = ['id' => new_id('g'), 'name' => $name, 'email' => '', 'tz' => 'UTC', 'status' => 'available', 'guest' => true, 'createdAt' => $ctx->nowIso()];
        $ctx->db->put('users', $g);
        start_session($ctx->db, $g['id']);
        return $g;
    });
