<?php
declare(strict_types=1);

namespace Loft;

test('helpers: JS-compatible ISO strings, ids, money', function () {
    eq(iso(0), '1970-01-01T00:00:00.000Z');
    eq(iso(1763712000123), '2025-11-21T08:00:00.123Z');
    eq(ms('2025-11-21T08:00:00.123Z'), 1763712000123);
    ok(preg_match('/^u_[a-z2-9]{16}$/', new_id('u')) === 1, 'new_id format');
    ok(strcmp(sortable_id(), sortable_id()) < 0, 'sortable ids sort in order');
    ok(preg_match('/^[A-Z2-9]{3}-[A-Z2-9]{3}$/', room_code()) === 1, 'room code');
    eq(normalise_code('k7p 42q'), 'K7P-42Q');
    eq(slugify('Acme Sprint · Q3!'), 'acme-sprint-q3');
    eq(format_usd(123456), '$1,234.56');
    eq(format_usd(12000, true), '$120');
    eq(format_usd(-1500), '-$15.00');
    eq(prorate(3333, 20), 1111);
    eq(fill_payment_link('https://pay.me/x?a={amount}&r={ref}', 4500, 'LF-1'), 'https://pay.me/x?a=45.00&r=LF-1');
    eq(month_range('2026-11')['start'], '2026-11-01T00:00:00.000Z');
    eq(prev_month_key('2026-01'), '2025-12');
});

test('db: rows, atomic update, op-log, change polling, token bucket', function () {
    $db = fresh();
    $db->put('things', ['id' => 'a', 'n' => 1, 'map' => ['x' => 1]]);
    eq($db->get('things', 'a')['map'], ['x' => 1]);
    $db->update('things', 'a', fn ($r) => array_merge($r, ['n' => $r['n'] + 1]));
    eq($db->get('things', 'a')['n'], 2);
    eq(count($db->list('things', fn ($r) => $r['n'] === 2)), 1);
    throws(fn () => $db->patch('things', 'missing', []), '/not found/');
    $ops = $db->appendOps('rm1', [['actor' => 'u', 'kind' => 'add', 'payload' => ['obj' => ['id' => 's1']]], ['actor' => 'u', 'kind' => 'remove', 'payload' => ['id' => 's1']]]);
    eq(array_column($ops, 'seq'), [1, 2]);
    eq(count($db->opsSince('rm1', 1)), 1);
    $v = $db->changed(['posts']);
    eq($db->changesSince($v - 1)['tables'], ['posts']);
    eq($db->changesSince(0)['tables'], ['*']);
    $t = 1_000_000;
    for ($i = 0; $i < 5; $i++) ok($db->takeToken('k', 5, $t));
    ok(!$db->takeToken('k', 5, $t), 'bucket empties');
    ok($db->takeToken('k', 5, $t + 13000), 'bucket refills');
});

test('auth: sign-in link is single use and expires in 15 minutes', function () {
    $db = fresh();
    call($db, null, 'POST', 'auth/link', ['email' => 'New.Person@Example.test']);
    $mail = end($GLOBALS['loft_mail']);
    eq($mail['to'], 'new.person@example.test');
    ok(preg_match('/token=([a-f0-9]{64})/', $mail['body'], $m) === 1, 'link in the email');
    $user = find($db->list('users'), fn ($u) => $u['email'] === 'new.person@example.test');
    eq($user['name'], 'New Person');
    $r = call($db, null, 'GET', 'auth/callback', ['token' => $m[1]]);
    ok($r instanceof Redirect && $r->to === 'https://example.test/spaces/', 'redirects into the app');
    $st = $db->pdo->query('SELECT user_id FROM auth_sessions');
    eq($st->fetchColumn(), $user['id']);
    $again = call($db, null, 'GET', 'auth/callback', ['token' => $m[1]]);
    contains($again->to, 'error=expired');
    call($db, null, 'POST', 'auth/link', ['email' => 'new.person@example.test']);
    preg_match('/token=([a-f0-9]{64})/', end($GLOBALS['loft_mail'])['body'], $m2);
    $GLOBALS['loft_now'] = now_ms() + 16 * 60000;
    contains(call($db, null, 'GET', 'auth/callback', ['token' => $m2[1]])->to, 'error=expired');
    throws(fn () => call($db, null, 'POST', 'auth/link', ['email' => 'nope']), '/valid email/');
});

test('owner console: branding toggle + paid-until, active for 14 days after, change log', function () {
    $db = fresh();
    fixture($db);
    Config::load(TEST_CONFIG + ['owner_user_id' => 'u_owner']);
    put($db, 'users', ['id' => 'u_owner', 'name' => 'Owner', 'email' => 'owner@example.test', 'tz' => 'UTC', 'status' => 'available', 'createdAt' => iso(now_ms())]);
    throws(fn () => call($db, 'u_host', 'GET', 'owner'), '/Only the owner/', Forbidden::class);
    $o = call($db, 'u_owner', 'GET', 'owner');
    eq(count($o['orgs']), 1);
    eq($o['orgs'][0]['active'], false);
    $GLOBALS['loft_now'] = ms('2026-11-21T10:00:00Z');
    $next = call($db, 'u_owner', 'POST', 'owner/orgs/' . $o['orgs'][0]['id'], ['branded' => true, 'brandedUntil' => '2026-11-10', 'note' => 'Paid yearly']);
    eq($next['active'], true, 'within the 14-day grace');
    $GLOBALS['loft_now'] = ms('2026-11-25T10:00:00Z');
    eq(branding_active($db->get('orgs', $next['id']), now_ms()), false, 'grace over');
    eq(call($db, 'u_owner', 'GET', 'owner')['log'][0]['action'], 'branding');
    throws(fn () => call($db, 'u_host', 'POST', 'brand', ['theme' => 'sunrise']), '/Branding is off/');
});

test('contact form stores the message and emails the owner', function () {
    $db = fresh();
    call($db, null, 'POST', 'contact', ['organisation' => 'Acme School', 'admin_email' => 'admin@acme.test', 'people' => '40', 'period' => 'yearly']);
    eq(count($db->list('contact_messages')), 1);
    eq(end($GLOBALS['loft_mail'])['subject'], 'Branded loft for Acme School');
    throws(fn () => call($db, null, 'POST', 'contact', ['organisation' => '', 'admin_email' => 'x']), '/organisation/');
});

test('ops over HTTP need a signed-in user and an open room', function () {
    $db = fresh();
    fixture($db);
    put($db, 'rooms', ['id' => 'rm1', 'spaceId' => 'sp_1', 'code' => 'ABC-DEF', 'createdBy' => 'u_host', 'endedAt' => null]);
    throws(fn () => call($db, null, 'GET', 'rooms/rm1/ops'), '/Not signed in/', Unauthorized::class);
    $out = call($db, 'u_a', 'POST', 'rooms/rm1/ops', ['ops' => [['kind' => 'add', 'payload' => ['obj' => ['id' => 'x']], 'actor' => 'spoofed']]]);
    eq($out[0]['actor'], 'u_a', 'actor comes from the session');
    eq(count(call($db, 'u_b', 'GET', 'rooms/rm1/ops', ['since' => 0])), 1);
});
