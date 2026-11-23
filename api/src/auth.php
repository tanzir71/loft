<?php
declare(strict_types=1);
namespace Loft;

function auth_username(mixed $value): string
{
    $name = strtolower(trim(is_string($value) ? $value : ''));
    if (!preg_match('/^[a-z0-9][a-z0-9_.-]{2,31}$/D', $name)) throw new BadRequest('Use a username of 3–32 letters, numbers, dots, dashes or underscores.');
    return $name;
}

function auth_password(mixed $value): string
{
    if (!is_string($value) || strlen($value) < 10 || strlen($value) > 72 || str_contains($value, "\0")) throw new BadRequest('Use a password or passphrase of 10–72 bytes.');
    return $value;
}

function auth_code(string $value): string { return strtolower(preg_replace('/[\s-]+/', '', $value) ?? ''); }
function auth_recovery(): string { return implode('-', str_split(strtoupper(bin2hex(random_bytes(32))), 8)); }
function auth_find(Db $db, string $identifier): ?array
{
    return find($db->list('users'), fn ($u) => str_contains($identifier, '@')
        ? strtolower((string) ($u['email'] ?? '')) === $identifier
        : strtolower((string) ($u['username'] ?? '')) === $identifier);
}

function auth_register(Ctx $ctx, array $in): array
{
    if (!$ctx->db->takeToken('register:' . $ctx->ip, 5, $ctx->now())) throw new BadRequest('Too many accounts created. Try again in a minute.');
    $username = auth_username($in['username'] ?? null);
    $password = auth_password($in['password'] ?? null);
    $code = auth_recovery();
    $user = $ctx->db->tx(function () use ($ctx, $in, $username, $password, $code) {
        if (auth_find($ctx->db, $username)) throw new BadRequest('That username is already taken.');
        $user = ['id' => new_id('u'), 'username' => $username, 'name' => str($in['name'] ?? '', 80) ?: $username,
            'email' => '', 'tz' => (string) Config::get('timezone', 'UTC'), 'status' => 'available', 'createdAt' => $ctx->nowIso(),
            'passwordHash' => password_hash($password, PASSWORD_DEFAULT), 'recoveryHash' => password_hash(auth_code($code), PASSWORD_DEFAULT), 'recoveryConfirmed' => false];
        $ctx->db->put('users', $user);
        return $user;
    }, true);
    start_session($ctx->db, $user['id']);
    return ['user' => public_user($user), 'recoveryCode' => $code];
}

function auth_login(Ctx $ctx, array $in): array
{
    $identifier = strtolower(trim(str($in['username'] ?? ($in['email'] ?? ''), 200)));
    if (!$ctx->db->takeToken('pw:' . $ctx->ip, 10, $ctx->now())) throw new BadRequest('Too many attempts. Try again in a minute.');
    $password = is_string($in['password'] ?? null) ? $in['password'] : '';
    if (strlen($password) > 72 || str_contains($password, "\0")) throw new Forbidden('Username or password is incorrect.');
    $user = auth_find($ctx->db, $identifier);
    $dummy = '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2uheWG/igi.';
    $valid = password_verify($password, (string) ($user['passwordHash'] ?? $dummy));
    if (!$user || empty($user['passwordHash']) || !$valid) throw new Forbidden('Username or password is incorrect.');
    $code = null;
    if (!empty($user['recoveryHash']) && empty($user['recoveryConfirmed'])) {
        $code = auth_recovery();
        $user = $ctx->db->patch('users', $user['id'], ['recoveryHash' => password_hash(auth_code($code), PASSWORD_DEFAULT)]);
    }
    start_session($ctx->db, $user['id']);
    return ['user' => public_user($user), 'recoveryCode' => $code];
}

function auth_recover(Ctx $ctx, array $in): array
{
    $identifier = strtolower(trim(str($in['username'] ?? '', 200)));
    if (!$ctx->db->takeToken('recover:' . $ctx->ip, 5, $ctx->now())) throw new BadRequest('Too many recovery attempts. Try again in a minute.');
    $password = auth_password($in['password'] ?? null);
    $code = auth_code(str($in['recoveryCode'] ?? '', 200));
    $next = auth_recovery();
    $user = $ctx->db->tx(function () use ($ctx, $identifier, $password, $code, $next) {
        $user = auth_find($ctx->db, $identifier);
        if (!$user || !preg_match('/^[a-f0-9]{64}$/D', $code) || empty($user['recoveryHash']) || !password_verify($code, $user['recoveryHash'])) throw new Forbidden('The recovery details are incorrect.');
        $user = $ctx->db->patch('users', $user['id'], ['passwordHash' => password_hash($password, PASSWORD_DEFAULT),
            'recoveryHash' => password_hash(auth_code($next), PASSWORD_DEFAULT), 'recoveryConfirmed' => false]);
        $ctx->db->pdo->prepare('DELETE FROM auth_sessions WHERE user_id = ?')->execute([$user['id']]);
        if (!empty($user['email'])) $ctx->db->pdo->prepare('DELETE FROM login_links WHERE email = ?')->execute([$user['email']]);
        return $user;
    }, true);
    start_session($ctx->db, $user['id']);
    return ['user' => public_user($user), 'recoveryCode' => $next];
}

function auth_set_password(Ctx $ctx, array $in): array
{
    $me = require_me($ctx);
    $password = auth_password($in['password'] ?? null);
    $username = array_key_exists('username', $in) ? auth_username($in['username']) : ($me['username'] ?? null);
    $code = auth_recovery();
    $ctx->db->tx(function () use ($ctx, $me, $password, $username, $code) {
        $other = $username ? auth_find($ctx->db, $username) : null;
        if ($other && $other['id'] !== $me['id']) throw new BadRequest('That username is already taken.');
        $ctx->db->patch('users', $me['id'], ['username' => $username, 'passwordHash' => password_hash($password, PASSWORD_DEFAULT),
            'recoveryHash' => password_hash(auth_code($code), PASSWORD_DEFAULT), 'recoveryConfirmed' => false]);
        $ctx->db->pdo->prepare('DELETE FROM auth_sessions WHERE user_id = ?')->execute([$me['id']]);
        if (!empty($me['email'])) $ctx->db->pdo->prepare('DELETE FROM login_links WHERE email = ?')->execute([$me['email']]);
    }, true);
    start_session($ctx->db, $me['id']);
    return ['ok' => true, 'recoveryCode' => $code];
}

/** Host-only credential recovery for an existing owner who never configured email/password. */
function auth_owner_cli(): void
{
    if (PHP_SAPI !== 'cli') throw new Forbidden('Host terminal access required.');
    if (!installed() || !owner_id()) throw new \RuntimeException('Complete first-run owner setup first.');
    fwrite(STDERR, "Owner username: ");
    $username = auth_username(trim((string) fgets(STDIN)));
    fwrite(STDERR, "New owner password: ");
    $hide = stream_isatty(STDIN) && PHP_OS_FAMILY !== 'Windows';
    if ($hide) system('stty -echo');
    try { $password = rtrim((string) fgets(STDIN), "\r\n"); }
    finally { if ($hide) system('stty echo'); fwrite(STDERR, "\n"); }
    $result = auth_set_password(new Ctx(db(), owner_id()), ['username' => $username, 'password' => $password]);
    fwrite(STDOUT, "Owner credentials saved. Save this recovery code privately:\n" . $result['recoveryCode'] . "\n");
}

function auth_install(Ctx $ctx, array $in): array
{
    if (installed()) throw new Forbidden('Loft is already installed');
    $username = auth_username($in['username'] ?? null);
    $password = auth_password($in['password'] ?? null);
    $email = strtolower(str($in['email'] ?? '', 200));
    if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) throw new BadRequest('Enter a valid contact email or leave it blank.');
    $lock = fopen(data_dir() . '/install.lock', 'c');
    if (!$lock || !flock($lock, LOCK_EX)) throw new BadRequest('Could not lock owner setup.');
    try {
        $file = data_dir() . '/config.php';
        if (is_file($file) && !empty(((array) require $file)['installed'])) throw new Forbidden('Loft is already installed');
        if ($ctx->db->list('users')) throw new BadRequest('Existing accounts were found. Restore the existing private config instead of reinstalling.');
        $tz = str($in['timezone'] ?? 'UTC', 64);
        if (!in_array($tz, \DateTimeZone::listIdentifiers(), true)) $tz = 'UTC';
        $code = auth_recovery();
        $owner = ['id' => new_id('u'), 'username' => $username, 'name' => str($in['name'] ?? '', 80) ?: $username,
            'email' => $email, 'tz' => $tz, 'status' => 'available', 'createdAt' => $ctx->nowIso(),
            'passwordHash' => password_hash($password, PASSWORD_DEFAULT), 'recoveryHash' => password_hash(auth_code($code), PASSWORD_DEFAULT), 'recoveryConfirmed' => false];
        $cfg = ['installed' => true, 'owner_user_id' => $owner['id'], 'owner_email' => $email,
            'app_url' => rtrim(str($in['appUrl'] ?? '', 300), '/') . '/', 'timezone' => $tz,
            'mail_from' => str($in['mailFrom'] ?? '', 200), 'email_signin_enabled' => false,
            'key' => base64_encode(random_bytes(32)), 'installed_at' => $ctx->nowIso()];
        $temp = tempnam(data_dir(), '.owner-config-');
        if (!$temp) throw new BadRequest('Could not stage owner setup.');
        try {
            $bytes = "<?php\n// Written by Loft. Keep this file and its encryption key private.\nreturn " . var_export($cfg, true) . ";\n";
            if (file_put_contents($temp, $bytes) !== strlen($bytes) || !chmod($temp, 0600)) throw new BadRequest('Could not write the config file.');
            $ctx->db->tx(function () use ($ctx, $owner, $temp, $file) {
                $ctx->db->put('users', $owner);
                if (!rename($temp, $file)) throw new BadRequest('Could not publish owner setup.');
            }, true);
        } finally { if (is_file($temp)) unlink($temp); }
        Config::load($cfg);
        start_session($ctx->db, $owner['id']);
        $ctx->db->audit($owner['id'], 'install', ['username' => $username]);
        return ['ok' => true, 'me' => public_user($owner), 'recoveryCode' => $code];
    } finally { flock($lock, LOCK_UN); fclose($lock); }
}
