<?php
declare(strict_types=1);

namespace Loft;

// Agent link protocol, capabilities v1 (handoff §12; Figma 06 · A1–A6 + "Agents · build rules").
// One link + one line. Plain HTTP + JSON so it runs on shared hosting. Agents create drafts only.
// PHP twin of packages/core/src/agents.ts (demoDrafts is preview-only and not ported).

const AGENT_LINE = 'Get things ready through this link, top to bottom.';
const LINK_DAYS = 30;
const RATE_PER_MIN = 60;
const MAX_BOARD_OPS = 500;
const MAX_AGENTS_PER_ROOM = 2;
const FILE_CAP_MB = 20;

const CAPABILITIES = [
    ['what' => 'claim the next prep task', 'method' => 'POST', 'path' => '/claim'],
    ['what' => 'read context', 'method' => 'GET', 'path' => '/context/{id}', 'note' => 'plans, files, past recaps (no payer contacts, no DMs)'],
    ['what' => 'create drafts', 'method' => 'POST', 'path' => '/drafts', 'note' => 'plan | board_ops (≤' . MAX_BOARD_OPS . ') | post | check | invoice_draft'],
    ['what' => 'upload a file', 'method' => 'POST', 'path' => '/files', 'note' => '≤ ' . FILE_CAP_MB . ' MB'],
    ['what' => 'ask the host, then move on', 'method' => 'POST', 'path' => '/ask'],
    ['what' => 'report', 'method' => 'POST', 'path' => '/report', 'note' => 'progress | done | blocker, minutes'],
    ['what' => 're-read changes', 'method' => 'GET', 'path' => '/changes?since='],
];

/** Built-in chips on Agents (A1): what an agent learns from the link itself. */
const BUILT_IN = ['claim the next prep task', 'read plans, files, past recaps', 'draft plans + agendas', 'draft board pages: shapes, connectors, stickies', 'draft quick checks', 'draft recap posts', 'draft invoices (never sends)', 'upload files', 'ask you, then move on', 'report progress · done · blocker'];

const PREP_TEMPLATES = [
    ['id' => 'agenda', 'label' => 'Agenda for a session', 'chip' => 'Agenda for a session', 'output' => ['plan', 'post'], 'blurb' => 'A plan with timed blocks, attached to the session'],
    ['id' => 'board_brief', 'label' => 'Board from a brief or PDF', 'chip' => 'Board from a brief', 'output' => ['board_ops', 'post'], 'blurb' => "Sections, stickies and shapes on the session's board"],
    ['id' => 'check', 'label' => 'N-question check', 'chip' => 'N-question check', 'output' => ['check'], 'blurb' => 'A quick check, auto-graded'],
    ['id' => 'recap', 'label' => "Recap from today's board", 'chip' => 'Recap', 'output' => ['post'], 'blurb' => 'A recap post from the board and the plan'],
    ['id' => 'client_agenda', 'label' => 'Client-call agenda from past recaps', 'chip' => 'Client-call agenda', 'output' => ['plan'], 'blurb' => 'An agenda from the last 3 recaps'],
    ['id' => 'invoice_drafts', 'label' => 'Invoice drafts, anomalies flagged', 'chip' => 'Invoice drafts', 'output' => ['invoice_draft'], 'blurb' => 'Drafts only, with anything odd flagged; never sends'],
];

/** Agents may never do these; context endpoints redact the fields server-side. */
const NEVER = ['send messages, email or WhatsApp', 'send or confirm invoices', 'invite people', 'change branding', 'read payer contact details or DMs'];

const DONE_WHEN = [
    'agenda' => 'a plan with 5–7 timed blocks is drafted and attached to the session',
    'board_brief' => "the board has one section per part of the brief, drafted on the draft layer",
    'check' => 'a check with the requested number of questions is drafted',
    'recap' => 'a recap post with what was covered and the board notes is drafted',
    'client_agenda' => 'an agenda built from the last 3 recaps is drafted',
    'invoice_drafts' => 'invoice drafts exist for the month with anything unusual flagged',
];

const AG_SECRET_KEYS = ['email', 'phone', 'payerEmail', 'payerPhone', 'payerContact', 'payToken', 'manageToken', 'feedToken', 'token', 'password'];

/**
 * The first request creates a seat from the User-Agent + X-Agent-Name ("codex-cli/0.9" → codex · codex-cli 0.9).
 * @return array{name: string, runtime: string, version: string}
 */
function seat_from_request(?string $userAgent, ?string $agentName): array
{
    $ua = trim($userAgent ?? '');
    $m = [];
    $matched = preg_match('/^([a-z][a-z0-9._-]*)\/([0-9][\w.-]*)/i', $ua, $m) === 1;
    if ($matched) $runtime = strtolower($m[1]);
    else {
        $first = (preg_split('/\s+/', $ua) ?: [''])[0];
        $runtime = $first !== '' ? strtolower($first) : 'agent';
    }
    $version = $matched ? $m[2] : '';
    $fromRuntime = (string) preg_replace('/-(cli|code)$/', '', $runtime);
    $name = mb_substr(trim($agentName ?? ''), 0, 40);
    if ($name === '') $name = $fromRuntime !== '' ? $fromRuntime : 'agent';
    return ['name' => $name, 'runtime' => $runtime, 'version' => $version];
}

/**
 * Token bucket: 60 requests a minute per seat, refilled continuously.
 * @return array{ok: bool, bucket: array{tokens: int|float, at: int}, retryAfterMs: int}
 */
function take_token(?array $bucket, int $now, int $perMin = RATE_PER_MIN): array
{
    $b = $bucket ?? ['tokens' => $perMin, 'at' => $now];
    $tokens = min($perMin, ($b['tokens'] ?? $perMin) + (($now - (int) ($b['at'] ?? $now)) / 60000) * $perMin);
    if ($tokens < 1) return ['ok' => false, 'bucket' => ['tokens' => $tokens, 'at' => $now], 'retryAfterMs' => (int) ceil(((1 - $tokens) / $perMin) * 60000)];
    return ['ok' => true, 'bucket' => ['tokens' => $tokens - 1, 'at' => $now], 'retryAfterMs' => 0];
}

/** Context for agents: no payer contacts, no tokens, no DMs (handoff §12). */
function redact(mixed $value): mixed
{
    if ($value instanceof \stdClass) {
        $vars = get_object_vars($value);
        if (!$vars) return new \stdClass();
        $value = $vars;
    } elseif (is_array($value) && array_is_list($value)) {
        return array_map(fn ($v) => redact($v), $value);
    }
    if (!is_array($value)) return $value;
    $out = [];
    foreach ($value as $k => $v) {
        if (in_array($k, AG_SECRET_KEYS, true)) continue;
        if ($k === 'channelType' && $v === 'dm') return new \stdClass();
        $out[$k] = redact($v);
    }
    return obj($out);
}

function validate_draft(string $kind, mixed $payload): ?string
{
    if (!in_array($kind, ['plan', 'board_ops', 'post', 'check', 'invoice_draft'], true)) return "Unknown draft kind \"$kind\"";
    if ($payload instanceof \stdClass) $payload = (array) $payload;
    if (!is_array($payload)) return 'payload must be an object';
    $isList = fn ($v) => is_array($v) && array_is_list($v);
    if ($kind === 'board_ops') {
        if (!$isList($payload['ops'] ?? null) || !$payload['ops']) return 'board_ops needs ops';
        if (count($payload['ops']) > MAX_BOARD_OPS) return 'At most ' . MAX_BOARD_OPS . ' ops per batch';
    }
    if ($kind === 'plan' && !$isList($payload['blocks'] ?? null)) return 'plan needs blocks';
    if ($kind === 'post' && !is_string($payload['body'] ?? null)) return 'post needs a body';
    if ($kind === 'check' && !$isList($payload['questions'] ?? null)) return 'check needs questions';
    if ($kind === 'invoice_draft' && !is_string($payload['note'] ?? null)) return 'invoice_draft needs a note';
    return null;
}

function ag_dots(string $label, int $width = 28): string
{
    return $label . ' ' . str_repeat('.', max(2, $width - mb_strlen($label)));
}

/**
 * next.md: what an agent reads first. It starts with the capabilities list, so nobody explains it in a prompt.
 * @param array{title: string, seat: ?array, seatNo: ?int, expiresAt: string, paused: bool, next: ?array, queue: list<array>, rejected: list<array>} $v
 */
function next_markdown(array $v): string
{
    $seat = $v['seat'] ?? null;
    $seatText = $seat
        ? $seat['runtime'] . (($seat['version'] ?? '') !== '' ? ' ' . $seat['version'] : '') . ' (seat ' . ($v['seatNo'] ?? 1) . ')'
        : 'new (waiting for approval)';
    $lines = [
        "# Loft · {$v['title']} · agent link",
        "capabilities: v1 · seat: $seatText · expires " . local(ms($v['expiresAt']))->format('j M Y'),
        '',
        '## What you can do',
    ];
    foreach (CAPABILITIES as $c) {
        $lines[] = '- ' . ag_dots($c['what']) . ' ' . str_pad($c['method'], 4) . ' ' . $c['path'] . (!empty($c['note']) ? '   ' . $c['note'] : '');
    }
    array_push(
        $lines,
        '- stop when paused',
        '',
        '## Rules',
        'drafts only · never send, invite, charge or confirm payments · ' . RATE_PER_MIN . ' requests/min',
        'in a live room: no audio, named cursor, edits wait on a draft layer',
        ''
    );
    if (!empty($v['paused'])) array_push($lines, '## Paused', 'The host paused this link. Stop and check back later.', '');
    if (!empty($v['next'])) {
        $n = $v['next'];
        $inputs = implode(' · ', $n['inputs'] ?? []);
        array_push($lines, '## Next task', "{$n['title']} · ready by {$n['readyBy']}", 'inputs: ' . ($inputs !== '' ? $inputs : 'none'), "done when: {$n['doneWhen']}", '');
    }
    $queue = array_values($v['queue'] ?? []);
    if ($queue) {
        $lines[] = '## Queue (' . count($queue) . ')';
        foreach ($queue as $i => $q) $lines[] = ($i + 1) . ". {$q['title']} · {$q['note']}";
        $lines[] = '';
    }
    $rejected = $v['rejected'] ?? [];
    if ($rejected) {
        $lines[] = '## Sent back by the host';
        foreach ($rejected as $r) $lines[] = "- {$r['title']}: {$r['reason']}";
        $lines[] = '';
    }
    return implode("\n", $lines);
}
