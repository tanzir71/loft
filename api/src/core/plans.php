<?php
declare(strict_types=1);

namespace Loft;

// Port of packages/core/src/plans.ts. The timeline is the plan: block times are derived from minutes;
// attaching prepares the room; wrap-up writes the billable session_log lines (the hinge into billing).

const BLOCK_TYPES = ['talk', 'board', 'activity', 'check', 'break', 'handout'];
const BLOCK_LABEL = ['talk' => 'Talk', 'board' => 'Board', 'activity' => 'Activity', 'check' => 'Check', 'break' => 'Break', 'handout' => 'Hand-out'];

/** Statuses: "attended" | "absent" | "excused" | "late_cancel" | "no_show". Price per session per member, in cents. */
const DEFAULT_POLICY = ['unitPriceCents' => 0, 'billable' => ['attended', 'late_cancel', 'no_show']];

/** JS Number(v) (see sch_num): numbers stay, numeric strings parse, null/"" → 0, anything else NaN. */
function pln_num(mixed $v): int|float
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

/** JS `n || fallback` for numbers; integral floats come back as ints. */
function pln_or(int|float $n, int|float $fallback): int|float
{
    if ((is_float($n) && is_nan($n)) || $n == 0) $n = $fallback;
    return is_float($n) && is_finite($n) && floor($n) === $n && abs($n) < PHP_INT_MAX ? (int) $n : $n;
}

/** JS Math.round (halves round up). */
function pln_round(int|float $n): int
{
    return (int) floor($n + 0.5);
}

/** JS String(v) for the scalar values plans accept. */
function pln_string(mixed $v): string
{
    if (is_string($v)) return $v;
    if (is_bool($v)) return $v ? 'true' : 'false';
    if ($v === null) return 'null';
    if (is_int($v) || is_float($v)) return (string) $v;
    return '[object Object]';
}

/**
 * Derived timeline: start = sum of previous minutes; under-length → a "free" tail, over-length → an "over" tail.
 * @return array{segments: list<array{id: string, type: string, start: int|float, minutes: int|float}>, planned: int|float, free: int|float, over: int|float}
 */
function timeline(array $blocks, int|float $available): array
{
    $t = 0;
    $segments = [];
    foreach ($blocks as $b) {
        $segments[] = ['id' => $b['id'], 'type' => $b['type'], 'start' => $t, 'minutes' => $b['minutes']];
        $t += $b['minutes'];
    }
    $free = max(0, $available - $t);
    $over = max(0, $t - $available);
    if ($free) $segments[] = ['id' => 'free', 'type' => 'free', 'start' => $t, 'minutes' => $free];
    if ($over) $segments[] = ['id' => 'over', 'type' => 'over', 'start' => $available, 'minutes' => $over];
    return ['segments' => $segments, 'planned' => $t, 'free' => $free, 'over' => $over];
}

/** 75 → "1:15". */
function mmss(int|float $min): string
{
    if (is_int($min)) return intdiv($min, 60) . ':' . str_pad((string) ($min % 60), 2, '0', STR_PAD_LEFT);
    return (string) floor($min / 60) . ':' . str_pad((string) fmod($min, 60), 2, '0', STR_PAD_LEFT);
}

/** Draft (under length or unattached) → Ready (attached) → Taught (wrap-up done). */
function derive_plan_status(array $p): string
{
    if (($p['status'] ?? null) === 'taught') return 'taught';
    $planned = sum($p['blocks'] ?? [], fn ($b) => $b['minutes'] ?? 0);
    return !empty($p['sessionId']) && $planned >= ($p['minutes'] ?? 0) * 0.8 ? 'ready' : 'draft';
}

/** Move a block (Alt+↑/↓ or drag); returns a new array. */
function move_block(array $blocks, int $from, int $to): array
{
    $out = array_values($blocks);
    if (!array_key_exists($from, $out)) return $blocks;
    $b = array_splice($out, $from, 1)[0];
    array_splice($out, max(0, min(count($out), $to)), 0, [$b]);
    return $out;
}

/** Epoch ms of a time string; strings without an offset are read in `$zone` (JS reads them as local time). */
function pln_ms_in(string $s, \DateTimeZone $zone): ?int
{
    try {
        $d = new \DateTimeImmutable($s, $zone);
        return (int) $d->format('U') * 1000 + (int) $d->format('v');
    } catch (\Throwable) {
        return null;
    }
}

/**
 * What members see in the posted agenda: visible blocks, titles + times, never host notes.
 * Clock times use `$zone` (the browser uses its local zone; the server uses the host's).
 * @return list<array{time: string, title: string, text: string}>
 */
function member_agenda(array $blocks, ?string $startsAt = null, ?\DateTimeZone $zone = null): array
{
    $zone ??= tz();
    $t = 0;
    $base = sch_filled($startsAt) ? pln_ms_in($startsAt, $zone) : null;
    $out = [];
    foreach ($blocks as $b) {
        if (!empty($b['visible'])) {
            $time = $base !== null ? (new \DateTimeImmutable('@' . (int) floor(($base + $t * 60000) / 1000)))->setTimezone($zone)->format('H:i') : mmss($t);
            $out[] = ['time' => $time, 'title' => (string) ($b['title'] ?? ''), 'text' => (string) ($b['memberText'] ?? '')];
        }
        $t += $b['minutes'] ?? 0;
    }
    return $out;
}

/** Block id: b + base36 time + base36 counter (TS `bid`). */
function pln_bid(): string
{
    static $seq = 0;
    return 'b' . base_convert((string) now_ms(), 10, 36) . base_convert((string) $seq++, 10, 36);
}

function pln_block(string $title, string $type, int $minutes, string $memberText = '', string $hostNotes = ''): array
{
    return ['id' => pln_bid(), 'title' => $title, 'type' => $type, 'minutes' => $minutes, 'memberText' => $memberText, 'hostNotes' => $hostNotes, 'resources' => $type === 'board' ? [['kind' => 'board', 'label' => 'Board · blank page']] : [], 'visible' => true];
}

/**
 * TS `TEMPLATES` (mode-agnostic starting points). Blocks are [title, type, minutes, memberText?];
 * plan_template_blocks($key) is the TS `TEMPLATES[key].blocks()` (fresh ids every call).
 */
const TEMPLATES = [
    'lesson' => ['label' => 'Lesson', 'minutes' => 60, 'blocks' => [['Check-in', 'talk', 5, 'What did you notice since last time?'], ['Predict', 'board', 10, 'Write your guess on the board.'], ['Activity', 'activity', 25, 'Work in pairs.'], ['Share findings', 'board', 10], ['Exit ticket', 'check', 5, '3 quick questions'], ['Set homework', 'handout', 5]]],
    'workshop' => ['label' => 'Workshop', 'minutes' => 90, 'blocks' => [['Welcome + goals', 'talk', 10], ['Map the problem', 'board', 20], ['Ideas', 'activity', 25], ['Break', 'break', 10], ['Vote + decide', 'check', 15], ['Next steps', 'talk', 10]]],
    'sprint' => ['label' => 'Sprint day', 'minutes' => 120, 'blocks' => [['Recap yesterday', 'talk', 10], ['Sketch', 'board', 40], ['Break', 'break', 10], ['Storyboard', 'board', 40], ['Decide', 'check', 20]]],
    'client' => ['label' => 'Client session', 'minutes' => 60, 'blocks' => [['Since last time', 'talk', 10], ['Review the numbers', 'board', 20], ['Options', 'activity', 15], ['Decisions + owners', 'talk', 10], ['Actions', 'handout', 5]]],
    'retro' => ['label' => 'Retro', 'minutes' => 45, 'blocks' => [['Check-in', 'talk', 5], ['What went well / not', 'board', 15], ['Group + vote', 'check', 10], ['Actions', 'talk', 10], ['Close', 'talk', 5]]],
];

/** @return list<array<string, mixed>>|null null when there is no such template */
function plan_template_blocks(string $key): ?array
{
    if (!array_key_exists($key, TEMPLATES)) return null;
    return array_map(fn ($x) => pln_block($x[0], $x[1], $x[2], $x[3] ?? '', $x[4] ?? ''), TEMPLATES[$key]['blocks']);
}

/** "From a file": one block per page (title = page heading or "Page n"). */
function blocks_from_pages(array $pages, int $minutesEach = 5): array
{
    $out = [];
    foreach (array_values($pages) as $i => $p) {
        $title = is_string($p['title'] ?? null) ? trim($p['title']) : '';
        $out[] = pln_block($title !== '' ? $title : 'Page ' . ($i + 1), 'board', $minutesEach);
    }
    return $out;
}

/** Validate AI JSON blocks (nothing is published until the host edits/accepts). */
function parse_ai_blocks(mixed $json): array
{
    if (!is_array($json) || !array_is_list($json)) throw new BadRequest('Expected a list of blocks');
    $out = [];
    foreach (array_slice($json, 0, 40) as $i => $raw) {
        $r = is_array($raw) ? $raw : [];
        $type = in_array($r['type'] ?? null, BLOCK_TYPES, true) ? $r['type'] : 'talk';
        $minutes = (int) max(1, min(240, pln_round(pln_or(pln_num($r['minutes'] ?? null), 5))));
        $out[] = ['id' => pln_bid(), 'title' => mb_substr(pln_string($r['title'] ?? 'Block ' . ($i + 1)), 0, 120), 'type' => $type, 'minutes' => $minutes, 'memberText' => mb_substr(pln_string($r['instructions'] ?? ''), 0, 2000), 'hostNotes' => mb_substr(pln_string($r['hostNotes'] ?? ''), 0, 2000), 'resources' => [], 'visible' => true];
    }
    return $out;
}

/**
 * Partly/skipped blocks carry over: prepended to the next plan.
 * @param array<string, string> $outcomes block id → "done" | "partly" | "skipped"
 * @param list<string> $keep block ids the host chose to carry
 */
function carry_over(array $outcomes, array $blocks, array $keep): array
{
    $out = [];
    foreach ($blocks as $b) {
        $o = $outcomes[$b['id']] ?? null;
        if (!sch_truthy($o) || $o === 'done' || !in_array($b['id'], $keep, true)) continue;
        $out[] = array_merge($b, ['id' => pln_bid(), 'title' => $b['title']]);
    }
    return $out;
}

/**
 * One session_log line per member (I2). Nothing is invoiced yet.
 * @param list<array{memberId: string, minutes: int|float, status: string}> $attendance
 * @param array{unitPriceCents: int, billable: list<string>} $policy
 */
function session_log_lines(array $attendance, array $policy): array
{
    return array_map(function ($a) use ($policy) {
        $billable = in_array($a['status'], $policy['billable'], true);
        return array_merge($a, ['billable' => $billable, 'unitPriceCents' => $policy['unitPriceCents'], 'amountCents' => $billable ? $policy['unitPriceCents'] : 0]);
    }, $attendance);
}

/**
 * Attendance prefilled from presence: joined at all → attended; nothing → absent.
 * @param list<string> $memberIds
 * @param array<string, int|float> $minutesById
 * @param list<string> $lateCancel
 * @return list<array{memberId: string, minutes: int, status: string}>
 */
function attendance_from_presence(array $memberIds, array $minutesById, array $lateCancel = []): array
{
    return array_map(fn ($id) => [
        'memberId' => $id,
        'minutes' => pln_round($minutesById[$id] ?? 0),
        'status' => in_array($id, $lateCancel, true) ? 'late_cancel' : (($minutesById[$id] ?? 0) > 0 ? 'attended' : 'absent'),
    ], array_values($memberIds));
}
