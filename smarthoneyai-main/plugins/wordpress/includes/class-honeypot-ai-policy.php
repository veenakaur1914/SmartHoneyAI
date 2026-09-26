<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Honeypot_AI_Policy {

	const MAX_POLICY_LIFETIME = 7200;
	const CLOCK_SKEW          = 300;

	private $storage;

	public function __construct( Honeypot_AI_Storage $storage ) {
		$this->storage = $storage;
	}

	public function validate_and_store( $policy, $etag = '' ) {
		$credentials = $this->storage->credentials();
		if ( ! $this->valid_shape( $policy ) ) {
			return new WP_Error( 'honeypot_ai_policy_shape', __( 'Policy document is invalid.', 'honeypot-ai' ) );
		}
		if ( (string) $policy['siteId'] !== (string) $credentials['site_id'] ) {
			return new WP_Error( 'honeypot_ai_policy_site', __( 'Policy belongs to another site.', 'honeypot-ai' ) );
		}
		if ( ! $this->verify_signature( $policy, isset( $credentials['policy_public_key'] ) ? $credentials['policy_public_key'] : '' ) ) {
			return new WP_Error( 'honeypot_ai_policy_signature', __( 'Policy signature verification failed.', 'honeypot-ai' ) );
		}
		$current = $this->storage->policy();
		if ( ! empty( $current['document']['version'] ) && (int) $policy['version'] < (int) $current['document']['version'] ) {
			return new WP_Error( 'honeypot_ai_policy_rollback', __( 'An older policy version was rejected.', 'honeypot-ai' ) );
		}
		if ( ! empty( $current['document']['version'] ) && (int) $policy['version'] === (int) $current['document']['version'] && ! hash_equals( (string) $current['document']['signature'], (string) $policy['signature'] ) ) {
			return new WP_Error( 'honeypot_ai_policy_version_conflict', __( 'A different policy reused the current version and was rejected.', 'honeypot-ai' ) );
		}
		if ( ! $this->storage->save_policy( $policy, $etag ) ) {
			return new WP_Error( 'honeypot_ai_policy_store', __( 'Verified policy could not be persisted safely.', 'honeypot-ai' ) );
		}
		return true;
	}

	public function effective_mode() {
		$stored = $this->storage->policy();
		$policy = isset( $stored['document'] ) && is_array( $stored['document'] ) ? $stored['document'] : array();
		if ( ! $policy || empty( $policy['expiresAt'] ) || strtotime( $policy['expiresAt'] ) <= time() ) {
			return 'MONITOR_ONLY';
		}
		return isset( $policy['mode'] ) && 'ENFORCE' === strtoupper( $policy['mode'] ) ? 'ENFORCE' : 'OBSERVE';
	}

	public function version() {
		$stored = $this->storage->policy();
		return isset( $stored['document']['version'] ) ? (int) $stored['document']['version'] : 0;
	}

	public function honeypots() {
		$stored = $this->storage->policy();
		if ( ! empty( $stored['document']['honeypots'] ) && is_array( $stored['document']['honeypots'] ) ) {
			return array_values( $stored['document']['honeypots'] );
		}
		return self::built_in_honeypots();
	}

	public function auto_block_config() {
		$defaults = array(
			'enabled'        => true,
			'distinctRoutes' => 3,
			'windowSeconds'  => 600,
			'blockSeconds'   => 86400,
		);
		$stored   = $this->storage->policy();
		$config   = isset( $stored['document']['autoBlock'] ) && is_array( $stored['document']['autoBlock'] ) ? $stored['document']['autoBlock'] : array();
		return wp_parse_args( $config, $defaults );
	}

	public function honeypot_config_hash() {
		return hash( 'sha256', (string) wp_json_encode( $this->honeypots(), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ) );
	}

	public function source_is_protected( $ip ) {
		return $this->is_protected_ip( $ip );
	}

	public function source_is_allowlisted( $ip ) {
		$stored = $this->storage->policy();
		$rules  = isset( $stored['document']['rules'] ) ? (array) $stored['document']['rules'] : array();
		foreach ( $rules as $rule ) {
			if ( $this->rule_active( $rule ) && 'ALLOW_IP' === $rule['type'] && $this->ip_matches( $ip, $rule['value'] ) ) {
				return true;
			}
		}
		return false;
	}

	public static function built_in_honeypots() {
		return array(
			array(
				'id'       => 'built-in-sql-injection-trap',
				'key'      => 'sql-injection-trap',
				'name'     => 'SQL injection honeypot',
				'path'     => '/database/query',
				'template' => 'DATABASE_LOGIN',
				'enabled'  => true,
			),
			array(
				'id'       => 'built-in-xss-probe-trap',
				'key'      => 'xss-probe-trap',
				'name'     => 'XSS honeypot',
				'path'     => '/preview/render',
				'template' => 'FAKE_LOGIN',
				'enabled'  => true,
			),
			array(
				'id'       => 'built-in-command-injection-trap',
				'key'      => 'command-injection-trap',
				'name'     => 'Command injection honeypot',
				'path'     => '/system/diagnostics',
				'template' => 'DIAGNOSTIC',
				'enabled'  => true,
			),
			array(
				'id'       => 'built-in-fake-login',
				'key'      => 'fake-login',
				'name'     => 'Fake administration login',
				'path'     => '/secure-admin-login',
				'template' => 'FAKE_LOGIN',
				'enabled'  => true,
			),
			array(
				'id'       => 'built-in-backup-archive',
				'key'      => 'backup-archive',
				'name'     => 'Backup archive',
				'path'     => '/wp-content/backups/site-backup.zip',
				'template' => 'ARCHIVE',
				'enabled'  => true,
			),
			array(
				'id'       => 'built-in-admin-console',
				'key'      => 'admin-console',
				'name'     => 'Internal administration console',
				'path'     => '/internal/admin-console',
				'template' => 'FAKE_LOGIN',
				'enabled'  => true,
			),
			array(
				'id'       => 'built-in-phpmyadmin',
				'key'      => 'phpmyadmin',
				'name'     => 'Database administration',
				'path'     => '/phpmyadmin',
				'template' => 'DATABASE_LOGIN',
				'enabled'  => true,
			),
			array(
				'id'       => 'built-in-environment-file',
				'key'      => 'environment-file',
				'name'     => 'Environment diagnostic endpoint',
				'path'     => '/env',
				'template' => 'DIAGNOSTIC',
				'enabled'  => true,
			),
			array(
				'id'       => 'built-in-git-config',
				'key'      => 'git-config',
				'name'     => 'Source control diagnostic endpoint',
				'path'     => '/git-config',
				'template' => 'DIAGNOSTIC',
				'enabled'  => true,
			),
			array(
				'id'       => 'built-in-wp-config-backup',
				'key'      => 'wp-config-backup',
				'name'     => 'WordPress configuration diagnostic',
				'path'     => '/wp-config-backup',
				'template' => 'DIAGNOSTIC',
				'enabled'  => true,
			),
			array(
				'id'       => 'built-in-server-status',
				'key'      => 'server-status',
				'name'     => 'Server diagnostic endpoint',
				'path'     => '/server-diagnostics',
				'template' => 'DIAGNOSTIC',
				'enabled'  => true,
			),
			array(
				'id'       => 'built-in-adminer',
				'key'      => 'adminer',
				'name'     => 'Adminer database console',
				'path'     => '/adminer.php',
				'template' => 'DATABASE_LOGIN',
				'enabled'  => true,
			),
			array(
				'id'       => 'built-in-debug-log',
				'key'      => 'debug-log',
				'name'     => 'WordPress debug diagnostic',
				'path'     => '/debug-log',
				'template' => 'DIAGNOSTIC',
				'enabled'  => true,
			),
			array(
				'id'       => 'built-in-database-dump',
				'key'      => 'database-dump',
				'name'     => 'Database backup',
				'path'     => '/backup.sql',
				'template' => 'ARCHIVE',
				'enabled'  => true,
			),
			array(
				'id'       => 'built-in-actuator-env',
				'key'      => 'actuator-env',
				'name'     => 'Application environment endpoint',
				'path'     => '/actuator/env',
				'template' => 'JSON_ERROR',
				'enabled'  => true,
			),
		);
	}

	public function decision( $request ) {
		$mode = $this->effective_mode();
		if ( 'ENFORCE' !== $mode ) {
			return array(
				'action' => 'OBSERVED',
				'rule'   => null,
				'mode'   => $mode,
			);
		}
		if ( $this->is_protected_ip( $request['ip'] ) ) {
			return array(
				'action' => 'ALLOWED',
				'rule'   => null,
				'mode'   => $mode,
			);
		}
		$stored = $this->storage->policy();
		$rules  = isset( $stored['document']['rules'] ) ? (array) $stored['document']['rules'] : array();
		usort(
			$rules,
			function ( $a, $b ) {
				return ( (int) $a['priority'] ) <=> ( (int) $b['priority'] );
			}
		);

		// Any matching allow rule wins, regardless of priority.
		foreach ( $rules as $rule ) {
			if ( $this->rule_active( $rule ) && 'ALLOW_IP' === $rule['type'] && $this->ip_matches( $request['ip'], $rule['value'] ) ) {
				return array(
					'action' => 'ALLOWED',
					'rule'   => $rule,
					'mode'   => $mode,
				);
			}
		}
		foreach ( $rules as $rule ) {
			if ( ! $this->rule_active( $rule ) || 0 === strpos( $rule['type'], 'ALLOW_' ) ) {
				continue;
			}
			if ( 'BLOCK_IP' === $rule['type'] && $this->ip_matches( $request['ip'], $rule['value'] ) ) {
				return array(
					'action' => 'BLOCKED',
					'rule'   => $rule,
					'mode'   => $mode,
				);
			}
			if ( 'BLOCK_USER_AGENT' === $rule['type'] && $this->bounded_contains( $request['user_agent'], $rule['value'] ) ) {
				return array(
					'action' => 'BLOCKED',
					'rule'   => $rule,
					'mode'   => $mode,
				);
			}
			if ( 'BLOCK_ROUTE' === $rule['type'] && $this->route_matches( $request['path'], $rule['value'] ) ) {
				return array(
					'action' => 'BLOCKED',
					'rule'   => $rule,
					'mode'   => $mode,
				);
			}
			if ( 'BLOCK_COUNTRY' === $rule['type'] && ! empty( $request['country'] ) && strtoupper( $request['country'] ) === strtoupper( $rule['value'] ) ) {
				return array(
					'action' => 'BLOCKED',
					'rule'   => $rule,
					'mode'   => $mode,
				);
			}
			if ( 'RATE_LIMIT' === $rule['type'] && $this->rate_limit_exceeded( $request['ip'], $rule ) ) {
				return array(
					'action' => 'RATE_LIMITED',
					'rule'   => $rule,
					'mode'   => $mode,
				);
			}
		}
		return array(
			'action' => 'OBSERVED',
			'rule'   => null,
			'mode'   => $mode,
		);
	}

	public function canonical_json( $policy ) {
		unset( $policy['signature'] );
		$normalized = $this->sort_recursive( $policy );
		return wp_json_encode( $normalized, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE );
	}

	private function verify_signature( $policy, $public_key ) {
		if ( ! function_exists( 'sodium_crypto_sign_verify_detached' ) || empty( $public_key ) ) {
			return false;
		}
		$signature = base64_decode( (string) $policy['signature'], true ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_decode -- Standard signature transport encoding.
		$key       = $this->decode_public_key( $public_key );
		if ( false === $signature || false === $key || SODIUM_CRYPTO_SIGN_BYTES !== strlen( $signature ) || SODIUM_CRYPTO_SIGN_PUBLICKEYBYTES !== strlen( $key ) ) {
			return false;
		}
		// Prefer the documented sorted form. The second form supports Node's
		// insertion-order JSON serialization during a safe rollout transition.
		if ( sodium_crypto_sign_verify_detached( $signature, $this->canonical_json( $policy ), $key ) ) {
			return true;
		}
		$ordered = $policy;
		unset( $ordered['signature'] );
		$ordered_json = wp_json_encode( $ordered, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE );
		return sodium_crypto_sign_verify_detached( $signature, $ordered_json, $key );
	}

	private function decode_public_key( $public_key ) {
		$decoded = base64_decode( (string) $public_key, true ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_decode -- Standard public-key transport encoding.
		if ( false === $decoded ) {
			return false;
		}
		if ( SODIUM_CRYPTO_SIGN_PUBLICKEYBYTES === strlen( $decoded ) ) {
			return $decoded;
		}
		// Enrollment may transport an Ed25519 SPKI PEM as base64. Its DER
		// payload ends with the raw 32-byte public key (OID 1.3.101.112).
		if ( false !== strpos( $decoded, 'BEGIN PUBLIC KEY' ) ) {
			$pem_body = preg_replace( '/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s+/', '', $decoded );
			$der      = base64_decode( $pem_body, true ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_decode -- PEM contains base64-encoded DER.
			if ( false !== $der && strlen( $der ) >= 44 && "\x30\x2a\x30\x05\x06\x03\x2b\x65\x70\x03\x21\x00" === substr( $der, 0, 12 ) ) {
				return substr( $der, -SODIUM_CRYPTO_SIGN_PUBLICKEYBYTES );
			}
		}
		return false;
	}

	private function valid_shape( $policy ) {
		if ( ! is_array( $policy ) ) {
			return false;
		}
		foreach ( array( 'siteId', 'version', 'issuedAt', 'expiresAt', 'mode', 'rules', 'signature' ) as $key ) {
			if ( ! array_key_exists( $key, $policy ) ) {
				return false;
			}
		}
		if ( (int) $policy['version'] < 1 || ! in_array( strtoupper( $policy['mode'] ), array( 'OBSERVE', 'ENFORCE' ), true ) || ! is_array( $policy['rules'] ) || count( $policy['rules'] ) > 2000 ) {
			return false;
		}
		$issued_at  = strtotime( $policy['issuedAt'] );
		$expires_at = strtotime( $policy['expiresAt'] );
		if ( ! $issued_at || ! $expires_at || $issued_at > ( time() + self::CLOCK_SKEW ) || $expires_at <= time() || $expires_at <= $issued_at || ( $expires_at - $issued_at ) > self::MAX_POLICY_LIFETIME || strlen( $policy['signature'] ) > 512 ) {
			return false;
		}
		$types = array( 'ALLOW_IP', 'BLOCK_IP', 'BLOCK_COUNTRY', 'BLOCK_USER_AGENT', 'BLOCK_ROUTE', 'RATE_LIMIT' );
		foreach ( $policy['rules'] as $rule ) {
			if ( ! is_array( $rule ) || empty( $rule['id'] ) || strlen( (string) $rule['id'] ) > 128 || empty( $rule['value'] ) || ! in_array( isset( $rule['type'] ) ? $rule['type'] : '', $types, true ) ) {
				return false;
			}
			if ( ! array_key_exists( 'enabled', $rule ) || ! is_bool( $rule['enabled'] ) || ! isset( $rule['priority'] ) || ! is_numeric( $rule['priority'] ) ) {
				return false;
			}
			if ( (int) $rule['priority'] < 0 || (int) $rule['priority'] > 10000 || strlen( $rule['value'] ) > 512 || strlen( isset( $rule['reason'] ) ? $rule['reason'] : '' ) > 500 ) {
				return false;
			}
			if ( 'ALLOW_IP' !== $rule['type'] && empty( $rule['expiresAt'] ) ) {
				return false;
			}
			if ( ! empty( $rule['expiresAt'] ) && ! strtotime( $rule['expiresAt'] ) ) {
				return false;
			}
			if ( ! $this->valid_rule_value( $rule['type'], $rule['value'] ) ) {
				return false;
			}
		}
		if ( isset( $policy['honeypots'] ) ) {
			if ( ! is_array( $policy['honeypots'] ) || count( $policy['honeypots'] ) > 200 ) {
				return false;
			}
			$keys      = array();
			$paths     = array();
			$templates = array( 'FAKE_LOGIN', 'DATABASE_LOGIN', 'ARCHIVE', 'DIAGNOSTIC', 'JSON_ERROR' );
			foreach ( $policy['honeypots'] as $honeypot ) {
				if ( ! is_array( $honeypot ) || empty( $honeypot['id'] ) || empty( $honeypot['key'] ) || empty( $honeypot['name'] ) || empty( $honeypot['path'] ) || ! array_key_exists( 'enabled', $honeypot ) ) {
					return false;
				}
				$key  = (string) $honeypot['key'];
				$path = (string) $honeypot['path'];
				if ( strlen( (string) $honeypot['id'] ) > 128 || strlen( $key ) > 128 || strlen( (string) $honeypot['name'] ) > 160 || strlen( $path ) > 190 || ! is_bool( $honeypot['enabled'] ) || ! in_array( isset( $honeypot['template'] ) ? $honeypot['template'] : '', $templates, true ) ) {
					return false;
				}
				if ( ! preg_match( '/^[a-z0-9][a-z0-9-]*$/', $key ) || ! $this->valid_honeypot_path( $path ) || isset( $keys[ $key ] ) || isset( $paths[ strtolower( $path ) ] ) ) {
					return false;
				}
				$keys[ $key ]                 = true;
				$paths[ strtolower( $path ) ] = true;
			}
		}
		if ( isset( $policy['autoBlock'] ) ) {
			$auto = $policy['autoBlock'];
			if ( ! is_array( $auto ) || ! isset( $auto['enabled'], $auto['distinctRoutes'], $auto['windowSeconds'], $auto['blockSeconds'] ) || ! is_bool( $auto['enabled'] ) ) {
				return false;
			}
			if ( (int) $auto['distinctRoutes'] < 2 || (int) $auto['distinctRoutes'] > 50 || (int) $auto['windowSeconds'] < 60 || (int) $auto['windowSeconds'] > 86400 || (int) $auto['blockSeconds'] < 60 || (int) $auto['blockSeconds'] > 604800 ) {
				return false;
			}
		}
		return true;
	}

	private function valid_honeypot_path( $path ) {
		if ( '/' !== substr( $path, 0, 1 ) || '/' === $path || preg_match( '/[\s\\\\?#\x00-\x1F\x7F]/', $path ) || false !== strpos( $path, '//' ) ) {
			return false;
		}
		foreach ( explode( '/', $path ) as $part ) {
			if ( '.' === $part || '..' === $part ) {
				return false;
			}
		}
		return '/' !== substr( $path, -1 );
	}

	private function valid_rule_value( $type, $value ) {
		$value = (string) $value;
		if ( in_array( $type, array( 'ALLOW_IP', 'BLOCK_IP' ), true ) ) {
			list($address, $bits) = array_pad( explode( '/', $value, 2 ), 2, null );
			if ( ! filter_var( $address, FILTER_VALIDATE_IP ) ) {
				return false;
			}
			if ( null === $bits ) {
				return true;
			}
			if ( ! preg_match( '/^\d{1,3}$/', $bits ) ) {
				return false;
			}
			$maximum = false !== strpos( $address, ':' ) ? 128 : 32;
			return (int) $bits >= 0 && (int) $bits <= $maximum;
		}
		if ( 'BLOCK_ROUTE' === $type ) {
			return '/' === substr( $value, 0, 1 ) && ! preg_match( '/[\s?#]/', $value ) && false === strpos( substr( $value, 0, -1 ), '*' );
		}
		if ( 'BLOCK_USER_AGENT' === $type ) {
			return strlen( $value ) <= 256 && ! preg_match( '/[\x00-\x1F\x7F]/', $value );
		}
		if ( 'BLOCK_COUNTRY' === $type ) {
			return 1 === preg_match( '/^[A-Z]{2}$/', strtoupper( $value ) );
		}
		if ( 'RATE_LIMIT' === $type && preg_match( '/^(\d{1,5})\/(\d{1,5})$/', $value, $matches ) ) {
			return (int) $matches[1] >= 1 && (int) $matches[1] <= 10000 && (int) $matches[2] >= 10 && (int) $matches[2] <= 86400;
		}
		return false;
	}

	private function rule_active( $rule ) {
		if ( empty( $rule['enabled'] ) ) {
			return false;
		}
		return empty( $rule['expiresAt'] ) || strtotime( $rule['expiresAt'] ) > time();
	}

	private function ip_matches( $ip, $rule ) {
		if ( false === strpos( $rule, '/' ) ) {
			return hash_equals( (string) $rule, (string) $ip );
		}
		list($subnet, $bits) = array_pad( explode( '/', $rule, 2 ), 2, null );
		if ( ! filter_var( $ip, FILTER_VALIDATE_IP ) || ! filter_var( $subnet, FILTER_VALIDATE_IP ) ) {
			return false;
		}
		$ip_bin     = inet_pton( $ip );
		$subnet_bin = inet_pton( $subnet );
		if ( false === $ip_bin || false === $subnet_bin || strlen( $ip_bin ) !== strlen( $subnet_bin ) ) {
			return false;
		}
		$bits = (int) $bits;
		$max  = 8 * strlen( $ip_bin );
		if ( $bits < 0 || $bits > $max ) {
			return false;
		}
		$bytes     = intdiv( $bits, 8 );
		$remaining = $bits % 8;
		if ( $bytes && substr( $ip_bin, 0, $bytes ) !== substr( $subnet_bin, 0, $bytes ) ) {
			return false;
		}
		if ( ! $remaining ) {
			return true;
		}
		$mask = ( 0xFF << ( 8 - $remaining ) ) & 0xFF;
		return ( ord( $ip_bin[ $bytes ] ) & $mask ) === ( ord( $subnet_bin[ $bytes ] ) & $mask );
	}

	private function is_protected_ip( $ip ) {
		if ( ! filter_var( $ip, FILTER_VALIDATE_IP ) ) {
			return true;
		}
		return false === filter_var( $ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE );
	}

	private function bounded_contains( $haystack, $needle ) {
		$needle = substr( (string) $needle, 0, 256 );
		return '' !== $needle && false !== stripos( substr( (string) $haystack, 0, 1024 ), $needle );
	}

	private function route_matches( $path, $value ) {
		$value = substr( (string) $value, 0, 512 );
		if ( '' === $value || '/' !== $value[0] ) {
			return false;
		}
		// A trailing * is the sole wildcard; regular expressions are never evaluated.
		if ( '*' === substr( $value, -1 ) ) {
			return 0 === strpos( (string) $path, substr( $value, 0, -1 ) );
		}
		return hash_equals( $value, (string) $path );
	}

	private function rate_limit_exceeded( $ip, $rule ) {
		// Compact safe format: requests/window-seconds, for example 60/60.
		if ( ! preg_match( '/^(\d{1,5})\/(\d{1,5})$/', (string) $rule['value'], $matches ) ) {
			return false;
		}
		$limit  = max( 1, min( 10000, (int) $matches[1] ) );
		$window = max( 10, min( 86400, (int) $matches[2] ) );
		$bucket = (int) floor( time() / $window );
		$key    = hash( 'sha256', (string) $rule['id'] . '|' . $ip . '|' . $bucket );
		$count  = $this->storage->increment_rate_limit( $key, ( ( $bucket + 1 ) * $window ) + 10 );
		if ( false === $count ) {
			$this->storage->record_error( __( 'The local rate-limit counter is unavailable.', 'honeypot-ai' ), 'honeypot_ai_rate_limit_storage' );
			return false;
		}
		return $count > $limit;
	}

	private function sort_recursive( $value ) {
		if ( ! is_array( $value ) ) {
			return $value;
		}
		if ( array_keys( $value ) !== range( 0, count( $value ) - 1 ) ) {
			ksort( $value, SORT_STRING );
		}
		foreach ( $value as $key => $item ) {
			$value[ $key ] = $this->sort_recursive( $item );
		}
		return $value;
	}
}
