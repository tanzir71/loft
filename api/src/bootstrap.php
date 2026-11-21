<?php
declare(strict_types=1);

// Loft API bootstrap: no Composer. Loads helpers, the DB, the router and every module.

namespace Loft;

if (PHP_VERSION_ID < 80100) {
    http_response_code(500);
    exit('Loft needs PHP 8.1 or newer.');
}

const API_ROOT = __DIR__ . '/..';

/** Where the SQLite file, uploads and config live (outside the web root in production). */
function data_dir(): string
{
    $env = getenv('LOFT_DATA');
    if ($env) return rtrim($env, '/');
    $sibling = dirname(API_ROOT) . '/data';
    return is_dir($sibling) ? $sibling : API_ROOT . '/data';
}

require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/App.php';
require_once __DIR__ . '/Db.php';
require_once __DIR__ . '/http.php';

$cfgFile = data_dir() . '/config.php';
Config::load(is_file($cfgFile) ? (array) require $cfgFile : []);
date_default_timezone_set('UTC');

foreach (glob(__DIR__ . '/core/*.php') ?: [] as $f) require_once $f;
foreach (glob(__DIR__ . '/routes/*.php') ?: [] as $f) require_once $f;

/** Open (and migrate) the database. */
function db(): Db
{
    static $db = null;
    if ($db) return $db;
    $dir = data_dir();
    if (!is_dir($dir)) mkdir($dir, 0700, true);
    return $db = new Db((string) (Config::get('db_path') ?: $dir . '/loft.sqlite'));
}

function installed(): bool
{
    return is_file(data_dir() . '/config.php') && (bool) Config::get('installed');
}
