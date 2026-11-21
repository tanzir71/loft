<?php
declare(strict_types=1);

namespace Loft;

// Quick checks (M8): four question types, auto-grading, timing, integrity signals and a gradebook.
// PHP twin of packages/core/src/checks.ts (pure functions).

const CK_SIGNAL_LABEL = [
    'tab_hidden' => 'left the tab',
    'window_blur' => 'switched windows',
    'fullscreen_exit' => 'left full screen',
    'devtools_key' => 'opened developer tools',
    'devtools_resize' => 'developer tools suspected',
    'copy_attempt' => 'copied text',
    'cut_attempt' => 'cut text',
    'paste_attempt' => 'pasted text',
    'context_menu' => 'opened the context menu',
    'print_attempt' => 'tried to print',
    'page_idle' => 'went idle',
    'multi_screen' => 'has a second screen',
    'automation_flag' => 'browser automation detected',
    'drop_attempt' => 'dropped content in',
    'insert_burst' => 'inserted a block of text at once',
];
const CK_STRONG_SIGNALS = ['paste_attempt', 'automation_flag', 'insert_burst', 'devtools_key', 'drop_attempt'];

/** A string field or '' (numbers become strings, like JS template literals). */
function ck_s(mixed $v): string
{
    if (is_string($v)) return $v;
    return is_int($v) || is_float($v) ? (string) $v : '';
}

function ck_list(mixed $v): array
{
    return is_array($v) ? array_values($v) : [];
}

/** Validate a question the way the legacy zod schemas did; returns an error message or null. */
function validate_question(array $q): ?string
{
    $type = $q['type'] ?? '';
    $options = ck_list($q['options'] ?? null);
    $answer = ck_list($q['answer'] ?? null);
    if (trim(ck_s($q['prompt'] ?? null)) === '') return 'Write the question';
    $points = int_cents($q['points'] ?? null);
    if ($points === null || $points < 1) return 'Points must be a whole number of at least 1';
    if ($type === 'mcq_single' || $type === 'mcq_multi') {
        if (count($options) < 2) return 'Add at least two options';
        if (some($options, fn ($o) => trim(ck_s(is_array($o) ? ($o['text'] ?? null) : null)) === '')) return 'Every option needs text';
        $ids = array_map(fn ($o) => is_array($o) ? ($o['id'] ?? null) : null, $options);
        if (!$answer || some($answer, fn ($a) => !in_array($a, $ids, true))) return 'Mark the correct option';
        if ($type === 'mcq_single' && count($answer) !== 1) return 'Pick exactly one correct option';
    }
    if ($type === 'true_false' && !(count($answer) === 1 && ($answer[0] === 'true' || $answer[0] === 'false'))) return 'Pick true or false';
    if ($type === 'short_answer' && !some($answer, fn ($a) => trim(ck_s($a)) !== '')) return 'Add at least one accepted answer';
    return null;
}

function ck_normalise(string $v): string
{
    return mb_strtolower(preg_replace('/\s+/u', ' ', trim($v)) ?? trim($v));
}

function ck_same_set(array $a, array $b): bool
{
    $x = [];
    foreach ($a as $v) if (!in_array($v, $x, true)) $x[] = $v;
    $y = [];
    foreach ($b as $v) if (!in_array($v, $y, true)) $y[] = $v;
    return count($x) === count($y) && every($x, fn ($v) => in_array($v, $y, true));
}

/**
 * Objective answers are graded now; an unmatched short answer is null (it goes to the host's review).
 * @return array{isCorrect: ?bool, points: int|float|null}
 */
function score_answer(array $q, ?array $a): array
{
    $type = $q['type'] ?? '';
    $points = $q['points'] ?? 0;
    $key = ck_list($q['answer'] ?? null);
    $a = $a === null ? [] : array_values($a);
    if (!$a) return ['isCorrect' => false, 'points' => 0];
    if ($type === 'mcq_single' || $type === 'true_false') {
        $ok = $a[0] === ($key[0] ?? null);
        return ['isCorrect' => $ok, 'points' => $ok ? $points : 0];
    }
    if ($type === 'mcq_multi') {
        $ok = ck_same_set($a, $key);
        return ['isCorrect' => $ok, 'points' => $ok ? $points : 0];
    }
    $accepted = array_map(fn ($x) => ck_normalise(ck_s($x)), $key);
    return in_array(ck_normalise(ck_s($a[0] ?? '')), $accepted, true) ? ['isCorrect' => true, 'points' => $points] : ['isCorrect' => null, 'points' => null];
}

/** @return array{earned: int|float, possible: int|float, pending: int, percent: ?int} */
function attempt_score(array $questions, array|object $scores): array
{
    $scores = (array) $scores;
    $earned = 0;
    $pending = 0;
    $possible = sum($questions, fn ($q) => $q['points'] ?? 0);
    foreach ($questions as $q) {
        $s = $scores[$q['id'] ?? ''] ?? null;
        if (!is_array($s) || (array_key_exists('points', $s) && $s['points'] === null)) $pending++;
        else $earned += $s['points'] ?? 0;
    }
    return ['earned' => $earned, 'possible' => $possible, 'pending' => $pending, 'percent' => $pending || !$possible ? null : (int) round(($earned / $possible) * 100)];
}

function window_error(array $c, int $now): ?string
{
    if (($c['status'] ?? '') !== 'published') return "This check isn't open";
    if (!empty($c['openAt']) && ms($c['openAt']) > $now) return "This check isn't open yet";
    if (!empty($c['closeAt']) && ms($c['closeAt']) < $now) return 'This check is closed';
    return null;
}

function attempt_deadline(array $c, string $startedAt): ?int
{
    $d = [];
    if (!empty($c['closeAt'])) $d[] = ms($c['closeAt']);
    if (!empty($c['timeLimitMin'])) $d[] = ms($startedAt) + (int) round($c['timeLimitMin'] * 60000);
    return $d ? min($d) : null;
}

function remaining_seconds(array $c, string $startedAt, int $now): ?int
{
    $d = attempt_deadline($c, $startedAt);
    return $d === null ? null : max(0, (int) floor(($d - $now) / 1000));
}

/** FNV-1a over UTF-16 code units, exactly like the TS (Math.imul + >>> 0). */
function ck_hash(string $s): int
{
    $x = 2166136261;
    foreach (mb_str_split($s) as $ch) {
        $cp = mb_ord($ch);
        if ($cp === false) $cp = 0xFFFD;
        $unit = $cp > 0xFFFF ? 0xD800 + (($cp - 0x10000) >> 10) : $cp;
        $x = (($x ^ $unit) * 16777619) & 0xFFFFFFFF;
    }
    return $x;
}

/** Stable per-member shuffle (same order on reload). */
function shuffled(array $items, string $seed): array
{
    $items = array_values($items);
    usort($items, fn ($a, $b) => ck_hash($seed . ck_s(is_array($a) ? ($a['id'] ?? '') : '')) <=> ck_hash($seed . ck_s(is_array($b) ? ($b['id'] ?? '') : '')));
    return $items;
}

/**
 * Signals, not verdicts: "clean" (nothing worth a look), "review" (look at the answers), "flagged"
 * (strong signals such as pasting or automation). The host decides; Loft never fails anyone.
 * @return array{level: string, reasons: list<string>}
 */
function integrity_review(mixed $s): array
{
    if (!$s) return ['level' => 'none', 'reasons' => []];
    $s = (array) $s;
    $counts = (array) ($s['violationCounts'] ?? []);
    $entries = [];
    foreach ($counts as $k => $n) if ((is_int($n) || is_float($n)) && $n > 0) $entries[] = [(string) $k, $n];
    usort($entries, fn ($a, $b) => $b[1] <=> $a[1]);
    $reasons = array_map(fn ($e) => (CK_SIGNAL_LABEL[$e[0]] ?? str_replace('_', ' ', $e[0])) . ($e[1] > 1 ? ' ×' . $e[1] : ''), $entries);
    $away = $s['awayMs'] ?? 0;
    if ($away >= 60000) $reasons[] = 'away ' . (int) round($away / 60000) . ' min';
    $strong = some(CK_STRONG_SIGNALS, fn ($k) => ($counts[$k] ?? 0) > 0);
    $score = $s['integrityScore'] ?? null;
    $level = $strong || ($score !== null && $score < 60) ? 'flagged' : (($score !== null && $score < 90) || $away >= 60000 ? 'review' : 'clean');
    return ['level' => $level, 'reasons' => $reasons];
}

/** Average over graded cells; missing work counts as zero once due (legacy rule). */
function cell_average(array $cells): ?int
{
    $earned = 0;
    $possible = 0;
    foreach ($cells as $c) {
        $p = $c['possible'] ?? null;
        if (!$p || $p <= 0) continue;
        if (($c['status'] ?? '') === 'graded' && ($c['earned'] ?? null) !== null) {
            $earned += $c['earned'];
            $possible += $p;
        }
        if (($c['status'] ?? '') === 'missing') $possible += $p;
    }
    return $possible == 0 ? null : (int) round(($earned / $possible) * 100);
}

function cell_text(array $c): string
{
    $status = $c['status'] ?? '';
    if ($status === 'missing') return 'Missing';
    if ($status === 'pending') return 'Pending';
    if ($status === 'not_due') return '';
    $earned = $c['earned'] ?? null;
    if (($c['possible'] ?? null) === null) return $earned === null ? '' : (string) $earned;
    return ($earned === null ? 'null' : (string) $earned) . '/' . $c['possible'];
}
