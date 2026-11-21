<?php
declare(strict_types=1);

namespace Loft;

// Port of packages/core/src/schedule.ts. Sessions are stored in UTC and shown in the viewer's zone.
// Series are materialised as rows; free slots = availability − sessions − busy blocks − buffers.
// PHP DateTimeZone replaces Intl; the offset arithmetic (and the DST re-check) is the same.

/** JS Number(v): numbers stay, numeric strings parse, bool → 1/0, null/"" → 0, anything else NaN. */
function sch_num(mixed $v): int|float
{
    if (is_int($v) || is_float($v)) return $v;
    if (is_bool($v)) return $v ? 1 : 0;
    if ($v === null) return 0;
    if (is_string($v)) {
        $t = trim($v);
        if ($t === '') return 0;
        if (is_numeric($t)) return $t + 0;
    }
    return NAN;
}

/** JS `n || fallback` for numbers (0 and NaN fall back); integral floats come back as ints. */
function sch_or(int|float $n, int|float $fallback): int|float
{
    if ((is_float($n) && is_nan($n)) || $n == 0) $n = $fallback;
    return is_float($n) && is_finite($n) && floor($n) === $n && abs($n) < PHP_INT_MAX ? (int) $n : $n;
}

/** JS Math.round (halves round up). */
function sch_round(int|float $n): int
{
    return (int) floor($n + 0.5);
}

/** JS truthiness of an input value. */
function sch_truthy(mixed $v): bool
{
    if (is_float($v) && is_nan($v)) return false;
    return !($v === null || $v === false || $v === 0 || $v === 0.0 || $v === '');
}

function sch_zone(string $tz): \DateTimeZone
{
    static $cache = [];
    if (isset($cache[$tz])) return $cache[$tz];
    try {
        return $cache[$tz] = new \DateTimeZone($tz);
    } catch (\Throwable) {
        throw new BadRequest("Invalid time zone specified: $tz");
    }
}

function sch_valid_tz(mixed $tz): bool
{
    if (!is_string($tz) || $tz === '') return false;
    try {
        sch_zone($tz);
        return true;
    } catch (\Throwable) {
        return false;
    }
}

/** [y, m, d] from "YYYY-MM-DD". */
function sch_ymd(string $date): array
{
    $p = explode('-', $date);
    return [(int) ($p[0] ?? 0), (int) ($p[1] ?? 0), (int) ($p[2] ?? 0)];
}

/** Offset (ms) of `tz` from UTC at instant `t`. */
function tz_offset(int|float $t, string $tz): int
{
    $at = new \DateTimeImmutable('@' . (int) floor($t / 1000));
    return sch_zone($tz)->getOffset($at) * 1000;
}

/** Wall time (YYYY-MM-DD + HH:MM) in `tz` → UTC epoch ms. Handles DST by re-checking the offset. */
function zoned_to_utc(string $date, string $time, string $tz): int
{
    [$y, $m, $d] = sch_ymd($date);
    $hm = explode(':', $time);
    $naive = gmmktime((int) ($hm[0] ?? 0), (int) ($hm[1] ?? 0), 0, $m, $d, $y) * 1000;
    $t = $naive - tz_offset($naive, $tz);
    $t = $naive - tz_offset($t, $tz);
    return $t;
}

/** YYYY-MM-DD of an instant in `tz`. */
function date_in(int|float $t, string $tz): string
{
    return (new \DateTimeImmutable('@' . (int) floor($t / 1000)))->setTimezone(sch_zone($tz))->format('Y-m-d');
}

/** 0 = Sunday … 6 = Saturday, in `tz`. */
function weekday_in(int|float $t, string $tz): int
{
    return (int) (new \DateTimeImmutable('@' . (int) floor($t / 1000)))->setTimezone(sch_zone($tz))->format('w');
}

function add_days(string $date, int $n): string
{
    [$y, $m, $d] = sch_ymd($date);
    return gmdate('Y-m-d', gmmktime(0, 0, 0, $m, $d + $n, $y));
}

/** Weekday of a calendar date (TS `dow`). */
function sch_dow(string $date): int
{
    [$y, $m, $d] = sch_ymd($date);
    return (int) gmdate('w', gmmktime(12, 0, 0, $m, $d, $y));
}

/**
 * Materialise a weekly series into UTC start times (max 200).
 * @param array{days: list<int>, time: string, minutes?: int, tz: string, from: string, until?: string|null, count?: int|null} $rule
 * @return list<string>
 */
function expand_series(array $rule): array
{
    $out = [];
    $count = isset($rule['count']) ? sch_num($rule['count']) : 200;
    if (is_float($count) && is_nan($count)) return [];
    $max = min($count, 200);
    $days = is_array($rule['days'] ?? null) ? $rule['days'] : [];
    $from = is_string($rule['from'] ?? null) ? $rule['from'] : '';
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $from)) return [];
    $until = sch_filled($rule['until'] ?? null) ? $rule['until'] : '';
    $time = (string) ($rule['time'] ?? '');
    $tz = (string) ($rule['tz'] ?? 'UTC');
    for ($i = 0, $date = $from; $i < 800 && count($out) < $max; $i++, $date = add_days($date, 1)) {
        if ($until !== '' && strcmp($date, $until) > 0) break;
        if (!in_array(sch_dow($date), $days, true)) continue;
        $out[] = iso(zoned_to_utc($date, $time, $tz));
    }
    return $out;
}

/** @return array{start: int|float, end: int|float} */
function to_interval(array $s): array
{
    $start = ms((string) ($s['startsAt'] ?? ''));
    return ['start' => $start, 'end' => $start + ($s['minutes'] ?? 0) * 60000];
}

function overlaps(array $a, array $b): bool
{
    return $a['start'] < $b['end'] && $b['start'] < $a['end'];
}

/**
 * Which proposed starts clash with existing sessions (not cancelled) or busy blocks.
 * @return list<array{startsAt: string, with: string}>
 */
function find_clashes(array $starts, int|float $minutes, array $existing, array $busy = []): array
{
    $out = [];
    foreach ($starts as $s) {
        $iv = ['start' => ms($s), 'end' => ms($s) + $minutes * 60000];
        $hit = find($existing, fn ($e) => ($e['status'] ?? null) !== 'cancelled' && overlaps($iv, to_interval($e)));
        if ($hit) $out[] = ['startsAt' => $s, 'with' => $hit['title'] ?? 'another session'];
        elseif (some($busy, fn ($b) => overlaps($iv, $b))) $out[] = ['startsAt' => $s, 'with' => 'busy in your calendar'];
    }
    return $out;
}

/**
 * Free slots for a booking type, over the horizon, in UTC ISO.
 * @param array{tz: string, weekly: array, rules: array{bufferMin: int, noticeHours: int, maxPerDay: int, horizonDays: int}} $av
 * @param list<array{start: int|float, end: int|float}> $taken
 * @param array{stepMin?: int, days?: int} $opts
 * @return list<string>
 */
function free_slots(array $av, int|float $minutes, array $taken, int $now, array $opts = []): array
{
    $rules = $av['rules'];
    $step = ($opts['stepMin'] ?? 30) * 60000;
    $days = min($opts['days'] ?? 30, $rules['horizonDays']);
    $earliest = $now + $rules['noticeHours'] * 3600000;
    $buffer = $rules['bufferMin'] * 60000;
    $blocked = array_map(fn ($t) => ['start' => $t['start'] - $buffer, 'end' => $t['end'] + $buffer], $taken);
    $tz = (string) $av['tz'];
    $takenDays = array_map(fn ($t) => date_in($t['start'], $tz), $taken);
    $weekly = (array) ($av['weekly'] ?? []);
    $out = [];
    $today = date_in($now, $tz);
    for ($i = 0; $i <= $days; $i++) {
        $date = add_days($today, $i);
        $ranges = $weekly[sch_dow($date)] ?? [];
        // The per-day cap counts what's already booked that day; offering more slots is fine.
        $perDay = count(array_filter($takenDays, fn ($d) => $d === $date));
        foreach ((array) $ranges as $r) {
            $r = (array) $r;
            if (!is_string($r['start'] ?? null) || !is_string($r['end'] ?? null)) continue;
            $rs = zoned_to_utc($date, $r['start'], $tz);
            $re = zoned_to_utc($date, $r['end'], $tz);
            for ($t = $rs; $t + $minutes * 60000 <= $re; $t += $step) {
                if ($perDay >= $rules['maxPerDay']) break;
                if ($t < $earliest) continue;
                $iv = ['start' => $t, 'end' => $t + $minutes * 60000];
                if (some($blocked, fn ($b) => overlaps($iv, $b))) continue;
                $out[] = iso((int) $t);
            }
        }
    }
    return $out;
}

/** Late cancel: fewer hours before start than the space's window (I1). */
function is_late_change(string $startsAt, int $now, int|float $windowHours): bool
{
    return ms($startsAt) - $now < $windowHours * 3600000;
}

/** Next N free slots after a time (for "decline → suggest the next 3 free times"). */
function next_free(array $slots, int $after, int $n = 3): array
{
    return array_slice(array_values(array_filter($slots, fn ($s) => ms($s) > $after)), 0, $n);
}

function default_availability(string $tz): array
{
    return [
        'tz' => $tz,
        'weekly' => [1 => [['start' => '10:00', 'end' => '13:00']], 2 => [['start' => '10:00', 'end' => '13:00']], 3 => [['start' => '14:00', 'end' => '17:00']], 4 => [['start' => '10:00', 'end' => '13:00']], 5 => [['start' => '10:00', 'end' => '14:00']]],
        'rules' => ['bufferMin' => 15, 'noticeHours' => 12, 'maxPerDay' => 4, 'horizonDays' => 30],
    ];
}
