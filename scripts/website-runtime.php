<?php
declare(strict_types=1);

// Build template, included only by the public front controller. Never stores user data in the ZIP.
if (realpath((string) ($_SERVER['SCRIPT_FILENAME'] ?? '')) === __FILE__) {
    http_response_code(404);
    exit;
}
$private = $app !== '' ? rtrim($app, '/\\') : dirname(__DIR__, 3) . '/loft-app';
$public = realpath((string) ($_SERVER['DOCUMENT_ROOT'] ?? dirname(__DIR__, 2)));
if (!is_dir($private) && !mkdir($private, 0700, true) && !is_dir($private)) {
    throw new RuntimeException('Loft needs a writable loft-app folder outside public_html. Set LOFT_APP if your domain uses a nested web root.');
}
$private = realpath($private);
$normalise = static fn (string $p): string => strtolower(str_replace('\\', '/', $p));
if (!$private || !$public || $normalise($private) === $normalise($public) || str_starts_with($normalise($private), $normalise($public) . '/')) {
    throw new RuntimeException('LOFT_APP must be outside the web root.');
}
$hasData = static fn (string $dir): bool => is_file($dir . '/config.php') || is_file($dir . '/loft.sqlite');
$configuredData = getenv('LOFT_DATA');
if (!$configuredData && $hasData($private . '/data') && $hasData($private . '/api/data')) throw new RuntimeException('Two Loft data directories exist. Set LOFT_DATA to the existing installation.');
// Early standalone builds used api/data despite documenting data/. Keep either in place.
$data = $configuredData ?: ($hasData($private . '/api/data') ? $private . '/api/data' : $private . '/data');
if (!is_dir($data) && !mkdir($data, 0700, true) && !is_dir($data)) throw new RuntimeException('Loft data folder is not writable.');
$data = realpath($data);
if (!$data || $normalise($data) === $normalise($public) || str_starts_with($normalise($data), $normalise($public) . '/')) throw new RuntimeException('LOFT_DATA must be outside the web root.');
putenv('LOFT_DATA=' . $data);
$revision = '__LOFT_RUNTIME_HASH__';
$release = $private . '/releases/' . $revision;
if (!is_file($release . '/.complete')) {
    $lock = fopen($private . '/.runtime.lock', 'c');
    if (!$lock || !flock($lock, LOCK_EX)) throw new RuntimeException('Cannot lock the Loft runtime update.');
    try {
        if (!is_file($release . '/.complete')) {
            $json = base64_decode('__LOFT_RUNTIME_PAYLOAD__', true);
            if ($json === false || !hash_equals($revision, hash('sha256', $json))) throw new RuntimeException('Loft runtime checksum mismatch.');
            $files = json_decode($json, true, 512, JSON_THROW_ON_ERROR);
            $stage = $private . '/releases/.install-' . bin2hex(random_bytes(8));
            if (!mkdir($stage, 0700, true)) throw new RuntimeException('Cannot stage the Loft runtime.');
            foreach ($files as $name => $encoded) {
                if (!preg_match('~^api/(src|migrations)/[a-zA-Z0-9_./-]+\.(php|sql)$~D', $name) || str_contains($name, '..')) throw new RuntimeException('Unsafe Loft runtime path.');
                $target = $stage . '/' . $name;
                if (!is_dir(dirname($target)) && !mkdir(dirname($target), 0700, true)) throw new RuntimeException('Cannot create Loft runtime directory.');
                $bytes = base64_decode($encoded, true);
                if ($bytes === false || file_put_contents($target, $bytes) !== strlen($bytes)) throw new RuntimeException('Cannot write Loft runtime file.');
            }
            if (!is_file($stage . '/api/src/bootstrap.php') || !is_file($stage . '/api/migrations/001_init.sql')) throw new RuntimeException('Incomplete Loft runtime.');
            file_put_contents($stage . '/.complete', $revision);
            if (!rename($stage, $release)) throw new RuntimeException('Cannot publish Loft runtime.');
        }
    } finally {
        flock($lock, LOCK_UN);
        fclose($lock);
    }
}
return $release;
