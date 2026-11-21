<?php
declare(strict_types=1);

// Loft API front controller (/spaces/api/v1/<resource> and /spaces/a/<token>/...).
// In production this file sits in public_html/spaces/api/ and the code outside the web root.

namespace Loft;

$candidates = [
    __DIR__ . '/../src/bootstrap.php',                 // repo / CI: api/public → api/src
    dirname(__DIR__, 3) . '/loft-app/api/src/bootstrap.php', // Namecheap: ~/public_html/spaces/api → ~/loft-app
];
foreach ($candidates as $c) {
    if (is_file($c)) {
        require $c;
        break;
    }
}
if (!function_exists('Loft\\db')) {
    http_response_code(500);
    exit('Loft is not installed correctly: the API code was not found.');
}

serve();
