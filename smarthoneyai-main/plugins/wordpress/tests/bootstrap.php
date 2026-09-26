<?php

$tests_dir = getenv('WP_TESTS_DIR');
if (!$tests_dir) {
    $tests_dir = '/tmp/wordpress-tests-lib';
}

if (!file_exists($tests_dir . '/includes/functions.php')) {
    fwrite(STDERR, "WordPress test suite was not found. Set WP_TESTS_DIR.\n");
    exit(1);
}

require_once $tests_dir . '/includes/functions.php';

$polyfills_dir = dirname(__DIR__) . '/vendor/yoast/phpunit-polyfills';
if (!defined('WP_TESTS_PHPUNIT_POLYFILLS_PATH') && is_dir($polyfills_dir)) {
    define('WP_TESTS_PHPUNIT_POLYFILLS_PATH', $polyfills_dir);
}

tests_add_filter('muplugins_loaded', function () {
    require dirname(__DIR__) . '/honeypot-ai.php';
});

require $tests_dir . '/includes/bootstrap.php';
