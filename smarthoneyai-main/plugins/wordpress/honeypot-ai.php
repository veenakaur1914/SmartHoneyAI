<?php
/**
 * Plugin Name: SmartHoneyAI Agent
 * Plugin URI: https://smarthoneyai.xyz
 * Description: Safe WordPress honeypot sensor and local policy enforcement agent for the SmartHoneyAI control plane.
 * Version: 1.1.0
 * Requires at least: 6.2
 * Requires PHP: 7.4
 * Author: SmartHoneyAI
 * License: GPL-2.0-or-later
 * Text Domain: honeypot-ai
 *
 * @package SmartHoneyAI
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'HONEYPOT_AI_VERSION', '1.1.0' );
define( 'HONEYPOT_AI_FILE', __FILE__ );
define( 'HONEYPOT_AI_DIR', plugin_dir_path( __FILE__ ) );
define( 'HONEYPOT_AI_URL', plugin_dir_url( __FILE__ ) );
define( 'HONEYPOT_AI_BASENAME', plugin_basename( __FILE__ ) );

require_once HONEYPOT_AI_DIR . 'includes/class-honeypot-ai-sanitizer.php';
require_once HONEYPOT_AI_DIR . 'includes/class-honeypot-ai-storage.php';
require_once HONEYPOT_AI_DIR . 'includes/class-honeypot-ai-transport.php';
require_once HONEYPOT_AI_DIR . 'includes/class-honeypot-ai-policy.php';
require_once HONEYPOT_AI_DIR . 'includes/class-honeypot-ai-agent.php';
require_once HONEYPOT_AI_DIR . 'includes/class-honeypot-ai-honeypots.php';
require_once HONEYPOT_AI_DIR . 'includes/class-honeypot-ai-admin.php';

function honeypot_ai_activate() {
	Honeypot_AI_Storage::activate();
	Honeypot_AI_Honeypots::add_rewrite_rules();
	flush_rewrite_rules( false );
}
register_activation_hook( __FILE__, 'honeypot_ai_activate' );
register_deactivation_hook( __FILE__, array( 'Honeypot_AI_Agent', 'deactivate' ) );

function honeypot_ai_bootstrap() {
	Honeypot_AI_Storage::maybe_upgrade();
	$storage   = new Honeypot_AI_Storage();
	$sanitizer = new Honeypot_AI_Sanitizer();
	$transport = new Honeypot_AI_Transport( $storage );
	$policy    = new Honeypot_AI_Policy( $storage );
	$agent     = new Honeypot_AI_Agent( $storage, $transport, $policy );
	$honeypots = new Honeypot_AI_Honeypots( $storage, $sanitizer, $policy );
	$admin     = new Honeypot_AI_Admin( $storage, $transport, $agent, $policy );

	$agent->register_hooks();
	$honeypots->register_hooks();
	$admin->register_hooks();
}
add_action( 'plugins_loaded', 'honeypot_ai_bootstrap' );
