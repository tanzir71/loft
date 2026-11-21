<?php
declare(strict_types=1);

namespace Loft;

// System resources that only exist on the server: sign-in links, change polling, the op-log over
// HTTP, uploads, the install wizard, the owner console (branding toggle + paid-until), the
// organisations contact form and the private calendar feed.

/** mail() in production; data/mail.log when `mail_mode` is "log" (dev, CI). */
function send_mail(string $to, string $subject, string $body, array $attachments = []): bool
{
    $from = (string) Config::get('mail_from', 'loft@' . ($_SERVER['HTTP_HOST'] ?? 'localhost'));
    if (Config::get('mail_mode') === 'log' || PHP_SAPI === 'cli') {
        @file_put_contents(data_dir() . '/mail.log', sprintf("[%s] To: %s\nSubject: %s\n\n%s\n\n", iso(now_ms()), $to, $subject, $body), FILE_APPEND);
        $GLOBALS['loft_mail'][] = ['to' => $to, 'subject' => $subject, 'body' => $body];
        return true;
    }
    $headers = ["From: Loft <$from>", 'MIME-Version: 1.0'];
    if (!$attachments) {
        $headers[] = 'Content-Type: text/plain; charset=utf-8';
        return @mail($to, '=?UTF-8?B?' . base64_encode($subject) . '?=', $body, implode("\r\n", $headers));
    }
    $b = 'loft' . bin2hex(random_bytes(8));
    $headers[] = "Content-Type: multipart/mixed; boundary=\"$b\"";
    $msg = "--$b\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n$body\r\n";
    foreach ($attachments as $a) {
        $msg .= "--$b\r\nContent-Type: {$a['type']}; name=\"{$a['name']}\"\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: attachment; filename=\"{$a['name']}\"\r\n\r\n" . chunk_split(base64_encode($a['body'])) . "\r\n";
    }
    $msg .= "--$b--";
    return @mail($to, '=?UTF-8?B?' . base64_encode($subject) . '?=', $msg, implode("\r\n", $headers));
}

function owner_id(): ?string
{
    return Config::get('owner_user_id') ?: null;
}

function require_owner(Ctx $ctx): array
{
    $me = require_me($ctx);
    if ($me['id'] !== owner_id()) throw new Forbidden('Only the owner can do that');
    return $me;
}

/** Branding is active while today ≤ branded_until + 14 days (handoff §7.4). */
function branding_active(?array $org, int $now): bool
{
    if (!$org || empty($org['branded']) || empty($org['brandedUntil'])) return false;
    return ms((string) $org['brandedUntil']) + 14 * DAY >= $now;
}

/** The organisation a host owns (created on first use). */
function org_for_host(Ctx $ctx, array $host): array
{
    $org = find($ctx->db->list('orgs'), fn ($o) => ($o['hostId'] ?? '') === $host['id']);
    if ($org) return $org;
    $base = slugify((string) $host['name']) ?: 'org';
    $slug = $base;
    for ($i = 2; find($ctx->db->list('orgs'), fn ($o) => $o['slug'] === $slug); $i++) $slug = "$base-$i";
    $org = ['id' => new_id('org'), 'hostId' => $host['id'], 'slug' => $slug, 'name' => (string) $host['name'], 'branded' => false, 'brandedUntil' => null, 'note' => '', 'theme' => 'loft', 'monogram' => strtoupper(substr((string) $host['name'], 0, 1)), 'createdAt' => $ctx->nowIso()];
    $ctx->db->put('orgs', $org);
    return $org;
}

function public_user(array $u): array
{
    unset($u['passwordHash']);
    return $u;
}

routes()
    // ---- sign-in links (32-byte token, single use, 15 minutes) ----
    ->post('auth/link', function (Ctx $ctx, array $p, array $in) {
        $email = strtolower(str($in['email'] ?? '', 200));
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) throw new BadRequest('Enter a valid email address');
        if (!$ctx->db->takeToken('link:' . $ctx->ip, 5, $ctx->now()) || !$ctx->db->takeToken('link:' . $email, 3, $ctx->now())) throw new BadRequest('Too many sign-in links. Try again in a minute.');
        $user = find($ctx->db->list('users'), fn ($u) => strtolower((string) ($u['email'] ?? '')) === $email);
        if (!$user) {
            $name = ucwords(str_replace(['.', '_', '-'], ' ', explode('@', $email)[0]));
            $user = ['id' => new_id('u'), 'name' => $name, 'email' => $email, 'tz' => (string) Config::get('timezone', 'UTC'), 'status' => 'available', 'createdAt' => $ctx->nowIso()];
            $ctx->db->put('users', $user);
        }
        $tok = bin2hex(random_bytes(32));
        $st = $ctx->db->pdo->prepare('INSERT INTO login_links (token_hash, email, created_at, expires_at) VALUES (?, ?, ?, ?)');
        $st->execute([hash('sha256', $tok), $email, $ctx->nowIso(), iso($ctx->now() + 15 * 60000)]);
        $api = rtrim((string) Config::get('api_url', rtrim((string) Config::get('app_url', ''), '/') . '/api/v1'), '/');
        send_mail($email, 'Your Loft sign-in link', "Hi " . first_name((string) $user['name']) . ",\n\nOpen this link to sign in to Loft (it works once, for 15 minutes):\n\n$api/auth/callback?token=$tok\n\nIf you didn't ask for it, you can ignore this email.");
        return ['ok' => true];
    })
    ->get('auth/callback', function (Ctx $ctx, array $p, array $in) {
        $tok = str($in['token'] ?? '', 200);
        $app = rtrim((string) Config::get('app_url', '/spaces/'), '/') . '/';
        $st = $ctx->db->pdo->prepare('SELECT email, expires_at, used_at FROM login_links WHERE token_hash = ?');
        $st->execute([hash('sha256', $tok)]);
        $r = $st->fetch(\PDO::FETCH_ASSOC);
        if (!$r || $r['used_at'] || (string) $r['expires_at'] < $ctx->nowIso()) return new Redirect($app . '#/signin?error=expired');
        $ctx->db->pdo->prepare('UPDATE login_links SET used_at = ? WHERE token_hash = ?')->execute([$ctx->nowIso(), hash('sha256', $tok)]);
        $user = find($ctx->db->list('users'), fn ($u) => strtolower((string) ($u['email'] ?? '')) === $r['email']);
        if (!$user) return new Redirect($app . '#/signin?error=expired');
        start_session($ctx->db, $user['id']);
        $ctx->db->patch('users', $user['id'], ['lastLoginAt' => $ctx->nowIso(), 'lastSeenAt' => $ctx->nowIso()]);
        return new Redirect($app);
    })
    ->post('auth/password', function (Ctx $ctx, array $p, array $in) {
        $email = strtolower(str($in['email'] ?? '', 200));
        if (!$ctx->db->takeToken('pw:' . $ctx->ip, 10, $ctx->now())) throw new BadRequest('Too many attempts. Try again in a minute.');
        $user = find($ctx->db->list('users'), fn ($u) => strtolower((string) ($u['email'] ?? '')) === $email);
        if (!$user || empty($user['passwordHash']) || !password_verify((string) ($in['password'] ?? ''), (string) $user['passwordHash'])) throw new Forbidden('Email or password is wrong');
        start_session($ctx->db, $user['id']);
        return public_user($user);
    })
    ->post('auth/password/set', function (Ctx $ctx, array $p, array $in) {
        $me = require_me($ctx);
        $pw = (string) ($in['password'] ?? '');
        if (strlen($pw) < 10) throw new BadRequest('Use at least 10 characters');
        $ctx->db->patch('users', $me['id'], ['passwordHash' => password_hash($pw, PASSWORD_DEFAULT)]);
        return ['ok' => true];
    })
    ->post('auth/signout', function (Ctx $ctx) {
        end_session($ctx->db);
        return ['ok' => true];
    })
    // ---- polling instead of WebSockets ----
    ->get('changes', function (Ctx $ctx, array $p, array $in) {
        return $ctx->db->changesSince((int) ($in['since'] ?? 0));
    })
    // ---- the op-log over HTTP (poll 1–2 s) ----
    ->get('rooms/:id/ops', function (Ctx $ctx, array $p, array $in) {
        require_me($ctx);
        if (!$ctx->db->get('rooms', $p['id'])) throw new NotFound('Room not found');
        return $ctx->db->opsSince($p['id'], (int) ($in['since'] ?? 0));
    })
    ->post('rooms/:id/ops', function (Ctx $ctx, array $p, array $in) {
        $me = require_me($ctx);
        $room = $ctx->db->get('rooms', $p['id']);
        if (!$room) throw new NotFound('Room not found');
        if (!empty($room['endedAt'])) throw new Forbidden('This session has ended');
        $ops = array_slice(is_array($in['ops'] ?? null) ? $in['ops'] : [], 0, 500);
        $clean = array_map(fn ($o) => ['actor' => $me['id'], 'ts' => (int) ($o['ts'] ?? $ctx->now()), 'kind' => (string) ($o['kind'] ?? 'update'), 'payload' => $o['payload'] ?? null], $ops);
        $out = $ctx->db->appendOps($p['id'], $clean);
        $ctx->opsChanged($p['id']);
        return $out;
    })
    // ---- files: sha-256 dedupe, bytes outside the web root ----
    ->post('files', function (Ctx $ctx, array $p, array $in) {
        $me = require_me($ctx);
        $f = $_FILES['file'] ?? null;
        if (!$f || ($f['error'] ?? 1) !== UPLOAD_ERR_OK) throw new BadRequest('Upload failed');
        $max = (int) Config::get('upload_max_mb', 20) * 1024 * 1024;
        if ((int) $f['size'] > $max) throw new BadRequest('That file is too big');
        $sha = hash_file('sha256', (string) $f['tmp_name']);
        $dir = data_dir() . '/files';
        if (!is_dir($dir)) mkdir($dir, 0700, true);
        $mime = (string) (mime_content_type((string) $f['tmp_name']) ?: 'application/octet-stream');
        if (!is_file("$dir/$sha")) move_uploaded_file((string) $f['tmp_name'], "$dir/$sha");
        $ctx->db->pdo->prepare('INSERT OR IGNORE INTO blobs (sha256, mime, bytes, created_at) VALUES (?, ?, ?, ?)')->execute([$sha, $mime, (int) $f['size'], $ctx->nowIso()]);
        $name = str((string) ($f['name'] ?? 'file'), 200) ?: 'file';
        $row = ['id' => new_id('f'), 'sha256' => $sha, 'name' => $name, 'mime' => $mime, 'size' => (int) $f['size'], 'ownerId' => $me['id'], 'spaceId' => str($in['spaceId'] ?? '', 80) ?: null, 'createdAt' => $ctx->nowIso()];
        $ctx->db->put('files', $row);
        $ctx->changed('files');
        return $row;
    })
    ->get('files/:id', function (Ctx $ctx, array $p) {
        $me = require_me($ctx);
        $f = $ctx->db->get('files', $p['id']);
        if (!$f) throw new NotFound('File not found');
        if (!empty($f['spaceId']) && !$ctx->db->get('memberships', $f['spaceId'] . ':' . $me['id']) && $f['ownerId'] !== $me['id']) throw new Forbidden("You're not in this space");
        $path = data_dir() . '/files/' . $f['sha256'];
        if (!is_file($path)) throw new NotFound('File missing');
        return new FileOut($path, (string) $f['mime'], (string) $f['name']);
    })
    // ---- install wizard (first run only) ----
    ->get('install', function () {
        $dir = data_dir();
        $checks = [
            ['PHP 8.1 or newer', PHP_VERSION_ID >= 80100, PHP_VERSION],
            ['PDO SQLite', extension_loaded('pdo_sqlite'), ''],
            ['OpenSSL', extension_loaded('openssl'), ''],
            ['Sodium', extension_loaded('sodium'), ''],
            ['cURL', extension_loaded('curl'), ''],
            ['Data folder is writable', (is_dir($dir) || @mkdir($dir, 0700, true)) && is_writable($dir), $dir],
        ];
        return ['installed' => installed(), 'checks' => array_map(fn ($c) => ['name' => $c[0], 'ok' => $c[1], 'detail' => $c[2]], $checks), 'timezone' => date_default_timezone_get()];
    })
    ->post('install', function (Ctx $ctx, array $p, array $in) {
        if (installed()) throw new Forbidden('Loft is already installed');
        $email = strtolower(str($in['email'] ?? '', 200));
        $name = str($in['name'] ?? '', 80);
        if (!filter_var($email, FILTER_VALIDATE_EMAIL) || $name === '') throw new BadRequest('Enter your name and email');
        $tz = str($in['timezone'] ?? 'UTC', 64);
        if (!in_array($tz, \DateTimeZone::listIdentifiers(), true)) $tz = 'UTC';
        $appUrl = rtrim(str($in['appUrl'] ?? '', 300), '/') . '/';
        $owner = ['id' => new_id('u'), 'name' => $name, 'email' => $email, 'tz' => $tz, 'status' => 'available', 'createdAt' => $ctx->nowIso()];
        $ctx->db->put('users', $owner);
        $cfg = ['installed' => true, 'owner_user_id' => $owner['id'], 'owner_email' => $email, 'app_url' => $appUrl, 'timezone' => $tz, 'mail_from' => str($in['mailFrom'] ?? '', 200) ?: $email, 'key' => base64_encode(random_bytes(32)), 'installed_at' => $ctx->nowIso()];
        $file = data_dir() . '/config.php';
        if (file_put_contents($file, "<?php\n// Written by the Loft install wizard. Keep this file private; never commit it.\nreturn " . var_export($cfg, true) . ";\n") === false) throw new BadRequest('Could not write the config file');
        @chmod($file, 0600);
        Config::load($cfg);
        start_session($ctx->db, $owner['id']);
        $ctx->db->audit($owner['id'], 'install', ['email' => $email]);
        return ['ok' => true, 'me' => $owner];
    })
    // ---- owner console (/spaces/owner) ----
    ->get('owner', function (Ctx $ctx) {
        require_owner($ctx);
        $users = index_by($ctx->db->list('users'), fn ($u) => $u['id']);
        $hosts = [];
        foreach ($ctx->db->list('memberships', fn ($m) => $m['role'] === 'host') as $m) $hosts[$m['userId']][] = $m['spaceId'];
        $orgs = [];
        foreach ($hosts as $hid => $spaceIds) {
            if (!isset($users[$hid])) continue;
            $org = org_for_host($ctx, $users[$hid]);
            $members = count(array_unique(array_map(fn ($m) => $m['userId'], $ctx->db->list('memberships', fn ($m) => in_array($m['spaceId'], $spaceIds, true)))));
            $orgs[] = $org + ['hostName' => $users[$hid]['name'], 'hostEmail' => $users[$hid]['email'] ?? '', 'spaces' => count($spaceIds), 'members' => $members, 'active' => branding_active($org, $ctx->now()), 'lastSeenAt' => $users[$hid]['lastSeenAt'] ?? null];
        }
        $st = $ctx->db->pdo->query("SELECT at, actor, action, data FROM audit WHERE action LIKE 'branding%' OR action = 'install' ORDER BY id DESC LIMIT 50");
        $log = array_map(fn ($r) => ['at' => $r['at'], 'actor' => $users[$r['actor']]['name'] ?? $r['actor'], 'action' => $r['action'], 'data' => json_decode((string) $r['data'], true)], $st->fetchAll(\PDO::FETCH_ASSOC));
        $contacts = sorted($ctx->db->list('contact_messages'), fn ($a, $b) => strcmp($b['createdAt'], $a['createdAt']));
        return ['orgs' => sorted($orgs, fn ($a, $b) => strcmp($a['name'], $b['name'])), 'log' => $log, 'contacts' => array_slice($contacts, 0, 20), 'version' => Config::get('version', 'dev')];
    })
    ->post('owner/orgs/:id', function (Ctx $ctx, array $p, array $in) {
        $me = require_owner($ctx);
        $org = $ctx->db->get('orgs', $p['id']);
        if (!$org) throw new NotFound('Organisation not found');
        $patch = [];
        if (array_key_exists('branded', $in)) $patch['branded'] = (bool) $in['branded'];
        if (array_key_exists('brandedUntil', $in)) $patch['brandedUntil'] = $in['brandedUntil'] ? substr(str($in['brandedUntil'], 10), 0, 10) : null;
        if (array_key_exists('note', $in)) $patch['note'] = str($in['note'], 500);
        $next = $ctx->db->patch('orgs', $org['id'], $patch);
        $ctx->db->audit($me['id'], 'branding', ['org' => $org['name'], 'branded' => $next['branded'], 'until' => $next['brandedUntil'], 'note' => $next['note']]);
        $ctx->changed('orgs');
        return $next + ['active' => branding_active($next, $ctx->now())];
    })
    // ---- the host's brand (Brand studio) ----
    ->get('brand', function (Ctx $ctx) {
        $me = require_me($ctx);
        $org = org_for_host($ctx, $me);
        return ['org' => $org, 'active' => branding_active($org, $ctx->now()), 'ownerEmail' => Config::get('owner_email', ''), 'link' => rtrim((string) Config::get('app_url', ''), '/') . '/' . $org['slug']];
    })
    ->post('brand', function (Ctx $ctx, array $p, array $in) {
        $me = require_me($ctx);
        $org = org_for_host($ctx, $me);
        if (!branding_active($org, $ctx->now())) throw new Forbidden('Branding is off for this organisation');
        $patch = [];
        if (isset($in['name'])) $patch['name'] = str($in['name'], 60) ?: $org['name'];
        if (isset($in['monogram'])) $patch['monogram'] = strtoupper(str($in['monogram'], 2)) ?: $org['monogram'];
        if (isset($in['theme']) && in_array($in['theme'], ['loft', 'sunrise', 'northwind', 'aurelian'], true)) $patch['theme'] = $in['theme'];
        $next = $ctx->db->patch('orgs', $org['id'], $patch);
        $ctx->changed('orgs');
        return $next;
    })
    // ---- organisations contact form (landing) ----
    ->post('contact', function (Ctx $ctx, array $p, array $in) {
        if (!$ctx->db->takeToken('contact:' . $ctx->ip, 5, $ctx->now())) throw new BadRequest('Too many messages. Try again later.');
        $email = strtolower(str($in['admin_email'] ?? ($in['email'] ?? ''), 200));
        $org = str($in['organisation'] ?? '', 120);
        if ($org === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) throw new BadRequest('Add your organisation and an email');
        $row = ['id' => new_id('cm'), 'organisation' => $org, 'website' => str($in['website'] ?? '', 200), 'country' => str($in['country'] ?? '', 80), 'people' => str($in['people'] ?? '', 40), 'period' => str($in['period'] ?? '', 20), 'email' => $email, 'createdAt' => $ctx->nowIso()];
        $ctx->db->put('contact_messages', $row);
        if ($to = Config::get('owner_email')) send_mail((string) $to, "Branded loft for $org", "Organisation: $org\nWebsite: {$row['website']}\nCountry: {$row['country']}\nPeople: {$row['people']}\nPeriod: {$row['period']}\nAdmin email: $email");
        return ['ok' => true];
    })
    // ---- private calendar feed: GET /ics/<token>.ics ----
    ->get('ics/:file', function (Ctx $ctx, array $p) {
        $token = preg_replace('/\.ics$/', '', $p['file']);
        $av = find($ctx->db->list('availability'), fn ($a) => ($a['feedToken'] ?? '') !== '' && hash_equals((string) $a['feedToken'], (string) $token));
        if (!$av) throw new NotFound('Unknown calendar feed');
        $feed = routes()->call(new Ctx($ctx->db, $av['id'], $ctx->ip), 'GET', 'feed');
        return new Raw((string) $feed['text'], 'text/calendar; charset=utf-8', 200, ['Content-Disposition' => 'inline; filename="loft.ics"']);
    });
