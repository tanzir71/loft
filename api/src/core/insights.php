<?php
declare(strict_types=1);

namespace Loft;

// Insights (Figma 04 · "Host · Insights + nudges"): last seen, attendance, homework on time, fees and an
// at-risk rule, as pure functions. PHP twin of packages/core/src/insights.ts.

const INS_COUNTED = ['attended', 'absent', 'no_show', 'late_cancel'];

const NUDGE_RULES = [
    ['id' => 'deadline', 'title' => 'Deadline reminder', 'sub' => '24 h before homework or a check is due', 'on' => true],
    ['id' => 'missed2', 'title' => 'Missed 2 sessions in a row', 'sub' => 'message the payer (a parent or the client)', 'on' => true],
    ['id' => 'fee3', 'title' => 'Fee overdue + 3 days', 'sub' => 'payer, with the pay link', 'on' => true],
    ['id' => 'files3', 'title' => "Hasn't opened shared files", 'sub' => 'after 3 days', 'on' => false],
];

const DEFAULT_NUDGE_TEXT = "Hi {first_name}, {task} is due {due}. Stuck on a question? Reply here and we'll go through it.";

/**
 * @param array{lastSeenAt: ?string, lastLoginAt: ?string, inRoom: bool, sessions: list<array>, work: list<array>, fee: string} $a
 */
function member_insight(array $a, int $now): array
{
    $counted = array_values(array_filter($a['sessions'] ?? [], fn ($s) => in_array($s['status'] ?? '', INS_COUNTED, true) && ms($s['at'] ?? null) <= $now));
    usort($counted, fn ($x, $y) => strcmp((string) $y['at'], (string) $x['at']));
    $attended = count(array_filter($counted, fn ($s) => $s['status'] === 'attended'));
    $attendance = $counted ? (int) round(($attended / count($counted)) * 100) : null;
    $missed = 0;
    foreach ($counted as $s) {
        if ($s['status'] === 'attended') break;
        if ($s['status'] === 'absent' || $s['status'] === 'no_show') $missed++;
    }
    $due = array_values(array_filter($a['work'] ?? [], fn ($w) => ms($w['dueAt'] ?? null) <= $now));
    $onTime = count(array_filter($due, fn ($w) => !empty($w['doneAt']) && strcmp((string) $w['doneAt'], (string) $w['dueAt']) <= 0));
    $done = count(array_filter($due, fn ($w) => !empty($w['doneAt'])));
    $notSeen = !empty($a['inRoom']) ? 0 : (!empty($a['lastSeenAt']) ? (int) floor(($now - ms($a['lastSeenAt'])) / DAY) : null);
    $reasons = [];
    if ($notSeen === null) $reasons[] = 'never seen';
    elseif ($notSeen >= 7) $reasons[] = "not seen for $notSeen days";
    if ($missed >= 2) $reasons[] = "missed $missed sessions in a row";
    elseif ($attendance !== null && count($counted) >= 3 && $attendance < 75) $reasons[] = "attendance {$attendance}%";
    if (count($due) >= 2 && $onTime / count($due) < 0.5) $reasons[] = $onTime . '/' . count($due) . ' on time';
    if (($a['fee'] ?? '') === 'overdue') $reasons[] = 'fee overdue';
    return [
        'attendance' => $attendance,
        'attended' => $attended,
        'expected' => count($counted),
        'homeworkDone' => $done,
        'homeworkDue' => count($due),
        'onTime' => $onTime,
        'notSeenDays' => $notSeen,
        'missedInARow' => $missed,
        'atRisk' => count($reasons) > 0,
        'reasons' => $reasons,
    ];
}

/** "in a room", "2 h ago", "yesterday", "3 days ago", "never". */
function seen_label(array $a, int $now): string
{
    if (!empty($a['inRoom'])) return 'in a room';
    if (empty($a['lastSeenAt'])) return 'never';
    $mins = max(0, (int) round(($now - ms($a['lastSeenAt'])) / 60000));
    if ($mins < 2) return 'just now';
    if ($mins < 60) return "$mins min ago";
    if ($mins < 60 * 24) return (int) round($mins / 60) . ' h ago';
    $days = intdiv($mins, 60 * 24);
    return $days === 1 ? 'yesterday' : "$days days ago";
}

/**
 * @param list<array{insight: array, activity: array}> $list
 * @return array{active: int, members: int, attendance: ?int, onTime: ?int, avgMinutes: ?int}
 */
function totals(array $list, int $windowStart): array
{
    $active = count(array_filter($list, fn ($m) => !empty($m['activity']['inRoom']) || (!empty($m['activity']['lastSeenAt']) && ms($m['activity']['lastSeenAt']) >= $windowStart)));
    $expected = sum($list, fn ($m) => $m['insight']['expected']);
    $attended = sum($list, fn ($m) => $m['insight']['attended']);
    $due = sum($list, fn ($m) => $m['insight']['homeworkDue']);
    $onTime = sum($list, fn ($m) => $m['insight']['onTime']);
    $mins = [];
    foreach ($list as $m) {
        foreach ($m['activity']['sessions'] ?? [] as $s) {
            if (($s['status'] ?? '') === 'attended' && ($s['minutes'] ?? 0) > 0) $mins[] = $s['minutes'];
        }
    }
    return [
        'active' => $active,
        'members' => count($list),
        'attendance' => $expected ? (int) round(($attended / $expected) * 100) : null,
        'onTime' => $due ? (int) round(($onTime / $due) * 100) : null,
        'avgMinutes' => $mins ? (int) round(array_sum($mins) / count($mins)) : null,
    ];
}

/** "+3", "−2%", "steady". */
function delta(int|float|null $now, int|float|null $before, string $unit = ''): string
{
    if ($now === null || $before === null) return '';
    $d = $now - $before;
    if ($d == 0) return 'steady';
    return ($d > 0 ? '+' : '−') . abs($d) . $unit;
}
