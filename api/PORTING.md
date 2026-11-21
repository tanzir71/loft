# Porting the local adapter to PHP

The browser preview runs the app against `packages/data/src/local/routes*.ts` (IndexedDB). Production runs the **same logic in PHP** against SQLite. Every PHP module in `api/src/routes/` is a line-for-line port of one TS route file, and every PHP file in `api/src/core/` ports one `packages/core/src/*.ts` file. Keep them in step: when a TS route changes, change its PHP twin.

## Data model

`Db` mirrors `LocalDb`: documents (JSON) in `rows(tbl, id, data)`. Row shapes are **identical** to the TS rows (camelCase keys), because the web app reads them unchanged. Money is integer cents; times are JS ISO strings (`2026-11-21T08:00:00.000Z`) so string comparison = time order.

| TS | PHP |
|---|---|
| `ctx.db.get<T>("t", id)` | `$ctx->db->get('t', $id)` → `?array` |
| `ctx.db.put("t", row)` | `$ctx->db->put('t', $row)` |
| `ctx.db.patch("t", id, patch)` | `$ctx->db->patch('t', $id, $patch)` |
| `ctx.db.update("t", id, fn)` | `$ctx->db->update('t', $id, fn (array $cur) => …)` |
| `ctx.db.del("t", id)` | `$ctx->db->del('t', $id)` |
| `ctx.db.list("t", (r) => …)` | `$ctx->db->list('t', fn ($r) => …)` (sorted by id, like IndexedDB) |
| `ctx.db.appendOps(roomId, ops)` / `opsSince` | same names |
| `ctx.changed("a", "b")` | `$ctx->changed('a', 'b')` |
| `ctx.opsChanged?.(roomId)` | `$ctx->opsChanged($roomId)` |
| `ctx.now().toISOString()` | `$ctx->nowIso()` |
| `ctx.now().getTime()` | `$ctx->now()` (ms) |
| `Date.parse(x)` | `ms($x)` |
| `new Date(ms).toISOString()` | `iso($ms)` |
| `requireMe(ctx)` | `require_me($ctx)` |
| `throw new NotFoundError(m)` / `ForbiddenError` | `throw new NotFound($m)` / `Forbidden` |
| `throw new Error(m)` (validation) | `throw new BadRequest($m)` |
| agent errors `{error, status}` | `throw new AgentError($m, $status)` |
| `newId("x")`, `sortableId("x")`, `roomCode()` | `new_id('x')`, `sortable_id('x')`, `room_code()` |
| `str(v, max)` | `str($v, $max)` |
| `formatUSD(c)` / `{ dropZeroCents: true }` | `format_usd($c)` / `format_usd($c, true)` |
| `toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })` | `short_date($iso)` (host time zone) |
| `monthKey`, `prevMonthKey`, `monthLabel`, `monthRange`, `dayKey`, `isDailyDue` | `month_key`, `prev_month_key`, `month_label`, `month_range`, `day_key`, `is_daily_due` |
| `arr.find`, `arr.some`, `arr.every`, sum via reduce | `find()`, `some()`, `every()`, `sum()` |
| `[...a].sort((x, y) => x.k.localeCompare(y.k))` | `sorted($a, fn ($x, $y) => strcmp($x['k'], $y['k']))` |
| `new Map(list.map((x) => [x.id, x]))` | `index_by($list, fn ($x) => $x['id'])` |

Naming: TS `camelCase` functions become PHP `snake_case` functions in `namespace Loft` (`draftInvoices` → `draft_invoices`). Private helpers in a route file get a short module prefix (`mon_`, `sch_`, `pln_`, `sp_`, `ag_`, `ck_`, `ins_`) so files never redeclare each other's functions.

Routes register on the shared router:

```php
routes()
    ->get('money/log', function (Ctx $ctx, array $p, array $in) { … return [...]; })
    ->post('money/log/:id', function (Ctx $ctx, array $p, array $in) { … });
```

`$p` holds path params, `$in` the query (GET) or JSON body (POST). Return arrays; they are sent as JSON with the **same keys and nesting** as the TS route returns. An empty PHP array encodes as `[]`; where the app needs `{}`, use `obj($a)`.

## Cross-module functions (fixed names)

| Function | Module |
|---|---|
| `billing_for(?array $space): array`, `money_settings(Ctx, string $hostId): array`, `record_attendance(Ctx, array $session, array $rows): array`, `build_drafts(Ctx, string $hostId, string $month, array $opts = []): array`, `money_daily(Ctx, string $hostId): void`, `money_review_items(Ctx, string $hostId): array` | `routes/money.php` |
| `wrapups_pending(Ctx, string $hostId): array`, `auto_wrap_stale(Ctx, string $hostId): void` | `routes/plans.php` |
| `pending_requests(Ctx, string $hostId): array` | `routes/schedule.php` |
| `insights_daily(Ctx, string $hostId): void`, `deliver_nudges(Ctx, string $hostId): void`, `touch_seen(Ctx): void` | `routes/insights.php` |
| `checks_review_items(Ctx, string $hostId): array` | `routes/checks.php` |
| `send_mail()`, `start_session()`, `org_for_host()`, `branding_active()`, `public_user()` | `routes/system.php`, `http.php` |

## Server-only differences

The server does a few things the preview only simulates:

- **Email** goes out with `send_mail()` (invoices and reminders with `via.email`, sign-in links, calendar invites with `.ics` attachments). In tests and with `mail_mode = log` it is written to `data/mail.log`.
- **Guests** get a session cookie (`start_session`) so a guest tab stays the same person.
- **Agent links** read the seat from the `User-Agent` and `X-Agent-Name` headers (the front controller puts them in `$in['agent']`) and errors use real HTTP status codes.

## Tests

`php api/tests/run.php [filter]`. Each `api/tests/*_test.php` uses `test()`, `eq()`, `ok()`, `contains()`, `throws()`, `fresh()` (a new in-memory DB), `call($db, $meId, 'GET'|'POST', $resource, $input)`, `put($db, $table, ...$rows)` and `fixture($db)`. Freeze time with `$GLOBALS['loft_now'] = ms('…')`.

PHP 8.1 syntax (production runs 8.2). No Composer.
