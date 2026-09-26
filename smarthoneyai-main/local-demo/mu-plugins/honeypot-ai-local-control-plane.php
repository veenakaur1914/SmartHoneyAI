<?php
/**
 * Permit the local demo WordPress container to call one exact HTTPS control-plane host.
 *
 * This file is copied into mu-plugins only by the local demo provisioner. It must never
 * be included in a production plugin package.
 */

if (!defined('ABSPATH') || 'local' !== wp_get_environment_type()) {
    return;
}

function honeypot_ai_local_demo_control_url($url)
{
    $parts = wp_parse_url((string) $url);
    if (!$parts || empty($parts['scheme']) || empty($parts['host'])) {
        return false;
    }

    $expected_host = strtolower((string) getenv('HONEYPOT_AI_LOCAL_CONTROL_HOST'));
    $expected_port = (int) getenv('HONEYPOT_AI_LOCAL_CONTROL_PORT');
    $port = isset($parts['port']) ? (int) $parts['port'] : 443;

    return 'https' === strtolower((string) $parts['scheme'])
        && '' !== $expected_host
        && hash_equals($expected_host, strtolower((string) $parts['host']))
        && $expected_port > 0
        && $expected_port === $port;
}

add_filter('http_request_host_is_external', function ($external, $host, $url) {
    return honeypot_ai_local_demo_control_url($url) ? true : $external;
}, 10, 3);

add_filter('http_request_args', function ($args, $url) {
    if (!honeypot_ai_local_demo_control_url($url)) {
        return $args;
    }

    $certificate = (string) getenv('HONEYPOT_AI_LOCAL_CA_FILE');
    if ('' === $certificate || !is_readable($certificate)) {
        return $args;
    }

    $args['sslverify'] = true;
    $args['sslcertificates'] = $certificate;
    $args['redirection'] = 0;
    return $args;
}, 10, 2);
