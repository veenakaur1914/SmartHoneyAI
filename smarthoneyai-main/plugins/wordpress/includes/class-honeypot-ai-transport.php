<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Honeypot_AI_Transport {

	private $storage;

	public function __construct( Honeypot_AI_Storage $storage ) {
		$this->storage = $storage;
	}

	public function enroll( $api_url, $token ) {
		$body = array(
			'token'         => trim( (string) $token ),
			'siteUrl'       => home_url( '/' ),
			'siteName'      => get_bloginfo( 'name' ),
			'pluginVersion' => HONEYPOT_AI_VERSION,
			'proof'         => hash_hmac( 'sha256', untrailingslashit( home_url( '/' ) ), trim( (string) $token ) ),
		);
		return $this->unsigned_request( 'POST', $api_url, '/v1/agent/enroll', $body );
	}

	public function signed_request( $method, $path, $body = null, $extra_headers = array() ) {
		$settings    = $this->storage->settings();
		$credentials = $this->storage->credentials();
		if ( empty( $settings['api_url'] ) || empty( $credentials['site_id'] ) || empty( $credentials['key_id'] ) || empty( $credentials['secret'] ) ) {
			return new WP_Error( 'honeypot_ai_not_enrolled', __( 'SmartHoneyAI is not enrolled.', 'honeypot-ai' ) );
		}

		$method    = strtoupper( $method );
		$body_json = null === $body ? '' : wp_json_encode( $body, JSON_UNESCAPED_SLASHES );
		if ( false === $body_json ) {
			return new WP_Error( 'honeypot_ai_encode_failed', __( 'Could not encode the request.', 'honeypot-ai' ) );
		}
		$timestamp = (string) time();
		$nonce     = wp_generate_uuid4();
		$body_hash = hash( 'sha256', $body_json );
		// The control plane treats a request ID as part of every signed request,
		// not only event batches. Batch callers supply a stable key for retries.
		$idempotency                      = isset( $extra_headers['Idempotency-Key'] ) ? (string) $extra_headers['Idempotency-Key'] : 'request-' . wp_generate_uuid4();
		$extra_headers['Idempotency-Key'] = $idempotency;
		$canonical                        = implode( "\n", array( $method, $path, $timestamp, $nonce, $body_hash, $idempotency ) );
		$signature                        = base64_encode( hash_hmac( 'sha256', $canonical, (string) $credentials['secret'], true ) ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode -- Standard HMAC transport encoding.

		$headers = array_merge(
			array(
				'Accept'                    => 'application/json',
				'Content-Type'              => 'application/json',
				'X-Honeypot-Site-Id'        => (string) $credentials['site_id'],
				'X-Honeypot-Key-Id'         => (string) $credentials['key_id'],
				'X-Honeypot-Timestamp'      => $timestamp,
				'X-Honeypot-Nonce'          => $nonce,
				'X-Honeypot-Content-SHA256' => $body_hash,
				'X-Honeypot-Signature'      => $signature,
				'User-Agent'                => 'SmartHoneyAI-WordPress/' . HONEYPOT_AI_VERSION,
			),
			$extra_headers
		);

		return $this->request( $method, $settings['api_url'], $path, $body_json, $headers );
	}

	private function unsigned_request( $method, $api_url, $path, $body ) {
		$body_json = wp_json_encode( $body, JSON_UNESCAPED_SLASHES );
		if ( false === $body_json ) {
			return new WP_Error( 'honeypot_ai_encode_failed', __( 'Could not encode the request.', 'honeypot-ai' ) );
		}
		return $this->request(
			$method,
			$api_url,
			$path,
			$body_json,
			array(
				'Accept'       => 'application/json',
				'Content-Type' => 'application/json',
				'User-Agent'   => 'SmartHoneyAI-WordPress/' . HONEYPOT_AI_VERSION,
			)
		);
	}

	private function request( $method, $api_url, $path, $body_json, $headers ) {
		$api_url = esc_url_raw( untrailingslashit( (string) $api_url ) );
		if ( ! $this->valid_api_url( $api_url ) ) {
			return new WP_Error( 'honeypot_ai_invalid_api_url', __( 'The API URL must be a public HTTPS URL (HTTP is permitted only for local development).', 'honeypot-ai' ) );
		}
		$local_ca = $this->local_control_ca( $api_url );
		$args     = array(
			'method'             => $method,
			'headers'            => $headers,
			'timeout'            => 10,
			'redirection'        => 0,
			'reject_unsafe_urls' => ! $local_ca,
			'sslverify'          => true,
			'data_format'        => 'body',
		);
		if ( $local_ca ) {
			$args['sslcertificates'] = $local_ca;
		}
		if ( '' !== $body_json ) {
			$args['body'] = $body_json;
		}
		// The local demo host resolves to Docker's private gateway, so WordPress'
		// public-host SSRF check must be bypassed only for this exact, CA-pinned
		// local HTTPS endpoint. All other requests retain the safe URL check.
		$response = $local_ca ? wp_remote_request( $api_url . $path, $args ) : wp_safe_remote_request( $api_url . $path, $args );
		if ( is_wp_error( $response ) ) {
			return $response;
		}
		$status  = (int) wp_remote_retrieve_response_code( $response );
		$raw     = wp_remote_retrieve_body( $response );
		$decoded = '' === $raw ? array() : json_decode( $raw, true );
		if ( 304 !== $status && ( $status < 200 || $status >= 300 ) ) {
			/* translators: %d is the HTTP response status from the control plane. */
			$message = is_array( $decoded ) && ! empty( $decoded['message'] ) ? $decoded['message'] : sprintf( __( 'Control plane returned HTTP %d.', 'honeypot-ai' ), $status );
			return new WP_Error( 'honeypot_ai_http_error', sanitize_text_field( $message ), array( 'status' => $status ) );
		}
		return array(
			'status'  => $status,
			'body'    => is_array( $decoded ) ? $decoded : array(),
			'headers' => wp_remote_retrieve_headers( $response ),
		);
	}

	private function valid_api_url( $url ) {
		$parts = wp_parse_url( $url );
		if ( ! $parts || empty( $parts['scheme'] ) || empty( $parts['host'] ) || ! empty( $parts['user'] ) || ! empty( $parts['pass'] ) || ! empty( $parts['query'] ) || ! empty( $parts['fragment'] ) ) {
			return false;
		}
		if ( ! empty( $parts['path'] ) && '/' !== $parts['path'] ) {
			return false;
		}
		if ( 'https' === strtolower( $parts['scheme'] ) ) {
			return true;
		}
		$host = strtolower( $parts['host'] );
		return 'http' === strtolower( $parts['scheme'] ) && in_array( $host, array( 'localhost', '127.0.0.1', '::1' ), true );
	}

	private function local_control_ca( $url ) {
		if ( ! function_exists( 'wp_get_environment_type' ) || 'local' !== wp_get_environment_type() ) {
			return '';
		}
		$expected_host = strtolower( trim( (string) getenv( 'HONEYPOT_AI_LOCAL_CONTROL_HOST' ) ) );
		$expected_port = (int) getenv( 'HONEYPOT_AI_LOCAL_CONTROL_PORT' );
		$ca_file       = (string) getenv( 'HONEYPOT_AI_LOCAL_CA_FILE' );
		$parts         = wp_parse_url( $url );
		if ( ! $parts || 'https' !== strtolower( isset( $parts['scheme'] ) ? $parts['scheme'] : '' ) || '' === $expected_host ) {
			return '';
		}
		$actual_host   = strtolower( isset( $parts['host'] ) ? $parts['host'] : '' );
		$actual_port   = isset( $parts['port'] ) ? (int) $parts['port'] : 443;
		$expected_port = $expected_port > 0 ? $expected_port : 443;
		if ( ! hash_equals( $expected_host, $actual_host ) || $expected_port !== $actual_port || ! is_readable( $ca_file ) ) {
			return '';
		}
		$real_path = realpath( $ca_file );
		return false !== $real_path ? $real_path : '';
	}
}
