<?php
declare(strict_types=1);
namespace Loft;

test('password auth: register without email, confirm recovery, reject duplicates and never expose hashes', function () {
    $db = fresh();
    throws(fn () => call($db, null, 'POST', 'auth/link', ['email' => 'nobody@example.test']), '/not enabled/');
    $result = call($db, null, 'POST', 'auth/register', ['username' => 'New.Host', 'password' => 'a-long-test-passphrase']);
    $id = $result['user']['id'];
    eq($result['user']['username'], 'new.host');
    eq($result['user']['email'], '');
    eq($result['user']['recoveryPending'], true);
    ok(!isset($result['user']['passwordHash'], $result['user']['recoveryHash']));
    eq($GLOBALS['loft_mail'], []);
    throws(fn () => call($db, null, 'POST', 'auth/register', ['username' => 'NEW.HOST', 'password' => 'a-long-test-passphrase']), '/already taken/');
    throws(fn () => call($db, $id, 'GET', 'owner'), '/Only the owner/');
    throws(fn () => call($db, $id, 'POST', 'auth/recovery-confirm', ['saved' => true, 'recoveryCode' => 'wrong']), '/current recovery code/');
    call($db, $id, 'POST', 'auth/recovery-confirm', ['saved' => true, 'recoveryCode' => $result['recoveryCode']]);
    $login = call($db, null, 'POST', 'auth/login', ['username' => 'NEW.HOST', 'password' => 'a-long-test-passphrase']);
    eq($login['recoveryCode'], null);
    eq($login['user']['recoveryPending'], false);
    $me = call($db, $id, 'GET', 'me');
    ok(!array_key_exists('passwordHash', $me) && !array_key_exists('recoveryHash', $me));
});

test('password auth: recovery rotates credentials, revokes sessions and consumes the old recovery code', function () {
    $db = fresh();
    $result = call($db, null, 'POST', 'auth/register', ['username' => 'recover-me', 'password' => 'first-test-passphrase']);
    $id = $result['user']['id'];
    $oldSession = $GLOBALS['loft_session_token'];
    $next = call($db, null, 'POST', 'auth/recover', ['username' => 'recover-me', 'password' => 'second-test-passphrase', 'recoveryCode' => $result['recoveryCode']]);
    ok($next['recoveryCode'] !== $result['recoveryCode']);
    $_COOKIE[SESSION_COOKIE] = $oldSession;
    eq(session_user($db), null);
    unset($_COOKIE[SESSION_COOKIE]);
    throws(fn () => call($db, null, 'POST', 'auth/login', ['username' => 'recover-me', 'password' => 'first-test-passphrase']), '/incorrect/');
    throws(fn () => call($db, null, 'POST', 'auth/recover', ['username' => 'recover-me', 'password' => 'third-test-passphrase', 'recoveryCode' => $result['recoveryCode']]), '/incorrect/');
    call($db, $id, 'POST', 'auth/recovery-confirm', ['saved' => true, 'recoveryCode' => $next['recoveryCode']]);
    eq(call($db, null, 'POST', 'auth/login', ['username' => 'recover-me', 'password' => 'second-test-passphrase'])['user']['id'], $id);
});

test('password auth: existing email accounts retain identity and data when adding a username', function () {
    $db = fresh(); fixture($db);
    $db->patch('users', 'u_host', ['passwordHash' => password_hash('legacy-test-passphrase', PASSWORD_DEFAULT)]);
    eq(call($db, null, 'POST', 'auth/password', ['email' => 'host@example.test', 'password' => 'legacy-test-passphrase'])['id'], 'u_host');
    $result = call($db, 'u_host', 'POST', 'auth/password/set', ['username' => 'legacy-host', 'password' => 'new-test-passphrase']);
    ok(strlen($result['recoveryCode']) > 64);
    eq(call($db, null, 'POST', 'auth/login', ['username' => 'legacy-host', 'password' => 'new-test-passphrase'])['user']['id'], 'u_host');
    eq($db->get('spaces', 'sp_1')['createdBy'], 'u_host');
    eq($db->get('users', 'u_host')['email'], 'host@example.test');
});
