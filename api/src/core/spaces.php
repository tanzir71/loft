<?php
declare(strict_types=1);

namespace Loft;

// Port of packages/core/src/spaces.ts: space modes (labels, tabs), tab labels, space codes and
// must-read acknowledgements. The room limit from limits.ts (ROOM_CAPACITY = 12) lives in helpers.php.

/** A mode only changes labels, tabs and templates. You can switch later. */
const SPACE_MODES = [
    'team' => ['label' => 'Team', 'blurb' => 'Weekly meetings, retros, a shared board', 'tabs' => ['stream', 'chat', 'work', 'files', 'people'], 'workLabel' => 'Tasks', 'composer' => 'Post an update to the team', 'icon' => 'users'],
    'client' => ['label' => 'Client / consulting', 'blurb' => 'Calls, decisions, retainers and invoices', 'tabs' => ['stream', 'chat', 'work', 'files', 'people', 'billing'], 'workLabel' => 'Actions', 'composer' => 'Post an update to the client team', 'icon' => 'wallet'],
    'workshop' => ['label' => 'Workshop / sprint', 'blurb' => 'A few intense days with a set agenda', 'tabs' => ['agenda', 'stream', 'chat', 'votes', 'files', 'people'], 'workLabel' => 'Actions', 'composer' => 'Post an update to the group', 'icon' => 'layout-dashboard'],
    'course' => ['label' => 'Course / class', 'blurb' => 'Lessons, assignments, quick checks', 'tabs' => ['stream', 'chat', 'work', 'files', 'people', 'grades'], 'workLabel' => 'Classwork', 'composer' => 'Announce something to your class', 'icon' => 'graduation-cap'],
    'tutoring' => ['label' => '1:1 tutoring or coaching', 'blurb' => 'One person, regular sessions, packages', 'tabs' => ['stream', 'chat', 'sessions', 'notes', 'files', 'billing'], 'workLabel' => 'Homework', 'composer' => 'Share something with your learner', 'icon' => 'book-open'],
];

const MODE_ORDER = ['team', 'client', 'workshop', 'course', 'tutoring'];

const SPACE_COLOURS = ['blue', 'green', 'amber', 'red', 'slate', 'teal'];

/** The mode config for a space (unknown modes fall back to "team"). */
function space_mode(string $mode): array
{
    $all = SPACE_MODES;
    return $all[$mode] ?? $all['team'];
}

function tab_label(string $mode, string $tab): string
{
    if ($tab === 'work') return space_mode($mode)['workLabel'];
    $labels = ['stream' => 'Stream', 'chat' => 'Chat', 'files' => 'Files', 'people' => 'People', 'billing' => 'Billing', 'agenda' => 'Agenda', 'votes' => 'Votes', 'grades' => 'Grades', 'sessions' => 'Sessions', 'notes' => 'Notes', 'work' => 'Work'];
    return $labels[$tab] ?? $tab;
}

/** Three-letter space code shown on cards ("Acme pricing" → "ACM", "Product team" → "PRO"). */
function space_code(string $name): string
{
    $letters = preg_replace('/[^A-Z]/', '', mb_strtoupper($name)) ?? '';
    $three = substr($letters, 0, 3);
    return str_pad($three !== '' ? $three : 'LFT', 3, 'X');
}

/**
 * Must-read posts: who in the space hasn't acknowledged yet (the author never needs to).
 * @param list<string> $memberIds
 * @param list<string> $ackedIds
 * @return list<string>
 */
function unacknowledged(array $memberIds, array $ackedIds, string $authorId): array
{
    $acked = array_flip($ackedIds);
    return array_values(array_filter($memberIds, fn ($id) => $id !== $authorId && !isset($acked[$id])));
}
