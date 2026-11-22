<?php
declare(strict_types=1);

// Loft API front controller (/spaces/api/v1/<resource> and /spaces/a/<token>/...).
// In production this file sits in public_html/spaces/api/ and the code outside the web root.

namespace Loft;

// Where loft-app lives can be set with `SetEnv LOFT_APP /home/<user>/loft-app` in this folder's .htaccess
// (needed when the web root isn't directly inside the home folder, e.g. an addon domain under public_html).
$app = (string) ($_SERVER['LOFT_APP'] ?? $_SERVER['REDIRECT_LOFT_APP'] ?? getenv('LOFT_APP') ?: '');
$candidates = array_filter([
    $app !== '' ? rtrim($app, '/') . '/api/src/bootstrap.php' : '',
    __DIR__ . '/../src/bootstrap.php',                 // repo / CI: api/public → api/src
    dirname(__DIR__, 3) . '/loft-app/api/src/bootstrap.php', // Namecheap: ~/public_html/spaces/api → ~/loft-app
]);
foreach ($candidates as $c) {
    if (is_file($c)) {
        require $c;
        break;
    }
}
if (!function_exists('Loft\\db')) {
    http_response_code(500);
    exit('Loft is not installed correctly: the API code was not found. Put loft-app next to your web root folder, or set LOFT_APP (see INSTALL.md).');
}

serve();
