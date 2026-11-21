<?php
declare(strict_types=1);

namespace Loft;

// Port of packages/core/src/billing.test.ts (pure rules) and packages/data/src/local/money.test.ts
// (routes), with a small fixture instead of the demo seed: a host, a course billed per member with
// payers, and a client space billed per hour once per session.

// ---------------------------------------------------------------- core/billing.php

function mon_t_row(string $id, string $memberId, ?string $payerId, array $extra = []): array
{
    return array_merge(['id' => $id, 'sessionId' => "s_$id", 'spaceId' => 'sp1', 'memberId' => $memberId, 'payerId' => $payerId, 'minutes' => 60, 'status' => 'attended', 'billable' => true, 'unitPriceCents' => 1500, 'amountCents' => 1500, 'invoiceId' => null, 'at' => '2026-11-10T10:00:00Z'], $extra);
}

function mon_t_billing(array $extra = []): array
{
    return ['sp1' => array_merge(DEFAULT_BILLING, ['unitPriceCents' => 1500], $extra)];
}

function mon_t_state(array $extra = []): array
{
    return array_merge(['status' => 'sent', 'totalCents' => 300000, 'dueAt' => '2026-11-20T00:00:00Z', 'payments' => [], 'claims' => []], $extra);
}

test('billing: courses bill members, client spaces bill the space once per session (I1)', function () {
    $b = normalise_billing(['mode' => 'per_session', 'unitPriceCents' => 1500], 'course');
    eq([$b['model'], $b['per'], $b['unitPriceCents'], $b['dueDays']], ['per_session', 'member', 1500, 7]);
    ok(!array_key_exists('mode', $b), 'the legacy mode key is dropped');
    eq(normalise_billing(null, 'client')['per'], 'session');
    eq(normalise_billing(null, 'team')['model'], 'free');
    eq(billing_for(null)['per'], 'member');
});

test('billing: prices log rows per session, per hour (to the cent) and free; invoiced rows stay frozen (I2)', function () {
    $b = mon_t_billing()['sp1'];
    $blank = ['invoiceId' => null, 'unitPriceCents' => 0, 'amountCents' => 0, 'billable' => false];
    eq(price_row($blank + ['status' => 'attended', 'minutes' => 60], $b), ['billable' => true, 'unitPriceCents' => 1500, 'amountCents' => 1500]);
    eq(price_row($blank + ['status' => 'excused', 'minutes' => 60], $b)['amountCents'], 0);
    eq(price_row($blank + ['status' => 'late_cancel', 'minutes' => 0], $b)['amountCents'], 1500);
    eq(price_row($blank + ['status' => 'attended', 'minutes' => 61], array_merge($b, ['model' => 'per_hour', 'unitPriceCents' => 2250]))['amountCents'], 2288);
    eq(price_row($blank + ['status' => 'attended', 'minutes' => 20], array_merge($b, ['model' => 'per_hour', 'unitPriceCents' => 3333]))['amountCents'], 1111);
    eq(price_row($blank + ['status' => 'attended', 'minutes' => 60], array_merge($b, ['model' => 'free']))['billable'], false);
    eq(price_row(['status' => 'excused', 'minutes' => 60, 'invoiceId' => 'inv1', 'unitPriceCents' => 1500, 'amountCents' => 1500, 'billable' => true], $b)['amountCents'], 1500);
});

test('billing: one draft per payer, siblings combine, rows with no payer need attention (I3)', function () {
    $drafts = draft_invoices(
        [mon_t_row('1', 'ayaan', 'shirin'), mon_t_row('2', 'ayaan', 'shirin'), mon_t_row('3', 'nabila', 'shirin'), mon_t_row('4', 'dipa', null), mon_t_row('5', 'rafi', 'rafi', ['invoiceId' => 'old']), mon_t_row('6', 'x', 'x', ['billable' => false, 'amountCents' => 0]), mon_t_row('7', 'sumaiya', 'sumaiya', ['packageId' => 'pk1', 'amountCents' => 0])],
        mon_t_billing(),
        ['names' => ['ayaan' => 'Ayaan', 'nabila' => 'Nabila']]
    );
    eq(count($drafts), 2);
    $shirin = find($drafts, fn ($d) => $d['payerId'] === 'shirin');
    eq(array_column($shirin['lines'], 'description'), ['Ayaan · 2 sessions', 'Nabila · 1 session']);
    eq($shirin['totalCents'], 4500);
    eq([end($drafts)['payerId'], end($drafts)['needsAttention']], [null, 'no payer set']);
    eq(count(draft_invoices([mon_t_row('1', 'ayaan', 'shirin'), mon_t_row('2', 'nabila', 'shirin')], mon_t_billing(['combineSiblings' => false]))), 2, 'siblings split when combining is off');
});

test('billing: per-hour drafts total the hours, monthly drafts one line per member, credits are negative lines', function () {
    $hourly = draft_invoices([mon_t_row('1', 'a', 'p', ['minutes' => 90, 'amountCents' => 22500]), mon_t_row('2', 'a', 'p', ['minutes' => 93, 'amountCents' => 23250])], mon_t_billing(['model' => 'per_hour', 'unitPriceCents' => 15000]), ['names' => ['a' => 'Ayaan']]);
    $l = $hourly[0]['lines'][0];
    eq([$l['kind'], $l['qty'], $l['amountCents'], $l['description']], ['hours', 3.05, 45750, 'Ayaan · 3 h 3 min']);
    $monthly = draft_invoices([], mon_t_billing(['model' => 'monthly', 'unitPriceCents' => 120000]), ['monthLabel' => 'November', 'monthly' => [['spaceId' => 'sp1', 'memberId' => 'a', 'payerId' => 'p']]]);
    eq(count($monthly[0]['lines']), 1);
    $m = $monthly[0]['lines'][0];
    eq([$m['kind'], $m['qty'], $m['amountCents'], $m['description']], ['monthly', 1, 120000, 'Member · November']);
    $d = draft_invoices([mon_t_row('1', 't', 'tania'), mon_t_row('2', 't', 'tania'), mon_t_row('3', 't', 'tania', ['status' => 'late_cancel'])], mon_t_billing(), ['credits' => ['t' => 5]]);
    $c = end($d[0]['lines']);
    eq([$c['kind'], $c['qty'], $c['amountCents']], ['credit', 2, -3000]);
    eq($d[0]['totalCents'], 1500);
});

test('billing: numbering continues LF-0418 sequences, receipts RC-…, revisions -B', function () {
    eq(next_invoice_number([], 'LF'), 'LF-0001');
    eq(next_invoice_number(['LF-0410', 'LF-0412', 'LF-0412-B', 'XX-0999'], 'LF'), 'LF-0413');
    eq(next_invoice_number(['LF-0410'], 'LF', 418), 'LF-0418');
    eq(receipt_number('LF-0412', 0), 'RC-0412');
    eq(receipt_number('LF-0412-B', 1), 'RC-0412-2');
    eq(revision_number('LF-0412'), 'LF-0412-B');
    eq(revision_number('LF-0412-B'), 'LF-0412-C');
});

test('billing: payment status derives partial, paid, viewed, claimed, overdue, draft and void', function () {
    $now = ms('2026-11-15T00:00:00Z');
    eq(invoice_status(mon_t_state(), $now), 'sent');
    $partial = mon_t_state(['payments' => [['amountCents' => 100000]]]);
    eq([invoice_status($partial, $now), paid_total($partial), balance_due($partial)], ['partial', 100000, 200000]);
    $paid = mon_t_state(['payments' => [['amountCents' => 100000], ['amountCents' => 200000]]]);
    eq([invoice_status($paid, $now), balance_due($paid)], ['paid', 0]);
    eq(invoice_status(mon_t_state(['viewedAt' => '2026-11-12']), $now), 'viewed');
    eq(invoice_status(mon_t_state(['claims' => [['status' => 'open']]]), $now), 'claimed');
    $late = ms('2026-11-25T00:00:00Z');
    eq(invoice_status(mon_t_state(), $late), 'overdue');
    eq(is_overdue(mon_t_state(['claims' => [['status' => 'open']]]), $late), false);
    eq(invoice_status(mon_t_state(['status' => 'draft']), $now), 'draft');
    eq(invoice_status(mon_t_state(['status' => 'void']), $now), 'void');
    eq(INVOICE_STATUS_LABEL['claimed'], 'Payer says paid');
});

test('billing: reminders go out once per step, pause for claims and payer pauses, stop when paid', function () {
    $inv = ['status' => 'sent', 'totalCents' => 5000, 'dueAt' => '2026-11-20T00:00:00Z', 'payments' => [], 'claims' => []];
    $at = fn (string $day) => ms($day . 'T00:00:00Z');
    eq(reminder_due($inv, DEFAULT_REMINDERS, [], $at('2026-11-16')), null);
    eq(reminder_due($inv, DEFAULT_REMINDERS, [], $at('2026-11-17'))['offsetDays'], -3);
    eq(reminder_due($inv, DEFAULT_REMINDERS, [-3], $at('2026-11-23'))['offsetDays'], 3);
    eq(reminder_due($inv, DEFAULT_REMINDERS, [-3, 0, 3], $at('2026-11-30'))['final'], true);
    eq(reminder_due($inv, DEFAULT_REMINDERS, [-3, 0, 3, 10], $at('2026-12-30')), null);
    eq(next_reminder_at($inv, DEFAULT_REMINDERS, [-3, 0, 3]), $at('2026-11-30'));
    eq(next_reminder_at($inv, DEFAULT_REMINDERS, [-3, 0, 3, 10]), null);
    $t = $at('2026-11-23');
    eq(reminder_due(array_merge($inv, ['claims' => [['status' => 'open']]]), DEFAULT_REMINDERS, [], $t), null);
    eq(reminder_due($inv, DEFAULT_REMINDERS, [], $t, true), null);
    eq(reminder_due(array_merge($inv, ['payments' => [['amountCents' => 5000]]]), DEFAULT_REMINDERS, [], $t), null);
});

test('billing: reminder text, templates and wa.me links', function () {
    $msg = reminder_message(['payerName' => 'Tania Jahan', 'number' => 'LF-0414', 'amountCents' => 3500, 'dueAt' => '2026-11-27T12:00:00Z', 'payLink' => 'buy.stripe.com/nusrat-tutoring']);
    eq($msg, "Hi Tania, a reminder that LF-0414 for \$35.00 is due Fri 27 Nov. Pay here: buy.stripe.com/nusrat-tutoring. Already paid? Tap 'I've paid' so I can confirm it. Thank you!");
    eq(reminder_message(['payerName' => 'Tania', 'number' => 'LF-1', 'amountCents' => 123456, 'dueAt' => '2026-11-27T12:00:00Z', 'payLink' => 'x', 'template' => '{amount}', 'final' => true]), 'Final reminder: $1234.56');
    eq(fill_template('{invoice} {nope}', ['invoice' => 'LF-1']), 'LF-1 {nope}');
    eq(whatsapp_link('+880 17 1234 5678', 'Hi there'), 'https://wa.me/8801712345678?text=Hi%20there');
    eq(whatsapp_link(null, "It's (paid)!"), "https://wa.me/?text=It's%20(paid)!");
});

test('billing: payment links resolve same, template, per payer and space overrides', function () {
    $s = ['mode' => 'template', 'link' => 'https://pay.me/nusrat', 'template' => 'https://pay.me/nusrat?amount={amount}&ref={ref}', 'perPayer' => ['p2' => 'https://bank.example/p2?a={amount}']];
    eq(resolve_payment_link(array_merge($s, ['mode' => 'same']), 'p1', 4500, 'LF-1'), 'https://pay.me/nusrat');
    eq(resolve_payment_link($s, 'p1', 4500, 'LF-1'), 'https://pay.me/nusrat?amount=45.00&ref=LF-1');
    eq(resolve_payment_link(array_merge($s, ['mode' => 'per_payer']), 'p2', 4500, 'LF-1'), 'https://bank.example/p2?a=45.00');
    eq(resolve_payment_link(array_merge($s, ['mode' => 'per_payer']), 'p1', 4500, 'LF-1'), 'https://pay.me/nusrat');
    eq(resolve_payment_link($s, 'p1', 4500, 'LF-1', 'https://club.example/pay'), 'https://club.example/pay');
    eq(resolve_payment_link(null, 'p1', 4500, 'LF-1'), null);
});

test('billing: package credits count only active rows; renewal at the threshold (I5)', function () {
    $rows = [
        ['kind' => 'purchase', 'qty' => 8, 'active' => true, 'at' => '1'],
        ['kind' => 'use', 'qty' => 1, 'active' => true, 'at' => '2'],
        ['kind' => 'use', 'qty' => 1, 'active' => true, 'at' => '3'],
        ['kind' => 'credit', 'qty' => 1, 'active' => true, 'at' => '4'],
        ['kind' => 'purchase', 'qty' => 8, 'active' => false, 'at' => '5'],
        ['kind' => 'expiry', 'qty' => 2, 'active' => true, 'at' => '6'],
    ];
    eq(ledger_balance($rows), 5);
    eq(needs_renewal(2, 2, false), true);
    eq(needs_renewal(2, 2, true), false);
    eq(needs_renewal(3, 2, false), false);
});

test('billing: CSV export escapes cells; months and durations', function () {
    $csv = to_csv([['n' => 'LF-1', 'who' => 'Karim, "N"', 'amt' => 4500]], [['key' => 'n', 'label' => 'Number'], ['key' => 'who', 'label' => 'Payer'], ['key' => 'amt', 'label' => 'Amount (USD)', 'format' => fn ($v) => number_format($v / 100, 2, '.', '')]]);
    eq($csv, "Number,Payer,Amount (USD)\nLF-1,\"Karim, \"\"N\"\"\",45.00\n");
    eq(month_key(ms('2026-11-21T12:00:00Z')), '2026-11');
    eq(prev_month_key('2026-01'), '2025-12');
    ok(ms(month_range('2026-11')['end']) - ms(month_range('2026-11')['start']) > 29 * DAY, 'a month is longer than 29 days');
    eq([duration_label(120), duration_label(183), duration_label(45)], ['2 h', '3 h 3 min', '45 min']);
});

// ---------------------------------------------------------------- routes/money.php

const MON_T_NOW = '2026-11-21T08:00:00Z'; // a Saturday: invoices sent now are due Sat 28 Nov

/** Host Nusrat; Physics (course, $15/session/member, Shirin pays for Ayaan + Nabila, Dipa has no payer); Acme (client, $150/h per session, Farhan pays). */
function mon_t_world(Db $db): void
{
    $GLOBALS['loft_now'] = ms(MON_T_NOW);
    $now = iso(now_ms());
    $user = function (string $id, string $name, ?string $email = null, ?string $phone = null) use ($now): array {
        $u = ['id' => $id, 'name' => $name, 'tz' => 'UTC', 'status' => 'available', 'createdAt' => $now];
        if ($email !== null) $u['email'] = $email;
        if ($phone !== null) $u['phone'] = $phone;
        return $u;
    };
    put($db, 'users',
        $user('u_host', 'Nusrat Rahman', 'host@example.test'),
        $user('u_ayaan', 'Ayaan Karim', 'ayaan@example.test'),
        $user('u_nabila', 'Nabila Karim'),
        $user('u_shirin', 'Shirin Karim', 'shirin@example.test', '+880 17 1234 5678'),
        $user('u_dipa', 'Dipa Saha', 'dipa@example.test'),
        $user('u_farhan', 'Farhan Ahmed', 'farhan@acme.test')
    );
    $space = fn (string $id, string $mode, string $code, string $name, string $slug, array $billing) => ['id' => $id, 'orgId' => null, 'mode' => $mode, 'code' => $code, 'name' => $name, 'sub' => '', 'slug' => $slug, 'colour' => 'teal', 'roomSlug' => $slug, 'createdAt' => $now, 'createdBy' => 'u_host', 'billing' => $billing];
    put($db, 'spaces',
        $space('sp_phy', 'course', 'PHY', 'Physics', 'physics', ['model' => 'per_session', 'unitPriceCents' => 1500, 'payers' => ['u_ayaan' => 'u_shirin', 'u_nabila' => 'u_shirin']]),
        $space('sp_acme', 'client', 'ACM', 'Acme Pricing', 'acme-pricing', ['model' => 'per_hour', 'unitPriceCents' => 15000, 'payers' => ['*' => 'u_farhan']])
    );
    $member = fn (string $spaceId, string $userId, string $role) => ['id' => "$spaceId:$userId", 'spaceId' => $spaceId, 'userId' => $userId, 'role' => $role, 'lastReadAt' => $now];
    put($db, 'memberships',
        $member('sp_phy', 'u_host', 'host'),
        $member('sp_phy', 'u_ayaan', 'member'),
        $member('sp_phy', 'u_nabila', 'member'),
        $member('sp_phy', 'u_dipa', 'member'),
        $member('sp_acme', 'u_host', 'host'),
        $member('sp_acme', 'u_farhan', 'member')
    );
}

/** Wrap up a session the way plans.php does: record_attendance with ['u_x' => 'attended', …]. */
function mon_t_attend(Db $db, string $sessionId, string $spaceId, string $day, array $statuses, int $minutes = 60): array
{
    $db->clearCache();
    $rows = [];
    foreach ($statuses as $memberId => $status) $rows[] = ['memberId' => (string) $memberId, 'minutes' => $status === 'attended' ? $minutes : 0, 'status' => $status];
    $ctx = new Ctx($db, 'u_host');
    $out = record_attendance($ctx, ['id' => $sessionId, 'spaceId' => $spaceId, 'startsAt' => "{$day}T10:00:00.000Z", 'minutes' => $minutes, 'title' => 'Lesson'], $rows);
    $ctx->flush();
    return $out;
}

function mon_t_host(Db $db, string $method, string $resource, array $input = []): mixed
{
    return call($db, 'u_host', $method, $resource, $input);
}

function mon_t_by(array $list, string $key, mixed $value): ?array
{
    return find($list, fn ($x) => ($x[$key] ?? null) === $value);
}

function mon_t_mail_to(string $to): array
{
    return array_values(array_filter($GLOBALS['loft_mail'] ?? [], fn ($m) => $m['to'] === $to));
}

function mon_t_token(array $listView): string
{
    $parts = explode('/', (string) $listView['payPath']);
    return (string) end($parts);
}

test('money: drafts per payer, flags a member with no payer, add payer, sends LF-0001… then continues from next number', function () {
    $db = fresh();
    mon_t_world($db);
    mon_t_attend($db, 'se_1', 'sp_phy', '2026-11-03', ['u_ayaan' => 'attended', 'u_nabila' => 'attended', 'u_dipa' => 'attended']);
    mon_t_attend($db, 'se_2', 'sp_phy', '2026-11-10', ['u_ayaan' => 'attended', 'u_nabila' => 'absent', 'u_dipa' => 'late_cancel']);
    mon_t_attend($db, 'se_3', 'sp_acme', '2026-11-12', ['u_farhan' => 'attended'], 120);

    $log = mon_t_host($db, 'GET', 'money/log', ['month' => '2026-11']);
    eq(count($log['rows']), 7);
    eq([$log['kpis']['notInvoicedCents'], $log['kpis']['billableSessions'], $log['kpis']['lateCancels'], $log['kpis']['makeupCredits']], [37500, 6, 1, 0]);
    $acme = mon_t_by($log['rows'], 'memberId', 'space:sp_acme');
    eq([$acme['minutes'], $acme['amountCents'], $acme['payerId'], $acme['memberName'], $acme['payerName']], [120, 30000, 'u_farhan', 'Acme Pricing', 'Farhan Ahmed']);
    $overview = mon_t_host($db, 'GET', 'money/overview', ['month' => '2026-11']);
    eq([$overview['kpis']['notInvoicedCents'], $overview['kpis']['drafts'], $overview['unconfigured'], $overview['months'][0]], [37500, 0, [], ['key' => '2026-11', 'label' => 'November 2026']]);

    eq(mon_t_host($db, 'POST', 'money/run', ['month' => '2026-11']), ['month' => '2026-11', 'drafts' => 3, 'ready' => 2]);
    $inv = mon_t_host($db, 'GET', 'money/invoices');
    eq($inv['draftLabel'], 'November 2026');
    eq(array_column($inv['ready'], 'totalCents'), [30000, 4500]);
    eq(mon_t_by($inv['ready'], 'payerId', 'u_shirin')['summary'], 'Ayaan + Nabila · combined · 3 sessions');
    eq(mon_t_by($inv['ready'], 'payerId', 'u_farhan')['summary'], 'Acme · 2 h');
    eq(count($inv['attention']), 1);
    eq([$inv['attention'][0]['payerName'], $inv['attention'][0]['needsAttention'], $inv['attention'][0]['totalCents']], ['Dipa Saha', 'no payer set', 3000]);
    $review = mon_t_by(money_review_items(new Ctx($db, 'u_host'), 'u_host'), 'id', 'drafts');
    eq([$review['title'], $review['sub']], ['2 invoice drafts ready to send', '$345.00 · 1 needs attention']);

    // Dipa pays for herself → the draft moves to Ready.
    throws(fn () => mon_t_host($db, 'POST', 'spaces/sp_phy/billing/payer', ['memberId' => 'u_dipa', 'payerId' => 'u_nobody']), '/Pick a payer/');
    eq(mon_t_host($db, 'POST', 'spaces/sp_phy/billing/payer', ['memberId' => 'u_dipa', 'payerId' => 'u_dipa']), ['ok' => true]);
    $inv = mon_t_host($db, 'GET', 'money/invoices');
    eq(count($inv['attention']), 0);
    eq(array_column($inv['ready'], 'totalCents'), [30000, 4500, 3000]);
    eq(mon_t_by($inv['ready'], 'payerId', 'u_dipa')['summary'], 'self · 2 sessions');

    $sent = mon_t_host($db, 'POST', 'invoices/send', ['ids' => array_column($inv['ready'], 'id')])['sent'];
    eq(array_column($sent, 'number'), ['LF-0001', 'LF-0002', 'LF-0003']);
    eq(array_column($sent, 'status'), ['sent', 'sent', 'sent']);
    eq($sent[1]['dueAt'], '2026-11-28T08:00:00.000Z');
    // Server: each payer gets the invoice by email with the pay page link.
    $mail = mon_t_mail_to('shirin@example.test');
    eq(count($mail), 1);
    eq($mail[0]['subject'], 'Invoice LF-0002 from Nusrat Rahman · $45.00');
    contains($mail[0]['body'], 'https://example.test/spaces/#' . $sent[1]['payPath']);
    contains($mail[0]['body'], 'due Sat 28 Nov');
    eq(mon_t_mail_to('farhan@acme.test')[0]['subject'], 'Invoice LF-0001 from Nusrat Rahman · $300.00');
    ok(some($db->list('notifications'), fn ($n) => $n['userId'] === 'u_shirin' && $n['kind'] === 'invoice' && $n['title'] === 'Invoice LF-0002 from Nusrat Rahman · $45.00'), 'in-app invoice notification');

    // Frozen: invoiced rows can't change status, and re-wrapping the session leaves them alone.
    $after = mon_t_host($db, 'GET', 'money/log', ['month' => '2026-11']);
    $frozen = find($after['rows'], fn ($r) => $r['invoiceNumber'] && $r['invoiceNumber'] !== 'draft');
    ok($frozen, 'an invoiced row');
    throws(fn () => mon_t_host($db, 'POST', 'money/log/' . rawurlencode($frozen['id']), ['status' => 'excused']), '/on an invoice/', Forbidden::class);
    $again = mon_t_attend($db, 'se_1', 'sp_phy', '2026-11-03', ['u_ayaan' => 'excused']);
    eq([$again[0]['status'], $again[0]['amountCents'], $again[0]['invoiceId'] !== null], ['attended', 1500, true]);
    eq(mon_t_host($db, 'GET', 'money/log', ['month' => '2026-11'])['kpis']['makeupCredits'], 0);
    throws(fn () => call($db, 'u_ayaan', 'GET', 'spaces/sp_phy/billing'), '/Only the host/', Forbidden::class);

    // The host's "Next number" wins when higher: LF-0418, and the sequence continues from there.
    mon_t_host($db, 'POST', 'money/settings', ['nextNumber' => 418]);
    mon_t_attend($db, 'se_4', 'sp_phy', '2026-11-17', ['u_dipa' => 'attended']);
    eq(mon_t_host($db, 'POST', 'money/run', ['month' => '2026-11'])['drafts'], 1);
    $draft = mon_t_host($db, 'GET', 'money/invoices')['ready'][0];
    eq(mon_t_host($db, 'POST', 'invoices/send', ['ids' => [$draft['id']]])['sent'][0]['number'], 'LF-0418');
    eq(mon_t_host($db, 'GET', 'spaces/sp_phy/billing')['settings']['nextNumber'], 'LF-0419');
});

test('money: excused re-prices to $0 with a makeup credit the next invoice applies as a negative line', function () {
    $db = fresh();
    mon_t_world($db);
    mon_t_attend($db, 'se_1', 'sp_phy', '2026-11-03', ['u_ayaan' => 'attended', 'u_nabila' => 'attended']);
    mon_t_attend($db, 'se_2', 'sp_phy', '2026-11-10', ['u_ayaan' => 'attended']);
    mon_t_attend($db, 'se_3', 'sp_phy', '2026-11-17', ['u_ayaan' => 'attended']);
    $before = mon_t_host($db, 'GET', 'money/log', ['month' => '2026-11'])['kpis']['makeupCredits'];
    $next = mon_t_host($db, 'POST', 'money/log/' . rawurlencode('se_3:u_ayaan'), ['status' => 'excused']);
    eq([$next['status'], $next['amountCents'], $next['billable']], ['excused', 0, false]);
    $log = mon_t_host($db, 'GET', 'money/log', ['month' => '2026-11']);
    eq($log['kpis']['makeupCredits'], $before + 1);
    ok(mon_t_by($log['rows'], 'id', 'se_3:u_ayaan')['credit'], 'the row shows its credit');
    $credit = $db->get('credits', 'credit:se_3:u_ayaan');
    eq([$credit['note'], $credit['expiresAt'], $credit['payerId']], ['Makeup credit · excused Tue 17 Nov', '2027-01-16T10:00:00.000Z', 'u_shirin']);

    mon_t_host($db, 'POST', 'money/run', ['month' => '2026-11']);
    $draft = mon_t_by(mon_t_host($db, 'GET', 'money/invoices')['ready'], 'payerId', 'u_shirin');
    eq([$draft['totalCents'], $draft['tags'], $draft['summary']], [3000, ['credit −$15'], 'Ayaan + Nabila · combined · 3 sessions · 1 credit used']);
    $line = mon_t_by(mon_t_host($db, 'GET', 'invoices/' . $draft['id'])['lines'], 'kind', 'credit');
    eq([$line['description'], $line['qty'], $line['unitCents'], $line['amountCents']], ['Ayaan Karim · makeup credit', 1, -1500, -1500]);

    // Sending uses the credit; voiding gives it (and the rows) back.
    mon_t_host($db, 'POST', 'invoices/send', ['ids' => [$draft['id']]]);
    eq($db->get('credits', 'credit:se_3:u_ayaan')['usedBy'], $draft['id']);
    eq(mon_t_host($db, 'GET', 'money/log', ['month' => '2026-11'])['kpis']['makeupCredits'], 0);
    eq(mon_t_host($db, 'POST', 'invoices/' . $draft['id'] . '/void'), ['ok' => true]);
    $log = mon_t_host($db, 'GET', 'money/log', ['month' => '2026-11']);
    eq($log['kpis']['makeupCredits'], 1);
    ok(every($log['rows'], fn ($r) => $r['invoiceId'] === null), 'rows are back in the log');
    eq(mon_t_host($db, 'GET', 'invoices/' . $draft['id'])['status'], 'void');
});

test('money: payer says paid on the pay page; host confirms with RC receipts (part payment) or rejects → overdue', function () {
    $db = fresh();
    mon_t_world($db);
    mon_t_host($db, 'POST', 'money/settings', ['paymentLink' => ['mode' => 'same', 'link' => 'https://pay.example.com/nusrat']]);
    mon_t_attend($db, 'se_1', 'sp_phy', '2026-11-03', ['u_ayaan' => 'attended', 'u_nabila' => 'attended']);
    mon_t_attend($db, 'se_2', 'sp_acme', '2026-11-04', ['u_farhan' => 'attended']);
    mon_t_host($db, 'POST', 'money/run', ['month' => '2026-11']);
    $ready = mon_t_host($db, 'GET', 'money/invoices')['ready'];
    $sent = mon_t_host($db, 'POST', 'invoices/send', ['ids' => array_column($ready, 'id')])['sent'];
    $shirin = mon_t_by($sent, 'payerId', 'u_shirin');
    eq($shirin['number'], 'LF-0002');
    $token = mon_t_token($shirin);

    $view = call($db, 'u_shirin', 'GET', "pay/$token");
    eq([$view['number'], $view['balanceCents'], $view['payLink'], count($view['lines']), $view['host']['name'], $view['periodLabel']], ['LF-0002', 3000, 'https://pay.example.com/nusrat', 2, 'Nusrat Rahman', 'November 2026']);
    $d = mon_t_host($db, 'GET', 'invoices/' . $shirin['id']);
    eq([$d['status'], $d['viewCount']], ['viewed', 1]);
    throws(fn () => call($db, null, 'GET', 'pay/pay_nope'), "/isn't valid/", NotFound::class);

    $after = call($db, null, 'POST', "pay/$token/claim", ['amountCents' => 3000, 'method' => 'Bank transfer', 'reference' => 'LF-0002']);
    eq([$after['status'], $after['claims'][0]['status'], $after['claims'][0]['method']], ['claimed', 'open', 'Bank transfer']);
    ok(some($db->list('notifications'), fn ($n) => $n['userId'] === 'u_host' && $n['title'] === 'Shirin Karim says LF-0002 is paid'), 'the host hears about the claim');
    $claim = find(mon_t_host($db, 'GET', 'money/claims')['open'], fn ($c) => $c['invoice']['number'] === 'LF-0002');
    eq($claim['invoice']['status'], 'claimed');
    ok(some(money_review_items(new Ctx($db, 'u_host'), 'u_host'), fn ($i) => $i['title'] === 'Shirin Karim says LF-0002 is paid' && $i['sub'] === '$30.00 · Bank transfer · LF-0002'), 'claim to review');

    // Part payment first, then the rest. Receipts go out by email too.
    eq(mon_t_host($db, 'POST', 'invoices/' . $shirin['id'] . '/confirm', ['claimId' => $claim['id'], 'amountCents' => 1000]), ['receipt' => 'RC-0002', 'balanceCents' => 2000]);
    eq(mon_t_mail_to('shirin@example.test')[1]['subject'], 'Receipt RC-0002 · $10.00');
    eq(mon_t_host($db, 'POST', 'invoices/' . $shirin['id'] . '/confirm', []), ['receipt' => 'RC-0002-2', 'balanceCents' => 0]);
    contains(mon_t_mail_to('shirin@example.test')[2]['body'], 'paid in full');
    $detail = mon_t_host($db, 'GET', 'invoices/' . $shirin['id']);
    eq([$detail['status'], end($detail['activity'])['text'], $detail['claims'][0]['status']], ['paid', 'Payment confirmed · $20.00 · receipt RC-0002-2', 'confirmed']);
    throws(fn () => mon_t_host($db, 'POST', 'invoices/' . $shirin['id'] . '/confirm', []), '/Nothing left to pay/');
    eq(array_column(call($db, null, 'GET', "pay/$token")['receipts'], 'receipt'), ['RC-0002', 'RC-0002-2']);

    // Questions on the pay page and the host's reply.
    $view = call($db, null, 'POST', "pay/$token/comments", ['body' => 'Does this include Saturday?', 'lineIdx' => 0]);
    eq([count($view['comments']), $view['comments'][0]['fromPayer'], $view['comments'][0]['name'], $view['comments'][0]['lineIdx']], [1, true, 'Shirin Karim', 0]);
    mon_t_host($db, 'POST', 'invoices/' . $shirin['id'] . '/comments', ['body' => 'No, that one was free.']);
    eq(count(mon_t_host($db, 'GET', 'invoices/' . $shirin['id'])['comments']), 2);

    // Reject Farhan's claim → reminders resume (overdue once the due date has passed).
    $acme = mon_t_by($sent, 'payerId', 'u_farhan');
    call($db, null, 'POST', 'pay/' . mon_t_token($acme) . '/claim', ['method' => 'Card']);
    $GLOBALS['loft_now'] = ms('2026-12-01T09:00:00Z');
    eq(mon_t_host($db, 'GET', 'invoices/' . $acme['id'])['status'], 'claimed', 'an open claim stops overdue');
    $open = find(mon_t_host($db, 'GET', 'money/claims')['open'], fn ($c) => $c['invoice']['id'] === $acme['id']);
    eq($open['amountCents'], 15000);
    mon_t_host($db, 'POST', 'invoices/' . $acme['id'] . '/reject', ['claimId' => $open['id'], 'reason' => 'Not in my account yet']);
    $d = mon_t_host($db, 'GET', 'invoices/' . $acme['id']);
    eq([$d['status'], $d['overdueDays'], $d['claims'][0]['status'], $d['claims'][0]['reason']], ['overdue', 3, 'rejected', 'Not in my account yet']);
    ok(some($db->list('notifications'), fn ($n) => $n['userId'] === 'u_farhan' && $n['title'] === 'LF-0001: payment not found yet'), 'the payer is told');
    throws(fn () => mon_t_host($db, 'POST', 'invoices/' . $acme['id'] . '/reject', ['claimId' => $open['id']]), '/No open claim/', NotFound::class);

    // "Can't find it · ask Farhan": a DM in the host's name.
    eq(mon_t_host($db, 'POST', 'invoices/' . $acme['id'] . '/ask', [])['dm'], '/dm/u_farhan');
    $dm = $db->list('messages')[0];
    eq([$dm['channelId'], $dm['body']], ['u_farhan~u_host', "Hi Farhan, I can't find the payment for LF-0001 (\$150.00) yet. Could you send the receipt or reference?"]);
});

test('money: revising a sent invoice drafts -B; sending it voids the original and keeps its payments', function () {
    $db = fresh();
    mon_t_world($db);
    mon_t_attend($db, 'se_1', 'sp_phy', '2026-11-03', ['u_ayaan' => 'attended', 'u_nabila' => 'attended']);
    mon_t_attend($db, 'se_2', 'sp_phy', '2026-11-10', ['u_ayaan' => 'attended']);
    mon_t_host($db, 'POST', 'money/run', ['month' => '2026-11']);
    $draft = mon_t_host($db, 'GET', 'money/invoices')['ready'][0];
    $orig = mon_t_host($db, 'POST', 'invoices/send', ['ids' => [$draft['id']]])['sent'][0];
    eq([$orig['number'], $orig['totalCents']], ['LF-0001', 4500]);
    throws(fn () => mon_t_host($db, 'POST', 'invoices/' . $orig['id'] . '/lines', ['lines' => []]), '/frozen/', Forbidden::class);
    mon_t_host($db, 'POST', 'invoices/' . $orig['id'] . '/confirm', ['amountCents' => 1000]);

    $id = mon_t_host($db, 'POST', 'invoices/' . $orig['id'] . '/revise')['id'];
    eq(mon_t_host($db, 'POST', 'invoices/' . $orig['id'] . '/revise')['id'], $id, 'one open revision at a time');
    $rev = mon_t_host($db, 'GET', "invoices/$id");
    eq([$rev['number'], $rev['status'], $rev['revisionOf']['number']], ['LF-0001-B', 'draft', 'LF-0001']);
    $lines = $rev['lines'];
    $lines[] = array_merge($rev['lines'][0], ['description' => 'Discount', 'kind' => 'adjustment', 'qty' => 1, 'unitCents' => -500, 'amountCents' => -500, 'logIds' => [], 'sessionIds' => []]);
    eq(mon_t_host($db, 'POST', "invoices/$id/lines", ['lines' => $lines])['totalCents'], 4000);
    eq(mon_t_host($db, 'POST', 'invoices/send', ['ids' => [$id]])['sent'][0]['number'], 'LF-0001-B');

    $all = mon_t_host($db, 'GET', 'money/invoices')['sent'];
    eq(mon_t_by($all, 'number', 'LF-0001')['status'], 'void');
    $b = mon_t_by($all, 'number', 'LF-0001-B');
    eq([$b['totalCents'], $b['balanceCents'], $b['status']], [4000, 3000, 'partial']);
    eq(call($db, null, 'GET', 'pay/' . mon_t_token($orig))['number'], 'LF-0001-B', 'the same link opens the revision');
    $old = mon_t_host($db, 'GET', 'invoices/' . $orig['id']);
    eq([$old['replacedBy']['number'], end($old['activity'])['text']], ['LF-0001-B', 'Replaced by LF-0001-B']);
    ok(every(mon_t_host($db, 'GET', 'money/log', ['month' => '2026-11'])['rows'], fn ($r) => $r['invoiceNumber'] === 'LF-0001-B'), 'the rows move to the revision');
});

test('money: a sold package activates on payment, pays for sessions, and renews at the threshold', function () {
    $db = fresh();
    mon_t_world($db);
    $invoiceId = mon_t_host($db, 'POST', 'money/packages', ['spaceId' => 'sp_phy', 'memberId' => 'u_ayaan', 'size' => 8, 'priceCents' => 11000])['invoiceId'];
    throws(fn () => mon_t_host($db, 'POST', 'money/packages', ['spaceId' => 'sp_phy', 'memberId' => 'u_ayaan', 'size' => 8, 'priceCents' => 0]), '/Set the sessions and a price/');
    $pk = mon_t_by(mon_t_host($db, 'GET', 'money/packages')['packages'], 'memberName', 'Ayaan Karim');
    eq([$pk['status'], $pk['left'], $pk['plan'], $pk['invoice']['status']], ['awaiting', 0, '8-session package', 'draft']);
    eq(mon_t_host($db, 'POST', 'invoices/send', ['ids' => [$invoiceId]])['sent'][0]['summary'], 'Ayaan · 8-session package · PHY');
    mon_t_host($db, 'POST', "invoices/$invoiceId/confirm", []);
    $pk = mon_t_by(mon_t_host($db, 'GET', 'money/packages')['packages'], 'memberName', 'Ayaan Karim');
    eq([$pk['status'], $pk['left'], $pk['ledger'][0]['note'], $pk['invoice']['status']], ['active', 8, 'Bought · LF-0001 paid', 'paid']);

    // Sessions now come out of the package: $0 on the log and never on a per-session invoice.
    mon_t_attend($db, 'se_1', 'sp_phy', '2026-11-03', ['u_ayaan' => 'attended', 'u_nabila' => 'attended']);
    $row = mon_t_by(mon_t_host($db, 'GET', 'money/log', ['month' => '2026-11'])['rows'], 'id', 'se_1:u_ayaan');
    eq([$row['amountCents'], $row['package']], [0, ['used' => 1, 'size' => 8]]);
    mon_t_host($db, 'POST', 'money/run', ['month' => '2026-11']);
    $draft = mon_t_by(mon_t_host($db, 'GET', 'money/invoices')['ready'], 'payerId', 'u_shirin');
    eq([$draft['summary'], $draft['totalCents']], ['Nabila · 1 session', 1500]);

    // Down to 2 left → the next day's first request drafts the renewal.
    foreach (['se_2' => '2026-11-04', 'se_3' => '2026-11-05', 'se_4' => '2026-11-06', 'se_5' => '2026-11-07', 'se_6' => '2026-11-08'] as $sid => $day) mon_t_attend($db, $sid, 'sp_phy', $day, ['u_ayaan' => 'attended']);
    $GLOBALS['loft_now'] = ms('2026-11-22T08:00:00Z');
    $inv = mon_t_host($db, 'GET', 'money/invoices');
    $renewal = mon_t_by($inv['ready'], 'kind', 'package');
    eq([$renewal['totalCents'], $renewal['tags']], [11000, ['package renewal']]);
    $pkgs = mon_t_host($db, 'GET', 'money/packages')['packages'];
    eq(count($pkgs), 1, 'the renewal shows on the package it renews');
    eq([$pkgs[0]['status'], $pkgs[0]['used'], $pkgs[0]['left'], $pkgs[0]['renewal']['priceCents']], ['renewal', 6, 2, 11000]);
});

test('money: the daily task sends due reminders once (in-app + email) and queues WhatsApp, never sends it', function () {
    $db = fresh();
    mon_t_world($db);
    mon_t_attend($db, 'se_1', 'sp_phy', '2026-11-03', ['u_ayaan' => 'attended', 'u_nabila' => 'attended']);
    mon_t_host($db, 'POST', 'money/run', ['month' => '2026-11']);
    $draft = mon_t_host($db, 'GET', 'money/invoices')['ready'][0];
    mon_t_host($db, 'POST', 'invoices/send', ['ids' => [$draft['id']]]);
    $inv = mon_t_host($db, 'GET', 'money/invoices')['sent'][0];
    eq([$inv['nextReminderAt'], $inv['nextReminderDays']], [ms('2026-11-25T08:00:00Z'), 4]);
    $id = $inv['id'];
    $mails = fn () => count(mon_t_mail_to('shirin@example.test'));
    eq($mails(), 1);

    $GLOBALS['loft_now'] = ms('2026-11-25T09:00:00Z');
    mon_t_host($db, 'GET', 'money/invoices');
    $d = mon_t_host($db, 'GET', "invoices/$id");
    eq([$d['remindersSent'], end($d['activity'])['text']], [[-3], 'Reminder · in-app + email']);
    $mail = mon_t_mail_to('shirin@example.test')[1];
    eq($mail['subject'], 'Invoice LF-0001 · $30.00 due Sat 28 Nov');
    eq($mail['body'], 'Hi Shirin, a reminder that LF-0001 for $30.00 is due Sat 28 Nov. Pay here: https://example.test/spaces/#' . $d['payPath'] . ". Already paid? Tap 'I've paid' so I can confirm it. Thank you!");
    ok(some($db->list('notifications'), fn ($n) => $n['userId'] === 'u_shirin' && $n['title'] === 'Reminder: LF-0001 · $30.00' && $n['sub'] === 'Due Sat 28 Nov'), 'in-app reminder');
    $GLOBALS['loft_now'] = ms('2026-11-25T15:00:00Z');
    mon_t_host($db, 'GET', 'money/invoices');
    eq($mails(), 2, 'once a day');

    // Due + 3: the skipped due-day step is marked, the WhatsApp step is queued for the host.
    $GLOBALS['loft_now'] = ms('2026-12-01T09:00:00Z');
    mon_t_host($db, 'GET', 'money/reminders');
    $d = mon_t_host($db, 'GET', "invoices/$id");
    eq([$d['remindersSent'], end($d['activity'])['text']], [[-3, 0, 3], 'Reminder · in-app + email · WhatsApp to send']);
    eq($mails(), 3);
    ok(some(money_review_items(new Ctx($db, 'u_host'), 'u_host'), fn ($i) => $i['id'] === "wa:$id" && $i['title'] === 'WhatsApp reminder to send · Shirin Karim'), 'WhatsApp is queued for the host');
    eq(whatsapp_link($d['payerPhone'], 'x'), 'https://wa.me/8801712345678?text=x');

    // Pausing a payer stops the next run.
    eq(mon_t_host($db, 'POST', 'money/payers/u_shirin/pause', ['paused' => true]), ['paused' => true]);
    $r = mon_t_host($db, 'GET', 'money/reminders');
    eq([$r['overdue'][0]['paused'], count($r['queued']), $r['pausedPayers'][0]['name']], [true, 1, 'Shirin Karim']);
    $GLOBALS['loft_now'] = ms('2026-12-09T09:00:00Z');
    mon_t_host($db, 'GET', 'money/invoices');
    eq(mon_t_host($db, 'GET', "invoices/$id")['remindersSent'], [-3, 0, 3]);
    eq(mon_t_host($db, 'POST', 'money/payers/u_shirin/pause', ['paused' => false]), ['paused' => false]);
    $GLOBALS['loft_now'] = ms('2026-12-10T09:00:00Z');
    mon_t_host($db, 'GET', 'money/invoices');
    $d = mon_t_host($db, 'GET', "invoices/$id");
    eq([end($d['activity'])['text'], $d['finalSent'], $d['remindersSent']], ['Final reminder · email · WhatsApp to send', true, [-3, 0, 3, 10]]);
    contains(end($GLOBALS['loft_mail'])['body'], 'Final reminder: Hi Shirin');
    // The host taps the wa.me link and marks the nudge: the queue clears.
    mon_t_host($db, 'POST', "invoices/$id/resend", ['nudge' => true]);
    eq(mon_t_host($db, 'GET', 'money/reminders')['queued'], []);
});

test('money: the first request on/after the 1st drafts last month automatically', function () {
    $db = fresh();
    mon_t_world($db);
    mon_t_attend($db, 'se_1', 'sp_phy', '2026-11-03', ['u_ayaan' => 'attended', 'u_nabila' => 'attended', 'u_dipa' => 'attended']);
    $inv = mon_t_host($db, 'GET', 'money/invoices');
    eq([count($inv['ready']), count($inv['attention']), $inv['draftLabel']], [0, 0, null]);
    eq(mon_t_host($db, 'GET', 'money/settings')['lastAutoRun'], '2026-10');
    $GLOBALS['loft_now'] = ms('2026-12-01T09:00:00Z');
    $inv = mon_t_host($db, 'GET', 'money/invoices');
    eq([$inv['draftLabel'], count($inv['ready']), count($inv['attention'])], ['November 2026', 1, 1]);
    eq(mon_t_host($db, 'GET', 'invoices/' . $inv['ready'][0]['id'])['activity'][0]['text'], 'Drafted automatically');
    $s = mon_t_host($db, 'GET', 'money/settings');
    eq([$s['lastAutoRun'], $s['lastDaily']], ['2026-11', '2026-12-01']);
    $GLOBALS['loft_now'] = ms('2026-12-02T09:00:00Z');
    eq(count(mon_t_host($db, 'GET', 'money/invoices')['ready']), 1, 'no second run for the same month');
});

test('money: after-session spaces draft per session; monthly spaces bill each member once a month', function () {
    $db = fresh();
    mon_t_world($db);
    $b = mon_t_host($db, 'POST', 'spaces/sp_acme/billing', ['billing' => ['schedule' => 'after_session', 'dueDays' => 14]]);
    eq([$b['schedule'], $b['dueDays'], $b['per'], $b['model']], ['after_session', 14, 'session', 'per_hour']);
    mon_t_attend($db, 'se_9', 'sp_acme', '2026-11-20', ['u_farhan' => 'attended'], 90);
    $ready = mon_t_host($db, 'GET', 'money/invoices')['ready'];
    eq(count($ready), 1);
    eq([$ready[0]['kind'], $ready[0]['totalCents'], $ready[0]['summary']], ['session', 22500, 'Acme · 1.5 h']);

    $m = mon_t_host($db, 'POST', 'spaces/sp_phy/billing', ['billing' => ['model' => 'monthly', 'unitPriceCents' => 12000]]);
    eq($m['payers'], ['u_ayaan' => 'u_shirin', 'u_nabila' => 'u_shirin'], 'payers are kept');
    eq(mon_t_host($db, 'POST', 'money/run', ['month' => '2026-11']), ['month' => '2026-11', 'drafts' => 2, 'ready' => 1]);
    $inv = mon_t_host($db, 'GET', 'money/invoices');
    eq(array_column($inv['ready'], 'totalCents'), [24000, 22500]);
    eq($inv['ready'][0]['summary'], 'Ayaan + Nabila · combined · monthly');
    eq([$inv['attention'][0]['payerName'], $inv['attention'][0]['totalCents']], ['Dipa Saha', 12000]);
    // Once a member's month is invoiced it isn't billed again.
    mon_t_host($db, 'POST', 'invoices/send', ['ids' => [$inv['ready'][0]['id']]]);
    eq(mon_t_host($db, 'POST', 'money/run', ['month' => '2026-11'])['drafts'], 1);
    $billing = mon_t_host($db, 'GET', 'spaces/sp_phy/billing');
    eq([$billing['configured'], $billing['billing']['model'], count($billing['members'])], [true, 'monthly', 3]);
    eq(mon_t_by($billing['members'], 'memberId', 'u_ayaan')['payerName'], 'Shirin Karim');
});
