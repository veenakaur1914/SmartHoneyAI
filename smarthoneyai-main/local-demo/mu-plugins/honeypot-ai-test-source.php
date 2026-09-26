<?php
/**
 * Secret-gated source-IP injection for authorized local firewall tests only.
 *
 * The WordPress container is published on host loopback, and this hook additionally
 * requires a local environment, the exact demo Host header, and a private/loopback
 * container peer. The secret headers are removed before the plugin can capture them.
 */

if (!defined('ABSPATH') || 'local' !== wp_get_environment_type()) {
    return;
}

$secret_file = (string) getenv('HONEYPOT_AI_TEST_SOURCE_SECRET_FILE');
$expected_host = strtolower((string) getenv('HONEYPOT_AI_TEST_HOST'));
$request_host = isset($_SERVER['HTTP_HOST']) ? strtolower((string) $_SERVER['HTTP_HOST']) : '';
$real_source = isset($_SERVER['REMOTE_ADDR']) ? (string) $_SERVER['REMOTE_ADDR'] : '';
$provided_secret = isset($_SERVER['HTTP_X_HONEYPOT_TEST_SECRET']) ? (string) $_SERVER['HTTP_X_HONEYPOT_TEST_SECRET'] : '';
$synthetic_source = isset($_SERVER['HTTP_X_HONEYPOT_TEST_REMOTE_ADDR']) ? (string) $_SERVER['HTTP_X_HONEYPOT_TEST_REMOTE_ADDR'] : '';

unset($_SERVER['HTTP_X_HONEYPOT_TEST_SECRET'], $_SERVER['HTTP_X_HONEYPOT_TEST_REMOTE_ADDR']);

$is_local_peer = false !== filter_var($real_source, FILTER_VALIDATE_IP, FILTER_FLAG_NO_RES_RANGE)
    && false === filter_var($real_source, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE);
$expected_secret = is_readable($secret_file) ? trim((string) file_get_contents($secret_file)) : '';
$synthetic_valid = false !== filter_var($synthetic_source, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE);

if ($is_local_peer
    && '' !== $expected_host
    && hash_equals($expected_host, $request_host)
    && strlen($expected_secret) >= 32
    && hash_equals($expected_secret, $provided_secret)
    && $synthetic_valid
) {
    $_SERVER['REMOTE_ADDR'] = $synthetic_source;
}
