<?php
declare(strict_types=1);

namespace Loft;

// Money (Figma 06 · row B): USD, no payment gateway. The host's own payment link; payers tap "I've paid";
// the host confirms. Port of packages/core/src/billing.ts (pure functions; month helpers live in helpers.php).

const DEFAULT_BILLING = [
    'model' => 'per_session',
    'unitPriceCents' => 0,
    'per' => 'member',
    'billable' => ['attended', 'late_cancel', 'no_show'],
    'lateCancelHours' => 24,
    'excused' => 'makeup',
    'schedule' => 'monthly',
    'dueDays' => 7,
    'paymentLink' => null,
    'combineSiblings' => true,
    'payers' => [],
];

const INVOICE_STATUS_LABEL = ['draft' => 'Draft', 'sent' => 'Sent', 'viewed' => 'Viewed', 'claimed' => 'Payer says paid', 'partial' => 'Partly paid', 'paid' => 'Paid', 'overdue' => 'Overdue', 'void' => 'Void'];

const DEFAULT_REMINDERS = [
    ['offsetDays' => -3, 'channels' => ['inapp', 'email']],
    ['offsetDays' => 0, 'channels' => ['inapp']],
    ['offsetDays' => 3, 'channels' => ['inapp', 'email', 'whatsapp']],
    ['offsetDays' => 10, 'channels' => ['email', 'whatsapp'], 'final' => true],
];

const DEFAULT_REMINDER_TEXT = "Hi {payer_first}, a reminder that {invoice} for {amount} is due {due}. Pay here: {pay_link}. Already paid? Tap 'I've paid' so I can confirm it. Thank you!";
const DEFAULT_REMINDER_SUBJECT = 'Invoice {invoice} · {amount} due {due}';

/** Fill missing fields (older rows stored only { mode, unitPriceCents }). */
function normalise_billing(?array $raw, ?string $spaceMode = 'course'): array
{
    $spaceMode ??= 'course';
    $per = $raw['per'] ?? (in_array($spaceMode, ['client', 'workshop', 'team'], true) ? 'session' : 'member');
    $model = $raw['model'] ?? ($raw['mode'] ?? ($spaceMode === 'team' ? 'free' : 'per_session'));
    $rest = $raw ?? [];
    unset($rest['mode']);
    $payers = is_array($raw['payers'] ?? null) ? $raw['payers'] : [];
    return array_merge(DEFAULT_BILLING, $rest, ['model' => $model, 'per' => $per, 'payers' => $payers]);
}

/** Re-price a row from the space policy (status changes; invoiced rows stay frozen). */
function price_row(array $row, array $b): array
{
    if (!empty($row['invoiceId'])) return ['billable' => $row['billable'], 'unitPriceCents' => $row['unitPriceCents'], 'amountCents' => $row['amountCents']];
    $unit = (int) ($b['unitPriceCents'] ?? 0);
    $billable = ($b['model'] ?? '') !== 'free' && in_array($row['status'] ?? null, is_array($b['billable'] ?? null) ? $b['billable'] : [], true);
    if (!$billable) return ['billable' => false, 'unitPriceCents' => $unit, 'amountCents' => 0];
    if ($b['model'] === 'per_hour') {
        $minutes = $row['minutes'] ?? 0;
        return ['billable' => true, 'unitPriceCents' => $unit, 'amountCents' => prorate($unit, is_int($minutes) || is_float($minutes) ? $minutes : (float) $minutes)];
    }
    if ($b['model'] === 'monthly' || $b['model'] === 'package') return ['billable' => true, 'unitPriceCents' => 0, 'amountCents' => 0];
    return ['billable' => true, 'unitPriceCents' => $unit, 'amountCents' => $unit];
}

/**
 * Draft one invoice per payer from unbilled billable rows (I3). Grouping: payer → members → space
 * (siblings combine unless a space turns that off). per_session = count × price; per_hour = total
 * minutes / 60 × rate; monthly = one line per member (or per space); makeup credits are negative
 * lines. Package rows are skipped. Rows without a payer produce a draft that needs attention.
 *
 * @param array $opts names?: array<string,string>, monthLabel?: string, credits?: array<string,int>, monthly?: list<array{spaceId,memberId,payerId}>
 */
function draft_invoices(array $rows, array $billing, array $opts = []): array
{
    $names = $opts['names'] ?? [];
    $credits = $opts['credits'] ?? [];
    $items = [];
    foreach ($rows as $r) {
        if (empty($r['billable']) || !empty($r['invoiceId']) || !empty($r['packageId'])) continue;
        if (($billing[$r['spaceId']]['model'] ?? 'per_session') === 'monthly') continue;
        $items[] = ['spaceId' => (string) $r['spaceId'], 'memberId' => (string) $r['memberId'], 'payerId' => $r['payerId'] ?? null, 'row' => $r];
    }
    foreach ($opts['monthly'] ?? [] as $m) $items[] = ['spaceId' => (string) $m['spaceId'], 'memberId' => (string) $m['memberId'], 'payerId' => $m['payerId'] ?? null, 'row' => null];

    $byPayer = [];
    foreach ($items as $it) {
        $combine = $billing[$it['spaceId']]['combineSiblings'] ?? true;
        $pid = $it['payerId'];
        $hasPayer = is_string($pid) && $pid !== '';
        $k = $hasPayer ? ($combine ? $pid : "{$pid}|{$it['memberId']}") : "__none__{$it['memberId']}";
        $byPayer[$k][] = $it;
    }

    $out = [];
    foreach ($byPayer as $key => $list) {
        $key = (string) $key;
        $payerId = str_starts_with($key, '__none__') ? null : explode('|', $key)[0];
        $lines = [];
        $groups = [];
        foreach ($list as $it) $groups["{$it['memberId']}|{$it['spaceId']}"][] = $it;
        foreach ($groups as $g => $its) {
            $parts = explode('|', (string) $g);
            $memberId = $parts[0];
            $spaceId = $parts[1] ?? '';
            $b = $billing[$spaceId] ?? DEFAULT_BILLING;
            $who = $names[$memberId] ?? 'Member';
            $rs = [];
            foreach ($its as $i) if ($i['row'] !== null) $rs[] = $i['row'];
            $base = ['spaceId' => $spaceId, 'memberId' => $memberId, 'logIds' => array_map(fn ($r) => $r['id'], $rs), 'sessionIds' => array_map(fn ($r) => $r['sessionId'], $rs)];
            if (($b['model'] ?? '') === 'monthly') {
                $unit = (int) ($b['unitPriceCents'] ?? 0);
                $lines[] = $base + ['kind' => 'monthly', 'description' => "$who · " . (($opts['monthLabel'] ?? '') ?: 'monthly'), 'qty' => 1, 'unitCents' => $unit, 'amountCents' => $unit];
            } elseif (($b['model'] ?? '') === 'per_hour') {
                $minutes = sum($rs, fn ($r) => $r['minutes']);
                $lines[] = $base + ['kind' => 'hours', 'description' => "$who · " . duration_label($minutes), 'qty' => round(($minutes / 60) * 100) / 100, 'unitCents' => (int) ($b['unitPriceCents'] ?? 0), 'amountCents' => (int) sum($rs, fn ($r) => $r['amountCents'])];
            } elseif ($rs) {
                $unit = (int) ($rs[0]['unitPriceCents'] ?? ($b['unitPriceCents'] ?? 0));
                $n = count($rs);
                $lines[] = $base + ['kind' => 'sessions', 'description' => "$who · $n session" . ($n === 1 ? '' : 's'), 'qty' => $n, 'unitCents' => $unit, 'amountCents' => (int) sum($rs, fn ($r) => $r['amountCents'])];
                $attended = count(array_filter($rs, fn ($r) => ($r['status'] ?? '') === 'attended'));
                $c = min((int) ($credits[$memberId] ?? 0), $attended);
                if ($c > 0 && $unit > 0) {
                    $credits[$memberId] = (int) ($credits[$memberId] ?? 0) - $c;
                    $lines[] = ['spaceId' => $spaceId, 'memberId' => $memberId, 'logIds' => [], 'sessionIds' => [], 'kind' => 'credit', 'description' => "$who · makeup credit" . ($c === 1 ? '' : 's'), 'qty' => $c, 'unitCents' => -$unit, 'amountCents' => -$unit * $c];
                }
            }
        }
        if (!$lines) continue;
        $out[] = ['payerId' => $payerId, 'lines' => $lines, 'totalCents' => (int) sum($lines, fn ($l) => $l['amountCents']), 'needsAttention' => $payerId !== null ? null : 'no payer set'];
    }
    // Stable (PHP 8): drafts that need attention go last, the rest keep their order.
    usort($out, fn ($a, $b) => ($a['needsAttention'] ? 1 : 0) <=> ($b['needsAttention'] ? 1 : 0));
    return $out;
}

/** 183 → "3 h 3 min"; 120 → "2 h"; 45 → "45 min". */
function duration_label(int|float $minutes): string
{
    $h = (int) floor($minutes / 60);
    $m = (int) round(fmod((float) $minutes, 60.0));
    if (!$h) return "$m min";
    return $m ? "$h h $m min" : "$h h";
}

/**
 * Invoice numbers follow Figma I1/I3: "LF-0418". The sequence continues from the highest number
 * issued (revision suffixes like "-B" ignored) or the host's "Next number", whichever is higher.
 */
function next_invoice_number(array $existing, string $prefix, int|float $floor = 1): string
{
    $stem = "$prefix-";
    $max = 0;
    foreach ($existing as $n) {
        if (!is_string($n) || !str_starts_with($n, $stem)) continue;
        $num = preg_match('/^\d+/', substr($n, strlen($stem)), $m) ? (int) $m[0] : 0;
        $max = max($max, $num);
    }
    return $stem . str_pad((string) max($max + 1, (int) $floor), 4, '0', STR_PAD_LEFT);
}

/** Receipt RC-0412 for the first payment on LF-0412, then RC-0412-2, -3 for part payments. */
function receipt_number(string $invoiceNumber, int $paymentIndex): string
{
    $seq = preg_match('/-(\d+)(?:-[A-Z])?$/', $invoiceNumber, $m) ? $m[1] : '0000';
    return "RC-$seq" . ($paymentIndex > 0 ? '-' . ($paymentIndex + 1) : '');
}

/** Revision suffix for an edited, already-sent invoice: LF-0412 → LF-0412-B → LF-0412-C. */
function revision_number(string $number): string
{
    if (preg_match('/^(.*)-([B-Y])$/', $number, $m)) return $m[1] . '-' . chr(ord($m[2]) + 1);
    return "$number-B";
}

/** JS encodeURIComponent (leaves ! * ' ( ) alone, unlike rawurlencode). */
function mon_uri_component(string $s): string
{
    return strtr(rawurlencode($s), ['%21' => '!', '%2A' => '*', '%27' => "'", '%28' => '(', '%29' => ')']);
}

/** wa.me deep link the host taps (Loft never sends WhatsApp messages itself). */
function whatsapp_link(?string $phone, string $text): string
{
    $digits = preg_replace('/\D/', '', $phone ?? '') ?? '';
    return "https://wa.me/$digits?text=" . mon_uri_component($text);
}

/** Fill a reminder template: {payer_first} {amount} {invoice} {due} {pay_link} {members}. */
function fill_template(string $template, array $vars): string
{
    return preg_replace_callback('/\{(\w+)\}/', fn ($m) => isset($vars[$m[1]]) ? (string) $vars[$m[1]] : $m[0], $template) ?? $template;
}

function mon_has_open_claim(array $inv): bool
{
    foreach ($inv['claims'] ?? [] as $c) if (($c['status'] ?? '') === 'open') return true;
    return false;
}

function paid_total(array $inv): int
{
    $n = 0;
    foreach ($inv['payments'] ?? [] as $p) $n += (int) ($p['amountCents'] ?? 0);
    return $n;
}

function balance_due(array $inv): int
{
    return max(0, (int) ($inv['totalCents'] ?? 0) - paid_total($inv));
}

/** Draft → Sent → Viewed → Payer says paid → Paid (or Partly paid) · Overdue · Void. */
function invoice_status(array $inv, int $now): string
{
    $status = $inv['status'] ?? 'draft';
    if ($status === 'void') return 'void';
    if ($status === 'draft') return 'draft';
    $paid = paid_total($inv);
    if ($paid >= (int) ($inv['totalCents'] ?? 0)) return 'paid';
    if (mon_has_open_claim($inv)) return 'claimed';
    if (is_overdue($inv, $now)) return 'overdue';
    if ($paid > 0) return 'partial';
    return !empty($inv['viewedAt']) ? 'viewed' : 'sent';
}

/** Overdue = past due, balance > 0, no open claim (Insights uses the same rule). */
function is_overdue(array $inv, int $now): bool
{
    return ($inv['status'] ?? '') === 'sent' && !empty($inv['dueAt']) && ms((string) $inv['dueAt']) < $now && balance_due($inv) > 0 && !mon_has_open_claim($inv);
}

/** The reminder step due now (latest passed step not yet sent). Claims and pauses stop it; payment ends it. */
function reminder_due(array $inv, array $steps, array $sentOffsets, int $now, bool $paused = false): ?array
{
    if ($paused || ($inv['status'] ?? '') !== 'sent' || empty($inv['dueAt']) || balance_due($inv) === 0 || mon_has_open_claim($inv)) return null;
    $due = ms((string) $inv['dueAt']);
    $passed = [];
    foreach ($steps as $s) {
        if ($due + (int) round($s['offsetDays'] * DAY) <= $now && !in_array($s['offsetDays'], $sentOffsets)) $passed[] = $s;
    }
    return $passed ? $passed[count($passed) - 1] : null;
}

/** When the next reminder goes out (null when none left). */
function next_reminder_at(array $inv, array $steps, array $sentOffsets): ?int
{
    if (empty($inv['dueAt'])) return null;
    $due = ms((string) $inv['dueAt']);
    $done = $sentOffsets ? max($sentOffsets) : -INF;
    $next = array_values(array_filter($steps, fn ($s) => $s['offsetDays'] > $done && !in_array($s['offsetDays'], $sentOffsets)));
    usort($next, fn ($a, $b) => $a['offsetDays'] <=> $b['offsetDays']);
    return $next ? $due + (int) round($next[0]['offsetDays'] * DAY) : null;
}

/** "$35.00" the way the TS template fills {amount} (toFixed(2), no thousands separator). */
function mon_dollars(int $cents): string
{
    return '$' . number_format($cents / 100, 2, '.', '');
}

/** The template variables of a reminder (also used for the email subject). */
function mon_reminder_vars(array $input): array
{
    $name = (string) ($input['payerName'] ?? '');
    return [
        'payer_first' => explode(' ', $name)[0],
        'amount' => mon_dollars((int) ($input['amountCents'] ?? 0)),
        'invoice' => (string) ($input['number'] ?? ''),
        'due' => short_date((string) ($input['dueAt'] ?? '')),
        'pay_link' => (string) ($input['payLink'] ?? ''),
        'members' => (string) ($input['members'] ?? ''),
    ];
}

/** @param array $input payerName, number, amountCents, dueAt, payLink, members?, template?, final? */
function reminder_message(array $input): string
{
    $text = fill_template((string) (($input['template'] ?? '') ?: DEFAULT_REMINDER_TEXT), mon_reminder_vars($input));
    return !empty($input['final']) ? "Final reminder: $text" : $text;
}

/** Resolve the pay link for one payer: same link, a {amount} template, or a per-payer override. */
function resolve_payment_link(?array $s, ?string $payerId, int $amountCents, string $reference, ?string $spaceOverride = null): ?string
{
    if ($spaceOverride !== null && $spaceOverride !== '') return fill_payment_link($spaceOverride, $amountCents, $reference);
    if ($s === null) return null;
    $mode = $s['mode'] ?? 'same';
    if ($mode === 'per_payer' && $payerId && !empty($s['perPayer'][$payerId])) return fill_payment_link((string) $s['perPayer'][$payerId], $amountCents, $reference);
    if ($mode === 'template' && !empty($s['template'])) return fill_payment_link((string) $s['template'], $amountCents, $reference);
    return !empty($s['link']) ? fill_payment_link((string) $s['link'], $amountCents, $reference) : null;
}

/** Package credits: purchase (+n, active once paid), use (−1), credit (+1 makeup), expiry (−n). */
function ledger_balance(array $rows): int
{
    $n = 0;
    foreach ($rows as $r) {
        if (empty($r['active'])) continue;
        $q = abs((int) ($r['qty'] ?? 0));
        $n += (($r['kind'] ?? '') === 'use' || ($r['kind'] ?? '') === 'expiry') ? -$q : $q;
    }
    return $n;
}

function needs_renewal(int $balance, int $threshold, bool $openRenewal): bool
{
    return !$openRenewal && $balance <= $threshold;
}

function mon_csv_cell(mixed $v): string
{
    $s = $v === null ? '' : (is_bool($v) ? ($v ? 'true' : 'false') : (is_scalar($v) ? (string) $v : (string) json_encode($v)));
    return preg_match('/[",\n]/', $s) ? '"' . str_replace('"', '""', $s) . '"' : $s;
}

/** @param list<array{key: string, label: string, format?: callable(mixed, array): string}> $columns */
function to_csv(array $rows, array $columns): string
{
    $head = implode(',', array_map(fn ($c) => mon_csv_cell($c['label']), $columns));
    $body = array_map(fn ($r) => implode(',', array_map(fn ($c) => mon_csv_cell(isset($c['format']) ? ($c['format'])($r[$c['key']] ?? null, $r) : ($r[$c['key']] ?? null)), $columns)), $rows);
    return implode("\n", array_merge([$head], $body)) . "\n";
}
