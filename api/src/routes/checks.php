<?php
declare(strict_types=1);

namespace Loft;

// M8 resources: quick checks (builder, attempts with autosave and timing, integrity snapshots from
// tinyproctorjs, auto-grading, manual review of short answers) and the gradebook.
// PHP twin of packages/data/src/local/routes-checks.ts.

const CK_QUESTION_TYPES = ['mcq_single', 'mcq_multi', 'true_false', 'short_answer'];

function ck_or(string $a, string $b): string
{
    return $a !== '' ? $a : $b;
}

/** JS `Number(v) || $or` for JSON input. */
function ck_num(mixed $v, int|float $or = 0): int|float
{
    if (is_bool($v)) $v = (int) $v;
    elseif (is_string($v)) {
        $t = trim($v);
        $v = $t === '' ? 0 : (is_numeric($t) ? $t + 0 : null);
    }
    if (!is_int($v) && !is_float($v)) return $or;
    if (is_float($v) && is_nan($v)) return $or;
    return $v == 0 ? $or : $v;
}

/** JS `String(v)` for scalars. */
function ck_js_string(mixed $v): string
{
    if (is_string($v)) return $v;
    if (is_bool($v)) return $v ? 'true' : 'false';
    if (is_int($v) || is_float($v)) return (string) $v;
    return '';
}

/** Maps keyed by question id are JSON objects, even when empty or when an id looks numeric. */
function ck_obj(array $a): object
{
    return (object) $a;
}

/** `new Date(v).toISOString()`; an unparseable date is a 400 like the TS RangeError. */
function ck_iso(string $v): string
{
    try {
        $d = new \DateTimeImmutable($v);
    } catch (\Throwable) {
        throw new BadRequest('Invalid time value');
    }
    return iso((int) $d->format('U') * 1000 + (int) $d->format('v'));
}

function ck_questions(array $c): array
{
    return array_values(array_filter(is_array($c['questions'] ?? null) ? $c['questions'] : [], 'is_array'));
}

function ck_score_of(array $a, string $qid): ?array
{
    $s = ((array) ($a['scores'] ?? []))[$qid] ?? null;
    return is_array($s) ? $s : null;
}

/** A published check whose close time has passed reads as closed. */
function ck_effective(array $c, int $now): string
{
    return ($c['status'] ?? '') === 'published' && !empty($c['closeAt']) && ms((string) $c['closeAt']) < $now ? 'closed' : (string) ($c['status'] ?? '');
}

/** @return array{0: array, 1: bool} [me, isHost] */
function ck_role(Ctx $ctx, string $spaceId): array
{
    $me = require_me($ctx);
    $m = $ctx->db->get('memberships', "$spaceId:{$me['id']}");
    if (!$m) throw new Forbidden("You're not in this space");
    return [$me, ($m['role'] ?? '') === 'host' || ($m['role'] ?? '') === 'cohost'];
}

function ck_check_or_404(Ctx $ctx, string $id): array
{
    $c = $ctx->db->get('checks', $id);
    if (!$c) throw new NotFound('Check not found');
    return $c;
}

/** Members never receive the answer key. */
function ck_for_member(array $c, string $userId): array
{
    $shuffle = !empty($c['shuffle']);
    $qs = $shuffle ? shuffled(ck_questions($c), $userId) : ck_questions($c);
    $c['questions'] = array_map(fn ($q) => array_merge($q, [
        'answer' => [],
        'options' => $shuffle && ($q['type'] ?? '') !== 'true_false' ? shuffled(is_array($q['options'] ?? null) ? $q['options'] : [], $userId . ck_s($q['id'] ?? '')) : ($q['options'] ?? []),
    ]), $qs);
    return $c;
}

function ck_grade(array $c, array $a): array
{
    $answers = (array) ($a['answers'] ?? []);
    $old = (array) ($a['scores'] ?? []);
    $scores = [];
    foreach (ck_questions($c) as $q) {
        $qid = ck_s($q['id'] ?? '');
        $manual = $old[$qid] ?? null;
        $auto = score_answer($q, is_array($answers[$qid] ?? null) ? $answers[$qid] : null);
        $keepManual = ($q['type'] ?? '') === 'short_answer' && $auto['points'] === null && is_array($manual) && (!array_key_exists('points', $manual) || $manual['points'] !== null);
        $scores[$qid] = $keepManual ? $manual : $auto;
    }
    $s = attempt_score(ck_questions($c), $scores);
    return array_merge($a, ['scores' => ck_obj($scores), 'status' => $s['pending'] ? 'submitted' : 'graded']);
}

function ck_attempt_view(array $c, array $a, int $now): array
{
    $scores = (array) ($a['scores'] ?? []);
    $live = ($a['status'] ?? '') === 'in_progress';
    $results = [];
    foreach ($scores as $k => $v) $results[(string) $k] = is_array($v) ? ($v['isCorrect'] ?? null) : null;
    return [
        'id' => $a['id'],
        'checkId' => $c['id'],
        'status' => $a['status'],
        'startedAt' => $a['startedAt'],
        'submittedAt' => $a['submittedAt'] ?? null,
        'answers' => ck_obj((array) ($a['answers'] ?? [])),
        'remaining' => $live ? remaining_seconds($c, (string) $a['startedAt'], $now) : null,
        'score' => $live ? null : attempt_score(ck_questions($c), $scores),
        'results' => $live ? null : ck_obj($results),
    ];
}

function ck_clean_questions(mixed $raw): array
{
    if (!is_array($raw)) return [];
    return array_map(function ($q) {
        $q = is_array($q) ? $q : [];
        $type = in_array($q['type'] ?? null, CK_QUESTION_TYPES, true) ? $q['type'] : 'mcq_single';
        $options = match ($type) {
            'true_false' => [['id' => 'true', 'text' => 'True'], ['id' => 'false', 'text' => 'False']],
            'short_answer' => [],
            default => array_map(fn ($o) => [
                'id' => ck_or(str(is_array($o) ? ($o['id'] ?? '') : '', 40), new_id('o')),
                'text' => str(is_array($o) ? ($o['text'] ?? '') : '', 300),
            ], array_slice(is_array($q['options'] ?? null) ? array_values($q['options']) : [], 0, 8)),
        };
        return [
            'id' => ck_or(str($q['id'] ?? '', 40), new_id('q')),
            'type' => $type,
            'prompt' => str($q['prompt'] ?? '', 1000),
            'points' => (int) max(1, min(100, round(ck_num($q['points'] ?? null, 1)))),
            'options' => $options,
            'answer' => array_map(fn ($x) => mb_substr($x, 0, 200), strings($q['answer'] ?? [])),
        ];
    }, array_slice(array_values($raw), 0, 50));
}

/** To review: short answers waiting for a mark, per check. */
function checks_review_items(Ctx $ctx, string $hostId): array
{
    $hosted = array_map(fn ($m) => $m['spaceId'], $ctx->db->list('memberships', fn ($m) => ($m['userId'] ?? null) === $hostId && (($m['role'] ?? '') === 'host' || ($m['role'] ?? '') === 'cohost')));
    $items = [];
    foreach ($ctx->db->list('checks', fn ($x) => in_array($x['spaceId'] ?? null, $hosted, true) && ($x['status'] ?? '') !== 'draft') as $c) {
        $waiting = $ctx->db->list('check_attempts', fn ($a) => ($a['checkId'] ?? null) === $c['id'] && ($a['status'] ?? '') === 'submitted');
        if (!$waiting) continue;
        $flagged = count(array_filter($waiting, fn ($a) => !empty($c['integrity']) && integrity_review($a['integrity'] ?? null)['level'] === 'flagged'));
        $n = count($waiting);
        $items[] = [
            'id' => "check:{$c['id']}",
            'kind' => 'check',
            'title' => "$n answer" . ($n === 1 ? '' : 's') . " to mark · {$c['title']}",
            'sub' => $flagged ? "$flagged with integrity signals to look at" : "Short answers that didn't match",
            'action' => 'Mark',
            'link' => "/checks/{$c['id']}",
        ];
    }
    return $items;
}

routes()
    ->get('spaces/:id/checks', function (Ctx $ctx, array $p) {
        [$me, $isHost] = ck_role($ctx, $p['id']);
        $checks = sorted($ctx->db->list('checks', fn ($c) => ($c['spaceId'] ?? null) === $p['id'] && ($isHost || ($c['status'] ?? '') !== 'draft')), fn ($a, $b) => strcmp((string) $b['createdAt'], (string) $a['createdAt']));
        $members = count($ctx->db->list('memberships', fn ($m) => ($m['spaceId'] ?? null) === $p['id'] && ($m['role'] ?? '') === 'member'));
        $now = $ctx->now();
        $out = [];
        foreach ($checks as $c) {
            $qs = ck_questions($c);
            $attempts = $ctx->db->list('check_attempts', fn ($a) => ($a['checkId'] ?? null) === $c['id']);
            $done = array_values(array_filter($attempts, fn ($a) => $a['status'] !== 'in_progress'));
            $mine = sorted(array_values(array_filter($attempts, fn ($a) => $a['userId'] === $me['id'])), fn ($a, $b) => strcmp((string) $b['startedAt'], (string) $a['startedAt']))[0] ?? null;
            $pct = [];
            foreach ($done as $a) {
                $x = attempt_score($qs, (array) ($a['scores'] ?? []))['percent'];
                if ($x !== null) $pct[] = $x;
            }
            $row = [
                'id' => $c['id'],
                'title' => $c['title'],
                'status' => ck_effective($c, $now),
                'closeAt' => $c['closeAt'] ?? null,
                'timeLimitMin' => $c['timeLimitMin'] ?? null,
                'integrity' => $c['integrity'] ?? false,
                'questions' => count($qs),
                'points' => sum($qs, fn ($q) => $q['points'] ?? 0),
            ];
            if ($isHost) {
                $row += [
                    'submitted' => count($done),
                    'members' => $members,
                    'average' => $pct ? (int) round(array_sum($pct) / count($pct)) : null,
                    'toReview' => count(array_filter($done, fn ($a) => $a['status'] === 'submitted')),
                    'flagged' => count(array_filter($done, fn ($a) => integrity_review($a['integrity'] ?? null)['level'] === 'flagged')),
                ];
            } else {
                $row += ['mine' => $mine ? ck_attempt_view($c, $mine, $now) : null, 'open' => window_error($c, $now) === null];
            }
            $out[] = $row;
        }
        return ['isHost' => $isHost, 'checks' => $out];
    })
    ->post('spaces/:id/checks', function (Ctx $ctx, array $p, array $in) {
        [$me, $isHost] = ck_role($ctx, $p['id']);
        if (!$isHost) throw new Forbidden('Only hosts make checks');
        $qs = ck_clean_questions($in['questions'] ?? null);
        $c = [
            'id' => new_id('ck'),
            'spaceId' => $p['id'],
            'title' => ck_or(str($in['title'] ?? '', 120), 'Quick check'),
            'instructions' => str($in['instructions'] ?? '', 1000),
            'questions' => $qs ?: [['id' => new_id('q'), 'type' => 'mcq_single', 'prompt' => '', 'points' => 1, 'options' => [['id' => new_id('o'), 'text' => ''], ['id' => new_id('o'), 'text' => '']], 'answer' => []]],
            'status' => 'draft',
            'openAt' => null,
            'closeAt' => null,
            'timeLimitMin' => 15,
            'maxAttempts' => 1,
            'shuffle' => true,
            'integrity' => true,
            'createdAt' => $ctx->nowIso(),
            'createdBy' => $me['id'],
        ];
        $ctx->db->put('checks', $c);
        $ctx->changed('checks');
        return $c;
    })
    ->get('checks/:id', function (Ctx $ctx, array $p) {
        $c = ck_check_or_404($ctx, $p['id']);
        [$me, $isHost] = ck_role($ctx, (string) $c['spaceId']);
        $space = $ctx->db->get('spaces', (string) $c['spaceId']);
        return array_merge($isHost ? $c : ck_for_member($c, $me['id']), [
            'status' => ck_effective($c, $ctx->now()),
            'isHost' => $isHost,
            'space' => ['id' => $c['spaceId'], 'name' => $space['name'] ?? '', 'slug' => $space['slug'] ?? '', 'code' => $space['code'] ?? ''],
        ]);
    })
    ->post('checks/:id', function (Ctx $ctx, array $p, array $in) {
        $c = ck_check_or_404($ctx, $p['id']);
        [, $isHost] = ck_role($ctx, (string) $c['spaceId']);
        if (!$isHost) throw new Forbidden('Only hosts edit checks');
        $next = $c;
        if (is_string($in['title'] ?? null)) $next['title'] = ck_or(str($in['title'], 120), (string) $c['title']);
        if (is_string($in['instructions'] ?? null)) $next['instructions'] = str($in['instructions'], 1000);
        if (is_array($in['questions'] ?? null) && array_is_list($in['questions'])) $next['questions'] = ck_clean_questions($in['questions']);
        if (array_key_exists('timeLimitMin', $in) && ($in['timeLimitMin'] === null || is_int($in['timeLimitMin']) || is_float($in['timeLimitMin']))) {
            $next['timeLimitMin'] = $in['timeLimitMin'] === null ? null : (int) max(1, min(240, round($in['timeLimitMin'])));
        }
        foreach (['closeAt', 'openAt'] as $k) {
            if (array_key_exists($k, $in) && ($in[$k] === null || is_string($in[$k]))) $next[$k] = ($in[$k] ?? '') !== '' ? ck_iso($in[$k]) : null;
        }
        if (is_int($in['maxAttempts'] ?? null) || is_float($in['maxAttempts'] ?? null)) $next['maxAttempts'] = (int) max(1, min(10, round($in['maxAttempts'])));
        if (is_bool($in['shuffle'] ?? null)) $next['shuffle'] = $in['shuffle'];
        if (is_bool($in['integrity'] ?? null)) $next['integrity'] = $in['integrity'];
        $ctx->db->put('checks', $next);
        $ctx->changed('checks');
        return $next;
    })
    ->post('checks/:id/status', function (Ctx $ctx, array $p, array $in) {
        $c = ck_check_or_404($ctx, $p['id']);
        [, $isHost] = ck_role($ctx, (string) $c['spaceId']);
        if (!$isHost) throw new Forbidden('Only hosts publish checks');
        $want = $in['status'] ?? null;
        $status = $want === 'closed' ? 'closed' : ($want === 'draft' ? 'draft' : 'published');
        $qs = ck_questions($c);
        if ($status === 'published') {
            if (!$qs) throw new BadRequest('Add a question first');
            foreach ($qs as $i => $q) {
                $err = validate_question($q);
                if ($err !== null) throw new BadRequest('Question ' . ($i + 1) . ": $err");
            }
        }
        $past = !empty($c['closeAt']) && ms((string) $c['closeAt']) < $ctx->now();
        $next = array_merge($c, ['status' => $status]);
        if ($status === 'closed' && (empty($c['closeAt']) || !$past)) $next['closeAt'] = $ctx->nowIso();
        if ($status === 'published' && $past) $next['closeAt'] = null;
        $ctx->db->put('checks', $next);
        if ($status === 'published' && ($c['status'] ?? '') === 'draft') {
            $sub = count($qs) . ' questions'
                . (!empty($c['timeLimitMin']) ? " · {$c['timeLimitMin']} min" : '')
                . (!empty($c['closeAt']) ? ' · closes ' . short_date((string) $c['closeAt']) : '');
            foreach ($ctx->db->list('memberships', fn ($x) => ($x['spaceId'] ?? null) === $c['spaceId'] && ($x['role'] ?? '') === 'member') as $m) {
                $ctx->db->put('notifications', ['id' => sortable_id('nt'), 'userId' => $m['userId'], 'kind' => 'check', 'title' => "New check: {$c['title']}", 'sub' => $sub, 'link' => "/checks/{$c['id']}/take", 'createdAt' => $ctx->nowIso(), 'readAt' => null]);
            }
            $ctx->changed('notifications');
        }
        $ctx->changed('checks');
        return $next;
    })
    ->post('checks/:id/start', function (Ctx $ctx, array $p) {
        $c = ck_check_or_404($ctx, $p['id']);
        [$me] = ck_role($ctx, (string) $c['spaceId']);
        $t = $ctx->now();
        $mine = sorted($ctx->db->list('check_attempts', fn ($a) => ($a['checkId'] ?? null) === $c['id'] && ($a['userId'] ?? null) === $me['id']), fn ($a, $b) => strcmp((string) $b['startedAt'], (string) $a['startedAt']));
        $open = find($mine, fn ($a) => $a['status'] === 'in_progress');
        if ($open) return ck_attempt_view($c, $open, $t);
        $err = window_error($c, $t);
        if ($err !== null) throw new BadRequest($err);
        $max = (int) ($c['maxAttempts'] ?? 1);
        if (count($mine) >= $max) throw new BadRequest($max === 1 ? "You've already done this check" : "You've used all $max attempts");
        $a = ['id' => new_id('at'), 'checkId' => $c['id'], 'userId' => $me['id'], 'startedAt' => $ctx->nowIso(), 'submittedAt' => null, 'status' => 'in_progress', 'answers' => new \stdClass(), 'scores' => new \stdClass(), 'integrity' => null];
        $ctx->db->put('check_attempts', $a);
        $ctx->changed('check_attempts');
        return ck_attempt_view($c, $a, $t);
    })
    ->get('attempts/:id', function (Ctx $ctx, array $p) {
        $me = require_me($ctx);
        $a = $ctx->db->get('check_attempts', $p['id']);
        if (!$a) throw new NotFound('Attempt not found');
        $c = ck_check_or_404($ctx, (string) $a['checkId']);
        [, $isHost] = ck_role($ctx, (string) $c['spaceId']);
        if (!$isHost && $a['userId'] !== $me['id']) throw new Forbidden('Not your attempt');
        return ck_attempt_view($c, $a, $ctx->now());
    })
    ->post('attempts/:id/answer', function (Ctx $ctx, array $p, array $in) {
        $me = require_me($ctx);
        $a = $ctx->db->get('check_attempts', $p['id']);
        if (!$a || $a['userId'] !== $me['id']) throw new NotFound('Attempt not found');
        $c = ck_check_or_404($ctx, (string) $a['checkId']);
        if ($a['status'] !== 'in_progress') throw new BadRequest('This attempt is already submitted');
        if (remaining_seconds($c, (string) $a['startedAt'], $ctx->now()) === 0) throw new BadRequest("Time's up");
        $qid = str($in['questionId'] ?? '', 40);
        if (!some(ck_questions($c), fn ($q) => ($q['id'] ?? null) === $qid)) throw new NotFound('Question not found');
        $answer = array_map(fn ($x) => mb_substr($x, 0, 2000), strings($in['answer'] ?? []));
        // One transaction per save, merged into the current row: concurrent autosaves never lose answers.
        $ctx->db->update('check_attempts', $a['id'], function (array $cur) use ($qid, $answer) {
            $answers = (array) ($cur['answers'] ?? []);
            $answers[$qid] = $answer;
            return array_merge($cur, ['answers' => ck_obj($answers)]);
        });
        return ['ok' => true];
    })
    ->post('attempts/:id/integrity', function (Ctx $ctx, array $p, array $in) {
        $me = require_me($ctx);
        $a = $ctx->db->get('check_attempts', $p['id']);
        if (!$a || $a['userId'] !== $me['id'] || $a['status'] !== 'in_progress') return ['ok' => false];
        $counts = is_array($in['violationCounts'] ?? null) ? $in['violationCounts'] : [];
        $vc = [];
        foreach ($counts as $k => $v) {
            if (count($vc) >= 30) break;
            if (is_int($v) || is_float($v)) $vc[(string) $k] = $v;
        }
        $recent = [];
        foreach (array_slice(is_array($in['recent'] ?? null) ? array_values($in['recent']) : [], -10) as $r) {
            $r = is_array($r) ? $r : [];
            $recent[] = ['t' => ck_js_string($r['t'] ?? ''), 'violationKey' => is_string($r['violationKey'] ?? null) ? $r['violationKey'] : null];
        }
        $snap = [
            'integrityScore' => max(0, min(100, ck_num($in['integrityScore'] ?? null, 0))),
            'violationCounts' => ck_obj($vc),
            'awayMs' => max(0, ck_num($in['awayMs'] ?? null, 0)),
            'recent' => $recent,
        ];
        $ctx->db->patch('check_attempts', $a['id'], ['integrity' => $snap]);
        return ['ok' => true];
    })
    ->post('attempts/:id/submit', function (Ctx $ctx, array $p) {
        $me = require_me($ctx);
        $a = $ctx->db->get('check_attempts', $p['id']);
        if (!$a || $a['userId'] !== $me['id']) throw new NotFound('Attempt not found');
        $c = ck_check_or_404($ctx, (string) $a['checkId']);
        if ($a['status'] !== 'in_progress') return ck_attempt_view($c, $a, $ctx->now());
        $done = $ctx->db->update('check_attempts', $a['id'], fn (array $cur) => ck_grade($c, array_merge($cur, ['submittedAt' => $ctx->nowIso()])));
        $ctx->changed('check_attempts');
        return ck_attempt_view($c, $done, $ctx->now());
    })
    ->get('checks/:id/results', function (Ctx $ctx, array $p) {
        $c = ck_check_or_404($ctx, $p['id']);
        [, $isHost] = ck_role($ctx, (string) $c['spaceId']);
        if (!$isHost) throw new Forbidden('Only hosts see results');
        $users = index_by($ctx->db->list('users'), fn ($u) => $u['id']);
        $nameOf = fn ($id, string $or) => (string) ($users[(string) $id]['name'] ?? $or);
        $qs = ck_questions($c);
        $attempts = sorted($ctx->db->list('check_attempts', fn ($a) => ($a['checkId'] ?? null) === $c['id']), fn ($a, $b) => strcmp($nameOf($a['userId'], ''), $nameOf($b['userId'], '')));
        $members = $ctx->db->list('memberships', fn ($m) => ($m['spaceId'] ?? null) === $c['spaceId'] && ($m['role'] ?? '') === 'member');
        $done = array_values(array_filter($attempts, fn ($a) => $a['status'] !== 'in_progress'));
        $review = [];
        foreach ($done as $a) {
            foreach ($qs as $q) {
                if (($q['type'] ?? '') !== 'short_answer') continue;
                $s = ck_score_of($a, ck_s($q['id'] ?? ''));
                if ($s === null || !array_key_exists('points', $s) || $s['points'] !== null) continue;
                $review[] = ['attemptId' => $a['id'], 'name' => $nameOf($a['userId'], '?'), 'questionId' => $q['id'], 'prompt' => $q['prompt'] ?? '', 'points' => $q['points'] ?? 0, 'response' => ((array) ($a['answers'] ?? []))[$q['id']][0] ?? '', 'accepted' => $q['answer'] ?? []];
            }
        }
        return [
            'attempts' => array_map(function ($a) use ($c, $qs, $nameOf) {
                $s = attempt_score($qs, (array) ($a['scores'] ?? []));
                $r = integrity_review(!empty($c['integrity']) ? ($a['integrity'] ?? null) : null);
                return [
                    'id' => $a['id'],
                    'userId' => $a['userId'],
                    'name' => $nameOf($a['userId'], '?'),
                    'status' => $a['status'],
                    'score' => $a['status'] === 'in_progress' ? null : $s,
                    'startedAt' => $a['startedAt'],
                    'submittedAt' => $a['submittedAt'] ?? null,
                    'minutes' => !empty($a['submittedAt']) ? (int) max(1, round((ms((string) $a['submittedAt']) - ms((string) $a['startedAt'])) / 60000)) : null,
                    'integrity' => array_merge($r, ['score' => $a['integrity']['integrityScore'] ?? null]),
                ];
            }, $attempts),
            'notStarted' => array_values(array_map(fn ($m) => ['userId' => $m['userId'], 'name' => $nameOf($m['userId'], '?')], array_filter($members, fn ($m) => !some($attempts, fn ($a) => $a['userId'] === $m['userId'])))),
            'questions' => array_map(function ($q) use ($done) {
                $qid = ck_s($q['id'] ?? '');
                $answered = array_values(array_filter($done, fn ($a) => array_key_exists('isCorrect', ck_score_of($a, $qid) ?? [])));
                $right = count(array_filter($answered, fn ($a) => (ck_score_of($a, $qid)['isCorrect'] ?? null) === true));
                return ['id' => $q['id'], 'prompt' => $q['prompt'] ?? '', 'type' => $q['type'] ?? '', 'correctRate' => $answered ? (int) round(($right / count($answered)) * 100) : null];
            }, $qs),
            'review' => $review,
        ];
    })
    ->post('attempts/:id/grade', function (Ctx $ctx, array $p, array $in) {
        $a = $ctx->db->get('check_attempts', $p['id']);
        if (!$a) throw new NotFound('Attempt not found');
        $c = ck_check_or_404($ctx, (string) $a['checkId']);
        [, $isHost] = ck_role($ctx, (string) $c['spaceId']);
        if (!$isHost) throw new Forbidden('Only hosts grade');
        $q = find(ck_questions($c), fn ($x) => ($x['id'] ?? null) === ($in['questionId'] ?? null));
        if (!$q) throw new NotFound('Question not found');
        $points = (int) max(0, min($q['points'], round(ck_num($in['points'] ?? null, 0))));
        // A partial mark is still a mark: it counts as graded, and only full marks count as correct.
        $scores = (array) ($a['scores'] ?? []);
        $scores[$q['id']] = ['isCorrect' => $points == $q['points'], 'points' => $points];
        $next = array_merge($a, ['scores' => ck_obj($scores), 'status' => attempt_score(ck_questions($c), $scores)['pending'] ? 'submitted' : 'graded']);
        $ctx->db->put('check_attempts', $next);
        $ctx->changed('check_attempts');
        return ['ok' => true];
    })
    ->get('spaces/:id/grades', function (Ctx $ctx, array $p) {
        [$me, $isHost] = ck_role($ctx, $p['id']);
        $t = $ctx->nowIso();
        $users = index_by($ctx->db->list('users'), fn ($u) => $u['id']);
        $members = array_values(array_filter($ctx->db->list('memberships', fn ($m) => ($m['spaceId'] ?? null) === $p['id'] && ($m['role'] ?? '') === 'member'), fn ($m) => $isHost || $m['userId'] === $me['id']));
        $tasks = sorted($ctx->db->list('posts', fn ($x) => ($x['spaceId'] ?? null) === $p['id'] && ($x['kind'] ?? '') === 'task' && !empty($x['dueAt'])), fn ($a, $b) => strcmp((string) ($a['dueAt'] ?? ''), (string) ($b['dueAt'] ?? '')));
        $checks = sorted($ctx->db->list('checks', fn ($c) => ($c['spaceId'] ?? null) === $p['id'] && ($c['status'] ?? '') !== 'draft'), fn ($a, $b) => strcmp((string) ($a['closeAt'] ?? $a['createdAt']), (string) ($b['closeAt'] ?? $b['createdAt'])));
        $taskIds = array_map(fn ($x) => $x['id'], $tasks);
        $checkIds = array_map(fn ($x) => $x['id'], $checks);
        $subs = $ctx->db->list('submissions', fn ($s) => in_array($s['postId'] ?? null, $taskIds, true));
        $attempts = $ctx->db->list('check_attempts', fn ($a) => in_array($a['checkId'] ?? null, $checkIds, true));
        $checksById = index_by($checks, fn ($c) => $c['id']);
        $columns = array_merge(
            array_map(fn ($x) => ['id' => $x['id'], 'kind' => 'task', 'title' => $x['title'], 'points' => null, 'dueAt' => $x['dueAt'] ?? null], $tasks),
            array_map(fn ($c) => ['id' => $c['id'], 'kind' => 'check', 'title' => $c['title'], 'points' => sum(ck_questions($c), fn ($q) => $q['points'] ?? 0), 'dueAt' => $c['closeAt'] ?? null], $checks)
        );
        $rows = array_map(function ($m) use ($columns, $subs, $attempts, $checksById, $users, $t) {
            $cells = array_map(function ($col) use ($m, $subs, $attempts, $checksById, $t) {
                $past = !empty($col['dueAt']) && strcmp((string) $col['dueAt'], $t) < 0;
                if ($col['kind'] === 'task') {
                    $s = find($subs, fn ($x) => ($x['postId'] ?? null) === $col['id'] && ($x['userId'] ?? null) === $m['userId']);
                    return ['columnId' => $col['id'], 'earned' => null, 'possible' => null, 'status' => $s ? (($s['status'] ?? '') === 'handed-in' ? 'pending' : 'graded') : ($past ? 'missing' : 'not_due')];
                }
                $c = $checksById[(string) $col['id']];
                $mine = sorted(array_values(array_filter($attempts, fn ($x) => ($x['checkId'] ?? null) === $col['id'] && ($x['userId'] ?? null) === $m['userId'] && $x['status'] !== 'in_progress')), fn ($x, $y) => strcmp((string) ($y['submittedAt'] ?? ''), (string) ($x['submittedAt'] ?? '')));
                $a = $mine[0] ?? null;
                if (!$a) return ['columnId' => $col['id'], 'earned' => null, 'possible' => $col['points'], 'status' => $past || ($c['status'] ?? '') === 'closed' ? 'missing' : 'not_due'];
                $s = attempt_score(ck_questions($c), (array) ($a['scores'] ?? []));
                return ['columnId' => $col['id'], 'earned' => $s['pending'] ? null : $s['earned'], 'possible' => $col['points'], 'status' => $s['pending'] ? 'pending' : 'graded'];
            }, $columns);
            return ['userId' => $m['userId'], 'name' => $users[(string) $m['userId']]['name'] ?? '?', 'average' => cell_average($cells), 'cells' => $cells];
        }, $members);
        return ['isHost' => $isHost, 'columns' => $columns, 'rows' => $rows];
    });
