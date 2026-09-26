<?php
/** Run one deterministic SmartHoneyAI queue/config/heartbeat cycle through WP-CLI. */

if (!defined('WP_CLI') || !WP_CLI || !class_exists('Honeypot_AI_Agent')) {
    fwrite(STDERR, "Run this helper with WP-CLI after activating SmartHoneyAI.\n");
    exit(1);
}

$storage = new Honeypot_AI_Storage();
$transport = new Honeypot_AI_Transport($storage);
$policy = new Honeypot_AI_Policy($storage);
$agent = new Honeypot_AI_Agent($storage, $transport, $policy);
$agent->tick();

$agent_status = $storage->agent_status();
$active_error = $storage->last_error(true);
$stored_policy = $storage->policy();
$document = isset($stored_policy['document']) && is_array($stored_policy['document']) ? $stored_policy['document'] : array();
$policy_rules = array();
foreach (isset($document['rules']) && is_array($document['rules']) ? $document['rules'] : array() as $rule) {
    $policy_rules[] = array(
        'id' => isset($rule['id']) ? (string) $rule['id'] : '',
        'type' => isset($rule['type']) ? (string) $rule['type'] : '',
        'value' => isset($rule['value']) ? (string) $rule['value'] : '',
        'enabled' => !empty($rule['enabled']),
    );
}
$result = array(
    'enrolled' => $storage->is_enrolled(),
    'connectionStatus' => $storage->connection_status(),
    'queueDepth' => $storage->queue_depth(),
    'queueBytes' => $storage->queue_bytes(),
    'droppedEvents' => $storage->dropped_events(),
    'policyVersion' => $policy->version(),
    'effectiveMode' => $policy->effective_mode(),
    'lastHeartbeatAt' => isset($agent_status['last_heartbeat_at']) ? $agent_status['last_heartbeat_at'] : null,
    'health' => isset($agent_status['health']) ? $agent_status['health'] : null,
    'lastErrorCode' => isset($active_error['code']) ? $active_error['code'] : null,
    'policyRules' => $policy_rules,
);

WP_CLI::line(wp_json_encode($result, JSON_UNESCAPED_SLASHES));
