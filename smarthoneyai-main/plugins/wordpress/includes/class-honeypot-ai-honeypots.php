<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Honeypot_AI_Honeypots {

	private $storage;
	private $sanitizer;
	private $policy;

	public function __construct( Honeypot_AI_Storage $storage, Honeypot_AI_Sanitizer $sanitizer, Honeypot_AI_Policy $policy ) {
		$this->storage   = $storage;
		$this->sanitizer = $sanitizer;
		$this->policy    = $policy;
	}

	public function register_hooks() {
		add_action( 'init', array( __CLASS__, 'add_rewrite_rules' ) );
		add_action( 'init', array( $this, 'enforce_policy' ), 20 );
		add_filter( 'query_vars', array( $this, 'query_vars' ) );
		add_action( 'template_redirect', array( $this, 'intercept' ), 0 );
	}

	public static function add_rewrite_rules() {
		$storage = new Honeypot_AI_Storage();
		$policy  = new Honeypot_AI_Policy( $storage );
		foreach ( $policy->honeypots() as $honeypot ) {
			if ( empty( $honeypot['enabled'] ) ) {
				continue;
			}
			$path = ltrim( (string) $honeypot['path'], '/' );
			$key  = sanitize_key( (string) $honeypot['key'] );
			if ( '' !== $path && '' !== $key ) {
				add_rewrite_rule( '^' . preg_quote( $path, '#' ) . '/?$', 'index.php?honeypot_ai_decoy=' . rawurlencode( $key ), 'top' );
			}
		}
	}

	/**
	 * Replace this plugin's in-memory rewrite rules with the latest policy and
	 * persist the result. Policy polling runs after init, so a plain flush would
	 * otherwise save the routes from the previous policy for another cycle.
	 */
	public static function refresh_rewrite_rules() {
		global $wp_rewrite;
		if ( $wp_rewrite instanceof WP_Rewrite && is_array( $wp_rewrite->extra_rules_top ) ) {
			foreach ( $wp_rewrite->extra_rules_top as $pattern => $target ) {
				if ( false !== strpos( (string) $target, 'honeypot_ai_decoy=' ) ) {
					unset( $wp_rewrite->extra_rules_top[ $pattern ] );
				}
			}
		}
		self::add_rewrite_rules();
		flush_rewrite_rules( false );
	}

	public function query_vars( $vars ) {
		$vars[] = 'honeypot_ai_decoy';
		return $vars;
	}

	public function intercept() {
		if ( is_admin() || wp_doing_cron() ) {
			return;
		}
		$decoy = sanitize_key( (string) get_query_var( 'honeypot_ai_decoy' ) );
		if ( '' === $decoy ) {
			$request = $this->request_context();
			$decoy   = $this->decoy_key_for_path( $request['path'] );
		}
		$route = $this->honeypot_by_key( $decoy );
		if ( ! $route || empty( $route['enabled'] ) ) {
			return;
		}

		$metadata = $this->record_automation_hit( $route );
		$this->capture( 'HONEYPOT', $decoy, 'OBSERVED', null, $metadata );
		$this->render_decoy( $route );
	}

	public function enforce_policy() {
		if ( is_admin() || wp_doing_cron() || ( is_user_logged_in() && current_user_can( 'manage_options' ) ) ) {
			return;
		}
		$request = $this->request_context();
		$config  = $this->policy->auto_block_config();
		if ( ! empty( $config['enabled'] ) && ! $this->policy->source_is_protected( $request['ip'] ) && ! $this->policy->source_is_allowlisted( $request['ip'] ) ) {
			$blocked_until = $this->storage->auto_blocked_until( $this->source_hash( $request['ip'] ) );
			if ( $blocked_until ) {
				$rule = array(
					'id'   => 'local-repeat-honeypot-attacker',
					'type' => 'AUTOMATION',
				);
				$this->capture(
					'FIREWALL',
					null,
					'BLOCKED',
					$rule,
					array(
						'automation'   => 'REPEAT_HONEYPOT_AUTO_BLOCK',
						'blockedUntil' => gmdate( 'c', strtotime( $blocked_until ) ),
					)
				);
				status_header( 403 );
				nocache_headers();
				header( 'Content-Type: text/plain; charset=UTF-8' );
				echo esc_html__( 'Request denied by site security automation.', 'honeypot-ai' );
				exit;
			}
		}

		$decoy = $this->decoy_key_for_path( $request['path'] );
		if ( $decoy && $this->decoy_enabled( $decoy ) ) {
			return;
		}

		$decision = $this->policy->decision( $request );
		if ( in_array( $decision['action'], array( 'BLOCKED', 'RATE_LIMITED' ), true ) ) {
			$kind = 'RATE_LIMITED' === $decision['action'] ? 'RATE_LIMIT' : 'FIREWALL';
			$this->capture( $kind, null, $decision['action'], $decision['rule'] );
			status_header( 'RATE_LIMITED' === $decision['action'] ? 429 : 403 );
			nocache_headers();
			header( 'Content-Type: text/plain; charset=UTF-8' );
			echo esc_html__( 'Request denied by site security policy.', 'honeypot-ai' );
			exit;
		}
	}

	private function configured_honeypots() {
		$configured = array();
		foreach ( $this->policy->honeypots() as $honeypot ) {
			$key = isset( $honeypot['key'] ) ? sanitize_key( (string) $honeypot['key'] ) : '';
			if ( '' !== $key ) {
				$configured[ $key ] = $honeypot;
			}
		}
		return $configured;
	}

	private function honeypot_by_key( $key ) {
		$honeypots = $this->configured_honeypots();
		return isset( $honeypots[ $key ] ) ? $honeypots[ $key ] : null;
	}

	public function decoy_key_for_path( $path ) {
		$path = '/' . trim( (string) $path, '/' );
		foreach ( $this->configured_honeypots() as $key => $honeypot ) {
			if ( hash_equals( strtolower( (string) $honeypot['path'] ), strtolower( $path ) ) ) {
				return $key;
			}
		}
		return null;
	}

	private function capture( $kind, $honeypot_key, $action, $rule, $extra_metadata = array() ) {
		$uri      = isset( $_SERVER['REQUEST_URI'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REQUEST_URI'] ) ) : '/';
		$path     = wp_parse_url( $uri, PHP_URL_PATH );
		$post     = isset( $_POST ) ? wp_unslash( $_POST ) : array(); // phpcs:ignore WordPress.Security.NonceVerification.Missing -- hostile public request evidence, never a state change.
		$metadata = array_merge( array( 'policyMode' => $this->policy->effective_mode() ), is_array( $extra_metadata ) ? $extra_metadata : array() );
		if ( is_array( $rule ) ) {
			$metadata['ruleId']   = sanitize_text_field( (string) $rule['id'] );
			$metadata['ruleType'] = sanitize_text_field( (string) $rule['type'] );
		}
		$event = array(
			'idempotencyKey' => 'wp-' . wp_generate_uuid4(),
			'occurredAt'     => gmdate( 'c' ),
			'kind'           => $kind,
			'method'         => strtoupper( substr( sanitize_key( isset( $_SERVER['REQUEST_METHOD'] ) ? $_SERVER['REQUEST_METHOD'] : 'GET' ), 0, 12 ) ),
			'path'           => substr( (string) $path, 0, 2048 ),
			'ipAddress'      => $this->sanitizer->client_ip( $_SERVER ),
			'userAgent'      => substr( sanitize_text_field( isset( $_SERVER['HTTP_USER_AGENT'] ) ? wp_unslash( $_SERVER['HTTP_USER_AGENT'] ) : '' ), 0, 1024 ),
			'headers'        => $this->sanitizer->headers( $_SERVER ),
			'payload'        => $this->sanitizer->payload( $post ),
			'action'         => $action,
			'metadata'       => $metadata,
		);
		if ( $honeypot_key ) {
			$event['honeypotKey'] = $honeypot_key;
		}
		if ( $this->storage->enqueue( $event ) ) {
			do_action( 'honeypot_ai_event_queued' );
			if ( ! wp_next_scheduled( 'honeypot_ai_send_queue' ) ) {
				wp_schedule_single_event( time() + 10, 'honeypot_ai_send_queue' );
			}
		}
	}

	private function record_automation_hit( $route ) {
		$config = $this->policy->auto_block_config();
		if ( empty( $config['enabled'] ) ) {
			return array();
		}
		$ip = $this->sanitizer->client_ip( $_SERVER );
		if ( $this->policy->source_is_protected( $ip ) || $this->policy->source_is_allowlisted( $ip ) ) {
			return array( 'autoBlockExempt' => true );
		}
		$result = $this->storage->record_honeypot_route_hit(
			$this->source_hash( $ip ),
			hash_hmac( 'sha256', (string) $route['key'], wp_salt( 'auth' ) ),
			(int) $config['windowSeconds'],
			(int) $config['blockSeconds'],
			(int) $config['distinctRoutes']
		);
		if ( false === $result ) {
			$this->storage->record_error( __( 'The local honeypot automation counter is unavailable.', 'honeypot-ai' ), 'honeypot_ai_auto_block_storage' );
			return array();
		}
		$metadata = array(
			'automation'     => 'REPEAT_HONEYPOT_AUTO_BLOCK',
			'distinctRoutes' => (int) $result['distinct_routes'],
			'threshold'      => (int) $config['distinctRoutes'],
		);
		if ( ! empty( $result['activated'] ) ) {
			$metadata['autoBlockActivated'] = true;
			$metadata['blockedUntil']       = gmdate( 'c', strtotime( $result['blocked_until'] ) );
		}
		return $metadata;
	}

	private function source_hash( $ip ) {
		return hash_hmac( 'sha256', (string) $ip, wp_salt( 'auth' ) );
	}

	private function request_context() {
		$uri = isset( $_SERVER['REQUEST_URI'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REQUEST_URI'] ) ) : '/';
		return array(
			'ip'         => $this->sanitizer->client_ip( $_SERVER ),
			'path'       => (string) wp_parse_url( $uri, PHP_URL_PATH ),
			'user_agent' => isset( $_SERVER['HTTP_USER_AGENT'] ) ? sanitize_text_field( wp_unslash( $_SERVER['HTTP_USER_AGENT'] ) ) : '',
			'country'    => '',
		);
	}

	private function decoy_enabled( $decoy ) {
		$route = $this->honeypot_by_key( $decoy );
		return $route && ! empty( $route['enabled'] );
	}

	private function render_decoy( $route ) {
		$template = isset( $route['template'] ) ? $route['template'] : 'DIAGNOSTIC';
		nocache_headers();
		header( 'X-Robots-Tag: noindex, nofollow', true );
		if ( 'JSON_ERROR' === $template ) {
			status_header( 404 );
			header( 'Content-Type: application/json; charset=UTF-8' );
			echo wp_json_encode(
				array(
					'error'  => 'endpoint_not_found',
					'status' => 404,
				)
			);
			exit;
		}
		if ( in_array( $template, array( 'ARCHIVE', 'DIAGNOSTIC' ), true ) ) {
			status_header( 404 );
			header( 'Content-Type: text/plain; charset=UTF-8' );
			echo esc_html__( 'Resource not found.', 'honeypot-ai' );
			exit;
		}
		status_header( 401 );
		header( 'Content-Type: text/html; charset=UTF-8' );
		$title = 'DATABASE_LOGIN' === $template ? __( 'Database administration', 'honeypot-ai' ) : __( 'Restricted administration', 'honeypot-ai' );
		echo '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' . esc_html( $title ) . '</title></head>';
		echo '<body style="font-family:system-ui,sans-serif;max-width:420px;margin:10vh auto;padding:24px"><h1>' . esc_html( $title ) . '</h1><p>' . esc_html__( 'Authorized operators only.', 'honeypot-ai' ) . '</p>';
		echo '<form method="post" autocomplete="off"><label>' . esc_html__( 'Account', 'honeypot-ai' ) . '<br><input name="username" maxlength="100"></label><br><br><label>' . esc_html__( 'Password', 'honeypot-ai' ) . '<br><input type="password" name="password" maxlength="200"></label><br><br><button type="submit">' . esc_html__( 'Continue', 'honeypot-ai' ) . '</button></form></body></html>';
		exit;
	}
}
