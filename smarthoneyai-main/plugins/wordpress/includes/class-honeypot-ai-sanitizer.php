<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Honeypot_AI_Sanitizer {

	const MAX_HEADERS_BYTES = 16384;
	const MAX_PAYLOAD_BYTES = 32768;

	private $sensitive_names = array(
		'authorization',
		'cookie',
		'set-cookie',
		'proxy-authorization',
		'x-api-key',
		'password',
		'passwd',
		'pass',
		'pwd',
		'token',
		'secret',
		'api_key',
		'apikey',
		'access_token',
		'refresh_token',
		'session',
		'sessionid',
		'nonce',
		'credit_card',
		'card_number',
		'cvv',
		'username',
		'user_name',
		'login',
		'account',
	);

	public function headers( $server ) {
		$headers = array();
		$size    = 0;
		foreach ( (array) $server as $key => $value ) {
			if ( 0 !== strpos( $key, 'HTTP_' ) && ! in_array( $key, array( 'CONTENT_TYPE', 'CONTENT_LENGTH' ), true ) ) {
				continue;
			}
			$name = strtolower( str_replace( '_', '-', preg_replace( '/^HTTP_/', '', $key ) ) );
			if ( $this->is_sensitive( $name ) ) {
				$clean = '[REDACTED]';
			} else {
				$clean = $this->scalar_text( $value, 4096 );
			}
			$line_size = strlen( $name ) + strlen( $clean );
			if ( ( $size + $line_size ) > self::MAX_HEADERS_BYTES ) {
				$headers['x-honeypot-truncated'] = 'true';
				break;
			}
			$headers[ $name ] = $clean;
			$size            += $line_size;
		}
		return $headers;
	}

	public function payload( $input ) {
		if ( ! is_array( $input ) ) {
			$input = array( 'raw' => (string) $input );
		}
		$clean   = $this->redact_recursive( $input, 0 );
		$encoded = wp_json_encode( $clean, JSON_UNESCAPED_SLASHES );
		if ( false === $encoded ) {
			return '[unavailable]';
		}
		if ( strlen( $encoded ) > self::MAX_PAYLOAD_BYTES ) {
			return substr( $encoded, 0, self::MAX_PAYLOAD_BYTES - 22 ) . '...[TRUNCATED]';
		}
		return $encoded;
	}

	public function client_ip( $server ) {
		$candidate = isset( $server['REMOTE_ADDR'] ) ? (string) $server['REMOTE_ADDR'] : '';
		return filter_var( $candidate, FILTER_VALIDATE_IP ) ? $candidate : '0.0.0.0';
	}

	private function redact_recursive( $value, $depth ) {
		if ( $depth > 5 ) {
			return '[TRUNCATED]';
		}
		if ( is_array( $value ) ) {
			$result = array();
			$count  = 0;
			foreach ( $value as $key => $item ) {
				if ( ++$count > 100 ) {
					$result['_truncated'] = true;
					break;
				}
				$name           = strtolower( (string) $key );
				$result[ $key ] = $this->is_sensitive( $name ) ? '[REDACTED]' : $this->redact_recursive( $item, $depth + 1 );
			}
			return $result;
		}
		return $this->scalar_text( $value, 4096 );
	}

	private function is_sensitive( $name ) {
		$normalized = str_replace( array( '-', '.', '[', ']' ), '_', strtolower( (string) $name ) );
		foreach ( $this->sensitive_names as $sensitive ) {
			if ( $normalized === $sensitive || false !== strpos( $normalized, $sensitive . '_' ) ) {
				return true;
			}
		}
		return false;
	}

	private function scalar_text( $value, $limit ) {
		if ( is_bool( $value ) ) {
			return $value ? 'true' : 'false';
		}
		if ( ! is_scalar( $value ) && null !== $value ) {
			return '[unsupported]';
		}
		$text = wp_check_invalid_utf8( (string) $value, true );
		$text = preg_replace( '/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', '', $text );
		return substr( $text, 0, $limit );
	}
}
