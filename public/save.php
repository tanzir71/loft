<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
  header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
  header('Access-Control-Allow-Headers: Content-Type');
  exit;
}

$room = isset($_GET['room']) ? (string)$_GET['room'] : '';
$room = trim($room);

if ($room === '' || !preg_match('/^[a-zA-Z0-9_-]{1,64}$/', $room)) {
  http_response_code(400);
  echo json_encode(['ok' => false, 'error' => 'Invalid room'], JSON_UNESCAPED_SLASHES);
  exit;
}

$dir = __DIR__ . DIRECTORY_SEPARATOR . 'rooms';
if (!is_dir($dir)) {
  @mkdir($dir, 0755, true);
}

$filePath = $dir . DIRECTORY_SEPARATOR . $room . '.json';

$empty = [
  'v' => 1,
  'room' => $room,
  'createdAt' => 0,
  'createdBy' => '',
  'updatedAt' => 0,
  'updatedBy' => '',
  'deletedAt' => 0,
  'deletedBy' => '',
  'ownerHash' => '',
  'canvas' => ['strokes' => [], 'items' => []],
  'chat' => [],
  'users' => [],
];

$nowMs = (int)round(microtime(true) * 1000);
$presenceTtlMs = 30000;

function normalize_user($u, $nowMs) {
  if (!is_array($u)) return null;
  $id = isset($u['id']) ? (string)$u['id'] : '';
  if ($id === '') return null;
  $name = isset($u['name']) ? (string)$u['name'] : '';
  if ($name === '') $name = 'anonymous';
  $avatarColor = isset($u['avatarColor']) ? (string)$u['avatarColor'] : '#888888';
  $lastSeen = isset($u['lastSeen']) ? (int)$u['lastSeen'] : $nowMs;
  return [
    'id' => $id,
    'name' => $name,
    'avatarColor' => $avatarColor,
    'lastSeen' => $lastSeen,
  ];
}

function merge_presence(&$state, $user, $nowMs, $ttlMs) {
  if (!isset($state['users']) || !is_array($state['users'])) $state['users'] = [];
  $map = [];
  foreach ($state['users'] as $u) {
    if (!is_array($u)) continue;
    $id = isset($u['id']) ? (string)$u['id'] : '';
    if ($id === '') continue;
    $map[$id] = $u;
  }
  if ($user !== null) {
    $id = $user['id'];
    $prev = isset($map[$id]) && is_array($map[$id]) ? $map[$id] : [];
    $map[$id] = [
      'id' => $id,
      'name' => isset($user['name']) ? (string)$user['name'] : (isset($prev['name']) ? (string)$prev['name'] : 'anonymous'),
      'avatarColor' => isset($user['avatarColor']) ? (string)$user['avatarColor'] : (isset($prev['avatarColor']) ? (string)$prev['avatarColor'] : '#888888'),
      'lastSeen' => isset($user['lastSeen']) ? (int)$user['lastSeen'] : $nowMs,
    ];
  }
  $out = [];
  foreach ($map as $u) {
    $ls = isset($u['lastSeen']) ? (int)$u['lastSeen'] : 0;
    if ($nowMs - $ls > $ttlMs) continue;
    $out[] = $u;
  }
  $state['users'] = $out;
}

function is_deleted($state) {
  return isset($state['deletedAt']) && (int)$state['deletedAt'] > 0;
}

function public_state($state) {
  if (isset($state['ownerHash'])) unset($state['ownerHash']);
  return $state;
}

function hash_owner_key($key) {
  $k = (string)$key;
  if ($k === '') return '';
  return hash('sha256', $k);
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
  if (!is_file($filePath)) {
    http_response_code(404);
    echo json_encode(['ok' => false, 'error' => 'not_found', 'room' => $room], JSON_UNESCAPED_SLASHES);
    exit;
  }
  $raw = @file_get_contents($filePath);
  if ($raw === false || trim($raw) === '') {
    http_response_code(404);
    echo json_encode(['ok' => false, 'error' => 'not_found', 'room' => $room], JSON_UNESCAPED_SLASHES);
    exit;
  }
  $decoded = json_decode($raw, true);
  if (!is_array($decoded)) {
    http_response_code(404);
    echo json_encode(['ok' => false, 'error' => 'not_found', 'room' => $room], JSON_UNESCAPED_SLASHES);
    exit;
  }
  if (is_deleted($decoded)) {
    http_response_code(410);
    echo json_encode(['ok' => false, 'error' => 'deleted', 'room' => $room], JSON_UNESCAPED_SLASHES);
    exit;
  }
  merge_presence($decoded, null, $nowMs, $presenceTtlMs);
  echo json_encode(public_state($decoded), JSON_UNESCAPED_SLASHES);
  exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
  $mode = isset($_GET['mode']) ? (string)$_GET['mode'] : 'full';
  $raw = file_get_contents('php://input');
  if ($raw === false) $raw = '';
  $decoded = json_decode($raw, true);
  if (!is_array($decoded)) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Invalid JSON'], JSON_UNESCAPED_SLASHES);
    exit;
  }

  $fileExists = is_file($filePath);

  if (($mode === 'presence' || $mode === 'delete') && !$fileExists) {
    http_response_code(404);
    echo json_encode(['ok' => false, 'error' => 'not_found', 'room' => $room], JSON_UNESCAPED_SLASHES);
    exit;
  }

  $fp = @fopen($filePath, $fileExists ? 'c+' : 'c+');
  if ($fp === false) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'Failed to open file'], JSON_UNESCAPED_SLASHES);
    exit;
  }
  if (!flock($fp, LOCK_EX)) {
    fclose($fp);
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'Failed to lock file'], JSON_UNESCAPED_SLASHES);
    exit;
  }

  $existingRaw = @stream_get_contents($fp);
  rewind($fp);
  $state = $empty;
  if (is_string($existingRaw) && trim($existingRaw) !== '') {
    $existingDecoded = json_decode($existingRaw, true);
    if (is_array($existingDecoded)) $state = array_merge($state, $existingDecoded);
  }

  if (is_deleted($state)) {
    flock($fp, LOCK_UN);
    fclose($fp);
    http_response_code(410);
    echo json_encode(['ok' => false, 'error' => 'deleted', 'room' => $room], JSON_UNESCAPED_SLASHES);
    exit;
  }

  $ownerKey = isset($decoded['ownerKey']) ? (string)$decoded['ownerKey'] : '';
  $ownerHash = $ownerKey !== '' ? hash_owner_key($ownerKey) : '';

  $user = null;
  if (isset($decoded['user'])) $user = normalize_user($decoded['user'], $nowMs);
  merge_presence($state, $user, $nowMs, $presenceTtlMs);

  $isOwner = false;
  $existingOwnerHash = isset($state['ownerHash']) ? (string)$state['ownerHash'] : '';
  if ($existingOwnerHash !== '' && $ownerHash !== '' && hash_equals($existingOwnerHash, $ownerHash)) {
    $isOwner = true;
  }

  if ($mode === 'check_owner') {
    flock($fp, LOCK_UN);
    fclose($fp);
    echo json_encode(['ok' => true, 'isOwner' => $isOwner, 'room' => $room], JSON_UNESCAPED_SLASHES);
    exit;
  }

  if ($mode === 'delete') {
    if ($existingOwnerHash === '' || $ownerHash === '' || !hash_equals($existingOwnerHash, $ownerHash)) {
      flock($fp, LOCK_UN);
      fclose($fp);
      http_response_code(403);
      echo json_encode(['ok' => false, 'error' => 'forbidden', 'room' => $room], JSON_UNESCAPED_SLASHES);
      exit;
    }
    $state['deletedAt'] = $nowMs;
    $state['deletedBy'] = isset($decoded['updatedBy']) ? (string)$decoded['updatedBy'] : '';
    $state['updatedAt'] = $nowMs;
    $state['updatedBy'] = $state['deletedBy'];
    $state['canvas'] = ['strokes' => [], 'items' => []];
    $state['chat'] = [];
    $state['users'] = [];
  }

  if ($mode !== 'presence') {
    $state['v'] = 1;
    $state['room'] = $room;
    if (!isset($state['createdAt']) || (int)$state['createdAt'] === 0) {
      $state['createdAt'] = $nowMs;
    }
    if (!isset($state['createdBy']) || (string)$state['createdBy'] === '') {
      $state['createdBy'] = isset($decoded['updatedBy']) ? (string)$decoded['updatedBy'] : '';
    }
    if (!isset($state['ownerHash']) || (string)$state['ownerHash'] === '') {
      if ($ownerHash !== '') $state['ownerHash'] = $ownerHash;
    }
    $state['updatedAt'] = isset($decoded['updatedAt']) ? (int)$decoded['updatedAt'] : $nowMs;
    $state['updatedBy'] = isset($decoded['updatedBy']) ? (string)$decoded['updatedBy'] : '';
    if (isset($decoded['canvas']) && is_array($decoded['canvas'])) $state['canvas'] = $decoded['canvas'];
    if (isset($decoded['chat']) && is_array($decoded['chat'])) $state['chat'] = $decoded['chat'];
  }

  $json = json_encode($state, JSON_UNESCAPED_SLASHES);
  if ($json === false) {
    flock($fp, LOCK_UN);
    fclose($fp);
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'Failed to encode JSON'], JSON_UNESCAPED_SLASHES);
    exit;
  }

  ftruncate($fp, 0);
  rewind($fp);
  fwrite($fp, $json);
  fflush($fp);
  flock($fp, LOCK_UN);
  fclose($fp);

  echo json_encode(['ok' => true, 'saved' => public_state($state), 'isOwner' => $isOwner], JSON_UNESCAPED_SLASHES);
  exit;
}

http_response_code(405);
echo json_encode(['ok' => false, 'error' => 'Method not allowed'], JSON_UNESCAPED_SLASHES);
