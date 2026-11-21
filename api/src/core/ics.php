<?php
declare(strict_types=1);

namespace Loft;

// Port of packages/core/src/ics.ts: iCalendar output (METHOD:REQUEST/CANCEL, a stable UID per session,
// SEQUENCE+1 on updates, LOCATION/URL, 75-octet line folding) and busy times read from a private feed.

/** 20260105T090000Z from epoch ms. */
function format_ics_date(int|float $timestamp): string
{
    return gmdate('Ymd\THis\Z', (int) floor($timestamp / 1000));
}

function escape_ics_text(string $value): string
{
    // Same order as the TS chain: backslashes first, so later escapes are not doubled.
    return str_replace(['\\', "\n", ';', ','], ['\\\\', '\\n', '\\;', '\\,'], $value);
}

/** Fold lines longer than 75 octets (RFC 5545 §3.1), never inside a UTF-8 character. */
function fold_ics_line(string $line): string
{
    if (strlen($line) <= 75) return $line;
    $out = [];
    $cur = '';
    $curBytes = 0;
    foreach (mb_str_split($line, 1, 'UTF-8') as $ch) {
        $b = strlen($ch);
        $limit = count($out) === 0 ? 75 : 74;
        if ($curBytes + $b > $limit) {
            $out[] = $cur;
            $cur = '';
            $curBytes = 0;
        }
        $cur .= $ch;
        $curBytes += $b;
    }
    $out[] = $cur;
    return implode("\r\n ", $out);
}

/** A non-empty string (JS truthiness for optional text fields). */
function sch_filled(mixed $v): bool
{
    return is_string($v) && $v !== '';
}

/**
 * @param array{events: list<array<string, mixed>>, name: string, now?: int|null, method?: string|null, organizer?: array{name: string, email: string}|null} $input
 * Events: {id, startsAt (ms), endsAt (ms), summary, description?, location?, url?, sequence?, status?}.
 */
function build_ics_calendar(array $input): string
{
    $now = $input['now'] ?? now_ms();
    $method = $input['method'] ?? 'PUBLISH';
    $organizer = $input['organizer'] ?? null;
    $lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Loft//Sessions//EN', 'CALSCALE:GREGORIAN', "METHOD:$method", 'X-WR-CALNAME:' . escape_ics_text((string) $input['name'])];
    foreach ($input['events'] as $e) {
        array_push(
            $lines,
            'BEGIN:VEVENT',
            'UID:' . escape_ics_text((string) $e['id']) . '@loft',
            'SEQUENCE:' . (int) ($e['sequence'] ?? 0),
            'DTSTAMP:' . format_ics_date($now),
            'DTSTART:' . format_ics_date($e['startsAt']),
            'DTEND:' . format_ics_date($e['endsAt']),
            'SUMMARY:' . escape_ics_text((string) $e['summary'])
        );
        if (sch_filled($e['description'] ?? null)) $lines[] = 'DESCRIPTION:' . escape_ics_text($e['description']);
        if (sch_filled($e['location'] ?? null)) $lines[] = 'LOCATION:' . escape_ics_text($e['location']);
        if (sch_filled($e['url'] ?? null)) $lines[] = 'URL:' . $e['url'];
        if ($organizer) $lines[] = 'ORGANIZER;CN=' . escape_ics_text((string) $organizer['name']) . ':mailto:' . $organizer['email'];
        array_push($lines, 'STATUS:' . ($method === 'CANCEL' ? 'CANCELLED' : ($e['status'] ?? 'CONFIRMED')), 'END:VEVENT');
    }
    $lines[] = 'END:VCALENDAR';
    return implode("\r\n", array_map(fn (string $l) => fold_ics_line($l), $lines)) . "\r\n";
}

const SCH_ICS_DAYS = ['SU' => 0, 'MO' => 1, 'TU' => 2, 'WE' => 3, 'TH' => 4, 'FR' => 5, 'SA' => 6];

/** 20261124T090000Z / 20261124 → epoch ms (floating and TZID times are read as UTC); null if unreadable. */
function sch_parse_ics_date(string $v): ?int
{
    if (!preg_match('/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/D', $v, $m)) return null;
    return gmmktime((int) ($m[4] ?? 0), (int) ($m[5] ?? 0), (int) ($m[6] ?? 0), (int) $m[2], (int) $m[3], (int) $m[1]) * 1000;
}

/** UTC weekday (0 = Sunday) of an epoch-ms instant. */
function sch_utc_day(int $t): int
{
    return (int) gmdate('w', (int) floor($t / 1000));
}

/**
 * Busy times from someone's private iCal feed (read-only): VEVENT DTSTART/DTEND, plus simple weekly RRULEs.
 * Floating and TZID times are treated as UTC (good enough for "busy", never written back).
 * @return list<array{start: int, end: int}>
 */
function parse_ics_busy(string $text, int $from, int $to): array
{
    $unfolded = preg_replace('/\r?\n[ \t]/', '', $text) ?? $text;
    $out = [];
    $blocks = explode('BEGIN:VEVENT', $unfolded);
    array_shift($blocks);
    foreach ($blocks as $block) {
        $body = explode('END:VEVENT', $block)[0];
        // (*ANYCRLF): CR, LF and CRLF all end a line, like JS line terminators in /m mode.
        $get = function (string $k) use ($body): ?string {
            return preg_match('/(*ANYCRLF)^' . preg_quote($k, '/') . '(?:;[^:\r\n]*)?:(.+)$/m', $body, $m) ? trim($m[1]) : null;
        };
        if (preg_match('/(*ANYCRLF)^STATUS:CANCELLED/m', $body) || preg_match('/(*ANYCRLF)^TRANSP:TRANSPARENT/m', $body)) continue;
        $start = sch_parse_ics_date($get('DTSTART') ?? '');
        $end = sch_parse_ics_date($get('DTEND') ?? '') ?? ($start !== null ? $start + 3600000 : null);
        if ($start === null || $end === null) continue;
        $rrule = $get('RRULE');
        if (sch_filled($rrule) && str_contains($rrule, 'FREQ=WEEKLY')) {
            $parts = [];
            foreach (explode(';', $rrule) as $p) {
                $kv = explode('=', $p);
                $parts[$kv[0]] = $kv[1] ?? null;
            }
            $until = sch_filled($parts['UNTIL'] ?? null) ? sch_parse_ics_date($parts['UNTIL']) : null;
            $count = sch_filled($parts['COUNT'] ?? null) ? sch_num($parts['COUNT']) : null;
            $interval = sch_or(sch_num($parts['INTERVAL'] ?? 1), 1);
            if (sch_filled($parts['BYDAY'] ?? null)) {
                $byday = [];
                foreach (explode(',', $parts['BYDAY']) as $d) {
                    $k = substr($d, -2);
                    if (array_key_exists($k, SCH_ICS_DAYS)) $byday[] = SCH_ICS_DAYS[$k];
                }
            } else {
                $byday = [sch_utc_day($start)];
            }
            sort($byday);
            $dur = $end - $start;
            $weekStart = $start - sch_utc_day($start) * 86400000;
            $n = 0;
            for ($w = 0; $w < 520; $w++) {
                if (fmod($w, $interval) != 0) continue;
                foreach ($byday as $d) {
                    $s = $weekStart + ($w * 7 + $d) * 86400000 + (($start % 86400000) + 86400000) % 86400000 - (($weekStart % 86400000) + 86400000) % 86400000;
                    if ($s < $start) continue;
                    if (($until !== null && $s > $until) || ($count !== null && $n >= $count) || $s > $to) break 2;
                    $n++;
                    if ($s + $dur > $from) $out[] = ['start' => $s, 'end' => $s + $dur];
                }
            }
        } elseif ($end > $from && $start < $to) {
            $out[] = ['start' => $start, 'end' => $end];
        }
    }
    usort($out, fn ($a, $b) => $a['start'] <=> $b['start']);
    return $out;
}
