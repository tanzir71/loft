<?php
declare(strict_types=1);

namespace Loft;

// Shared helpers: time, ids, strings, money. Ported from packages/core (ids.ts, time.ts, money.ts).

class NotFound extends \RuntimeException {}
class Forbidden extends \RuntimeException {}
/** Not signed in (HTTP 401). */
class Unauthorized extends NotFound {}
/** Agent-link errors carry their HTTP status (handoff §12). */
class AgentError extends \RuntimeException
{
    public function __construct(string $message, public int $status)
    {
        parent::__construct($message);
    }
}
/** A plain validation error shown to the user (HTTP 400). */
class BadRequest extends \RuntimeException {}

const DAY = 86400000;
const ID_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const ROOM_CAPACITY = 12;

/** Milliseconds since the epoch (tests can freeze the clock with $GLOBALS['loft_now']). */
function now_ms(): int
{
    if (isset($GLOBALS['loft_now'])) return (int) $GLOBALS['loft_now'];
    return (int) floor(microtime(true) * 1000);
}

/** JS-compatible ISO string: 2026-11-21T08:00:00.000Z (string order = time order). */
function iso(int $ms): string
{
    $s = intdiv($ms, 1000);
    $frac = $ms - $s * 1000;
    if ($frac < 0) {
        $s -= 1;
        $frac += 1000;
    }
    return gmdate('Y-m-d\TH:i:s', $s) . sprintf('.%03dZ', $frac);
}

/** Parse an ISO string (or anything strtotime understands) to ms; NaN-safe: returns 0. */
function ms(?string $iso): int
{
    if ($iso === null || $iso === '') return 0;
    try {
        $d = new \DateTimeImmutable($iso);
        return (int) $d->format('U') * 1000 + (int) $d->format('v');
    } catch (\Throwable) {
        return 0;
    }
}

function rand_from(string $alphabet, int $n): string
{
    $out = '';
    $bytes = random_bytes($n);
    for ($i = 0; $i < $n; $i++) $out .= $alphabet[ord($bytes[$i]) % strlen($alphabet)];
    return $out;
}

function new_id(string $prefix = ''): string
{
    $s = rand_from(ID_ALPHABET, 16);
    return $prefix !== '' ? "{$prefix}_{$s}" : $s;
}

/** Time-sortable id: 9-char base36 ms + 3-char counter + 8 random chars (same layout as the TS one). */
function sortable_id(string $prefix = ''): string
{
    static $last = 0, $counter = 0;
    $now = now_ms();
    if ($now === $last) $counter++;
    else {
        $last = $now;
        $counter = 0;
    }
    $id = str_pad(base_convert((string) $now, 10, 36), 9, '0', STR_PAD_LEFT) . str_pad(base_convert((string) $counter, 10, 36), 3, '0', STR_PAD_LEFT) . rand_from(ID_ALPHABET, 8);
    return $prefix !== '' ? "{$prefix}_{$id}" : $id;
}

function room_code(): string
{
    $c = rand_from(CODE_ALPHABET, 6);
    return substr($c, 0, 3) . '-' . substr($c, 3, 3);
}

function normalise_code(string $input): string
{
    $from = preg_match('#/r/([A-Za-z0-9-]+)#', $input, $m) ? $m[1] : $input;
    $raw = preg_replace('/[^A-Z0-9]/', '', strtoupper($from)) ?? '';
    if (strlen($raw) !== 6) return $raw;
    return substr($raw, 0, 3) . '-' . substr($raw, 3, 3);
}

function slugify(string $input, int $max = 40): string
{
    $s = strtolower(trim(preg_replace('/[^a-z0-9]+/i', '-', iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $input) ?: $input) ?? '', '-'));
    return rtrim(substr($s, 0, $max), '-');
}

/** Trimmed string input, capped (TS `str`). */
function str(mixed $v, int $max = 200): string
{
    return is_string($v) ? mb_substr(trim($v), 0, $max) : '';
}

function int_cents(mixed $v): ?int
{
    return is_int($v) ? $v : (is_float($v) && floor($v) === $v ? (int) $v : null);
}

function format_usd(int $cents, bool $dropZeroCents = false): string
{
    $neg = $cents < 0;
    $abs = abs($cents);
    $s = ($dropZeroCents && $abs % 100 === 0) ? '$' . number_format(intdiv($abs, 100)) : '$' . number_format($abs / 100, 2);
    return ($neg ? '-' : '') . $s;
}

function prorate(int $hourlyCents, int|float $minutes): int
{
    return (int) round(($hourlyCents * $minutes) / 60, 0, PHP_ROUND_HALF_UP);
}

function fill_payment_link(string $template, int $cents, string $reference = ''): string
{
    $amount = number_format($cents / 100, 2, '.', '');
    return str_replace(['{amount}', '{ref}'], [rawurlencode($amount), rawurlencode($reference)], $template);
}

/** The host's time zone (config), used for month boundaries and daily jobs. */
function tz(): \DateTimeZone
{
    static $tz = null;
    return $tz ??= new \DateTimeZone((string) (Config::get('timezone') ?: 'UTC'));
}

function local(int $ms): \DateTimeImmutable
{
    return (new \DateTimeImmutable('@' . intdiv($ms, 1000)))->setTimezone(tz());
}

function day_key(int $ms): string
{
    return local($ms)->format('Y-m-d');
}

function is_daily_due(?string $lastRunDay, int $nowMs): bool
{
    return !$lastRunDay || $lastRunDay < day_key($nowMs);
}

/** "Sun 15 Nov" (en-GB weekday short, day, month short). */
function short_date(string $isoStr): string
{
    return local(ms($isoStr))->format('D j M');
}

/** "Sun 15 Nov, 18:30". */
function short_when(string $isoStr): string
{
    return local(ms($isoStr))->format('D j M, H:i');
}

function month_key(int $ms): string
{
    return local($ms)->format('Y-m');
}

function prev_month_key(string $key): string
{
    [$y, $m] = array_map('intval', explode('-', $key));
    return $m === 1 ? sprintf('%d-12', $y - 1) : sprintf('%d-%02d', $y, $m - 1);
}

function month_label(string $key): string
{
    [$y, $m] = array_map('intval', explode('-', $key));
    return (new \DateTimeImmutable(sprintf('%04d-%02d-01', $y, $m), tz()))->format('F Y');
}

/** @return array{start: string, end: string} */
function month_range(string $key): array
{
    [$y, $m] = array_map('intval', explode('-', $key));
    $start = new \DateTimeImmutable(sprintf('%04d-%02d-01 00:00:00', $y, $m), tz());
    $end = $start->modify('+1 month');
    return ['start' => iso((int) $start->format('U') * 1000), 'end' => iso((int) $end->format('U') * 1000)];
}

function first_name(string $n): string
{
    return explode(' ', trim($n))[0] ?? $n;
}

/** JS-like `arr.find`. */
function find(array $list, callable $fn): mixed
{
    foreach ($list as $x) if ($fn($x)) return $x;
    return null;
}

function some(array $list, callable $fn): bool
{
    foreach ($list as $x) if ($fn($x)) return true;
    return false;
}

function every(array $list, callable $fn): bool
{
    foreach ($list as $x) if (!$fn($x)) return false;
    return true;
}

function sum(array $list, callable $fn): int|float
{
    $n = 0;
    foreach ($list as $x) $n += $fn($x);
    return $n;
}

/** Sort a list with a comparator and return it (JS `[...a].sort(fn)`). */
function sorted(array $list, callable $cmp): array
{
    usort($list, $cmp);
    return $list;
}

/** Index a list by a key function (JS `new Map(list.map(x => [k(x), x]))`). */
function index_by(array $list, callable $key): array
{
    $out = [];
    foreach ($list as $x) $out[(string) $key($x)] = $x;
    return $out;
}

/** Keep only string items of an input array (TS `arr()`). */
function strings(mixed $v): array
{
    return is_array($v) ? array_values(array_filter($v, 'is_string')) : [];
}

function json_out(mixed $data, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

/** Empty PHP arrays encode as [] — use this where the app expects an object. */
function obj(array $a): array|object
{
    return $a === [] ? new \stdClass() : $a;
}
