<?php
declare(strict_types=1);

namespace Loft;

/** Settings written by the install wizard into data/config.php (never committed). */
final class Config
{
    /** @var array<string, mixed> */
    private static array $values = [];

    public static function load(array $values): void
    {
        self::$values = $values;
    }

    public static function get(string $key, mixed $default = null): mixed
    {
        return self::$values[$key] ?? $default;
    }

    public static function all(): array
    {
        return self::$values;
    }
}

/** The request context every route gets (the PHP twin of the TS LocalCtx). */
final class Ctx
{
    /** @var list<string> */
    private array $touched = [];

    public function __construct(public Db $db, public ?string $meId, public string $ip = '0.0.0.0', public ?string $baseUrl = null)
    {
    }

    public function now(): int
    {
        return now_ms();
    }

    public function nowIso(): string
    {
        return iso(now_ms());
    }

    /** Tell polling clients which tables changed. */
    public function changed(string ...$tables): void
    {
        array_push($this->touched, ...$tables);
    }

    public function opsChanged(string $roomId): void
    {
        $this->touched[] = "ops:$roomId";
    }

    public function flush(): void
    {
        if ($this->touched) $this->db->changed($this->touched);
        $this->touched = [];
    }

    /** Absolute app URL for links in emails ("/pay/x" → https://host/spaces/#/pay/x). */
    public function appUrl(string $path): string
    {
        $base = rtrim((string) ($this->baseUrl ?? Config::get('app_url', '')), '/');
        return $base . '/#' . $path;
    }
}

/** Resource router shared by every module (same patterns as packages/data/src/router.ts). */
final class Router
{
    /** @var list<array{method: string, parts: list<string>, handler: callable}> */
    private array $routes = [];

    public function get(string $pattern, callable $handler): self
    {
        $this->routes[] = ['method' => 'GET', 'parts' => explode('/', $pattern), 'handler' => $handler];
        return $this;
    }

    public function post(string $pattern, callable $handler): self
    {
        $this->routes[] = ['method' => 'POST', 'parts' => explode('/', $pattern), 'handler' => $handler];
        return $this;
    }

    /** @return array{handler: callable, params: array<string, string>}|null */
    public function match(string $method, string $resource): ?array
    {
        $parts = explode('/', trim($resource, '/'));
        foreach ($this->routes as $r) {
            if ($r['method'] !== $method || count($r['parts']) !== count($parts)) continue;
            $params = [];
            $ok = true;
            foreach ($parts as $i => $got) {
                $want = $r['parts'][$i];
                if (str_starts_with($want, ':')) $params[substr($want, 1)] = rawurldecode($got);
                elseif ($want !== $got) {
                    $ok = false;
                    break;
                }
            }
            if ($ok) return ['handler' => $r['handler'], 'params' => $params];
        }
        return null;
    }

    /** Run a resource directly (tests and the front controller). */
    public function call(Ctx $ctx, string $method, string $resource, array $input = []): mixed
    {
        $m = $this->match($method, $resource);
        if (!$m) throw new NotFound("$method $resource");
        $out = ($m['handler'])($ctx, $m['params'], $input);
        $ctx->flush();
        return $out;
    }
}

/** The single router; modules register on it when loaded. */
function routes(): Router
{
    static $r = null;
    return $r ??= new Router();
}

/** The signed-in user or 404 "Not signed in" (TS requireMe). */
function require_me(Ctx $ctx): array
{
    $me = $ctx->meId ? $ctx->db->get('users', $ctx->meId) : null;
    if (!$me) throw new Unauthorized('Not signed in');
    return $me;
}
