<?php
/**
 * Enroll the provisioned local WordPress site through the real plugin transport.
 *
 * Run with WP-CLI only. The one-time token is read from the environment, removed
 * immediately, never persisted, and never printed.
 */

if (!defined('WP_CLI') || !WP_CLI || !class_exists('Honeypot_AI_Transport')) {
    fwrite(STDERR, "Run this helper with WP-CLI after activating SmartHoneyAI.\n");
    exit(1);
}

$token = trim((string) getenv('HONEYPOT_ENROLLMENT_TOKEN'));
$control_url = untrailingslashit((string) getenv('HONEYPOT_CONTROL_URL'));
putenv('HONEYPOT_ENROLLMENT_TOKEN');
unset($_ENV['HONEYPOT_ENROLLMENT_TOKEN'], $_SERVER['HONEYPOT_ENROLLMENT_TOKEN']);

if (strlen($token) < 32) {
    WP_CLI::error('HONEYPOT_ENROLLMENT_TOKEN is missing or invalid.');
}
if ('' === $control_url) {
    $control_url = 'https://host.docker.internal';
}
$parts = wp_parse_url($control_url);
$port = isset($parts['port']) ? (int) $parts['port'] : 443;
$expected_port = (int) getenv('HONEYPOT_AI_LOCAL_CONTROL_PORT');
$expected_port = $expected_port > 0 ? $expected_port : 443;
if (!$parts
    || empty($parts['scheme'])
    || empty($parts['host'])
    || 'https' !== strtolower((string) $parts['scheme'])
    || 'host.docker.internal' !== strtolower((string) $parts['host'])
    || $expected_port !== $port
) {
    WP_CLI::error(sprintf('HONEYPOT_CONTROL_URL must use https://host.docker.internal on the configured local HTTPS port (%d).', $expected_port));
}

$storage = new Honeypot_AI_Storage();
$settings = $storage->settings();
$settings['api_url'] = $control_url;
update_option(Honeypot_AI_Storage::OPTION_SETTINGS, $settings, false);

$transport = new Honeypot_AI_Transport($storage);
$response = $transport->enroll($control_url, $token);
$token = '';
if (is_wp_error($response)) {
    WP_CLI::error($response->get_error_message());
}

$body = isset($response['body']) && is_array($response['body']) ? $response['body'] : array();
$credential = isset($body['credential']) && is_array($body['credential']) ? $body['credential'] : $body;
$site_id = isset($body['siteId']) ? $body['siteId'] : (isset($credential['siteId']) ? $credential['siteId'] : '');
$key_id = isset($body['keyId']) ? $body['keyId'] : (isset($credential['keyId']) ? $credential['keyId'] : '');
$secret = isset($body['secret']) ? $body['secret'] : (isset($credential['secret']) ? $credential['secret'] : '');
$public_key = isset($body['policyPublicKey']) ? $body['policyPublicKey'] : (isset($credential['policyPublicKey']) ? $credential['policyPublicKey'] : '');

if (!$site_id || !$key_id || strlen((string) $secret) < 32 || !$public_key) {
    WP_CLI::error('Enrollment response omitted required credentials or policy public key.');
}

$storage->save_credentials(array(
    'site_id' => sanitize_text_field($site_id),
    'key_id' => sanitize_text_field($key_id),
    'secret' => (string) $secret,
    'policy_public_key' => (string) $public_key,
    'enrolled_at' => gmdate('c'),
));
$secret = '';
Honeypot_AI_Storage::schedule_events();

$policy = new Honeypot_AI_Policy($storage);
$agent = new Honeypot_AI_Agent($storage, $transport, $policy);
$agent->tick();

WP_CLI::success('WordPress enrolled and initial policy/heartbeat synchronization attempted.');
