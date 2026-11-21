<?php
declare(strict_types=1);

// Plain PHP test runner (no PHPUnit): php api/tests/run.php [filter]

namespace Loft;

$tmp = sys_get_temp_dir() . '/loft-tests-' . getmypid();
@mkdir($tmp, 0700, true);
putenv("LOFT_DATA=$tmp");
require __DIR__ . '/../src/bootstrap.php';

const TEST_CONFIG = ['installed' => true, 'timezone' => 'UTC', 'mail_mode' => 'log', 'app_url' => 'https://example.test/spaces/', 'owner_email' => 'owner@example.test'];
Config::load(TEST_CONFIG);

$GLOBALS['loft_tests'] = [];
function test(string $name, callable $fn): void
{
    $GLOBALS['loft_tests'][] = [$name, $fn];
}

final class Failure extends \Exception {}

function fail(string $msg): never
{
    throw new Failure($msg);
}

function export(mixed $v): string
{
    return json_encode($v, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) ?: var_export($v, true);
}

function eq(mixed $actual, mixed $expected, string $msg = ''): void
{
    if ($actual !== $expected) fail(($msg ? "$msg: " : '') . 'expected ' . export($expected) . ', got ' . export($actual));
}

function ok(mixed $cond, string $msg = 'expected true'): void
{
    if (!$cond) fail($msg);
}

function contains(string $haystack, string $needle): void
{
    if (!str_contains($haystack, $needle)) fail('expected ' . export($haystack) . ' to contain ' . export($needle));
}

function throws(callable $fn, string $pattern = '//', ?string $class = null): void
{
    try {
        $fn();
    } catch (Failure $f) {
        throw $f;
    } catch (\Throwable $e) {
        if ($class && !($e instanceof $class)) fail("expected $class, got " . get_class($e) . ': ' . $e->getMessage());
        if (!preg_match($pattern, $e->getMessage())) fail('error ' . export($e->getMessage()) . " doesn't match $pattern");
        return;
    }
    fail('expected an exception');
}

/** A fresh in-memory database for each test. */
function fresh(): Db
{
    Config::load(TEST_CONFIG);
    unset($GLOBALS['loft_now']);
    $GLOBALS['loft_mail'] = [];
    // Tests never reach a real provider: requests are logged and get no answer unless a test scripts one.
    $GLOBALS['loft_http_log'] = [];
    $GLOBALS['loft_http'] = function (string $method, string $url, array $headers, ?array $body): array {
        $GLOBALS['loft_http_log'][] = ['method' => $method, 'url' => $url, 'headers' => $headers, 'body' => $body];
        return ['status' => 0, 'json' => null];
    };
    return new Db(':memory:');
}

/** Call a resource as a user (or anonymously). */
function call(Db $db, ?string $me, string $method, string $resource, array $input = []): mixed
{
    $db->clearCache();
    return routes()->call(new Ctx($db, $me), $method, $resource, $input);
}

/** Insert documents quickly: put($db, 'users', [...], [...]). */
function put(Db $db, string $table, array ...$rows): void
{
    foreach ($rows as $r) $db->put($table, $r);
}

/** A host with one space and members (the smallest useful fixture). */
function fixture(Db $db, string $mode = 'course', array $members = ['u_a' => 'member', 'u_b' => 'member']): array
{
    $now = iso(now_ms());
    put($db, 'users', ['id' => 'u_host', 'name' => 'Nusrat Rahman', 'email' => 'host@example.test', 'tz' => 'UTC', 'status' => 'available', 'createdAt' => $now]);
    foreach ($members as $uid => $_) put($db, 'users', ['id' => $uid, 'name' => ucfirst(substr($uid, 2)) . ' Member', 'email' => substr($uid, 2) . '@example.test', 'tz' => 'UTC', 'status' => 'available', 'createdAt' => $now]);
    put($db, 'spaces', ['id' => 'sp_1', 'orgId' => null, 'mode' => $mode, 'code' => 'PHY', 'name' => 'Physics', 'sub' => 'Course', 'slug' => 'physics', 'colour' => 'teal', 'roomSlug' => 'physics', 'createdAt' => $now, 'createdBy' => 'u_host']);
    put($db, 'memberships', ['id' => 'sp_1:u_host', 'spaceId' => 'sp_1', 'userId' => 'u_host', 'role' => 'host', 'lastReadAt' => $now]);
    foreach ($members as $uid => $role) put($db, 'memberships', ['id' => "sp_1:$uid", 'spaceId' => 'sp_1', 'userId' => $uid, 'role' => $role, 'lastReadAt' => $now]);
    return ['host' => 'u_host', 'space' => 'sp_1'];
}

foreach (glob(__DIR__ . '/*_test.php') ?: [] as $f) require $f;

$filter = $argv[1] ?? '';
$pass = 0;
$failed = [];
foreach ($GLOBALS['loft_tests'] as [$name, $fn]) {
    if ($filter !== '' && !str_contains($name, $filter)) continue;
    try {
        $fn();
        $pass++;
        echo "  ✓ $name\n";
    } catch (\Throwable $e) {
        $failed[] = $name;
        echo "  ✗ $name\n    " . get_class($e) . ': ' . $e->getMessage() . "\n    at " . $e->getFile() . ':' . $e->getLine() . "\n";
        if (!($e instanceof Failure)) echo '    ' . str_replace("\n", "\n    ", $e->getTraceAsString()) . "\n";
    }
}
echo "\n" . $pass . ' passed' . ($failed ? ', ' . count($failed) . ' failed' : '') . "\n";
array_map('unlink', glob("$tmp/*") ?: []);
exit($failed ? 1 : 0);
