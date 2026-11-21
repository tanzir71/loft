<?php
declare(strict_types=1);

namespace Loft;

// Mirrors packages/core/src/checks.test.ts and the "quick checks (M8)" half of packages/data/src/local/insights.test.ts.

function ck_test_q(string $type, array $answer, array $extra = []): array
{
    return array_merge(['id' => "q_$type", 'type' => $type, 'prompt' => 'Which?', 'points' => 2, 'options' => [['id' => 'a', 'text' => 'A'], ['id' => 'b', 'text' => 'B'], ['id' => 'c', 'text' => 'C']], 'answer' => $answer], $extra);
}

function ck_test_match(?string $actual, string $re): void
{
    ok($actual !== null && preg_match($re, $actual) === 1, 'expected ' . export($actual) . " to match $re");
}

test('checks: validates the four question types', function () {
    eq(validate_question(ck_test_q('mcq_single', ['a'])), null);
    ck_test_match(validate_question(ck_test_q('mcq_single', ['a', 'b'])), '/exactly one/');
    ck_test_match(validate_question(ck_test_q('mcq_multi', ['z'])), '/correct option/');
    ck_test_match(validate_question(ck_test_q('true_false', ['maybe'], ['options' => []])), '/true or false/');
    ck_test_match(validate_question(ck_test_q('short_answer', [' '], ['options' => []])), '/accepted answer/');
    ck_test_match(validate_question(ck_test_q('mcq_single', ['a'], ['prompt' => ' '])), '/Write/');
    ck_test_match(validate_question(ck_test_q('mcq_single', ['a'], ['points' => 0])), '/Points/');
});

test('checks: autogrades objective answers and leaves unmatched short answers for review', function () {
    eq(score_answer(ck_test_q('mcq_single', ['b']), ['b']), ['isCorrect' => true, 'points' => 2]);
    eq(score_answer(ck_test_q('mcq_single', ['b']), ['a']), ['isCorrect' => false, 'points' => 0]);
    eq(score_answer(ck_test_q('mcq_multi', ['a', 'c']), ['c', 'a']), ['isCorrect' => true, 'points' => 2]);
    eq(score_answer(ck_test_q('mcq_multi', ['a', 'c']), ['a']), ['isCorrect' => false, 'points' => 0]);
    eq(score_answer(ck_test_q('true_false', ['false']), ['false'])['isCorrect'], true);
    eq(score_answer(ck_test_q('short_answer', ['45 degrees', '45°']), ['  45   Degrees ']), ['isCorrect' => true, 'points' => 2]);
    eq(score_answer(ck_test_q('short_answer', ['45 degrees']), ['about forty-five']), ['isCorrect' => null, 'points' => null]);
    eq(score_answer(ck_test_q('mcq_single', ['b']), null), ['isCorrect' => false, 'points' => 0]);
});

test('checks: totals an attempt, pending while a short answer waits', function () {
    $qs = [ck_test_q('mcq_single', ['a']), ck_test_q('short_answer', ['x'], ['id' => 's'])];
    eq(attempt_score($qs, ['q_mcq_single' => ['points' => 2], 's' => ['points' => null]]), ['earned' => 2, 'possible' => 4, 'pending' => 1, 'percent' => null]);
    eq(attempt_score($qs, ['q_mcq_single' => ['points' => 2], 's' => ['points' => 1]]), ['earned' => 3, 'possible' => 4, 'pending' => 0, 'percent' => 75]);
});

test('checks: times attempts and enforces the window', function () {
    $w = ['status' => 'published', 'openAt' => '2026-11-21T10:00:00Z', 'closeAt' => '2026-11-21T12:00:00Z', 'timeLimitMin' => 15, 'maxAttempts' => 1];
    ck_test_match(window_error($w, ms('2026-11-21T09:00:00Z')), "/isn't open yet/");
    eq(window_error($w, ms('2026-11-21T11:00:00Z')), null);
    ck_test_match(window_error($w, ms('2026-11-21T13:00:00Z')), '/closed/');
    ck_test_match(window_error(array_merge($w, ['status' => 'draft']), ms('2026-11-21T11:00:00Z')), "/isn't open/");
    eq(attempt_deadline($w, '2026-11-21T11:00:00Z'), ms('2026-11-21T11:15:00Z'));
    eq(attempt_deadline($w, '2026-11-21T11:50:00Z'), ms('2026-11-21T12:00:00Z'));
    eq(remaining_seconds($w, '2026-11-21T11:00:00Z', ms('2026-11-21T11:14:00Z')), 60);
    eq(remaining_seconds(array_merge($w, ['closeAt' => null, 'timeLimitMin' => null]), '2026-11-21T11:00:00Z', 0), null);
});

test('checks: shuffles stably per member', function () {
    $items = array_map(fn ($id) => ['id' => $id], ['a', 'b', 'c', 'd', 'e']);
    $ids = fn (array $xs) => array_map(fn ($x) => $x['id'], $xs);
    eq($ids(shuffled($items, 'u1')), $ids(shuffled($items, 'u1')));
    $sortedIds = $ids(shuffled($items, 'u1'));
    sort($sortedIds);
    eq($sortedIds, ['a', 'b', 'c', 'd', 'e']);
});

test('checks: turns integrity signals into a review level, never a verdict', function () {
    eq(integrity_review(null)['level'], 'none');
    eq(integrity_review(['integrityScore' => 100, 'violationCounts' => [], 'awayMs' => 0]), ['level' => 'clean', 'reasons' => []]);
    eq(integrity_review(['integrityScore' => 85, 'violationCounts' => ['tab_hidden' => 2], 'awayMs' => 20000]), ['level' => 'review', 'reasons' => ['left the tab ×2']]);
    eq(integrity_review(['integrityScore' => 95, 'violationCounts' => ['paste_attempt' => 1], 'awayMs' => 90000]), ['level' => 'flagged', 'reasons' => ['pasted text', 'away 2 min']]);
});

test('gradebook: averages graded work and counts missing as zero', function () {
    eq(cell_average([['earned' => 8, 'possible' => 10, 'status' => 'graded'], ['earned' => null, 'possible' => 10, 'status' => 'missing'], ['earned' => null, 'possible' => 5, 'status' => 'pending']]), 40);
    eq(cell_average([['earned' => null, 'possible' => 5, 'status' => 'pending']]), null);
    eq(cell_text(['earned' => 8, 'possible' => 10, 'status' => 'graded']), '8/10');
    eq(cell_text(['earned' => null, 'possible' => 10, 'status' => 'missing']), 'Missing');
});

/** Physics with three members, a closed exit ticket (two attempts) and an open timed check nobody started. */
function ck_test_fixture(Db $db): void
{
    $GLOBALS['loft_now'] = ms('2026-11-21T10:00:00.000Z');
    fixture($db, 'course', ['u_ayaan' => 'member', 'u_dipa' => 'member', 'u_sumaiya' => 'member']);
    $exit = [
        ['id' => 'x1', 'type' => 'mcq_single', 'prompt' => 'Which angle gives the longest range?', 'points' => 1, 'options' => [['id' => 'a', 'text' => '30°'], ['id' => 'b', 'text' => '45°']], 'answer' => ['b']],
        ['id' => 'x2', 'type' => 'short_answer', 'prompt' => 'Write the angle in words', 'points' => 1, 'options' => [], 'answer' => ['45 degrees']],
    ];
    $energy = [
        ['id' => 'e1', 'type' => 'mcq_single', 'prompt' => 'Kinetic energy depends on', 'points' => 1, 'options' => [['id' => 'e1_1', 'text' => 'mass only'], ['id' => 'e1_2', 'text' => 'mass and speed'], ['id' => 'e1_3', 'text' => 'height']], 'answer' => ['e1_2']],
        ['id' => 'e2', 'type' => 'true_false', 'prompt' => 'Energy can be created', 'points' => 1, 'options' => [['id' => 'true', 'text' => 'True'], ['id' => 'false', 'text' => 'False']], 'answer' => ['false']],
        ['id' => 'e3', 'type' => 'short_answer', 'prompt' => 'Unit of energy', 'points' => 1, 'options' => [], 'answer' => ['joules', 'J']],
    ];
    $base = ['spaceId' => 'sp_1', 'instructions' => '', 'openAt' => null, 'maxAttempts' => 1, 'integrity' => true, 'createdBy' => 'u_host'];
    put(
        $db,
        'checks',
        $base + ['id' => 'ck_exit', 'title' => 'Exit ticket', 'questions' => $exit, 'status' => 'published', 'closeAt' => '2026-11-20T12:00:00.000Z', 'timeLimitMin' => null, 'shuffle' => false, 'createdAt' => '2026-11-19T10:00:00.000Z'],
        $base + ['id' => 'ck_energy', 'title' => 'Energy', 'questions' => $energy, 'status' => 'published', 'closeAt' => '2026-11-28T12:00:00.000Z', 'timeLimitMin' => 10, 'shuffle' => true, 'createdAt' => '2026-11-20T10:00:00.000Z']
    );
    put(
        $db,
        'check_attempts',
        ['id' => 'at_ayaan', 'checkId' => 'ck_exit', 'userId' => 'u_ayaan', 'startedAt' => '2026-11-19T11:00:00.000Z', 'submittedAt' => '2026-11-19T11:06:00.000Z', 'status' => 'graded', 'answers' => ['x1' => ['b'], 'x2' => ['forty']], 'scores' => ['x1' => ['isCorrect' => true, 'points' => 1], 'x2' => ['isCorrect' => false, 'points' => 0]], 'integrity' => ['integrityScore' => 100, 'violationCounts' => [], 'awayMs' => 0]],
        ['id' => 'at_sumaiya', 'checkId' => 'ck_exit', 'userId' => 'u_sumaiya', 'startedAt' => '2026-11-19T11:00:00.000Z', 'submittedAt' => '2026-11-19T11:09:00.000Z', 'status' => 'submitted', 'answers' => ['x1' => ['a'], 'x2' => ['about forty-five']], 'scores' => ['x1' => ['isCorrect' => false, 'points' => 0], 'x2' => ['isCorrect' => null, 'points' => null]], 'integrity' => ['integrityScore' => 85, 'violationCounts' => ['tab_hidden' => 2], 'awayMs' => 20000]]
    );
}

test('checks routes: hosts see results with integrity signals; members never get the answer key', function () {
    $db = fresh();
    ck_test_fixture($db);
    $list = call($db, 'u_host', 'GET', 'spaces/sp_1/checks');
    eq($list['isHost'], true);
    $exit = find($list['checks'], fn ($c) => $c['id'] === 'ck_exit');
    eq([$exit['status'], $exit['submitted'], $exit['toReview'], $exit['members']], ['closed', 2, 1, 3]);
    $items = checks_review_items(new Ctx($db, 'u_host'), 'u_host');
    eq(array_map(fn ($i) => $i['title'], $items), ['1 answer to mark · Exit ticket']);
    $res = call($db, 'u_host', 'GET', 'checks/ck_exit/results');
    $sumaiya = find($res['attempts'], fn ($a) => $a['name'] === 'Sumaiya Member');
    eq($sumaiya['integrity'], ['level' => 'review', 'reasons' => ['left the tab ×2'], 'score' => 85]);
    eq($sumaiya['minutes'], 9);
    eq(array_map(fn ($x) => $x['name'], $res['notStarted']), ['Dipa Member']);
    eq(find($res['questions'], fn ($q) => $q['id'] === 'x1')['correctRate'], 50);
    eq(count($res['review']), 1);
    eq($res['review'][0]['response'], 'about forty-five');
    $view = call($db, 'u_ayaan', 'GET', 'checks/ck_energy');
    eq($view['isHost'], false);
    ok(every($view['questions'], fn ($q) => $q['answer'] === []), 'no answer key for members');
    $opts = array_map(fn ($o) => $o['id'], find($view['questions'], fn ($q) => $q['id'] === 'e1')['options']);
    sort($opts);
    eq($opts, ['e1_1', 'e1_2', 'e1_3']);
    eq(call($db, 'u_host', 'GET', 'checks/ck_energy')['questions'][0]['answer'], ['e1_2'], 'hosts get the key');
    throws(fn () => call($db, 'u_ayaan', 'GET', 'checks/ck_exit/results'), '/Only hosts see results/', Forbidden::class);
    // Mark Sumaiya's short answer → graded.
    $r = $res['review'][0];
    eq(call($db, 'u_host', 'POST', "attempts/{$r['attemptId']}/grade", ['questionId' => $r['questionId'], 'points' => 1]), ['ok' => true]);
    $again = call($db, 'u_host', 'GET', 'spaces/sp_1/checks');
    eq(find($again['checks'], fn ($c) => $c['id'] === 'ck_exit')['toReview'], 0);
    eq($db->get('check_attempts', 'at_sumaiya')['status'], 'graded');
    eq(checks_review_items(new Ctx($db, 'u_host'), 'u_host'), []);
});

test('checks routes: a member takes a timed check: autosave, integrity snapshot, auto-grade, one attempt only', function () {
    $db = fresh();
    ck_test_fixture($db);
    $a = call($db, 'u_ayaan', 'POST', 'checks/ck_energy/start');
    ok($a['remaining'] > 590, 'ten minutes on the clock');
    eq($a['score'], null);
    eq(json_encode($a['answers']), '{}', 'answers is an object');
    eq(call($db, 'u_ayaan', 'POST', 'checks/ck_energy/start')['id'], $a['id'], 'start again resumes');
    call($db, 'u_ayaan', 'POST', "attempts/{$a['id']}/answer", ['questionId' => 'e1', 'answer' => ['e1_2']]);
    call($db, 'u_ayaan', 'POST', "attempts/{$a['id']}/answer", ['questionId' => 'e2', 'answer' => ['true']]);
    call($db, 'u_ayaan', 'POST', "attempts/{$a['id']}/answer", ['questionId' => 'e3', 'answer' => ['Joules']]);
    eq(count($db->get('check_attempts', $a['id'])['answers']), 3, 'every save merged into the row');
    throws(fn () => call($db, 'u_ayaan', 'POST', "attempts/{$a['id']}/answer", ['questionId' => 'nope', 'answer' => ['x']]), '/Question not found/', NotFound::class);
    throws(fn () => call($db, 'u_dipa', 'POST', "attempts/{$a['id']}/answer", ['questionId' => 'e1', 'answer' => ['x']]), '/Attempt not found/', NotFound::class);
    throws(fn () => call($db, 'u_dipa', 'GET', "attempts/{$a['id']}"), '/Not your attempt/', Forbidden::class);
    eq(call($db, 'u_ayaan', 'POST', "attempts/{$a['id']}/integrity", ['integrityScore' => 70, 'violationCounts' => ['paste_attempt' => 1, 'bad' => 'x'], 'awayMs' => 0, 'recent' => [['t' => '2026-11-21T10:01:00Z', 'violationKey' => 'paste_attempt']]]), ['ok' => true]);
    eq($db->get('check_attempts', $a['id'])['integrity']['violationCounts'], ['paste_attempt' => 1]);
    $done = call($db, 'u_ayaan', 'POST', "attempts/{$a['id']}/submit");
    eq($done['score'], ['earned' => 2, 'possible' => 3, 'pending' => 0, 'percent' => 67]);
    eq((array) $done['results'], ['e1' => true, 'e2' => false, 'e3' => true]);
    eq($done['status'], 'graded');
    throws(fn () => call($db, 'u_ayaan', 'POST', 'checks/ck_energy/start'), '/already done this check/');
    throws(fn () => call($db, 'u_ayaan', 'POST', "attempts/{$a['id']}/answer", ['questionId' => 'e1', 'answer' => ['e1_1']]), '/already submitted/');
    eq(call($db, 'u_ayaan', 'POST', "attempts/{$a['id']}/integrity", ['integrityScore' => 10]), ['ok' => false]);
    $res = call($db, 'u_host', 'GET', 'checks/ck_energy/results');
    eq($res['attempts'][0]['integrity']['level'], 'flagged');
    // Time's up: Dipa starts, then the 10 minutes pass.
    $b = call($db, 'u_dipa', 'POST', 'checks/ck_energy/start');
    $GLOBALS['loft_now'] = now_ms() + 11 * 60000;
    throws(fn () => call($db, 'u_dipa', 'POST', "attempts/{$b['id']}/answer", ['questionId' => 'e1', 'answer' => ['e1_2']]), "/Time's up/");
    throws(fn () => call($db, 'u_ayaan', 'POST', 'checks/ck_exit/start'), '/closed/');
});

test('checks routes: hosts build and publish a check; invalid questions block publishing; the gradebook averages', function () {
    $db = fresh();
    ck_test_fixture($db);
    put($db, 'posts', ['id' => 'po_ws6', 'spaceId' => 'sp_1', 'kind' => 'task', 'title' => 'Worksheet 6 p2', 'dueAt' => '2026-11-18T00:00:00.000Z', 'createdAt' => '2026-11-15T00:00:00.000Z']);
    put($db, 'submissions', ['id' => 'sub_1', 'postId' => 'po_ws6', 'userId' => 'u_ayaan', 'status' => 'returned', 'at' => '2026-11-17T00:00:00.000Z']);
    throws(fn () => call($db, 'u_ayaan', 'POST', 'spaces/sp_1/checks', ['title' => 'Nope']), '/Only hosts make checks/', Forbidden::class);
    $c = call($db, 'u_host', 'POST', 'spaces/sp_1/checks', ['title' => 'Vectors recap']);
    eq([$c['status'], $c['timeLimitMin'], count($c['questions'])], ['draft', 15, 1]);
    eq(call($db, 'u_ayaan', 'GET', 'spaces/sp_1/checks')['checks'][0]['id'] !== $c['id'], true, 'members never see drafts');
    throws(fn () => call($db, 'u_host', 'POST', "checks/{$c['id']}/status", ['status' => 'published']), '/Question 1: Write the question/', BadRequest::class);
    $edited = call($db, 'u_host', 'POST', "checks/{$c['id']}", ['questions' => [['type' => 'true_false', 'prompt' => 'Vectors have direction.', 'points' => 1, 'answer' => ['true']]], 'timeLimitMin' => 999, 'maxAttempts' => 2]);
    eq([$edited['timeLimitMin'], $edited['maxAttempts']], [240, 2]);
    eq($edited['questions'][0]['options'], [['id' => 'true', 'text' => 'True'], ['id' => 'false', 'text' => 'False']]);
    throws(fn () => call($db, 'u_host', 'POST', "checks/{$c['id']}", ['closeAt' => '##not a date##']), '/Invalid time value/', BadRequest::class);
    $pub = call($db, 'u_host', 'POST', "checks/{$c['id']}/status", ['status' => 'published']);
    eq($pub['status'], 'published');
    $notes = $db->list('notifications', fn ($n) => $n['kind'] === 'check');
    eq(count($notes), 3, 'every member hears about it');
    eq($notes[0]['title'], 'New check: Vectors recap');
    eq($notes[0]['sub'], '1 questions · 240 min');
    $g = call($db, 'u_host', 'GET', 'spaces/sp_1/grades');
    eq(array_map(fn ($x) => $x['title'], $g['columns']), ['Worksheet 6 p2', 'Exit ticket', 'Vectors recap', 'Energy']);
    $row = fn (string $name) => find($g['rows'], fn ($r) => $r['name'] === $name);
    eq($row('Dipa Member')['average'], 0, 'missing the closed exit ticket');
    eq($row('Dipa Member')['cells'][0]['status'], 'missing');
    eq($row('Ayaan Member')['average'], 50);
    eq($row('Ayaan Member')['cells'][0]['status'], 'graded');
    eq($row('Sumaiya Member')['average'], null, 'a short answer still waits');
    $mine = call($db, 'u_ayaan', 'GET', 'spaces/sp_1/grades');
    eq([$mine['isHost'], count($mine['rows'])], [false, 1]);
    $closed = call($db, 'u_host', 'POST', "checks/{$c['id']}/status", ['status' => 'closed']);
    eq($closed['closeAt'], iso(now_ms()));
});
