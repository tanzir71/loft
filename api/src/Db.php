<?php
declare(strict_types=1);

namespace Loft;

use PDO;

/**
 * SQLite (WAL, busy_timeout 3000) holding the same documents as the browser's local adapter:
 * one `rows` table keyed by (table, id) with JSON, plus relational tables for the op-log, auth,
 * rate limits, files and the audit log. One logic, two runtimes: routes port line for line.
 */
final class Db
{
    public PDO $pdo;
    /** @var array<string, array<string, array<string, mixed>>> per-request read cache by table */
    private array $cache = [];

    public function __construct(string $path)
    {
        $this->pdo = new PDO('sqlite:' . $path, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        $this->pdo->exec('PRAGMA busy_timeout = 3000');
        if ($path !== ':memory:') $this->pdo->exec('PRAGMA journal_mode = WAL');
        $this->pdo->exec('PRAGMA foreign_keys = ON');
        $this->migrate();
    }

    public function migrate(): void
    {
        $this->pdo->exec('CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, at TEXT NOT NULL)');
        $done = $this->pdo->query('SELECT name FROM migrations')->fetchAll(PDO::FETCH_COLUMN);
        $files = glob(dirname(__DIR__) . '/migrations/*.sql') ?: [];
        sort($files);
        foreach ($files as $f) {
            $name = basename($f);
            if (in_array($name, $done, true)) continue;
            $this->pdo->exec((string) file_get_contents($f));
            $st = $this->pdo->prepare('INSERT INTO migrations (name, at) VALUES (?, ?)');
            $st->execute([$name, gmdate('c')]);
        }
    }

    /** @return array<string, mixed>|null */
    public function get(string $table, string $id): ?array
    {
        $st = $this->pdo->prepare('SELECT data FROM rows WHERE tbl = ? AND id = ?');
        $st->execute([$table, $id]);
        $json = $st->fetchColumn();
        return $json === false ? null : json_decode((string) $json, true);
    }

    /** @param array<string, mixed> $row */
    public function put(string $table, array $row): void
    {
        $id = (string) $row['id'];
        $st = $this->pdo->prepare('INSERT INTO rows (tbl, id, data) VALUES (?, ?, ?) ON CONFLICT(tbl, id) DO UPDATE SET data = excluded.data');
        $st->execute([$table, $id, json_encode($row, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)]);
        unset($this->cache[$table]);
    }

    /**
     * @param array<string, mixed> $patch
     * @return array<string, mixed>
     */
    public function patch(string $table, string $id, array $patch): array
    {
        return $this->update($table, $id, fn (array $cur) => array_merge($cur, $patch, ['id' => $id]));
    }

    private int $depth = 0;

    /**
     * Run $fn in one immediate transaction (nested calls join the outer one). PDO's inTransaction()
     * can't see a raw BEGIN on SQLite, so the depth is tracked here.
     * @template T
     * @param callable(): T $fn
     * @return T
     */
    public function tx(callable $fn, bool $fresh = false): mixed
    {
        if ($this->depth > 0) {
            $this->depth++;
            try {
                return $fn();
            } finally {
                $this->depth--;
            }
        }
        $this->pdo->exec('BEGIN IMMEDIATE');
        $this->depth = 1;
        if ($fresh) $this->clearCache();
        try {
            $out = $fn();
            $this->pdo->exec('COMMIT');
            return $out;
        } catch (\Throwable $e) {
            $this->pdo->exec('ROLLBACK');
            $this->clearCache();
            throw $e;
        } finally {
            $this->depth = 0;
        }
    }

    /**
     * Read-modify-write in one transaction so concurrent writers never lose updates.
     * @param callable(array<string, mixed>): array<string, mixed> $fn
     * @return array<string, mixed>
     */
    public function update(string $table, string $id, callable $fn): array
    {
        return $this->tx(function () use ($table, $id, $fn) {
            $cur = $this->get($table, $id);
            if ($cur === null) throw new NotFound("$table/$id not found");
            $next = $fn($cur);
            $next['id'] = $id;
            $this->put($table, $next);
            return $next;
        });
    }

    public function del(string $table, string $id): void
    {
        $st = $this->pdo->prepare('DELETE FROM rows WHERE tbl = ? AND id = ?');
        $st->execute([$table, $id]);
        unset($this->cache[$table]);
    }

    /**
     * Every row of a table, optionally filtered. Small teams by design: tables stay small.
     * @param (callable(array<string, mixed>): bool)|null $filter
     * @return list<array<string, mixed>>
     */
    public function list(string $table, ?callable $filter = null): array
    {
        if (!isset($this->cache[$table])) {
            $st = $this->pdo->prepare('SELECT data FROM rows WHERE tbl = ? ORDER BY id');
            $st->execute([$table]);
            $this->cache[$table] = array_map(fn ($j) => json_decode((string) $j, true), $st->fetchAll(PDO::FETCH_COLUMN));
        }
        $rows = $this->cache[$table];
        return $filter ? array_values(array_filter($rows, $filter)) : $rows;
    }

    /**
     * Append ops to a room's log; one immediate transaction serialises seq assignment.
     * @param list<array<string, mixed>> $ops
     * @return list<array<string, mixed>>
     */
    public function appendOps(string $roomId, array $ops): array
    {
        return $this->tx(function () use ($roomId, $ops) {
            $st = $this->pdo->prepare('SELECT COALESCE(MAX(seq), 0) FROM ops WHERE room_id = ?');
            $st->execute([$roomId]);
            $seq = (int) $st->fetchColumn();
            $ins = $this->pdo->prepare('INSERT INTO ops (room_id, seq, actor, ts, kind, payload) VALUES (?, ?, ?, ?, ?, ?)');
            $out = [];
            foreach ($ops as $o) {
                $seq++;
                $row = ['roomId' => $roomId, 'seq' => $seq, 'actor' => (string) ($o['actor'] ?? ''), 'ts' => (int) ($o['ts'] ?? now_ms()), 'kind' => (string) $o['kind'], 'payload' => $o['payload'] ?? null];
                $ins->execute([$roomId, $seq, $row['actor'], $row['ts'], $row['kind'], json_encode($row['payload'], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)]);
                $out[] = $row;
            }
            return $out;
        });
    }

    /** @return list<array<string, mixed>> */
    public function opsSince(string $roomId, int $since, int $limit = 2000): array
    {
        $st = $this->pdo->prepare('SELECT seq, actor, ts, kind, payload FROM ops WHERE room_id = ? AND seq > ? ORDER BY seq LIMIT ' . $limit);
        $st->execute([$roomId, $since]);
        return array_map(fn ($r) => ['roomId' => $roomId, 'seq' => (int) $r['seq'], 'actor' => $r['actor'], 'ts' => (int) $r['ts'], 'kind' => $r['kind'], 'payload' => json_decode((string) $r['payload'], true)], $st->fetchAll(PDO::FETCH_ASSOC));
    }

    public function getMeta(string $key): mixed
    {
        $st = $this->pdo->prepare('SELECT v FROM meta WHERE k = ?');
        $st->execute([$key]);
        $v = $st->fetchColumn();
        return $v === false ? null : json_decode((string) $v, true);
    }

    public function setMeta(string $key, mixed $value): void
    {
        $st = $this->pdo->prepare('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v');
        $st->execute([$key, json_encode($value)]);
    }

    /** Bump the change counter the app polls (`changes?since=`), remembering which tables moved. */
    public function changed(array $tables): int
    {
        $this->pdo->exec("INSERT INTO meta (k, v) VALUES ('version', '1') ON CONFLICT(k) DO UPDATE SET v = CAST(v AS INTEGER) + 1");
        $v = (int) $this->getMeta('version');
        $st = $this->pdo->prepare('INSERT INTO changes (version, tables, at) VALUES (?, ?, ?)');
        $st->execute([$v, implode(',', array_unique($tables)), now_ms()]);
        if ($v % 200 === 0) $this->pdo->exec('DELETE FROM changes WHERE version < ' . ($v - 1000));
        return $v;
    }

    /** @return array{version: int, tables: list<string>} */
    public function changesSince(int $since): array
    {
        $v = (int) ($this->getMeta('version') ?? 0);
        if ($since >= $v) return ['version' => $v, 'tables' => []];
        $st = $this->pdo->prepare('SELECT tables FROM changes WHERE version > ?');
        $st->execute([$since]);
        $tables = [];
        foreach ($st->fetchAll(PDO::FETCH_COLUMN) as $t) foreach (explode(',', (string) $t) as $x) if ($x !== '') $tables[$x] = true;
        return ['version' => $v, 'tables' => $since === 0 ? ['*'] : array_keys($tables)];
    }

    /** Token bucket (rate limits per IP and per agent seat). */
    public function takeToken(string $key, int $perMin, int $nowMs): bool
    {
        $st = $this->pdo->prepare('SELECT tokens, at FROM rate WHERE k = ?');
        $st->execute([$key]);
        $r = $st->fetch(PDO::FETCH_ASSOC);
        $tokens = $r ? min($perMin, (float) $r['tokens'] + (($nowMs - (int) $r['at']) / 60000) * $perMin) : $perMin;
        $ok = $tokens >= 1;
        $up = $this->pdo->prepare('INSERT INTO rate (k, tokens, at) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET tokens = excluded.tokens, at = excluded.at');
        $up->execute([$key, $ok ? $tokens - 1 : $tokens, $nowMs]);
        return $ok;
    }

    public function audit(string $actor, string $action, array $data = []): void
    {
        $st = $this->pdo->prepare('INSERT INTO audit (at, actor, action, data) VALUES (?, ?, ?, ?)');
        $st->execute([iso(now_ms()), $actor, $action, json_encode($data, JSON_UNESCAPED_SLASHES)]);
    }

    public function clearCache(): void
    {
        $this->cache = [];
    }
}
