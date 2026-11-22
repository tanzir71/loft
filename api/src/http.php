<?php
declare(strict_types=1);

namespace Loft;

// HTTP edge: parses the request, resolves the session, guards writes (JSON-only + same origin),
// rate-limits per IP, runs the route and maps errors to status codes.

const SESSION_COOKIE = 'loft_session';
const SESSION_DAYS = 30;

/** Special responses a route can return instead of JSON. */
final class Raw
{
    public function __construct(public string $body, public string $type = 'text/plain; charset=utf-8', public int $status = 200, public array $headers = [])
    {
    }
}
final class Redirect
{
    public function __construct(public string $to)
    {
    }
}
final class FileOut
{
    public function __construct(public string $path, public string $mime, public string $name)
    {
    }
}

function client_ip(): string
{
    return (string) ($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0');
}

function is_https(): bool
{
    return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
}

/** Session user id from the cookie (only hashes are stored). */
function session_user(Db $db): ?string
{
    $tok = $_COOKIE[SESSION_COOKIE] ?? '';
    if (!is_string($tok) || strlen($tok) < 32) return null;
    $st = $db->pdo->prepare('SELECT user_id, expires_at FROM auth_sessions WHERE token_hash = ?');
    $st->execute([hash('sha256', $tok)]);
    $r = $st->fetch(\PDO::FETCH_ASSOC);
    if (!$r || (string) $r['expires_at'] < iso(now_ms())) return null;
    return (string) $r['user_id'];
}

/** Start a session for a user and set the HttpOnly, SameSite=Lax cookie. */
function start_session(Db $db, string $userId): string
{
    $tok = bin2hex(random_bytes(32));
    $st = $db->pdo->prepare('INSERT INTO auth_sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)');
    $st->execute([hash('sha256', $tok), $userId, iso(now_ms()), iso(now_ms() + SESSION_DAYS * DAY)]);
    if (PHP_SAPI !== 'cli') {
        setcookie(SESSION_COOKIE, $tok, ['expires' => time() + SESSION_DAYS * 86400, 'path' => '/', 'secure' => is_https(), 'httponly' => true, 'samesite' => 'Lax']);
    }
    $GLOBALS['loft_session_token'] = $tok;
    return $tok;
}

function end_session(Db $db): void
{
    $tok = $_COOKIE[SESSION_COOKIE] ?? '';
    if (is_string($tok) && $tok !== '') {
        $st = $db->pdo->prepare('DELETE FROM auth_sessions WHERE token_hash = ?');
        $st->execute([hash('sha256', $tok)]);
    }
    if (PHP_SAPI !== 'cli') setcookie(SESSION_COOKIE, '', ['expires' => time() - 3600, 'path' => '/', 'secure' => is_https(), 'httponly' => true, 'samesite' => 'Lax']);
}

/** The resource path after /api/v1/ (or "a/<token>/…" for agent links). */
function resource_path(): string
{
    $uri = (string) parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH);
    if (isset($_GET['__agent'])) return 'a/' . trim((string) $_GET['__agent'], '/');
    if (preg_match('#/a/(.+)$#', $uri, $m) && !str_contains($uri, '/api/v1/')) return 'a/' . trim($m[1], '/');
    if (preg_match('#/api/v1/(.*)$#', $uri, $m)) return trim($m[1], '/');
    if (preg_match('#/api/(.*)$#', $uri, $m)) return trim($m[1], '/');
    return trim($uri, '/');
}

function serve(): void
{
    $method = $_SERVER['REQUEST_METHOD'] === 'POST' ? 'POST' : 'GET';
    $resource = resource_path();
    $isAgent = str_starts_with($resource, 'a/');
    try {
        if (!installed() && !str_starts_with($resource, 'install')) json_out(['error' => 'Loft is not installed yet', 'install' => true], 503);
        $db = db();
        $input = $method === 'GET' ? $_GET : [];
        unset($input['__agent']);
        if ($method === 'POST') {
            $type = (string) ($_SERVER['CONTENT_TYPE'] ?? '');
            if (str_starts_with($type, 'multipart/form-data')) $input = $_POST;
            else {
                // JSON only: forms from other sites can't send it without a CORS preflight (CSRF guard).
                if (!$isAgent && !str_starts_with($type, 'application/json')) json_out(['error' => 'Send JSON'], 415);
                $raw = (string) file_get_contents('php://input');
                $input = $raw === '' ? [] : (array) json_decode($raw, true);
            }
            $origin = (string) ($_SERVER['HTTP_ORIGIN'] ?? '');
            $expectedOrigin = (is_https() ? 'https' : 'http') . '://' . ($_SERVER['HTTP_HOST'] ?? '');
            if (!$isAgent && $origin !== '' && strtolower(rtrim($origin, '/')) !== strtolower($expectedOrigin)) json_out(['error' => 'Cross-site request refused'], 403);
            if (!$db->takeToken('ip:' . client_ip(), 240, now_ms())) json_out(['error' => 'Too many requests. Slow down a little.'], 429);
        }
        if ($isAgent) {
            $input['agent'] = ['userAgent' => (string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 'name' => (string) ($_SERVER['HTTP_X_AGENT_NAME'] ?? '')];
        }
        $ctx = new Ctx($db, $isAgent ? null : session_user($db), client_ip(), (string) Config::get('app_url', ''));
        $out = routes()->call($ctx, $method, $resource, $input);
        respond($out, $isAgent);
    } catch (AgentError $e) {
        json_out(['error' => $e->getMessage(), 'status' => $e->status], $e->status);
    } catch (Unauthorized $e) {
        json_out(['error' => $e->getMessage()], 401);
    } catch (NotFound $e) {
        json_out(['error' => $e->getMessage()], 404);
    } catch (Forbidden $e) {
        json_out(['error' => $e->getMessage()], 403);
    } catch (BadRequest | \InvalidArgumentException | \DomainException $e) {
        json_out(['error' => $e->getMessage()], 400);
    } catch (\Throwable $e) {
        error_log('[loft] ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
        // Validation errors are thrown as plain exceptions by ported routes: show their message.
        $plain = get_class($e) === 'Exception' || get_class($e) === 'RuntimeException';
        json_out(['error' => $plain ? $e->getMessage() : 'Something went wrong on the server'], $plain ? 400 : 500);
    }
}

function respond(mixed $out, bool $isAgent): never
{
    if ($out instanceof Redirect) {
        header('Location: ' . $out->to, true, 302);
        exit;
    }
    if ($out instanceof Raw) {
        http_response_code($out->status);
        header('Content-Type: ' . $out->type);
        foreach ($out->headers as $k => $v) header("$k: $v");
        echo $out->body;
        exit;
    }
    if ($out instanceof FileOut) {
        header('Content-Type: ' . $out->mime);
        header('Content-Length: ' . (string) filesize($out->path));
        header('Content-Disposition: inline; filename="' . str_replace('"', '', $out->name) . '"');
        header('Cache-Control: private, max-age=86400');
        readfile($out->path);
        exit;
    }
    // Agent protocol errors come back from routes as {error, status}; next.md is Markdown.
    if ($isAgent && is_array($out) && isset($out['error'], $out['status'])) json_out($out, (int) $out['status']);
    if ($isAgent && is_array($out) && array_keys($out) === ['markdown']) {
        http_response_code(200);
        header('Content-Type: text/markdown; charset=utf-8');
        echo $out['markdown'];
        exit;
    }
    json_out($out);
}
