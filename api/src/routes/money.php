<?php
declare(strict_types=1);

namespace Loft;

// M7 resources (Figma 06 · row B): billing setup, session log, invoice runs, invoice detail, packages &
// credits, confirming payments, reminders, and the payer's pay page. Money never touches Loft: invoices
// carry the host's own payment link, payers tap "I've paid", the host confirms.
// Port of packages/data/src/local/routes-money.ts. Server-only: invoices, email reminders and receipts
// also go out by email (send_mail); WhatsApp is never sent, only queued for the host to tap.

const MON_STATUSES = ['attended', 'absent', 'excused', 'late_cancel', 'no_show'];

function mon_is_num(mixed $v): bool
{
    return is_int($v) || is_float($v);
}

/** Number(v) for the few inputs the TS reads with Number(): numbers, numeric strings, booleans; else 0. */
function mon_num(mixed $v): int|float
{
    if (is_int($v) || is_float($v)) return $v;
    if (is_bool($v)) return $v ? 1 : 0;
    if (is_string($v) && is_numeric(trim($v))) return 0 + trim($v);
    return 0;
}

/** TS firstName: the part before the first space (no trimming). */
function mon_first(string $n): string
{
    return explode(' ', $n)[0];
}

function mon_usd(mixed $cents, bool $dropZeroCents = false): string
{
    return format_usd((int) $cents, $dropZeroCents);
}

// ---- settings ----

function money_settings(Ctx $ctx, string $hostId): array
{
    $defaults = [
        'id' => $hostId,
        'prefix' => 'LF',
        'nextNumber' => 1,
        'footer' => '',
        'brandLine' => '',
        'paymentLink' => ['mode' => 'same', 'link' => '', 'template' => '', 'perPayer' => []],
        'reminders' => ['steps' => DEFAULT_REMINDERS, 'subject' => DEFAULT_REMINDER_SUBJECT, 'text' => DEFAULT_REMINDER_TEXT],
        'packages' => ['renew' => true, 'renewAt' => 2, 'expire' => true, 'expireDays' => 60, 'warnDays' => 7, 'excusedCredit' => true],
        'pausedPayers' => [],
        'lastAutoRun' => '',
        'lastDaily' => '',
    ];
    $s = $ctx->db->get('money_settings', $hostId);
    if ($s) return $s + $defaults;
    $legacy = $ctx->db->get('settings', $hostId);
    $defaults['paymentLink']['link'] = (string) ($legacy['paymentLink'] ?? '');
    return $defaults;
}

/** Settings as JSON: perPayer is an object even when empty. */
function mon_settings_out(array $s): array
{
    $s['paymentLink']['perPayer'] = obj(is_array($s['paymentLink']['perPayer'] ?? null) ? $s['paymentLink']['perPayer'] : []);
    $s['pausedPayers'] = array_values($s['pausedPayers'] ?? []);
    return $s;
}

function mon_save_settings(Ctx $ctx, array $s): void
{
    $ctx->db->put('money_settings', mon_settings_out($s));
}

// ---- spaces, people ----

function mon_hosted_spaces(Ctx $ctx, string $hostId): array
{
    $out = [];
    foreach ($ctx->db->list('memberships', fn ($m) => ($m['userId'] ?? null) === $hostId && ($m['role'] ?? null) === 'host') as $m) {
        $s = $ctx->db->get('spaces', (string) $m['spaceId']);
        if ($s) $out[] = $s;
    }
    return $out;
}

function billing_for(?array $space): array
{
    return normalise_billing(is_array($space['billing'] ?? null) ? $space['billing'] : null, isset($space['mode']) ? (string) $space['mode'] : null);
}

/** Billing as JSON/stored: payers is an object even when empty. */
function mon_billing_out(array $b): array
{
    $b['payers'] = obj(is_array($b['payers'] ?? null) ? $b['payers'] : []);
    return $b;
}

function mon_user_map(Ctx $ctx): array
{
    return index_by($ctx->db->list('users'), fn ($u) => $u['id']);
}

/** Display names for log members, including the "space:<id>" member used by per-session spaces. */
function mon_name_map(Ctx $ctx, array $spaces): array
{
    $names = [];
    foreach ($ctx->db->list('users') as $u) $names[(string) $u['id']] = $u['name'] ?? null;
    foreach ($spaces as $s) $names['space:' . $s['id']] = $s['name'] ?? null;
    return $names;
}

function mon_require_host_of(Ctx $ctx, string $spaceId): array
{
    $me = require_me($ctx);
    $m = $ctx->db->get('memberships', "$spaceId:{$me['id']}");
    if (!$m || ($m['role'] ?? null) !== 'host') throw new Forbidden('Only the host sees billing');
    return $me;
}

function mon_invoice_or_404(Ctx $ctx, string $id, string $hostId): array
{
    $inv = $ctx->db->get('invoices', $id);
    if (!$inv || ($inv['hostId'] ?? null) !== $hostId) throw new NotFound('Invoice not found');
    return $inv;
}

// ---- packages & makeup credits ----

function mon_package_ledger(Ctx $ctx, string $packageId): array
{
    return sorted($ctx->db->list('credits', fn ($c) => ($c['packageId'] ?? null) === $packageId), fn ($a, $b) => strcmp((string) $a['at'], (string) $b['at']));
}

function mon_active_package(Ctx $ctx, string $spaceId, string $memberId): ?array
{
    $pkgs = sorted($ctx->db->list('packages', fn ($p) => ($p['spaceId'] ?? null) === $spaceId && ($p['memberId'] ?? null) === $memberId), fn ($a, $b) => strcmp((string) $a['createdAt'], (string) $b['createdAt']));
    foreach ($pkgs as $p) {
        $ledger = mon_package_ledger($ctx, (string) $p['id']);
        if (some($ledger, fn ($r) => $r['kind'] === 'purchase' && !empty($r['active'])) && ledger_balance($ledger) > 0) return $p;
    }
    return null;
}

function mon_makeup_credits(Ctx $ctx, string $hostId): array
{
    return $ctx->db->list('credits', fn ($c) => ($c['hostId'] ?? null) === $hostId && ($c['kind'] ?? null) === 'credit' && empty($c['packageId']) && empty($c['usedBy']) && empty($c['expired']));
}

// ---- session log ----

/**
 * Write (or re-price) one log row from the space policy. Invoiced rows are frozen.
 * @param array $s session: id, spaceId, startsAt, minutes, title
 * @param array $a attendance: memberId, minutes, status
 */
function mon_apply_log(Ctx $ctx, array $s, array $space, array $a): array
{
    $b = billing_for($space);
    $hostId = (string) $space['createdBy'];
    $settings = money_settings($ctx, $hostId);
    $memberId = (string) $a['memberId'];
    $status = (string) ($a['status'] ?? 'absent');
    $minutes = mon_num($a['minutes'] ?? 0);
    $startsAt = (string) $s['startsAt'];
    $id = $s['id'] . ':' . $memberId;
    $cur = $ctx->db->get('session_log', $id);
    if ($cur && !empty($cur['invoiceId'])) return $cur;
    $ctx->db->del('credits', "use:$id");
    $oldCredit = $ctx->db->get('credits', "credit:$id");
    if ($oldCredit && empty($oldCredit['usedBy'])) $ctx->db->del('credits', "credit:$id");
    $payerId = $b['per'] === 'session' ? ($b['payers']['*'] ?? null) : ($b['payers'][$memberId] ?? null);
    $priced = price_row(['status' => $status, 'minutes' => $minutes, 'invoiceId' => null, 'unitPriceCents' => 0, 'amountCents' => 0, 'billable' => false], $b);
    $packageId = null;
    if ($priced['billable'] && $b['per'] === 'member') {
        $pkg = mon_active_package($ctx, (string) $space['id'], $memberId);
        if ($pkg) {
            $packageId = $pkg['id'];
            $priced['amountCents'] = 0;
            $ctx->db->put('credits', ['id' => "use:$id", 'hostId' => $hostId, 'spaceId' => $space['id'], 'memberId' => $memberId, 'payerId' => $pkg['payerId'] ?? null, 'packageId' => $pkg['id'], 'kind' => 'use', 'qty' => 1, 'active' => true, 'at' => $startsAt, 'note' => $status === 'attended' ? 'Attended' : ($status === 'late_cancel' ? 'Late cancel (billable)' : 'No-show (billable)'), 'logId' => $id]);
        }
    }
    if ($status === 'excused' && $b['excused'] === 'makeup' && !empty($settings['packages']['excusedCredit']) && empty($oldCredit['usedBy'])) {
        $expireDays = mon_num($settings['packages']['expireDays'] ?? 60);
        $ctx->db->put('credits', ['id' => "credit:$id", 'hostId' => $hostId, 'spaceId' => $space['id'], 'memberId' => $memberId, 'payerId' => $payerId, 'packageId' => null, 'kind' => 'credit', 'qty' => 1, 'active' => true, 'at' => $startsAt, 'note' => 'Makeup credit · excused ' . short_date($startsAt), 'expiresAt' => !empty($settings['packages']['expire']) ? iso(ms($startsAt) + (int) round($expireDays * DAY)) : null, 'logId' => $id, 'usedBy' => null, 'expired' => false]);
    }
    $row = ['id' => $id, 'sessionId' => $s['id'], 'spaceId' => $space['id'], 'memberId' => $memberId, 'payerId' => $payerId, 'minutes' => (int) round($minutes), 'status' => $status, 'billable' => $priced['billable'], 'unitPriceCents' => $priced['unitPriceCents'], 'amountCents' => $priced['amountCents'], 'invoiceId' => null, 'at' => $startsAt, 'title' => $s['title'] ?? null, 'packageId' => $packageId];
    $ctx->db->put('session_log', $row);
    return $row;
}

/**
 * Wrap-up (P6) and auto-wrap call this: one row per member, or one per session for client spaces.
 * @param array $session id, spaceId, startsAt, minutes, title
 * @param list<array{memberId: string, minutes: int|float, status: string}> $rows
 */
function record_attendance(Ctx $ctx, array $session, array $rows): array
{
    $space = $ctx->db->get('spaces', (string) ($session['spaceId'] ?? ''));
    if (!$space) return [];
    $b = billing_for($space);
    $out = [];
    if ($b['per'] === 'session') {
        $attended = array_values(array_filter($rows, fn ($r) => ($r['status'] ?? null) === 'attended'));
        $status = $attended ? 'attended' : (some($rows, fn ($r) => ($r['status'] ?? null) === 'late_cancel') ? 'late_cancel' : (some($rows, fn ($r) => ($r['status'] ?? null) === 'no_show') ? 'no_show' : 'absent'));
        $minutes = 0;
        if ($attended) $minutes = max(0, ...array_map(fn ($r) => mon_num($r['minutes'] ?? 0), $attended)) ?: mon_num($session['minutes'] ?? 0);
        $out[] = mon_apply_log($ctx, $session, $space, ['memberId' => 'space:' . $space['id'], 'minutes' => $minutes, 'status' => $status]);
    } else {
        foreach ($rows as $r) $out[] = mon_apply_log($ctx, $session, $space, $r);
    }
    if ($b['schedule'] === 'after_session') build_drafts($ctx, (string) $space['createdBy'], month_key(ms((string) $session['startsAt'])), ['sessionId' => (string) $session['id']]);
    return $out;
}

// ---- invoice runs ----

function mon_blank_invoice(Ctx $ctx, string $hostId, array $extra): array
{
    return array_merge([
        'id' => new_id('inv'),
        'hostId' => $hostId,
        'number' => null,
        'payerId' => null,
        'memberIds' => [],
        'period' => month_key($ctx->now()),
        'kind' => 'monthly',
        'lines' => [],
        'totalCents' => 0,
        'status' => 'draft',
        'needsAttention' => null,
        'createdAt' => $ctx->nowIso(),
        'sentAt' => null,
        'dueAt' => null,
        'viewedAt' => null,
        'viewCount' => 0,
        'payments' => [],
        'claims' => [],
        'comments' => [],
        'remindersSent' => [],
        'waPending' => null,
        'activity' => [],
        'payToken' => new_id('pay'),
    ], $extra);
}

/**
 * Build drafts from unbilled rows up to the end of `month` (I3): one per payer. Untouched auto drafts
 * for the same scope are rebuilt; edited drafts keep their rows. Nothing is sent.
 * @param array $opts sessionId?: string, auto?: bool
 */
function build_drafts(Ctx $ctx, string $hostId, string $month, array $opts = []): array
{
    $spaces = mon_hosted_spaces($ctx, $hostId);
    $ids = [];
    $billing = [];
    foreach ($spaces as $s) {
        $ids[(string) $s['id']] = true;
        $billing[(string) $s['id']] = billing_for($s);
    }
    $sessionId = !empty($opts['sessionId']) ? (string) $opts['sessionId'] : null;
    $kind = $sessionId !== null ? 'session' : 'monthly';
    foreach ($ctx->db->list('invoices', fn ($i) => ($i['hostId'] ?? null) === $hostId && $i['status'] === 'draft' && empty($i['edited']) && ($i['kind'] ?? null) === $kind) as $inv) {
        if ($sessionId !== null ? ($inv['sessionId'] ?? null) === $sessionId : ($inv['period'] ?? null) === $month) $ctx->db->del('invoices', (string) $inv['id']);
    }
    $rest = $ctx->db->list('invoices', fn ($i) => ($i['hostId'] ?? null) === $hostId && $i['status'] !== 'void');
    $held = [];
    foreach ($rest as $i) {
        if ($i['status'] !== 'draft') continue;
        foreach ($i['lines'] ?? [] as $l) foreach ($l['logIds'] ?? [] as $lid) $held[(string) $lid] = true;
    }
    $end = month_range($month)['end'];
    $rows = $ctx->db->list('session_log', fn ($r) => isset($ids[(string) ($r['spaceId'] ?? '')]) && empty($r['invoiceId']) && strcmp((string) $r['at'], $end) < 0 && ($sessionId === null || ($r['sessionId'] ?? null) === $sessionId));
    $rows = array_values(array_filter($rows, fn ($r) => !isset($held[(string) $r['id']]) && ($billing[(string) $r['spaceId']]['schedule'] ?? null) !== 'package_out'));
    $monthly = [];
    if ($sessionId === null && strcmp($month, month_key($ctx->now())) <= 0) {
        $billed = [];
        foreach ($rest as $i) {
            if (($i['period'] ?? null) !== $month) continue;
            foreach ($i['lines'] ?? [] as $l) if (($l['kind'] ?? null) === 'monthly') $billed[($l['spaceId'] ?? '') . '|' . ($l['memberId'] ?? '')] = true;
        }
        foreach ($spaces as $s) {
            $b = $billing[(string) $s['id']];
            if ($b['model'] !== 'monthly') continue;
            if ($b['per'] === 'session') $who = [['memberId' => 'space:' . $s['id'], 'payerId' => $b['payers']['*'] ?? null]];
            else $who = array_map(fn ($m) => ['memberId' => (string) $m['userId'], 'payerId' => $b['payers'][$m['userId']] ?? null], $ctx->db->list('memberships', fn ($m) => ($m['spaceId'] ?? null) === $s['id'] && ($m['role'] ?? null) !== 'host' && ($m['role'] ?? null) !== 'cohost'));
            foreach ($who as $w) if (!isset($billed[$s['id'] . '|' . $w['memberId']])) $monthly[] = ['spaceId' => (string) $s['id'], 'memberId' => $w['memberId'], 'payerId' => $w['payerId']];
        }
    }
    $credits = [];
    foreach (mon_makeup_credits($ctx, $hostId) as $c) $credits[(string) $c['memberId']] = ($credits[(string) $c['memberId']] ?? 0) + 1;
    $names = mon_name_map($ctx, $spaces);
    $drafts = draft_invoices($rows, $billing, ['names' => $names, 'monthLabel' => explode(' ', month_label($month))[0], 'credits' => $credits, 'monthly' => $monthly]);
    $out = [];
    foreach ($drafts as $d) {
        $memberIds = [];
        foreach ($d['lines'] as $l) if (is_string($l['memberId'] ?? null) && $l['memberId'] !== '' && !in_array($l['memberId'], $memberIds, true)) $memberIds[] = $l['memberId'];
        $inv = mon_blank_invoice($ctx, $hostId, [
            'payerId' => $d['payerId'],
            'memberIds' => $memberIds,
            'period' => $month,
            'kind' => $kind,
            'sessionId' => $sessionId,
            'lines' => $d['lines'],
            'totalCents' => $d['totalCents'],
            'needsAttention' => $d['needsAttention'],
            'activity' => [['kind' => 'drafted', 'at' => $ctx->nowIso(), 'text' => !empty($opts['auto']) ? 'Drafted automatically' : 'Drafted']],
        ]);
        $ctx->db->put('invoices', $inv);
        $out[] = $inv;
    }
    $ctx->changed('invoices');
    return $out;
}

/** After a payer or status change, rebuild untouched drafts so they never go stale. */
function mon_rebuild_open_drafts(Ctx $ctx, string $hostId): void
{
    $periods = [];
    foreach ($ctx->db->list('invoices', fn ($i) => ($i['hostId'] ?? null) === $hostId && $i['status'] === 'draft' && empty($i['edited']) && ($i['kind'] ?? null) === 'monthly') as $i) $periods[(string) $i['period']] = true;
    foreach (array_keys($periods) as $m) build_drafts($ctx, $hostId, (string) $m);
}

// ---- views ----

function mon_view_ctx(Ctx $ctx, string $hostId): array
{
    $users = mon_user_map($ctx);
    return ['users' => $users, 'spaces' => index_by($ctx->db->list('spaces'), fn ($s) => $s['id']), 'settings' => money_settings($ctx, $hostId), 'host' => $users[$hostId] ?? null, 'now' => $ctx->now()];
}

function mon_member_name(array $v, ?string $id): string
{
    if ($id === null || $id === '') return '—';
    if (str_starts_with($id, 'space:')) return (string) ($v['spaces'][substr($id, 6)]['name'] ?? 'Space');
    return (string) ($v['users'][$id]['name'] ?? 'Member');
}

/** "Ayaan + Nabila · combined · 15 sessions" (I3 rows). */
function mon_summary(array $v, array $inv): string
{
    $payerId = $inv['payerId'] ?? null;
    $members = array_map(fn ($m) => $m === $payerId ? 'self' : mon_first(mon_member_name($v, (string) $m)), $inv['memberIds'] ?? []);
    $lines = $inv['lines'] ?? [];
    $sessions = 0;
    $minutes = 0;
    $credits = 0;
    foreach ($lines as $l) {
        $kind = $l['kind'] ?? '';
        if ($kind === 'sessions') $sessions += mon_num($l['qty'] ?? 0);
        elseif ($kind === 'hours') $minutes += mon_num($l['qty'] ?? 0) * 60;
        elseif ($kind === 'credit') $credits += mon_num($l['qty'] ?? 0);
    }
    $parts = [implode(' + ', $members) ?: '—'];
    if (count($members) > 1) $parts[] = 'combined';
    if (($inv['kind'] ?? '') === 'package') $parts[] = implode(' · ', array_slice(explode(' · ', (string) ($lines[0]['description'] ?? '')), 1)) ?: 'package';
    if ($sessions) $parts[] = "$sessions session" . ($sessions == 1 ? '' : 's');
    if ($minutes) $parts[] = (round(($minutes / 60) * 10) / 10) . ' h';
    if (some($lines, fn ($l) => ($l['kind'] ?? '') === 'monthly')) $parts[] = 'monthly';
    if ($credits) $parts[] = "$credits credit" . ($credits == 1 ? '' : 's') . ' used';
    return implode(' · ', $parts);
}

function mon_pay_link_for(array $v, array $inv): ?string
{
    $space = $v['spaces'][(string) ($inv['lines'][0]['spaceId'] ?? '')] ?? null;
    $override = $space ? billing_for($space)['paymentLink'] : null;
    $settingsLink = $v['settings']['paymentLink'] ?? null;
    return resolve_payment_link(is_array($settingsLink) ? $settingsLink : null, $inv['payerId'] ?? null, balance_due($inv) ?: (int) $inv['totalCents'], (string) ($inv['number'] ?? ''), is_string($override) ? $override : null);
}

function mon_list_view(array $v, array $inv): array
{
    $status = invoice_status($inv, $v['now']);
    $steps = $v['settings']['reminders']['steps'] ?? [];
    $sentOffsets = $inv['remindersSent'] ?? [];
    $next = $inv['status'] === 'sent' && balance_due($inv) > 0 ? next_reminder_at($inv, $steps, $sentOffsets) : null;
    $payerId = $inv['payerId'] ?? null;
    $payer = $payerId ? ($v['users'][$payerId] ?? null) : null;
    $credit = 0;
    foreach ($inv['lines'] ?? [] as $l) if (($l['kind'] ?? '') === 'credit') $credit += (int) ($l['amountCents'] ?? 0);
    $tags = [];
    if (($inv['kind'] ?? '') === 'package') $tags[] = 'package renewal';
    if ($credit) $tags[] = 'credit −' . mon_usd(-$credit, true);
    $overdue = is_overdue($inv, $v['now']) && !empty($inv['dueAt']);
    return [
        'id' => $inv['id'],
        'number' => $inv['number'] ?? null,
        'kind' => $inv['kind'] ?? 'monthly',
        'period' => $inv['period'] ?? null,
        'payerId' => $payerId,
        'payerName' => $payer['name'] ?? ($payerId ? 'Payer' : mon_member_name($v, $inv['memberIds'][0] ?? null)),
        'payerPhone' => $payer['phone'] ?? null,
        'payerEmail' => $payer['email'] ?? null,
        'summary' => mon_summary($v, $inv),
        'tags' => $tags,
        'totalCents' => (int) $inv['totalCents'],
        'paidCents' => paid_total($inv),
        'balanceCents' => balance_due($inv),
        'status' => $status,
        'statusLabel' => INVOICE_STATUS_LABEL[$status],
        'needsAttention' => $inv['needsAttention'] ?? null,
        'sentAt' => $inv['sentAt'] ?? null,
        'dueAt' => $inv['dueAt'] ?? null,
        'overdueDays' => $overdue ? (int) floor(($v['now'] - ms((string) $inv['dueAt'])) / DAY) : 0,
        'nextReminderAt' => $next,
        'nextReminderDays' => $next === null ? null : max(0, (int) ceil(($next - $v['now']) / DAY)),
        'finalSent' => some($steps, fn ($s) => !empty($s['final']) && in_array($s['offsetDays'], $sentOffsets)),
        'paused' => !empty($payerId) && in_array($payerId, $v['settings']['pausedPayers'] ?? [], true),
        'openClaims' => count(array_filter($inv['claims'] ?? [], fn ($c) => ($c['status'] ?? '') === 'open')),
        'payPath' => '/pay/' . $inv['payToken'],
        'members' => implode(', ', array_map(fn ($m) => mon_member_name($v, (string) $m), $inv['memberIds'] ?? [])),
    ];
}

function mon_detail_view(Ctx $ctx, array $v, array $inv): array
{
    $rows = [];
    foreach ($inv['lines'] ?? [] as $l) {
        foreach ($l['logIds'] ?? [] as $id) {
            $r = $ctx->db->get('session_log', (string) $id);
            if ($r) $rows[(string) $id] = $r;
        }
    }
    $lines = [];
    foreach (array_values($inv['lines'] ?? []) as $idx => $l) {
        $space = $v['spaces'][(string) ($l['spaceId'] ?? '')] ?? null;
        $items = [];
        foreach ($l['logIds'] ?? [] as $id) if (isset($rows[(string) $id])) $items[] = $rows[(string) $id];
        $items = sorted($items, fn ($a, $b) => strcmp((string) $b['at'], (string) $a['at']));
        $lines[] = array_merge($l, [
            'idx' => $idx,
            'spaceCode' => $space['code'] ?? '',
            'spaceSlug' => $space['slug'] ?? '',
            'who' => mon_member_name($v, $l['memberId'] ?? null),
            'items' => array_map(fn ($r) => ['id' => $r['id'], 'at' => $r['at'], 'title' => $r['title'] ?? 'Session', 'minutes' => $r['minutes'], 'status' => $r['status'], 'amountCents' => $r['amountCents'], 'who' => mon_first(mon_member_name($v, (string) $r['memberId'])), 'recap' => $space ? '/s/' . $space['slug'] : null], $items),
        ]);
    }
    $payerId = $inv['payerId'] ?? null;
    $payer = $payerId ? ($v['users'][$payerId] ?? null) : null;
    $others = $payerId ? $ctx->db->list('invoices', fn ($i) => ($i['hostId'] ?? null) === $inv['hostId'] && ($i['payerId'] ?? null) === $payerId && $i['status'] === 'sent') : [];
    $latePaid = some($others, fn ($i) => !empty($i['payments']) && !empty($i['dueAt']) && ms((string) $i['payments'][0]['at']) > ms((string) $i['dueAt']));
    $revision = !empty($inv['revisionOf']) ? $ctx->db->get('invoices', (string) $inv['revisionOf']) : null;
    $replaced = !empty($inv['replacedBy']) ? $ctx->db->get('invoices', (string) $inv['replacedBy']) : null;
    return array_merge(mon_list_view($v, $inv), [
        'lines' => $lines,
        'payments' => $inv['payments'] ?? [],
        'claims' => $inv['claims'] ?? [],
        'comments' => $inv['comments'] ?? [],
        'activity' => $inv['activity'] ?? [],
        'viewCount' => $inv['viewCount'] ?? 0,
        'viewedAt' => $inv['viewedAt'] ?? null,
        'remindersSent' => $inv['remindersSent'] ?? [],
        'payLink' => mon_pay_link_for($v, $inv),
        'footer' => str_replace('{ref}', (string) ($inv['number'] ?? 'draft'), (string) ($v['settings']['footer'] ?? '')),
        'host' => ['name' => $v['host']['name'] ?? 'Host', 'brandLine' => $v['settings']['brandLine'] ?? ''],
        'payer' => $payer ? [
            'id' => $payer['id'],
            'name' => $payer['name'] ?? '',
            'email' => $payer['email'] ?? null,
            'phone' => $payer['phone'] ?? null,
            'pays' => array_values(array_map(fn ($m) => mon_first(mon_member_name($v, (string) $m)), array_filter($inv['memberIds'] ?? [], fn ($m) => $m !== $payer['id']))),
            'invoices' => count($others),
            'record' => $others ? ($latePaid ? 'sometimes late' : 'always paid') : 'first invoice',
        ] : null,
        'revisionOf' => $revision ? ['id' => $revision['id'], 'number' => $revision['number'] ?? null] : null,
        'replacedBy' => $replaced ? ['id' => $replaced['id'], 'number' => $replaced['number'] ?? null] : null,
        'template' => $v['settings']['reminders']['text'] ?? DEFAULT_REMINDER_TEXT,
    ]);
}

/** What the payer sees: no host notes, no other payers, nothing from other invoices. */
function mon_pay_view(Ctx $ctx, array $inv): array
{
    $v = mon_view_ctx($ctx, (string) $inv['hostId']);
    $d = mon_detail_view($ctx, $v, $inv);
    return [
        'number' => $d['number'],
        'status' => $d['status'],
        'statusLabel' => $d['statusLabel'],
        'period' => $inv['period'],
        'periodLabel' => month_label((string) $inv['period']),
        'dueAt' => $d['dueAt'],
        'sentAt' => $d['sentAt'],
        'host' => $d['host'],
        'payerName' => $d['payerName'],
        'lines' => array_map(fn ($l) => ['idx' => $l['idx'], 'description' => $l['description'] ?? '', 'qty' => $l['qty'] ?? 1, 'unitCents' => $l['unitCents'] ?? 0, 'amountCents' => $l['amountCents'] ?? 0, 'kind' => $l['kind'] ?? null, 'items' => array_map(fn ($i) => ['at' => $i['at'], 'title' => $i['title'], 'minutes' => $i['minutes'], 'amountCents' => $i['amountCents'], 'who' => $i['who'], 'status' => $i['status']], $l['items'])], $d['lines']),
        'totalCents' => $d['totalCents'],
        'paidCents' => $d['paidCents'],
        'balanceCents' => $d['balanceCents'],
        'payLink' => $d['payLink'],
        'footer' => $d['footer'],
        'comments' => $inv['comments'] ?? [],
        'claims' => array_map(fn ($c) => ['id' => $c['id'], 'at' => $c['at'], 'amountCents' => $c['amountCents'], 'method' => $c['method'], 'status' => $c['status'], 'reason' => $c['reason'] ?? null], $inv['claims'] ?? []),
        'receipts' => array_map(fn ($p) => ['receipt' => $p['receipt'], 'amountCents' => $p['amountCents'], 'at' => $p['at']], $inv['payments'] ?? []),
    ];
}

// ---- notifications, email, sending, payments ----

function mon_notify(Ctx $ctx, ?string $userId, string $kind, string $title, string $sub, string $link): void
{
    if (!$userId || str_starts_with($userId, 'space:') || !$ctx->db->get('users', $userId)) return;
    $ctx->db->put('notifications', ['id' => sortable_id('nt'), 'userId' => $userId, 'kind' => $kind, 'title' => $title, 'sub' => $sub, 'link' => $link, 'createdAt' => $ctx->nowIso(), 'readAt' => null]);
    $ctx->changed('notifications');
}

function mon_log(array &$inv, Ctx $ctx, string $kind, string $text): void
{
    $inv['activity'] = array_merge($inv['activity'] ?? [], [['kind' => $kind, 'at' => $ctx->nowIso(), 'text' => $text]]);
}

/** The pay page as an absolute link for emails. */
function mon_pay_url(Ctx $ctx, array $inv): string
{
    return $ctx->appUrl('/pay/' . $inv['payToken']);
}

/** The payer's user row when they have an email address (server-only email delivery). */
function mon_payer_with_email(Ctx $ctx, array $inv): ?array
{
    $pid = $inv['payerId'] ?? null;
    if (!is_string($pid) || $pid === '' || str_starts_with($pid, 'space:')) return null;
    $u = $ctx->db->get('users', $pid);
    return $u && is_string($u['email'] ?? null) && $u['email'] !== '' ? $u : null;
}

/** @param array $via email, whatsapp, inapp (bools) */
function mon_send_invoice(Ctx $ctx, array &$inv, array $issued, array $via): string
{
    $settings = money_settings($ctx, (string) $inv['hostId']);
    $host = $ctx->db->get('users', (string) $inv['hostId']);
    $space = $ctx->db->get('spaces', (string) ($inv['lines'][0]['spaceId'] ?? ''));
    $number = $inv['number'] ?? next_invoice_number($issued, (string) $settings['prefix'], mon_num($settings['nextNumber'] ?? 1));
    $t = $ctx->now();
    $inv['number'] = $number;
    $inv['status'] = 'sent';
    $inv['sentAt'] = iso($t);
    $inv['dueAt'] = iso($t + (int) round(mon_num(billing_for($space)['dueDays']) * DAY));
    $inv['via'] = $via;
    foreach ($inv['lines'] ?? [] as $l) {
        foreach ($l['logIds'] ?? [] as $id) $ctx->db->patch('session_log', (string) $id, ['invoiceId' => $inv['id']]);
        if (($l['kind'] ?? null) === 'credit' && !empty($l['memberId'])) {
            $avail = sorted(array_values(array_filter(mon_makeup_credits($ctx, (string) $inv['hostId']), fn ($c) => $c['memberId'] === $l['memberId'])), fn ($a, $b) => strcmp((string) $a['at'], (string) $b['at']));
            foreach (array_slice($avail, 0, max(0, (int) mon_num($l['qty'] ?? 0))) as $c) $ctx->db->patch('credits', (string) $c['id'], ['usedBy' => $inv['id']]);
        }
    }
    if (!empty($inv['revisionOf'])) {
        $orig = $ctx->db->get('invoices', (string) $inv['revisionOf']);
        if ($orig) {
            $inv['payments'] = $orig['payments'] ?? [];
            $inv['claims'] = $orig['claims'] ?? [];
            $inv['comments'] = $orig['comments'] ?? [];
            mon_log($orig, $ctx, 'void', "Replaced by $number");
            $ctx->db->put('invoices', array_merge($orig, ['status' => 'void', 'replacedBy' => $inv['id']]));
        }
    }
    $channels = implode(' + ', array_values(array_filter([!empty($via['email']) ? 'email' : '', !empty($via['whatsapp']) ? 'WhatsApp link' : '', !empty($via['inapp']) ? 'in-app' : ''])));
    mon_log($inv, $ctx, 'sent', 'Sent · ' . ($channels ?: 'marked as sent'));
    $ctx->db->put('invoices', $inv);
    $hostName = (string) ($host['name'] ?? 'your host');
    if (!empty($via['inapp'])) mon_notify($ctx, $inv['payerId'] ?? null, 'invoice', "Invoice $number from $hostName · " . mon_usd($inv['totalCents']), 'Due ' . short_date($inv['dueAt']), '/pay/' . $inv['payToken']);
    // Server: the invoice goes out by email too.
    if (!empty($via['email']) && ($payer = mon_payer_with_email($ctx, $inv))) {
        $footer = str_replace('{ref}', (string) $number, (string) ($settings['footer'] ?? ''));
        $body = 'Hi ' . mon_first((string) ($payer['name'] ?? '')) . ",\n\n"
            . "$hostName sent you invoice $number for " . mon_usd($inv['totalCents']) . ', due ' . short_date($inv['dueAt']) . ".\n\n"
            . "See the details and pay here:\n" . mon_pay_url($ctx, $inv) . "\n\n"
            . "Already paid? Open the link and tap \"I've paid\" so " . mon_first($hostName) . ' can confirm it.'
            . ($footer !== '' ? "\n\n$footer" : '');
        send_mail((string) $payer['email'], "Invoice $number from $hostName · " . mon_usd($inv['totalCents']), $body);
    }
    return (string) $number;
}

function mon_confirm_payment(Ctx $ctx, array &$inv, int $amount, ?array $claim, string $method): array
{
    $amt = min(max(0, $amount), balance_due($inv));
    if ($amt <= 0) throw new BadRequest('Nothing left to pay on this invoice');
    $receipt = receipt_number((string) ($inv['number'] ?? 'LF-0000'), count($inv['payments'] ?? []));
    $inv['payments'] = array_merge($inv['payments'] ?? [], [['id' => new_id('pm'), 'amountCents' => $amt, 'at' => $ctx->nowIso(), 'receipt' => $receipt, 'method' => $method, 'claimId' => $claim['id'] ?? null]]);
    if ($claim) $inv['claims'] = array_map(fn ($c) => $c['id'] === $claim['id'] ? array_merge($c, ['status' => 'confirmed']) : $c, $inv['claims'] ?? []);
    $full = balance_due($inv) === 0;
    mon_log($inv, $ctx, 'paid', ($full ? 'Payment confirmed' : 'Part payment confirmed') . ' · ' . mon_usd($amt) . " · receipt $receipt");
    $inv['waPending'] = null;
    $ctx->db->put('invoices', $inv);
    if ($full && !empty($inv['packageId'])) {
        $ctx->db->patch('credits', 'purchase:' . $inv['packageId'], ['active' => true, 'note' => 'Bought · ' . $inv['number'] . ' paid']);
    }
    mon_notify($ctx, $inv['payerId'] ?? null, 'receipt', "Receipt $receipt · " . mon_usd($amt) . ' received', $inv['number'] . ($full ? ' · paid in full' : ' · ' . mon_usd(balance_due($inv)) . ' left'), '/pay/' . $inv['payToken']);
    // Server: the receipt goes out by email too.
    if ($payer = mon_payer_with_email($ctx, $inv)) {
        $host = $ctx->db->get('users', (string) $inv['hostId']);
        $hostName = (string) ($host['name'] ?? 'Your host');
        $body = 'Hi ' . mon_first((string) ($payer['name'] ?? '')) . ",\n\n"
            . "$hostName confirmed your payment of " . mon_usd($amt) . ' for ' . $inv['number'] . ". Your receipt number is $receipt.\n\n"
            . ($full ? 'This invoice is now paid in full. Thank you!' : mon_usd(balance_due($inv)) . ' is left to pay.') . "\n\n"
            . mon_pay_url($ctx, $inv);
        send_mail((string) $payer['email'], "Receipt $receipt · " . mon_usd($amt), $body);
    }
    $ctx->changed('invoices', 'credits');
    return ['receipt' => $receipt, 'balanceCents' => balance_due($inv)];
}

/**
 * Sell a package (I5): a package row, an inactive purchase in the ledger, and an invoice draft.
 * @param array $input spaceId, memberId, size, priceCents, renewalOf?
 * @return array{pkg: array, inv: array}
 */
function mon_sell_package(Ctx $ctx, string $hostId, array $input): array
{
    $space = $ctx->db->get('spaces', (string) $input['spaceId']);
    if (!$space) throw new NotFound('Space not found');
    $b = billing_for($space);
    $memberId = (string) $input['memberId'];
    $payerId = $b['payers'][$memberId] ?? null;
    $users = mon_user_map($ctx);
    $renewalOf = $input['renewalOf'] ?? null;
    $pkg = ['id' => new_id('pk'), 'hostId' => $hostId, 'spaceId' => $space['id'], 'memberId' => $memberId, 'payerId' => $payerId, 'size' => $input['size'], 'priceCents' => $input['priceCents'], 'invoiceId' => null, 'renewalOf' => $renewalOf, 'renewalId' => null, 'createdAt' => $ctx->nowIso()];
    $who = (string) ($users[$memberId]['name'] ?? 'Member');
    $inv = mon_blank_invoice($ctx, $hostId, [
        'payerId' => $payerId,
        'memberIds' => [$memberId],
        'kind' => 'package',
        'edited' => true,
        'packageId' => $pkg['id'],
        'lines' => [['spaceId' => $space['id'], 'memberId' => $memberId, 'description' => mon_first($who) . " · {$input['size']}-session package · {$space['code']}", 'qty' => 1, 'unitCents' => $input['priceCents'], 'amountCents' => $input['priceCents'], 'logIds' => [], 'sessionIds' => [], 'kind' => 'package']],
        'totalCents' => $input['priceCents'],
        'needsAttention' => $payerId ? null : 'no payer set',
        'activity' => [['kind' => 'drafted', 'at' => $ctx->nowIso(), 'text' => $renewalOf ? 'Renewal drafted automatically' : 'Package sold · draft created']],
    ]);
    $pkg['invoiceId'] = $inv['id'];
    $ctx->db->put('packages', $pkg);
    $ctx->db->put('invoices', $inv);
    $ctx->db->put('credits', ['id' => 'purchase:' . $pkg['id'], 'hostId' => $hostId, 'spaceId' => $space['id'], 'memberId' => $memberId, 'payerId' => $payerId, 'packageId' => $pkg['id'], 'kind' => 'purchase', 'qty' => $input['size'], 'active' => false, 'at' => $ctx->nowIso(), 'note' => "Bought {$input['size']} sessions · awaiting payment"]);
    if ($renewalOf) $ctx->db->patch('packages', (string) $renewalOf, ['renewalId' => $pkg['id']]);
    $ctx->changed('packages', 'invoices', 'credits');
    return ['pkg' => $pkg, 'inv' => $inv];
}

// ---- the daily task (first request of the day; no cron) ----

function money_daily(Ctx $ctx, string $hostId): void
{
    $settings = money_settings($ctx, $hostId);
    $now = $ctx->now();
    if (!is_daily_due((string) ($settings['lastDaily'] ?? ''), $now)) return;
    // 1. Auto-draft last month's invoices on the first request on/after the 1st.
    $prev = prev_month_key(month_key($now));
    $lastAuto = (string) ($settings['lastAutoRun'] ?? '');
    if ($lastAuto === '' || strcmp($lastAuto, $prev) < 0) {
        build_drafts($ctx, $hostId, $prev, ['auto' => true]);
        $settings['lastAutoRun'] = $prev;
    }
    // 2. Reminders: in-app + email go out; WhatsApp is queued for the host to tap.
    $steps = $settings['reminders']['steps'] ?? DEFAULT_REMINDERS;
    $v = null;
    foreach ($ctx->db->list('invoices', fn ($i) => ($i['hostId'] ?? null) === $hostId && $i['status'] === 'sent') as $inv) {
        $paused = !empty($inv['payerId']) && in_array($inv['payerId'], $settings['pausedPayers'] ?? [], true);
        $sentOffsets = $inv['remindersSent'] ?? [];
        $step = reminder_due($inv, $steps, $sentOffsets, $now, $paused);
        if (!$step) continue;
        $skipped = [];
        foreach ($steps as $s) if ($s['offsetDays'] < $step['offsetDays'] && !in_array($s['offsetDays'], $sentOffsets)) $skipped[] = $s['offsetDays'];
        $inv['remindersSent'] = array_merge($sentOffsets, $skipped, [$step['offsetDays']]);
        $channels = $step['channels'] ?? [];
        $auto = array_values(array_map(fn ($c) => $c === 'inapp' ? 'in-app' : $c, array_filter($channels, fn ($c) => $c !== 'whatsapp')));
        $final = !empty($step['final']);
        $wa = in_array('whatsapp', $channels, true);
        mon_log($inv, $ctx, 'reminder', ($final ? 'Final reminder' : 'Reminder') . ' · ' . (implode(' + ', $auto) ?: 'queued') . ($wa ? ' · WhatsApp to send' : ''));
        if ($wa) $inv['waPending'] = $step['offsetDays'];
        $ctx->db->put('invoices', $inv);
        if (in_array('inapp', $channels, true)) mon_notify($ctx, $inv['payerId'] ?? null, 'reminder', ($final ? 'Final reminder' : 'Reminder') . ': ' . $inv['number'] . ' · ' . mon_usd(balance_due($inv)), !empty($inv['dueAt']) ? 'Due ' . short_date((string) $inv['dueAt']) : '', '/pay/' . $inv['payToken']);
        // Server: email steps go out by email, with the host's reminder subject and text.
        if (in_array('email', $channels, true) && ($payer = mon_payer_with_email($ctx, $inv))) {
            $v ??= mon_view_ctx($ctx, $hostId);
            $input = [
                'payerName' => (string) ($payer['name'] ?? ''),
                'number' => (string) ($inv['number'] ?? ''),
                'amountCents' => balance_due($inv),
                'dueAt' => (string) ($inv['dueAt'] ?? ''),
                'payLink' => mon_pay_url($ctx, $inv),
                'members' => implode(', ', array_map(fn ($m) => mon_member_name($v, (string) $m), $inv['memberIds'] ?? [])),
                'template' => (string) ($settings['reminders']['text'] ?? ''),
                'final' => $final,
            ];
            $subject = fill_template((string) (($settings['reminders']['subject'] ?? '') ?: DEFAULT_REMINDER_SUBJECT), mon_reminder_vars($input));
            send_mail((string) $payer['email'], $subject, reminder_message($input));
        }
    }
    // 3. Makeup credits expire.
    $nowIso = iso($now);
    foreach (mon_makeup_credits($ctx, $hostId) as $c) {
        if (!empty($c['expiresAt']) && strcmp((string) $c['expiresAt'], $nowIso) < 0) $ctx->db->patch('credits', (string) $c['id'], ['expired' => true, 'note' => ($c['note'] ?? '') . ' · expired']);
    }
    // 4. Package renewals at the threshold.
    if (!empty($settings['packages']['renew'])) {
        foreach ($ctx->db->list('packages', fn ($x) => ($x['hostId'] ?? null) === $hostId && empty($x['renewalId'])) as $p) {
            $ledger = mon_package_ledger($ctx, (string) $p['id']);
            if (!some($ledger, fn ($r) => $r['kind'] === 'purchase' && !empty($r['active']))) continue;
            if (ledger_balance($ledger) <= mon_num($settings['packages']['renewAt'] ?? 2)) mon_sell_package($ctx, $hostId, ['spaceId' => $p['spaceId'], 'memberId' => $p['memberId'], 'size' => $p['size'], 'priceCents' => $p['priceCents'], 'renewalOf' => $p['id']]);
        }
    }
    $settings['lastDaily'] = day_key($now);
    mon_save_settings($ctx, $settings);
    $ctx->changed('invoices', 'money_settings');
}

/** To review items for Money: claims to check, drafts ready, WhatsApp reminders to send. */
function money_review_items(Ctx $ctx, string $hostId): array
{
    $items = [];
    $invoices = $ctx->db->list('invoices', fn ($i) => ($i['hostId'] ?? null) === $hostId);
    $users = mon_user_map($ctx);
    foreach ($invoices as $inv) {
        if ($inv['status'] !== 'sent') continue;
        $payer = !empty($inv['payerId']) ? (string) ($users[$inv['payerId']]['name'] ?? 'A payer') : 'A payer';
        foreach ($inv['claims'] ?? [] as $c) {
            if (($c['status'] ?? '') !== 'open') continue;
            $items[] = ['id' => "claim:{$inv['id']}:{$c['id']}", 'kind' => 'payment', 'title' => "$payer says {$inv['number']} is paid", 'sub' => mon_usd($c['amountCents']) . ' · ' . $c['method'] . (!empty($c['reference']) ? ' · ' . $c['reference'] : ''), 'action' => 'Check', 'link' => "/money/payments?invoice={$inv['id']}"];
        }
        if (($inv['waPending'] ?? null) !== null) $items[] = ['id' => "wa:{$inv['id']}", 'kind' => 'reminder', 'title' => "WhatsApp reminder to send · $payer", 'sub' => $inv['number'] . ' · ' . mon_usd(balance_due($inv)) . ' left', 'action' => 'Send', 'link' => '/money/reminders'];
    }
    $drafts = array_values(array_filter($invoices, fn ($i) => $i['status'] === 'draft'));
    if ($drafts) {
        $ready = array_values(array_filter($drafts, fn ($d) => empty($d['needsAttention'])));
        $attention = count($drafts) - count($ready);
        $n = count($ready);
        $items[] = ['id' => 'drafts', 'kind' => 'invoices', 'title' => "$n invoice draft" . ($n === 1 ? '' : 's') . ' ready to send', 'sub' => mon_usd(sum($ready, fn ($d) => (int) $d['totalCents'])) . ($attention ? " · $attention need" . ($attention === 1 ? 's' : '') . ' attention' : ''), 'action' => 'Review', 'link' => '/money/invoices'];
    }
    return $items;
}

/** The first non-draft invoice for a pay token (optionally only sent ones, optionally skipping replaced ones). */
function mon_by_token(Ctx $ctx, string $token, callable $filter): ?array
{
    return $ctx->db->list('invoices', fn ($i) => ($i['payToken'] ?? null) === $token && $filter($i))[0] ?? null;
}

// ---- routes ----

routes()
    ->get('money/overview', function (Ctx $ctx, array $p, array $in) {
        $me = require_me($ctx);
        money_daily($ctx, $me['id']);
        $month = str($in['month'] ?? '', 7) ?: month_key($ctx->now());
        $v = mon_view_ctx($ctx, $me['id']);
        $spaces = mon_hosted_spaces($ctx, $me['id']);
        $ids = array_fill_keys(array_map(fn ($s) => (string) $s['id'], $spaces), true);
        ['start' => $start, 'end' => $end] = month_range($month);
        $inMonth = fn (string $iso) => strcmp($iso, $start) >= 0 && strcmp($iso, $end) < 0;
        $logRows = $ctx->db->list('session_log', fn ($r) => isset($ids[(string) ($r['spaceId'] ?? '')]));
        $invoices = $ctx->db->list('invoices', fn ($i) => ($i['hostId'] ?? null) === $me['id']);
        $sent = array_values(array_filter($invoices, fn ($i) => $i['status'] === 'sent'));
        $payments = [];
        foreach ($sent as $i) foreach ($i['payments'] ?? [] as $pm) if ($inMonth((string) $pm['at'])) $payments[] = $pm;
        $months = [month_key($ctx->now())];
        foreach ($logRows as $r) $months[] = month_key(ms((string) $r['at']));
        foreach ($invoices as $i) $months[] = (string) $i['period'];
        $months = array_values(array_unique($months));
        sort($months, SORT_STRING);
        $months = array_slice(array_reverse($months), 0, 12);
        $overdue = array_values(array_filter($sent, fn ($i) => is_overdue($i, $v['now'])));
        $makeup = mon_makeup_credits($ctx, $me['id']);
        $recent = array_slice(sorted($sent, fn ($a, $b) => strcmp((string) ($b['sentAt'] ?? ''), (string) ($a['sentAt'] ?? ''))), 0, 6);
        return [
            'month' => $month,
            'label' => month_label($month),
            'months' => array_map(fn ($m) => ['key' => $m, 'label' => month_label($m)], $months),
            'kpis' => [
                'notInvoicedCents' => (int) sum(array_filter($logRows, fn ($r) => empty($r['invoiceId']) && !empty($r['billable']) && $inMonth((string) $r['at'])), fn ($r) => (int) $r['amountCents']),
                'billableSessions' => count(array_filter($logRows, fn ($r) => !empty($r['billable']) && $inMonth((string) $r['at']))),
                'lateCancels' => count(array_filter($logRows, fn ($r) => $r['status'] === 'late_cancel' && !empty($r['billable']) && $inMonth((string) $r['at']))),
                'makeupCredits' => count($makeup),
                'outstandingCents' => (int) sum($sent, fn ($i) => balance_due($i)),
                'overdue' => count($overdue),
                'overdueCents' => (int) sum($overdue, fn ($i) => balance_due($i)),
                'claims' => (int) sum($sent, fn ($i) => count(array_filter($i['claims'] ?? [], fn ($c) => ($c['status'] ?? '') === 'open'))),
                'drafts' => count(array_filter($invoices, fn ($i) => $i['status'] === 'draft')),
                'paidCents' => (int) sum($payments, fn ($pm) => (int) $pm['amountCents']),
            ],
            'recent' => array_map(fn ($i) => mon_list_view($v, $i), $recent),
            'review' => money_review_items($ctx, $me['id']),
            'unconfigured' => array_values(array_map(fn ($s) => ['id' => $s['id'], 'name' => $s['name'], 'slug' => $s['slug'] ?? ''], array_filter($spaces, fn ($s) => ($s['mode'] ?? '') !== 'team' && ($s['billing'] ?? null) === null))),
        ];
    })
    ->get('money/log', function (Ctx $ctx, array $p, array $in) {
        $me = require_me($ctx);
        $month = str($in['month'] ?? '', 7) ?: month_key($ctx->now());
        $v = mon_view_ctx($ctx, $me['id']);
        $spaces = mon_hosted_spaces($ctx, $me['id']);
        $ids = array_fill_keys(array_map(fn ($s) => (string) $s['id'], $spaces), true);
        ['start' => $start, 'end' => $end] = month_range($month);
        $invoices = index_by($ctx->db->list('invoices', fn ($i) => ($i['hostId'] ?? null) === $me['id']), fn ($i) => $i['id']);
        $pkgs = index_by($ctx->db->list('packages', fn ($x) => ($x['hostId'] ?? null) === $me['id']), fn ($x) => $x['id']);
        $uses = $ctx->db->list('credits', fn ($c) => ($c['hostId'] ?? null) === $me['id'] && ($c['kind'] ?? null) === 'use');
        $rows = sorted(
            $ctx->db->list('session_log', fn ($r) => isset($ids[(string) ($r['spaceId'] ?? '')]) && strcmp((string) $r['at'], $start) >= 0 && strcmp((string) $r['at'], $end) < 0),
            fn ($a, $b) => strcmp((string) $b['at'], (string) $a['at']) ?: strcmp((string) $a['memberId'], (string) $b['memberId'])
        );
        $credits = $ctx->db->list('credits', fn ($c) => ($c['hostId'] ?? null) === $me['id'] && ($c['kind'] ?? null) === 'credit');
        return [
            'month' => $month,
            'label' => month_label($month),
            'spaces' => array_values(array_map(fn ($s) => ['id' => $s['id'], 'code' => $s['code'] ?? '', 'name' => $s['name']], array_filter($spaces, fn ($s) => some($rows, fn ($r) => $r['spaceId'] === $s['id'])))),
            'kpis' => [
                'notInvoicedCents' => (int) sum(array_filter($rows, fn ($r) => empty($r['invoiceId']) && !empty($r['billable'])), fn ($r) => (int) $r['amountCents']),
                'billableSessions' => count(array_filter($rows, fn ($r) => !empty($r['billable']))),
                'lateCancels' => count(array_filter($rows, fn ($r) => $r['status'] === 'late_cancel' && !empty($r['billable']))),
                'makeupCredits' => count(array_filter($credits, fn ($c) => empty($c['usedBy']) && empty($c['expired']))),
            ],
            'rows' => array_map(function ($r) use ($pkgs, $uses, $v, $invoices, $credits) {
                $pkg = !empty($r['packageId']) ? ($pkgs[$r['packageId']] ?? null) : null;
                $used = $pkg ? count(array_filter($uses, fn ($u) => ($u['packageId'] ?? null) === $pkg['id'] && strcmp((string) $u['at'], (string) $r['at']) <= 0)) : 0;
                $space = $v['spaces'][(string) $r['spaceId']] ?? null;
                return array_merge($r, [
                    'spaceCode' => $space['code'] ?? '',
                    'spaceName' => $space['name'] ?? '',
                    'memberName' => mon_member_name($v, (string) $r['memberId']),
                    'payerName' => !empty($r['payerId']) ? mon_member_name($v, (string) $r['payerId']) : null,
                    'invoiceNumber' => !empty($r['invoiceId']) ? ($invoices[$r['invoiceId']]['number'] ?? 'draft') : null,
                    'package' => $pkg ? ['used' => $used, 'size' => $pkg['size']] : null,
                    'credit' => some($credits, fn ($c) => ($c['logId'] ?? null) === $r['id']),
                ]);
            }, $rows),
        ];
    })
    ->post('money/log/:id', function (Ctx $ctx, array $p, array $in) {
        $me = require_me($ctx);
        $row = $ctx->db->get('session_log', $p['id']);
        if (!$row) throw new NotFound('Log row not found');
        $space = $ctx->db->get('spaces', (string) $row['spaceId']);
        if (!$space) throw new NotFound('Space not found');
        mon_require_host_of($ctx, (string) $space['id']);
        if (!empty($row['invoiceId'])) throw new Forbidden('This row is on an invoice. Edit the invoice instead.');
        $status = in_array($in['status'] ?? null, MON_STATUSES, true) ? $in['status'] : $row['status'];
        $minutes = mon_is_num($in['minutes'] ?? null) ? max(0, (int) round($in['minutes'])) : $row['minutes'];
        $next = mon_apply_log($ctx, ['id' => $row['sessionId'], 'spaceId' => $row['spaceId'], 'startsAt' => $row['at'], 'minutes' => $minutes, 'title' => $row['title'] ?? 'Session'], $space, ['memberId' => $row['memberId'], 'minutes' => $minutes, 'status' => $status]);
        mon_rebuild_open_drafts($ctx, $me['id']);
        $ctx->changed('session_log', 'credits');
        return $next;
    })
    ->get('spaces/:id/billing', function (Ctx $ctx, array $p) {
        $me = mon_require_host_of($ctx, $p['id']);
        $space = $ctx->db->get('spaces', $p['id']);
        if (!$space) throw new NotFound('Space not found');
        $b = billing_for($space);
        $users = mon_user_map($ctx);
        $members = array_map(fn ($m) => (string) $m['userId'], $ctx->db->list('memberships', fn ($m) => ($m['spaceId'] ?? null) === $space['id'] && ($m['role'] ?? null) !== 'host'));
        $settings = money_settings($ctx, $me['id']);
        $people = [];
        foreach ($users as $u) if ($u['id'] !== $me['id'] && empty($u['guest'])) $people[] = ['id' => $u['id'], 'name' => $u['name'] ?? '', 'email' => $u['email'] ?? null, 'phone' => $u['phone'] ?? null];
        $issued = array_map(fn ($i) => (string) ($i['number'] ?? ''), $ctx->db->list('invoices', fn ($i) => ($i['hostId'] ?? null) === $me['id']));
        return [
            'space' => ['id' => $space['id'], 'name' => $space['name'], 'slug' => $space['slug'] ?? '', 'code' => $space['code'] ?? '', 'mode' => $space['mode'] ?? 'course'],
            'billing' => mon_billing_out($b),
            'configured' => ($space['billing'] ?? null) !== null,
            'members' => array_map(function ($m) use ($b, $users, $space) {
                $pid = $b['payers'][$m] ?? null;
                $pu = $pid !== null ? ($users[$pid] ?? null) : null;
                return ['memberId' => $m, 'name' => $m === '*' ? $space['name'] . ' · whole space' : (string) ($users[$m]['name'] ?? 'Member'), 'payerId' => $pid, 'payerName' => $pu['name'] ?? null, 'payerContact' => $pu ? (($pu['email'] ?? '') ?: (($pu['phone'] ?? '') ?: '')) : null, 'self' => $pid === $m];
            }, $b['per'] === 'session' ? ['*'] : $members),
            'people' => $people,
            'defaultLink' => $settings['paymentLink']['link'] ?? '',
            'settings' => ['prefix' => $settings['prefix'], 'nextNumber' => next_invoice_number($issued, (string) $settings['prefix'], mon_num($settings['nextNumber'] ?? 1)), 'footer' => $settings['footer'], 'reminders' => $settings['reminders']['steps'] ?? []],
        ];
    })
    ->post('spaces/:id/billing', function (Ctx $ctx, array $p, array $in) {
        $me = mon_require_host_of($ctx, $p['id']);
        $space = $ctx->db->get('spaces', $p['id']);
        if (!$space) throw new NotFound('Space not found');
        $cur = billing_for($space);
        $raw = is_array($in['billing'] ?? null) ? $in['billing'] : [];
        $payers = $cur['payers'];
        if (is_array($raw['payers'] ?? null)) {
            $payers = [];
            foreach ($raw['payers'] as $k => $val) if (is_string($val) && $val !== '') $payers[(string) $k] = $val;
        }
        $next = array_merge($cur, [
            'model' => in_array($raw['model'] ?? null, ['per_session', 'per_hour', 'monthly', 'package', 'free'], true) ? $raw['model'] : $cur['model'],
            'unitPriceCents' => int_cents($raw['unitPriceCents'] ?? null) ?? $cur['unitPriceCents'],
            'per' => in_array($raw['per'] ?? null, ['session', 'member'], true) ? $raw['per'] : $cur['per'],
            'billable' => is_array($raw['billable'] ?? null) && array_is_list($raw['billable']) ? array_values(array_filter($raw['billable'], fn ($s) => in_array($s, ['attended', 'late_cancel', 'no_show'], true))) : $cur['billable'],
            'excused' => ($raw['excused'] ?? null) === 'none' ? 'none' : (($raw['excused'] ?? null) === 'makeup' ? 'makeup' : $cur['excused']),
            'schedule' => in_array($raw['schedule'] ?? null, ['monthly', 'after_session', 'package_out'], true) ? $raw['schedule'] : $cur['schedule'],
            'dueDays' => mon_is_num($raw['dueDays'] ?? null) ? max(0, min(60, (int) round($raw['dueDays']))) : $cur['dueDays'],
            'paymentLink' => array_key_exists('paymentLink', $raw) && $raw['paymentLink'] === null ? null : (is_string($raw['paymentLink'] ?? null) ? (str($raw['paymentLink'], 300) ?: null) : $cur['paymentLink']),
            'combineSiblings' => is_bool($raw['combineSiblings'] ?? null) ? $raw['combineSiblings'] : $cur['combineSiblings'],
            'payers' => $payers,
        ]);
        $ctx->db->put('spaces', array_merge($space, ['billing' => mon_billing_out($next)]));
        if (is_array($in['settings'] ?? null)) {
            $s = $in['settings'];
            $settings = money_settings($ctx, $me['id']);
            if (is_string($s['footer'] ?? null)) $settings['footer'] = str($s['footer'], 300);
            if (mon_is_num($s['nextNumber'] ?? null) && $s['nextNumber'] > 0) $settings['nextNumber'] = (int) round($s['nextNumber']);
            mon_save_settings($ctx, $settings);
        }
        $ctx->changed('spaces', 'money_settings');
        return mon_billing_out($next);
    })
    // "Add payer" (I1 / I3 needs attention): map a member to a payer and fix their unbilled rows.
    ->post('spaces/:id/billing/payer', function (Ctx $ctx, array $p, array $in) {
        $me = mon_require_host_of($ctx, $p['id']);
        $space = $ctx->db->get('spaces', $p['id']);
        if (!$space) throw new NotFound('Space not found');
        $memberId = str($in['memberId'] ?? '', 80);
        $payerId = str($in['payerId'] ?? '', 80);
        if ($memberId === '' || $payerId === '' || !$ctx->db->get('users', $payerId)) throw new BadRequest('Pick a payer');
        $b = billing_for($space);
        $b['payers'][$memberId] = $payerId;
        $ctx->db->put('spaces', array_merge($space, ['billing' => mon_billing_out($b)]));
        $key = $b['per'] === 'session' ? 'space:' . $space['id'] : $memberId;
        foreach ($ctx->db->list('session_log', fn ($x) => ($x['spaceId'] ?? null) === $space['id'] && ($x['memberId'] ?? null) === $key && empty($x['invoiceId'])) as $r) $ctx->db->patch('session_log', (string) $r['id'], ['payerId' => $payerId]);
        mon_rebuild_open_drafts($ctx, $me['id']);
        $ctx->changed('spaces', 'session_log', 'invoices');
        return ['ok' => true];
    })
    ->post('money/run', function (Ctx $ctx, array $p, array $in) {
        $me = require_me($ctx);
        $month = str($in['month'] ?? '', 7) ?: month_key($ctx->now());
        $made = build_drafts($ctx, $me['id'], $month);
        return ['month' => $month, 'drafts' => count($made), 'ready' => count(array_filter($made, fn ($d) => empty($d['needsAttention'])))];
    })
    ->get('money/invoices', function (Ctx $ctx) {
        $me = require_me($ctx);
        money_daily($ctx, $me['id']);
        $v = mon_view_ctx($ctx, $me['id']);
        $all = $ctx->db->list('invoices', fn ($i) => ($i['hostId'] ?? null) === $me['id']);
        $draftRows = sorted(array_values(array_filter($all, fn ($i) => $i['status'] === 'draft')), fn ($a, $b) => (int) $b['totalCents'] <=> (int) $a['totalCents']);
        $drafts = array_map(fn ($i) => mon_list_view($v, $i), $draftRows);
        $periods = array_values(array_unique(array_map(fn ($i) => (string) $i['period'], $draftRows)));
        sort($periods, SORT_STRING);
        $last = $periods ? $periods[count($periods) - 1] : null;
        $sent = sorted(array_values(array_filter($all, fn ($i) => $i['status'] !== 'draft')), fn ($a, $b) => strcmp((string) ($b['number'] ?? ''), (string) ($a['number'] ?? '')));
        return [
            'draftPeriod' => $last,
            'draftLabel' => $last !== null ? month_label($last) : null,
            'ready' => array_values(array_filter($drafts, fn ($d) => empty($d['needsAttention']))),
            'attention' => array_values(array_filter($drafts, fn ($d) => !empty($d['needsAttention']))),
            'sent' => array_map(fn ($i) => mon_list_view($v, $i), $sent),
            'footer' => $v['settings']['footer'] ?? '',
        ];
    })
    ->get('invoices/:id', function (Ctx $ctx, array $p) {
        $me = require_me($ctx);
        $inv = mon_invoice_or_404($ctx, $p['id'], $me['id']);
        return mon_detail_view($ctx, mon_view_ctx($ctx, $me['id']), $inv);
    })
    ->post('invoices/send', function (Ctx $ctx, array $p, array $in) {
        $me = require_me($ctx);
        $ids = strings($in['ids'] ?? null);
        $via = ['email' => ($in['email'] ?? null) !== false, 'whatsapp' => ($in['whatsapp'] ?? null) !== false, 'inapp' => ($in['inapp'] ?? null) !== false];
        $all = index_by($ctx->db->list('invoices', fn ($i) => ($i['hostId'] ?? null) === $me['id']), fn ($i) => $i['id']);
        $issued = [];
        foreach ($all as $i) if (is_string($i['number'] ?? null) && $i['number'] !== '') $issued[] = $i['number'];
        $v = mon_view_ctx($ctx, $me['id']);
        $sent = [];
        foreach ($ids as $id) {
            $inv = $all[$id] ?? null;
            if (!$inv || $inv['status'] !== 'draft' || empty($inv['payerId']) || empty($inv['lines'])) continue;
            $number = mon_send_invoice($ctx, $inv, $issued, $via);
            $all[$id] = $inv;
            $issued[] = $number;
            $sent[] = mon_list_view($v, $inv);
        }
        $ctx->changed('invoices', 'session_log', 'credits');
        return ['sent' => $sent];
    })
    ->post('invoices/:id/lines', function (Ctx $ctx, array $p, array $in) {
        $me = require_me($ctx);
        $inv = mon_invoice_or_404($ctx, $p['id'], $me['id']);
        if ($inv['status'] !== 'draft') throw new Forbidden('Sent invoices are frozen. Edit lines to create a revision.');
        $lines = is_array($in['lines'] ?? null) && array_is_list($in['lines']) ? $in['lines'] : [];
        $inv['lines'] = array_map(function ($l) {
            $l = is_array($l) ? $l : [];
            return array_merge($l, [
                'description' => str($l['description'] ?? '', 160) ?: 'Line',
                'qty' => mon_num($l['qty'] ?? null) ?: 1,
                'amountCents' => int_cents($l['amountCents'] ?? null) ?? 0,
                'unitCents' => int_cents($l['unitCents'] ?? null) ?? 0,
                'logIds' => strings($l['logIds'] ?? null),
                'sessionIds' => strings($l['sessionIds'] ?? null),
            ]);
        }, $lines);
        $inv['totalCents'] = (int) sum($inv['lines'], fn ($l) => $l['amountCents']);
        $inv['edited'] = true;
        mon_log($inv, $ctx, 'edited', 'Lines edited');
        $ctx->db->put('invoices', $inv);
        $ctx->changed('invoices');
        return ['ok' => true, 'totalCents' => $inv['totalCents']];
    })
    ->post('invoices/:id/revise', function (Ctx $ctx, array $p) {
        $me = require_me($ctx);
        $inv = mon_invoice_or_404($ctx, $p['id'], $me['id']);
        if ($inv['status'] === 'draft') return ['id' => $inv['id']];
        if ($inv['status'] === 'void') throw new Forbidden('This invoice is void');
        $existing = $ctx->db->list('invoices', fn ($i) => ($i['revisionOf'] ?? null) === $inv['id'] && $i['status'] === 'draft')[0] ?? null;
        if ($existing) return ['id' => $existing['id']];
        $rev = mon_blank_invoice($ctx, $me['id'], array_merge($inv, [
            'id' => new_id('inv'),
            'number' => revision_number((string) ($inv['number'] ?? 'LF-0000')),
            'status' => 'draft',
            'edited' => true,
            'revisionOf' => $inv['id'],
            'sentAt' => null,
            'dueAt' => null,
            'viewedAt' => null,
            'viewCount' => 0,
            'payments' => [],
            'claims' => [],
            'remindersSent' => [],
            'waPending' => null,
            'payToken' => $inv['payToken'],
            'activity' => [['kind' => 'drafted', 'at' => $ctx->nowIso(), 'text' => 'Revision of ' . $inv['number']]],
        ]));
        $ctx->db->put('invoices', $rev);
        $ctx->changed('invoices');
        return ['id' => $rev['id']];
    })
    ->post('invoices/:id/void', function (Ctx $ctx, array $p) {
        $me = require_me($ctx);
        $inv = mon_invoice_or_404($ctx, $p['id'], $me['id']);
        if ($inv['status'] === 'draft') {
            $ctx->db->del('invoices', (string) $inv['id']);
            $ctx->changed('invoices');
            return ['ok' => true, 'deleted' => true];
        }
        foreach ($inv['lines'] ?? [] as $l) foreach ($l['logIds'] ?? [] as $id) $ctx->db->patch('session_log', (string) $id, ['invoiceId' => null]);
        foreach ($ctx->db->list('credits', fn ($x) => ($x['usedBy'] ?? null) === $inv['id']) as $c) $ctx->db->patch('credits', (string) $c['id'], ['usedBy' => null]);
        $inv['status'] = 'void';
        $inv['waPending'] = null;
        mon_log($inv, $ctx, 'void', 'Voided · rows are back in the log');
        $ctx->db->put('invoices', $inv);
        mon_notify($ctx, $inv['payerId'] ?? null, 'invoice', $inv['number'] . ' was cancelled', 'No payment needed for this invoice', '/pay/' . $inv['payToken']);
        $ctx->changed('invoices', 'session_log', 'credits');
        return ['ok' => true];
    })
    ->post('invoices/:id/resend', function (Ctx $ctx, array $p, array $in) {
        $me = require_me($ctx);
        $inv = mon_invoice_or_404($ctx, $p['id'], $me['id']);
        if ($inv['status'] !== 'sent') throw new Forbidden('Only sent invoices can be resent');
        $nudge = ($in['nudge'] ?? null) === true;
        mon_log($inv, $ctx, $nudge ? 'reminder' : 'sent', $nudge ? 'Nudge sent · in-app' : 'Resent · in-app');
        if ($nudge) $inv['waPending'] = null;
        $ctx->db->put('invoices', $inv);
        mon_notify($ctx, $inv['payerId'] ?? null, $nudge ? 'reminder' : 'invoice', ($nudge ? 'Reminder' : 'Invoice') . ': ' . $inv['number'] . ' · ' . mon_usd(balance_due($inv)), !empty($inv['dueAt']) ? 'Due ' . short_date((string) $inv['dueAt']) : '', '/pay/' . $inv['payToken']);
        $ctx->changed('invoices');
        return ['ok' => true];
    })
    ->post('invoices/:id/comments', function (Ctx $ctx, array $p, array $in) {
        $me = require_me($ctx);
        $inv = mon_invoice_or_404($ctx, $p['id'], $me['id']);
        $body = str($in['body'] ?? '', 1000);
        if ($body === '') throw new BadRequest('Write a reply');
        $inv['comments'] = array_merge($inv['comments'] ?? [], [['id' => new_id('cm'), 'lineIdx' => mon_is_num($in['lineIdx'] ?? null) ? $in['lineIdx'] : null, 'userId' => $me['id'], 'name' => $me['name'], 'body' => $body, 'at' => $ctx->nowIso(), 'fromPayer' => false]]);
        $ctx->db->put('invoices', $inv);
        mon_notify($ctx, $inv['payerId'] ?? null, 'message', mon_first((string) $me['name']) . ' replied on ' . $inv['number'], mb_substr($body, 0, 80), '/pay/' . $inv['payToken']);
        $ctx->changed('invoices');
        return ['ok' => true];
    })
    ->get('money/claims', function (Ctx $ctx) {
        $me = require_me($ctx);
        $v = mon_view_ctx($ctx, $me['id']);
        $sent = $ctx->db->list('invoices', fn ($i) => ($i['hostId'] ?? null) === $me['id'] && $i['status'] === 'sent');
        ['start' => $start, 'end' => $end] = month_range(month_key($ctx->now()));
        $confirmed = [];
        foreach ($sent as $i) foreach ($i['payments'] ?? [] as $pm) if (strcmp((string) $pm['at'], $start) >= 0 && strcmp((string) $pm['at'], $end) < 0) $confirmed[] = $pm;
        $open = [];
        foreach ($sent as $i) foreach ($i['claims'] ?? [] as $c) if (($c['status'] ?? '') === 'open') $open[] = array_merge($c, ['invoice' => mon_list_view($v, $i)]);
        return [
            'open' => sorted($open, fn ($a, $b) => strcmp((string) $b['at'], (string) $a['at'])),
            'unpaid' => array_values(array_map(fn ($i) => mon_list_view($v, $i), array_filter($sent, fn ($i) => balance_due($i) > 0 && !mon_has_open_claim($i)))),
            'confirmedThisMonth' => ['count' => count($confirmed), 'cents' => (int) sum($confirmed, fn ($pm) => (int) $pm['amountCents'])],
        ];
    })
    ->post('invoices/:id/confirm', function (Ctx $ctx, array $p, array $in) {
        $me = require_me($ctx);
        $inv = mon_invoice_or_404($ctx, $p['id'], $me['id']);
        if ($inv['status'] !== 'sent') throw new Forbidden('Only sent invoices take payments');
        $claimId = $in['claimId'] ?? null;
        $claim = find($inv['claims'] ?? [], fn ($c) => $c['id'] === $claimId && ($c['status'] ?? '') === 'open');
        $amount = int_cents($in['amountCents'] ?? null) ?? ($claim ? (int) $claim['amountCents'] : balance_due($inv));
        $method = $claim['method'] ?? (str($in['method'] ?? '', 40) ?: 'Marked paid');
        return mon_confirm_payment($ctx, $inv, $amount, $claim, (string) $method);
    })
    ->post('invoices/:id/reject', function (Ctx $ctx, array $p, array $in) {
        $me = require_me($ctx);
        $inv = mon_invoice_or_404($ctx, $p['id'], $me['id']);
        $claimId = $in['claimId'] ?? null;
        $claim = find($inv['claims'] ?? [], fn ($c) => $c['id'] === $claimId && ($c['status'] ?? '') === 'open');
        if (!$claim) throw new NotFound('No open claim');
        $reason = str($in['reason'] ?? '', 300) ?: "I couldn't find this payment yet.";
        $inv['claims'] = array_map(fn ($c) => $c['id'] === $claim['id'] ? array_merge($c, ['status' => 'rejected', 'reason' => $reason]) : $c, $inv['claims']);
        mon_log($inv, $ctx, 'rejected', "Claim not confirmed · $reason · reminders resume");
        $ctx->db->put('invoices', $inv);
        mon_notify($ctx, $inv['payerId'] ?? null, 'invoice', $inv['number'] . ': payment not found yet', $reason, '/pay/' . $inv['payToken']);
        $ctx->changed('invoices');
        return ['ok' => true];
    })
    // "Can't find it · ask <payer>": a DM from the host, in their words.
    ->post('invoices/:id/ask', function (Ctx $ctx, array $p, array $in) {
        $me = require_me($ctx);
        $inv = mon_invoice_or_404($ctx, $p['id'], $me['id']);
        if (empty($inv['payerId'])) throw new BadRequest('No payer on this invoice');
        $payer = $ctx->db->get('users', (string) $inv['payerId']);
        $body = str($in['body'] ?? '', 1000) ?: 'Hi ' . mon_first((string) ($payer['name'] ?? '')) . ", I can't find the payment for {$inv['number']} (" . mon_usd(balance_due($inv)) . ') yet. Could you send the receipt or reference?';
        $pair = [(string) $me['id'], (string) $inv['payerId']];
        sort($pair, SORT_STRING);
        $ctx->db->put('messages', ['id' => sortable_id('msg'), 'channelType' => 'dm', 'channelId' => implode('~', $pair), 'userId' => $me['id'], 'name' => $me['name'], 'body' => $body, 'createdAt' => $ctx->nowIso()]);
        mon_log($inv, $ctx, 'asked', 'Asked ' . mon_first((string) ($payer['name'] ?? 'the payer')) . ' by DM');
        $ctx->db->put('invoices', $inv);
        mon_notify($ctx, (string) $inv['payerId'], 'message', $me['name'] . ': ' . mb_substr($body, 0, 60), 'Direct message', '/dm/' . $me['id']);
        $ctx->changed('messages', 'invoices');
        return ['ok' => true, 'dm' => '/dm/' . $inv['payerId']];
    })
    ->get('money/packages', function (Ctx $ctx) {
        $me = require_me($ctx);
        $v = mon_view_ctx($ctx, $me['id']);
        $pkgs = sorted($ctx->db->list('packages', fn ($x) => ($x['hostId'] ?? null) === $me['id']), fn ($a, $b) => strcmp((string) $a['createdAt'], (string) $b['createdAt']));
        $invoices = index_by($ctx->db->list('invoices', fn ($i) => ($i['hostId'] ?? null) === $me['id']), fn ($i) => $i['id']);
        $rows = [];
        foreach ($pkgs as $pk) {
            $ledger = mon_package_ledger($ctx, (string) $pk['id']);
            $active = some($ledger, fn ($r) => $r['kind'] === 'purchase' && !empty($r['active']));
            $used = count(array_filter($ledger, fn ($r) => $r['kind'] === 'use'));
            $renewal = !empty($pk['renewalId']) ? find($pkgs, fn ($x) => $x['id'] === $pk['renewalId']) : null;
            $renewalInv = $renewal && !empty($renewal['invoiceId']) ? ($invoices[$renewal['invoiceId']] ?? null) : null;
            $inv = !empty($pk['invoiceId']) ? ($invoices[$pk['invoiceId']] ?? null) : null;
            if (!$active && !empty($pk['renewalOf'])) continue; // shown as "Renewal drafted" on the package it renews
            $left = ledger_balance($ledger);
            $rows[] = [
                'id' => $pk['id'],
                'memberName' => mon_member_name($v, (string) $pk['memberId']),
                'spaceCode' => $v['spaces'][(string) $pk['spaceId']]['code'] ?? '',
                'plan' => $pk['size'] . '-session package',
                'size' => $pk['size'],
                'used' => $used,
                'left' => $left,
                'status' => !$active ? 'awaiting' : ($renewal ? 'renewal' : ($left <= 0 ? 'used' : 'active')),
                'priceCents' => $pk['priceCents'],
                'ledger' => array_map(fn ($r) => ['id' => $r['id'], 'kind' => $r['kind'], 'qty' => $r['qty'], 'active' => $r['active'], 'at' => $r['at'], 'note' => $r['note'] ?? ''], $ledger),
                'invoice' => $inv ? ['id' => $inv['id'], 'number' => $inv['number'] ?? null, 'status' => invoice_status($inv, $v['now'])] : null,
                'renewal' => $renewalInv ? ['id' => $renewalInv['id'], 'number' => $renewalInv['number'] ?? null, 'priceCents' => $renewal['priceCents'], 'at' => $renewalInv['createdAt']] : null,
            ];
        }
        $byMember = [];
        foreach ($ctx->db->list('credits', fn ($c) => ($c['hostId'] ?? null) === $me['id'] && ($c['kind'] ?? null) === 'credit' && empty($c['packageId'])) as $c) {
            if (empty($c['usedBy']) && empty($c['expired'])) $byMember[(string) $c['memberId']][] = $c;
        }
        $credits = [];
        foreach ($byMember as $memberId => $list) {
            $exp = array_values(array_filter(array_map(fn ($c) => $c['expiresAt'] ?? null, $list)));
            sort($exp, SORT_STRING);
            $credits[] = ['memberId' => (string) $memberId, 'memberName' => mon_member_name($v, (string) $memberId), 'spaceCode' => $v['spaces'][(string) $list[0]['spaceId']]['code'] ?? '', 'count' => count($list), 'expiresAt' => $exp[0] ?? null];
        }
        $settings = money_settings($ctx, $me['id']);
        $spaces = mon_hosted_spaces($ctx, $me['id']);
        $members = [];
        foreach ($spaces as $s) {
            $b = billing_for($s);
            if ($b['per'] !== 'member' || $b['model'] === 'free') continue;
            foreach ($ctx->db->list('memberships', fn ($x) => ($x['spaceId'] ?? null) === $s['id'] && ($x['role'] ?? null) !== 'host' && ($x['role'] ?? null) !== 'cohost') as $m) {
                $members[] = ['spaceId' => $s['id'], 'memberId' => $m['userId'], 'label' => mon_member_name($v, (string) $m['userId']) . ' · ' . ($s['code'] ?? ''), 'priceCents' => $b['unitPriceCents']];
            }
        }
        $hourly = [];
        foreach ($spaces as $s) {
            $model = billing_for($s)['model'];
            if ($model === 'per_hour' || $model === 'monthly') $hourly[] = ['name' => $s['name'], 'code' => $s['code'] ?? '', 'plan' => $model === 'per_hour' ? 'Per hour' : 'Monthly'];
        }
        return ['packages' => $rows, 'credits' => $credits, 'hourly' => $hourly, 'rules' => $settings['packages'], 'members' => $members];
    })
    ->post('money/packages', function (Ctx $ctx, array $p, array $in) {
        $me = require_me($ctx);
        $spaceId = str($in['spaceId'] ?? '', 80);
        mon_require_host_of($ctx, $spaceId);
        $size = (int) max(1, min(100, round(mon_num($in['size'] ?? 0))));
        $priceCents = int_cents($in['priceCents'] ?? null) ?? 0;
        if (!$size || $priceCents <= 0) throw new BadRequest('Set the sessions and a price');
        $sold = mon_sell_package($ctx, $me['id'], ['spaceId' => $spaceId, 'memberId' => str($in['memberId'] ?? '', 80), 'size' => $size, 'priceCents' => $priceCents]);
        return ['invoiceId' => $sold['inv']['id']];
    })
    ->get('money/settings', function (Ctx $ctx) {
        $me = require_me($ctx);
        return mon_settings_out(money_settings($ctx, $me['id']));
    })
    ->post('money/settings', function (Ctx $ctx, array $p, array $in) {
        $me = require_me($ctx);
        $s = money_settings($ctx, $me['id']);
        if (is_array($in['packages'] ?? null)) $s['packages'] = array_merge($s['packages'], $in['packages']);
        if (is_array($in['reminders'] ?? null)) {
            $r = $in['reminders'];
            $s['reminders'] = [
                'steps' => is_array($r['steps'] ?? null) && array_is_list($r['steps']) ? $r['steps'] : $s['reminders']['steps'],
                'subject' => is_string($r['subject'] ?? null) ? str($r['subject'], 200) : $s['reminders']['subject'],
                'text' => is_string($r['text'] ?? null) ? str($r['text'], 1000) : $s['reminders']['text'],
            ];
        }
        if (is_array($in['paymentLink'] ?? null)) {
            $pl = $in['paymentLink'];
            $s['paymentLink'] = [
                'mode' => in_array($pl['mode'] ?? null, ['template', 'per_payer'], true) ? $pl['mode'] : 'same',
                'link' => str($pl['link'] ?? $s['paymentLink']['link'], 300),
                'template' => str($pl['template'] ?? $s['paymentLink']['template'], 300),
                'perPayer' => is_array($pl['perPayer'] ?? null) ? $pl['perPayer'] : $s['paymentLink']['perPayer'],
            ];
            $ctx->db->put('settings', array_merge($ctx->db->get('settings', $me['id']) ?? ['id' => $me['id']], ['paymentLink' => $s['paymentLink']['link'] ?: null]));
        }
        if (is_string($in['prefix'] ?? null)) $s['prefix'] = (preg_replace('/[^A-Z0-9]/', '', strtoupper(str($in['prefix'], 6))) ?? '') ?: 'LF';
        if (is_string($in['footer'] ?? null)) $s['footer'] = str($in['footer'], 300);
        if (is_string($in['brandLine'] ?? null)) $s['brandLine'] = str($in['brandLine'], 80);
        if (mon_is_num($in['nextNumber'] ?? null) && $in['nextNumber'] > 0) $s['nextNumber'] = (int) round($in['nextNumber']);
        mon_save_settings($ctx, $s);
        $ctx->changed('money_settings', 'settings');
        return mon_settings_out($s);
    })
    ->get('money/reminders', function (Ctx $ctx) {
        $me = require_me($ctx);
        money_daily($ctx, $me['id']);
        $v = mon_view_ctx($ctx, $me['id']);
        $sent = $ctx->db->list('invoices', fn ($i) => ($i['hostId'] ?? null) === $me['id'] && $i['status'] === 'sent');
        $overdue = sorted(array_values(array_filter($sent, fn ($i) => is_overdue($i, $v['now']))), fn ($a, $b) => strcmp((string) ($a['dueAt'] ?? ''), (string) ($b['dueAt'] ?? '')));
        return [
            'steps' => $v['settings']['reminders']['steps'],
            'subject' => $v['settings']['reminders']['subject'],
            'text' => $v['settings']['reminders']['text'],
            'overdue' => array_map(fn ($i) => mon_list_view($v, $i), $overdue),
            'queued' => array_values(array_map(fn ($i) => mon_list_view($v, $i), array_filter($sent, fn ($i) => ($i['waPending'] ?? null) !== null))),
            'pausedPayers' => array_map(fn ($id) => ['id' => $id, 'name' => mon_member_name($v, (string) $id)], array_values($v['settings']['pausedPayers'] ?? [])),
        ];
    })
    ->post('money/payers/:id/pause', function (Ctx $ctx, array $p, array $in) {
        $me = require_me($ctx);
        $s = money_settings($ctx, $me['id']);
        $id = $p['id'];
        $paused = $s['pausedPayers'] ?? [];
        $s['pausedPayers'] = ($in['paused'] ?? null) === false ? array_values(array_filter($paused, fn ($x) => $x !== $id)) : array_values(array_unique(array_merge($paused, [$id])));
        mon_save_settings($ctx, $s);
        $ctx->changed('money_settings', 'invoices');
        return ['paused' => in_array($id, $s['pausedPayers'], true)];
    })
    // ---- the payer's pay page (no sign-in; the token in the link is the key) ----
    ->get('pay/:token', function (Ctx $ctx, array $p) {
        $token = $p['token'];
        $inv = mon_by_token($ctx, $token, fn ($i) => $i['status'] !== 'draft' && empty($i['replacedBy'])) ?? mon_by_token($ctx, $token, fn ($i) => $i['status'] !== 'draft');
        if (!$inv) throw new NotFound("This invoice link isn't valid");
        $isHost = $ctx->meId === $inv['hostId'];
        // A view counts once per 30 minutes (the page re-reads whenever data changes).
        if (!$isHost && $inv['status'] === 'sent' && (empty($inv['viewedAt']) || ms((string) $inv['viewedAt']) < $ctx->now() - 30 * 60000)) {
            $inv['viewCount'] = (int) ($inv['viewCount'] ?? 0) + 1;
            $inv['viewedAt'] = $ctx->nowIso();
            $n = $inv['viewCount'];
            mon_log($inv, $ctx, 'viewed', $n > 1 ? 'Viewed ' . ($n === 2 ? 'twice' : "$n times") : 'Viewed');
            $ctx->db->put('invoices', $inv);
        }
        return mon_pay_view($ctx, $inv);
    })
    ->post('pay/:token/claim', function (Ctx $ctx, array $p, array $in) {
        $inv = mon_by_token($ctx, $p['token'], fn ($i) => $i['status'] === 'sent');
        if (!$inv) throw new NotFound("This invoice can't take payments");
        $due = balance_due($inv);
        if ($due === 0) throw new BadRequest('This invoice is already paid');
        $amount = min(int_cents($in['amountCents'] ?? null) ?? $due, $due);
        if ($amount <= 0) throw new BadRequest('Enter the amount you paid');
        $claim = ['id' => new_id('cl'), 'at' => $ctx->nowIso(), 'amountCents' => $amount, 'method' => str($in['method'] ?? '', 40) ?: 'Payment link', 'reference' => str($in['reference'] ?? '', 80), 'note' => str($in['note'] ?? '', 500), 'status' => 'open'];
        $inv['claims'] = array_merge($inv['claims'] ?? [], [$claim]);
        $inv['waPending'] = null;
        mon_log($inv, $ctx, 'claimed', 'Payer says paid · ' . $claim['method'] . ($claim['reference'] !== '' ? ' · ' . $claim['reference'] : ''));
        $ctx->db->put('invoices', $inv);
        $payer = !empty($inv['payerId']) ? $ctx->db->get('users', (string) $inv['payerId']) : null;
        mon_notify($ctx, (string) $inv['hostId'], 'payment', ($payer['name'] ?? 'A payer') . ' says ' . $inv['number'] . ' is paid', mon_usd($amount) . ' · ' . $claim['method'], '/money/payments?invoice=' . $inv['id']);
        $ctx->changed('invoices');
        return mon_pay_view($ctx, $inv);
    })
    ->post('pay/:token/comments', function (Ctx $ctx, array $p, array $in) {
        $inv = mon_by_token($ctx, $p['token'], fn ($i) => $i['status'] !== 'draft');
        if (!$inv) throw new NotFound("This invoice link isn't valid");
        $body = str($in['body'] ?? '', 1000);
        if ($body === '') throw new BadRequest('Write your question');
        $payer = !empty($inv['payerId']) ? $ctx->db->get('users', (string) $inv['payerId']) : null;
        $lineIdx = mon_is_num($in['lineIdx'] ?? null) ? $in['lineIdx'] : null;
        $inv['comments'] = array_merge($inv['comments'] ?? [], [['id' => new_id('cm'), 'lineIdx' => $lineIdx, 'userId' => $inv['payerId'] ?? null, 'name' => $payer['name'] ?? 'Payer', 'body' => $body, 'at' => $ctx->nowIso(), 'fromPayer' => true]]);
        $ctx->db->put('invoices', $inv);
        mon_notify($ctx, (string) $inv['hostId'], 'message', ($payer['name'] ?? 'A payer') . ' asked about ' . $inv['number'], mb_substr($body, 0, 80), '/money/invoices/' . $inv['id']);
        $ctx->changed('invoices');
        return mon_pay_view($ctx, $inv);
    });
