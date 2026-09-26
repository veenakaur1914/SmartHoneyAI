<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Honeypot_AI_Storage {

	const OPTION_SETTINGS         = 'honeypot_ai_settings';
	const OPTION_CREDENTIALS      = 'honeypot_ai_credentials';
	const OPTION_POLICY           = 'honeypot_ai_policy';
	const OPTION_POLICY_CANDIDATE = 'honeypot_ai_policy_candidate';
	const OPTION_LAST_ERROR       = 'honeypot_ai_last_error';
	const OPTION_AGENT_STATUS     = 'honeypot_ai_agent_status';
	const OPTION_DROPPED_EVENTS   = 'honeypot_ai_dropped_events';
	const OPTION_SCHEMA_VERSION   = 'honeypot_ai_schema_version';
	const OPTION_DELETE_DATA      = 'honeypot_ai_delete_data_on_uninstall';
	const SCHEMA_VERSION          = '4';
	const MAX_QUEUE               = 10000;
	const MAX_QUEUE_BYTES         = 67108864;

	public static function table_name() {
		global $wpdb;
		return $wpdb->prefix . 'honeypot_ai_events';
	}

	public static function rate_limit_table_name() {
		global $wpdb;
		return $wpdb->prefix . 'honeypot_ai_rate_limits';
	}

	public static function queue_state_table_name() {
		global $wpdb;
		return $wpdb->prefix . 'honeypot_ai_queue_state';
	}

	public static function honeypot_hits_table_name() {
		global $wpdb;
		return $wpdb->prefix . 'honeypot_ai_honeypot_hits';
	}

	public static function auto_blocks_table_name() {
		global $wpdb;
		return $wpdb->prefix . 'honeypot_ai_auto_blocks';
	}

	public static function activate() {
		self::install_schema();

		if ( false === get_option( self::OPTION_SETTINGS, false ) ) {
			add_option(
				self::OPTION_SETTINGS,
				array(
					'api_url'        => '',
					'enabled_decoys' => array( 'fake-login', 'backup-archive', 'admin-console', 'phpmyadmin' ),
					'poll_interval'  => 300,
				),
				'',
				false
			);
		}
		if ( false === get_option( self::OPTION_DELETE_DATA, false ) ) {
			add_option( self::OPTION_DELETE_DATA, 'no', '', false );
		}
		if ( false === get_option( self::OPTION_DROPPED_EVENTS, false ) ) {
			add_option( self::OPTION_DROPPED_EVENTS, '0', '', false );
		}
		self::schedule_events();
		flush_rewrite_rules( false );
	}

	public static function maybe_upgrade() {
		if ( self::SCHEMA_VERSION !== (string) get_option( self::OPTION_SCHEMA_VERSION, '' ) ) {
			self::install_schema( true );
		}
	}

	private static function install_schema( $version_guard = false ) {
		global $wpdb;
		$lock_name = 'honeypot_ai_schema_' . substr( hash( 'sha256', $wpdb->prefix . ( defined( 'DB_NAME' ) ? DB_NAME : 'WordPress' ) ), 0, 32 );
		$acquired  = 1 === (int) $wpdb->get_var( $wpdb->prepare( 'SELECT GET_LOCK(%s, 10)', $lock_name ) );
		if ( ! $acquired ) {
			return false;
		}
		try {
			// Every concurrent request re-checks after acquiring the schema-only
			// lock. Hot-path queue work never uses this advisory lock.
			if ( $version_guard && self::SCHEMA_VERSION === (string) get_option( self::OPTION_SCHEMA_VERSION, '' ) ) {
				return true;
			}
			require_once ABSPATH . 'wp-admin/includes/upgrade.php';

			$events_table      = self::table_name();
			$rate_limit_table  = self::rate_limit_table_name();
			$queue_state_table = self::queue_state_table_name();
			$hits_table        = self::honeypot_hits_table_name();
			$blocks_table      = self::auto_blocks_table_name();
			$charset           = $wpdb->get_charset_collate();
			$events_sql        = "CREATE TABLE {$events_table} (
            id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
            idempotency_key varchar(128) NOT NULL,
            payload longtext NOT NULL,
            payload_bytes bigint(20) unsigned NOT NULL DEFAULT 0,
            attempts smallint(5) unsigned NOT NULL DEFAULT 0,
            available_at datetime NOT NULL,
            claim_token char(32) DEFAULT NULL,
            claimed_until datetime DEFAULT NULL,
            created_at datetime NOT NULL,
            PRIMARY KEY (id),
            UNIQUE KEY idempotency_key (idempotency_key),
            KEY available_at (available_at),
            KEY claim_token (claim_token),
            KEY claim_ready (claimed_until, available_at)
        ) {$charset};";
			$rate_limit_sql    = "CREATE TABLE {$rate_limit_table} (
            bucket_key char(64) NOT NULL,
            hit_count bigint(20) unsigned NOT NULL DEFAULT 0,
            expires_at datetime NOT NULL,
            updated_at datetime NOT NULL,
            PRIMARY KEY (bucket_key),
            KEY expires_at (expires_at)
        ) {$charset};";
			$queue_state_sql   = "CREATE TABLE {$queue_state_table} (
            singleton_id tinyint(3) unsigned NOT NULL,
            row_count bigint(20) unsigned NOT NULL DEFAULT 0,
            payload_bytes bigint(20) unsigned NOT NULL DEFAULT 0,
            dropped_events bigint(20) unsigned NOT NULL DEFAULT 0,
            updated_at datetime NOT NULL,
            PRIMARY KEY (singleton_id)
        ) {$charset};";
			$hits_sql          = "CREATE TABLE {$hits_table} (
            source_hash char(64) NOT NULL,
            route_hash char(64) NOT NULL,
            seen_at datetime NOT NULL,
            expires_at datetime NOT NULL,
            PRIMARY KEY (source_hash, route_hash),
            KEY expires_at (expires_at),
            KEY source_expiry (source_hash, expires_at)
        ) {$charset};";
			$blocks_sql        = "CREATE TABLE {$blocks_table} (
            source_hash char(64) NOT NULL,
            blocked_until datetime NOT NULL,
            created_at datetime NOT NULL,
            PRIMARY KEY (source_hash),
            KEY blocked_until (blocked_until)
        ) {$charset};";
			dbDelta( $events_sql );
			dbDelta( $rate_limit_sql );
			dbDelta( $queue_state_sql );
			dbDelta( $hits_sql );
			dbDelta( $blocks_sql );
			$wpdb->query( "UPDATE {$events_table} SET payload_bytes = OCTET_LENGTH(payload) WHERE payload_bytes = 0" ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
			$stats = $wpdb->get_row( "SELECT COUNT(*) AS row_count, COALESCE(SUM(payload_bytes), 0) AS payload_bytes FROM {$events_table}", ARRAY_A ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
			$wpdb->query(
				$wpdb->prepare(
					"INSERT INTO {$queue_state_table} (singleton_id, row_count, payload_bytes, dropped_events, updated_at) VALUES (1, %d, %d, %d, %s)
                ON DUPLICATE KEY UPDATE row_count = VALUES(row_count), payload_bytes = VALUES(payload_bytes), dropped_events = GREATEST(dropped_events, VALUES(dropped_events)), updated_at = VALUES(updated_at)",
					isset( $stats['row_count'] ) ? (int) $stats['row_count'] : 0,
					isset( $stats['payload_bytes'] ) ? (int) $stats['payload_bytes'] : 0,
					max( 0, (int) get_option( self::OPTION_DROPPED_EVENTS, 0 ) ),
					current_time( 'mysql', true )
				)
			); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
			update_option( self::OPTION_SCHEMA_VERSION, self::SCHEMA_VERSION, false );
			return true;
		} finally {
			$wpdb->get_var( $wpdb->prepare( 'SELECT RELEASE_LOCK(%s)', $lock_name ) );
		}
	}

	public static function schedule_events() {
		if ( ! wp_next_scheduled( 'honeypot_ai_policy_sync' ) ) {
			wp_schedule_event( time() + 15, 'honeypot_ai_one_minute', 'honeypot_ai_policy_sync' );
		}
		if ( ! wp_next_scheduled( 'honeypot_ai_agent_tick' ) ) {
			wp_schedule_event( time() + 60, 'honeypot_ai_five_minutes', 'honeypot_ai_agent_tick' );
		}
	}

	public function settings() {
		$defaults = array(
			'api_url'        => '',
			'enabled_decoys' => array( 'fake-login', 'backup-archive', 'admin-console', 'phpmyadmin' ),
			'poll_interval'  => 300,
		);
		return wp_parse_args( (array) get_option( self::OPTION_SETTINGS, array() ), $defaults );
	}

	public function credentials() {
		$value = get_option( self::OPTION_CREDENTIALS, array() );
		return is_array( $value ) ? $value : array();
	}

	public function is_enrolled() {
		$credentials = $this->credentials();
		return ! empty( $credentials['site_id'] ) && ! empty( $credentials['key_id'] ) && ! empty( $credentials['secret'] );
	}

	public function save_credentials( $credentials ) {
		return update_option( self::OPTION_CREDENTIALS, $credentials, false );
	}

	public function disconnect() {
		delete_option( self::OPTION_CREDENTIALS );
		delete_option( self::OPTION_POLICY );
		delete_option( self::OPTION_POLICY_CANDIDATE );
		delete_option( self::OPTION_AGENT_STATUS );
		delete_option( self::OPTION_LAST_ERROR );
	}

	public function policy() {
		$records  = array(
			get_option( self::OPTION_POLICY, array() ),
			get_option( self::OPTION_POLICY_CANDIDATE, array() ),
		);
		$selected = array();
		foreach ( $records as $record ) {
			if ( ! $this->policy_record_valid( $record ) ) {
				continue;
			}
			if ( ! $selected || $this->policy_record_is_newer( $record, $selected ) ) {
				$selected = $record;
			}
		}
		return $selected;
	}

	public function save_policy( $policy, $etag ) {
		$encoded = wp_json_encode( $policy, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE );
		if ( false === $encoded ) {
			return false;
		}
		$record = array(
			'document'    => $policy,
			'etag'        => (string) $etag,
			'source_hash' => hash( 'sha256', $encoded ),
			'stored_at'   => gmdate( 'c' ),
		);

		// Persist to a candidate slot first. If the primary write is interrupted,
		// policy() can still select the verified candidate on the next request.
		update_option( self::OPTION_POLICY_CANDIDATE, $record, false );
		$candidate = get_option( self::OPTION_POLICY_CANDIDATE, array() );
		if ( ! $this->policy_record_valid( $candidate ) || ! hash_equals( $record['source_hash'], $candidate['source_hash'] ) ) {
			return false;
		}

		update_option( self::OPTION_POLICY, $candidate, false );
		$primary = get_option( self::OPTION_POLICY, array() );
		if ( $this->policy_record_valid( $primary ) && hash_equals( $candidate['source_hash'], $primary['source_hash'] ) ) {
			delete_option( self::OPTION_POLICY_CANDIDATE );
		}
		return true;
	}

	public function record_error( $message, $code = 'honeypot_ai_error' ) {
		$code    = preg_replace( '/[^a-zA-Z0-9_.:-]/', '_', (string) $code );
		$code    = substr( (string) $code, 0, 64 );
		$message = substr( sanitize_text_field( (string) $message ), 0, 500 );
		update_option(
			self::OPTION_LAST_ERROR,
			array(
				'code'    => '' !== $code ? $code : 'honeypot_ai_error',
				'message' => $message,
				'at'      => gmdate( 'c' ),
				'active'  => true,
			),
			false
		);
	}

	public function last_error( $active_only = false ) {
		$error = get_option( self::OPTION_LAST_ERROR, array() );
		if ( ! is_array( $error ) || ( $active_only && empty( $error['active'] ) ) ) {
			return array();
		}
		return $error;
	}

	public function record_heartbeat_success( $health, $details = array() ) {
		$health = in_array( $health, array( 'HEALTHY', 'DEGRADED', 'ERROR' ), true ) ? $health : 'ERROR';
		update_option(
			self::OPTION_AGENT_STATUS,
			array(
				'last_heartbeat_at'     => gmdate( 'c' ),
				'health'                => $health,
				'deployment_type'       => isset( $details['deploymentType'] ) && 'DOCKER' === $details['deploymentType'] ? 'DOCKER' : 'NORMAL_HOSTING',
				'paired_network_sensor' => isset( $details['pairedNetworkSensor'] ) && is_array( $details['pairedNetworkSensor'] ) ? $details['pairedNetworkSensor'] : array(),
			),
			false
		);

		$error = $this->last_error();
		if ( $error ) {
			$error['active'] = false;
			update_option( self::OPTION_LAST_ERROR, $error, false );
		}
	}

	public function agent_status() {
		$status = get_option( self::OPTION_AGENT_STATUS, array() );
		return is_array( $status ) ? $status : array();
	}

	public function connection_status() {
		if ( ! $this->is_enrolled() ) {
			return 'OFFLINE';
		}
		$status         = $this->agent_status();
		$last_heartbeat = isset( $status['last_heartbeat_at'] ) ? strtotime( $status['last_heartbeat_at'] ) : false;
		if ( ! $last_heartbeat ) {
			return 'OFFLINE';
		}
		$age = max( 0, time() - $last_heartbeat );
		if ( $age <= 600 && 'HEALTHY' === ( isset( $status['health'] ) ? $status['health'] : '' ) ) {
			return 'ONLINE';
		}
		if ( $age <= 900 ) {
			return 'DEGRADED';
		}
		return 'OFFLINE';
	}

	public function enqueue( $event ) {
		global $wpdb;
		$json            = wp_json_encode( $event, JSON_UNESCAPED_SLASHES );
		$idempotency_key = isset( $event['idempotencyKey'] ) ? (string) $event['idempotencyKey'] : '';
		$payload_bytes   = false === $json ? 0 : strlen( $json );
		if ( false === $json || $payload_bytes > self::MAX_QUEUE_BYTES || '' === $idempotency_key || strlen( $idempotency_key ) > 128 ) {
			$this->increment_dropped_events( 1 );
			return false;
		}
		if ( false === $wpdb->query( 'START TRANSACTION' ) ) { // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
			return $this->fail_enqueue( __( 'The event spool could not start a database transaction.', 'honeypot-ai' ), 'honeypot_ai_queue_transaction', false );
		}

		$state = $this->lock_queue_state();
		if ( false === $state ) {
			return $this->fail_enqueue( __( 'The event spool state is unavailable.', 'honeypot-ai' ), 'honeypot_ai_queue_state' );
		}

		$table       = self::table_name();
		$now         = current_time( 'mysql', true );
		$existing_id = $wpdb->get_var(
			$wpdb->prepare(
				"SELECT id FROM {$table} WHERE idempotency_key = %s LIMIT 1",
				$idempotency_key
			)
		); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		if ( '' !== $wpdb->last_error ) {
			return $this->fail_enqueue( __( 'The event spool could not inspect an idempotency key.', 'honeypot-ai' ), 'honeypot_ai_queue_idempotency' );
		}
		if ( null !== $existing_id ) {
			if ( false === $wpdb->query( 'COMMIT' ) ) { // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
				return $this->fail_enqueue( __( 'The event spool could not commit an idempotent event.', 'honeypot-ai' ), 'honeypot_ai_queue_commit' );
			}
			return true;
		}

		$inserted = $wpdb->insert(
			$table,
			array(
				'idempotency_key' => $idempotency_key,
				'payload'         => $json,
				'payload_bytes'   => $payload_bytes,
				'available_at'    => $now,
				'created_at'      => $now,
			),
			array( '%s', '%s', '%d', '%s', '%s' )
		);
		if ( 1 !== (int) $inserted ) {
			return $this->fail_enqueue( __( 'The event spool could not persist an event.', 'honeypot-ai' ), 'honeypot_ai_queue_insert' );
		}

		$next_rows      = (int) $state['rows'] + 1;
		$next_bytes     = (int) $state['bytes'] + $payload_bytes;
		$eviction_ids   = array();
		$eviction_bytes = 0;
		if ( $next_rows > self::MAX_QUEUE || $next_bytes > self::MAX_QUEUE_BYTES ) {
			$rows = $wpdb->get_results(
				$wpdb->prepare(
					"SELECT id, payload_bytes FROM {$table} WHERE claim_token IS NULL OR claimed_until IS NULL OR claimed_until < %s ORDER BY id ASC LIMIT " . ( self::MAX_QUEUE + 1 ) . ' FOR UPDATE',
					$now
				),
				ARRAY_A
			); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
			if ( ! is_array( $rows ) ) {
				return $this->fail_enqueue( __( 'The event spool could not inspect its capacity.', 'honeypot-ai' ), 'honeypot_ai_queue_capacity' );
			}
			$eviction_ids = $this->capacity_eviction_ids( $rows, $next_rows, $next_bytes );
			foreach ( $rows as $row ) {
				if ( in_array( (int) $row['id'], $eviction_ids, true ) ) {
					$eviction_bytes += max( 0, (int) $row['payload_bytes'] );
				}
			}
			if ( $eviction_ids ) {
				$placeholders = implode( ',', array_fill( 0, count( $eviction_ids ), '%d' ) );
				$deleted      = $wpdb->query( $wpdb->prepare( "DELETE FROM {$table} WHERE id IN ({$placeholders})", $eviction_ids ) ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared,WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare -- Placeholder count is generated from integer IDs.
				if ( false === $deleted || count( $eviction_ids ) !== (int) $deleted ) {
					return $this->fail_enqueue( __( 'The event spool could not enforce its capacity.', 'honeypot-ai' ), 'honeypot_ai_queue_capacity' );
				}
				$next_rows -= (int) $deleted;
				$next_bytes = max( 0, $next_bytes - $eviction_bytes );
			}
		}
		if ( $next_rows > self::MAX_QUEUE || $next_bytes > self::MAX_QUEUE_BYTES ) {
			return $this->fail_enqueue( __( 'The event spool remains above its capacity.', 'honeypot-ai' ), 'honeypot_ai_queue_capacity' );
		}

		$next_drops = (int) $state['drops'] + count( $eviction_ids );
		if ( ! $this->write_locked_queue_state( $next_rows, $next_bytes, $next_drops ) || false === $wpdb->query( 'COMMIT' ) ) { // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
			return $this->fail_enqueue( __( 'The event spool could not commit an event.', 'honeypot-ai' ), 'honeypot_ai_queue_commit' );
		}
		return true;
	}

	public function queue_depth() {
		$stats = $this->queue_stats();
		return $stats['rows'];
	}

	public function queue_bytes() {
		$stats = $this->queue_stats();
		return $stats['bytes'];
	}

	public function queue_stats() {
		global $wpdb;
		$row = $wpdb->get_row(
			'SELECT row_count, payload_bytes FROM ' . self::queue_state_table_name() . ' WHERE singleton_id = 1',
			ARRAY_A
		); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		return array(
			'rows'  => isset( $row['row_count'] ) ? (int) $row['row_count'] : 0,
			'bytes' => isset( $row['payload_bytes'] ) ? (int) $row['payload_bytes'] : 0,
		);
	}

	public function dropped_events() {
		global $wpdb;
		$value = $wpdb->get_var( 'SELECT dropped_events FROM ' . self::queue_state_table_name() . ' WHERE singleton_id = 1' ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		return max( 0, (int) $value, (int) get_option( self::OPTION_DROPPED_EVENTS, 0 ) );
	}

	public function claim_pending( $limit = 100, $lease_seconds = 60 ) {
		global $wpdb;
		$table         = self::table_name();
		$limit         = max( 1, min( 500, (int) $limit ) );
		$lease_seconds = max( 15, min( 300, (int) $lease_seconds ) );
		try {
			$token = bin2hex( random_bytes( 16 ) );
		} catch ( Exception $exception ) {
			$this->record_error( $exception->getMessage(), 'honeypot_ai_queue_claim_token' );
			return false;
		}
		$now           = current_time( 'mysql', true );
		$claimed_until = gmdate( 'Y-m-d H:i:s', time() + $lease_seconds );
		if ( false === $wpdb->query( 'START TRANSACTION' ) ) { // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
			return false;
		}
		$claimed = $wpdb->query(
			$wpdb->prepare(
				"UPDATE {$table} SET claim_token = %s, claimed_until = %s
            WHERE available_at <= %s AND (claim_token IS NULL OR claimed_until IS NULL OR claimed_until < %s)
            ORDER BY id ASC LIMIT %d",
				$token,
				$claimed_until,
				$now,
				$now,
				$limit
			)
		); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		if ( false === $claimed ) {
			$wpdb->query( 'ROLLBACK' ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
			return false;
		}
		if ( 0 === (int) $claimed ) {
			$wpdb->query( 'COMMIT' ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
			return array(
				'token' => $token,
				'items' => array(),
			);
		}
		$rows = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT id, payload FROM {$table} WHERE claim_token = %s ORDER BY id ASC",
				$token
			),
			ARRAY_A
		); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		if ( ! is_array( $rows ) || count( $rows ) !== (int) $claimed ) {
			$wpdb->query( 'ROLLBACK' ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
			return false;
		}
		$items = array();
		foreach ( (array) $rows as $row ) {
			$event = json_decode( $row['payload'], true );
			if ( ! is_array( $event ) ) {
				$wpdb->query( 'ROLLBACK' ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
				$this->record_error( __( 'The event spool contains an invalid payload.', 'honeypot-ai' ), 'honeypot_ai_queue_payload' );
				return false;
			}
			$items[] = array(
				'row_id' => (int) $row['id'],
				'event'  => $event,
			);
		}
		if ( false === $wpdb->query( 'COMMIT' ) ) { // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
			$wpdb->query( 'ROLLBACK' ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
			return false;
		}
		return array(
			'token' => $token,
			'items' => $items,
		);
	}

	public function delete_claimed_rows( $token ) {
		global $wpdb;
		$token = strtolower( (string) $token );
		if ( ! preg_match( '/^[a-f0-9]{32}$/', $token ) ) {
			return 0;
		}
		if ( false === $wpdb->query( 'START TRANSACTION' ) ) { // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
			return 0;
		}
		$state = $this->lock_queue_state();
		if ( false === $state ) {
			$wpdb->query( 'ROLLBACK' ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
			return 0;
		}
		$table = self::table_name();
		$rows  = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT id, payload_bytes FROM {$table} WHERE claim_token = %s FOR UPDATE",
				$token
			),
			ARRAY_A
		); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		if ( ! is_array( $rows ) || ! $rows ) {
			$wpdb->query( 'COMMIT' ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
			return 0;
		}
		$deleted = $wpdb->query( $wpdb->prepare( "DELETE FROM {$table} WHERE claim_token = %s", $token ) ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		if ( false === $deleted || count( $rows ) !== (int) $deleted ) {
			$wpdb->query( 'ROLLBACK' ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
			return 0;
		}
		$deleted_bytes = array_sum( array_map( 'intval', wp_list_pluck( $rows, 'payload_bytes' ) ) );
		$next_rows     = max( 0, (int) $state['rows'] - (int) $deleted );
		$next_bytes    = max( 0, (int) $state['bytes'] - $deleted_bytes );
		if ( ! $this->write_locked_queue_state( $next_rows, $next_bytes, (int) $state['drops'] ) || false === $wpdb->query( 'COMMIT' ) ) { // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
			$wpdb->query( 'ROLLBACK' ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
			return 0;
		}
		return max( 0, (int) $deleted );
	}

	public function retry_claim( $token, $delay_seconds = 30 ) {
		global $wpdb;
		$token = strtolower( (string) $token );
		if ( ! preg_match( '/^[a-f0-9]{32}$/', $token ) ) {
			return 0;
		}
		$delay_seconds = max( 1, min( 60, (int) $delay_seconds ) );
		return $wpdb->query(
			$wpdb->prepare(
				'UPDATE ' . self::table_name() . ' SET attempts = attempts + 1, available_at = %s, claim_token = NULL, claimed_until = NULL WHERE claim_token = %s',
				gmdate( 'Y-m-d H:i:s', time() + $delay_seconds ),
				$token
			)
		); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
	}

	public function increment_rate_limit( $bucket_key, $expires_at ) {
		global $wpdb;
		$table      = self::rate_limit_table_name();
		$bucket_key = substr( preg_replace( '/[^a-f0-9]/', '', strtolower( (string) $bucket_key ) ), 0, 64 );
		if ( 64 !== strlen( $bucket_key ) ) {
			return false;
		}
		$now    = current_time( 'mysql', true );
		$result = $wpdb->query(
			$wpdb->prepare(
				"INSERT INTO {$table} (bucket_key, hit_count, expires_at, updated_at) VALUES (%s, LAST_INSERT_ID(1), %s, %s)
            ON DUPLICATE KEY UPDATE hit_count = LAST_INSERT_ID(hit_count + 1), expires_at = VALUES(expires_at), updated_at = VALUES(updated_at)",
				$bucket_key,
				gmdate( 'Y-m-d H:i:s', (int) $expires_at ),
				$now
			)
		); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		if ( false === $result ) {
			return false;
		}
		// LAST_INSERT_ID(expr) is connection-scoped, so every concurrent request
		// receives the value produced by its own atomic increment rather than a
		// later request's count from a separate row SELECT.
		return (int) $wpdb->get_var( 'SELECT LAST_INSERT_ID()' );
	}

	public function cleanup_rate_limits() {
		global $wpdb;
		$table = self::rate_limit_table_name();
		return $wpdb->query(
			$wpdb->prepare(
				"DELETE FROM {$table} WHERE expires_at < %s",
				current_time( 'mysql', true )
			)
		); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
	}

	/**
	 * Record a distinct honeypot route for an opaque source hash.
	 *
	 * Raw addresses never enter either local automation table.
	 *
	 * @param string $source_hash    Keyed hash of the visitor source.
	 * @param string $route_hash     Keyed hash of the honeypot route.
	 * @param int    $window_seconds Distinct-route observation window.
	 * @param int    $block_seconds  Local block duration.
	 * @param int    $threshold      Required distinct-route count.
	 * @return array|false Automation state, or false when persistence fails.
	 */
	public function record_honeypot_route_hit( $source_hash, $route_hash, $window_seconds, $block_seconds, $threshold ) {
		global $wpdb;
		$source_hash = strtolower( (string) $source_hash );
		$route_hash  = strtolower( (string) $route_hash );
		if ( ! preg_match( '/^[a-f0-9]{64}$/', $source_hash ) || ! preg_match( '/^[a-f0-9]{64}$/', $route_hash ) ) {
			return false;
		}
		$window_seconds = max( 60, min( 86400, (int) $window_seconds ) );
		$block_seconds  = max( 60, min( 604800, (int) $block_seconds ) );
		$threshold      = max( 2, min( 50, (int) $threshold ) );
		$now            = current_time( 'mysql', true );
		$route_expires  = gmdate( 'Y-m-d H:i:s', time() + $window_seconds );
		$blocked_until  = gmdate( 'Y-m-d H:i:s', time() + $block_seconds );
		$hits_table     = self::honeypot_hits_table_name();
		$blocks_table   = self::auto_blocks_table_name();

		if ( false === $wpdb->query( 'START TRANSACTION' ) ) { // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
			return false;
		}
		$existing_block = $wpdb->get_var(
			$wpdb->prepare(
				"SELECT blocked_until FROM {$blocks_table} WHERE source_hash = %s FOR UPDATE",
				$source_hash
			)
		); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$was_blocked    = $existing_block && strtotime( $existing_block ) > time();
		$recorded       = $wpdb->query(
			$wpdb->prepare(
				"INSERT INTO {$hits_table} (source_hash, route_hash, seen_at, expires_at) VALUES (%s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE seen_at = VALUES(seen_at), expires_at = VALUES(expires_at)",
				$source_hash,
				$route_hash,
				$now,
				$route_expires
			)
		); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		if ( false === $recorded ) {
			$wpdb->query( 'ROLLBACK' ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
			return false;
		}
		$distinct  = (int) $wpdb->get_var(
			$wpdb->prepare(
				"SELECT COUNT(*) FROM {$hits_table} WHERE source_hash = %s AND expires_at > %s",
				$source_hash,
				$now
			)
		); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$activated = false;
		if ( $distinct >= $threshold ) {
			$stored = $wpdb->query(
				$wpdb->prepare(
					"INSERT INTO {$blocks_table} (source_hash, blocked_until, created_at) VALUES (%s, %s, %s)
                    ON DUPLICATE KEY UPDATE blocked_until = GREATEST(blocked_until, VALUES(blocked_until))",
					$source_hash,
					$blocked_until,
					$now
				)
			); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
			if ( false === $stored ) {
				$wpdb->query( 'ROLLBACK' ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
				return false;
			}
			$activated = ! $was_blocked;
		} else {
			$blocked_until = $was_blocked ? $existing_block : null;
		}
		if ( false === $wpdb->query( 'COMMIT' ) ) { // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
			$wpdb->query( 'ROLLBACK' ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
			return false;
		}
		return array(
			'distinct_routes' => $distinct,
			'activated'       => $activated,
			'blocked_until'   => $blocked_until,
		);
	}

	public function auto_blocked_until( $source_hash ) {
		global $wpdb;
		$source_hash = strtolower( (string) $source_hash );
		if ( ! preg_match( '/^[a-f0-9]{64}$/', $source_hash ) ) {
			return false;
		}
		$value = $wpdb->get_var(
			$wpdb->prepare(
				'SELECT blocked_until FROM ' . self::auto_blocks_table_name() . ' WHERE source_hash = %s LIMIT 1',
				$source_hash
			)
		); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		return $value && strtotime( $value ) > time() ? (string) $value : false;
	}

	public function cleanup_security_buckets() {
		global $wpdb;
		$now = current_time( 'mysql', true );
		$wpdb->query( $wpdb->prepare( 'DELETE FROM ' . self::honeypot_hits_table_name() . ' WHERE expires_at < %s', $now ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		return $wpdb->query( $wpdb->prepare( 'DELETE FROM ' . self::auto_blocks_table_name() . ' WHERE blocked_until < %s', $now ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
	}

	private function policy_record_valid( $record ) {
		if ( ! is_array( $record ) || ! isset( $record['document'] ) || ! is_array( $record['document'] ) ) {
			return false;
		}
		// Accept legacy records once; all new writes include and verify a hash.
		if ( empty( $record['source_hash'] ) ) {
			return true;
		}
		$encoded = wp_json_encode( $record['document'], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE );
		return false !== $encoded && preg_match( '/^[a-f0-9]{64}$/', (string) $record['source_hash'] ) && hash_equals( (string) $record['source_hash'], hash( 'sha256', $encoded ) );
	}

	private function policy_record_is_newer( $candidate, $current ) {
		$candidate_version = isset( $candidate['document']['version'] ) ? (int) $candidate['document']['version'] : 0;
		$current_version   = isset( $current['document']['version'] ) ? (int) $current['document']['version'] : 0;
		if ( $candidate_version !== $current_version ) {
			return $candidate_version > $current_version;
		}
		return strtotime( isset( $candidate['stored_at'] ) ? $candidate['stored_at'] : '' ) > strtotime( isset( $current['stored_at'] ) ? $current['stored_at'] : '' );
	}

	private function lock_queue_state() {
		global $wpdb;
		$state_table = self::queue_state_table_name();
		$row         = $wpdb->get_row(
			"SELECT row_count, payload_bytes, dropped_events FROM {$state_table} WHERE singleton_id = 1 FOR UPDATE",
			ARRAY_A
		); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		if ( is_array( $row ) ) {
			$legacy_drops     = max( 0, (int) get_option( self::OPTION_DROPPED_EVENTS, 0 ) );
			$reconciled_drops = max( (int) $row['dropped_events'], $legacy_drops );
			if ( $reconciled_drops !== (int) $row['dropped_events'] ) {
				$updated = $wpdb->query(
					$wpdb->prepare(
						"UPDATE {$state_table} SET dropped_events = %d, updated_at = %s WHERE singleton_id = 1",
						$reconciled_drops,
						current_time( 'mysql', true )
					)
				); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
				if ( false === $updated ) {
					return false;
				}
			}
			return array(
				'rows'  => max( 0, (int) $row['row_count'] ),
				'bytes' => max( 0, (int) $row['payload_bytes'] ),
				'drops' => $reconciled_drops,
			);
		}
		if ( '' !== $wpdb->last_error ) {
			return false;
		}
		$events_table = self::table_name();
		$stats        = $wpdb->get_row(
			"SELECT COUNT(*) AS row_count, COALESCE(SUM(payload_bytes), 0) AS payload_bytes FROM {$events_table}",
			ARRAY_A
		); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		if ( ! is_array( $stats ) ) {
			return false;
		}
		$drops    = max( 0, (int) get_option( self::OPTION_DROPPED_EVENTS, 0 ) );
		$inserted = $wpdb->query(
			$wpdb->prepare(
				"INSERT INTO {$state_table} (singleton_id, row_count, payload_bytes, dropped_events, updated_at) VALUES (1, %d, %d, %d, %s)",
				(int) $stats['row_count'],
				(int) $stats['payload_bytes'],
				$drops,
				current_time( 'mysql', true )
			)
		); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		if ( 1 !== (int) $inserted ) {
			return false;
		}
		return array(
			'rows'  => max( 0, (int) $stats['row_count'] ),
			'bytes' => max( 0, (int) $stats['payload_bytes'] ),
			'drops' => $drops,
		);
	}

	private function write_locked_queue_state( $rows, $bytes, $drops ) {
		global $wpdb;
		$updated = $wpdb->query(
			$wpdb->prepare(
				'UPDATE ' . self::queue_state_table_name() . ' SET row_count = %d, payload_bytes = %d, dropped_events = %d, updated_at = %s WHERE singleton_id = 1',
				max( 0, (int) $rows ),
				max( 0, (int) $bytes ),
				max( 0, (int) $drops ),
				current_time( 'mysql', true )
			)
		); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		return false !== $updated;
	}

	private function fail_enqueue( $message, $code, $rollback = true ) {
		global $wpdb;
		if ( $rollback ) {
			$wpdb->query( 'ROLLBACK' ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
		}
		$this->increment_dropped_events( 1 );
		$this->record_error( $message, $code );
		return false;
	}

	private function increment_dropped_events( $count ) {
		global $wpdb;
		$count = max( 0, (int) $count );
		if ( 0 === $count ) {
			return true;
		}
		if ( false !== $wpdb->query( 'START TRANSACTION' ) ) { // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
			$state = $this->lock_queue_state();
			if ( false !== $state && $this->write_locked_queue_state( $state['rows'], $state['bytes'], $state['drops'] + $count ) && false !== $wpdb->query( 'COMMIT' ) ) { // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
				return true;
			}
			$wpdb->query( 'ROLLBACK' ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
		}

		// Retain a fail-safe legacy counter for schema/bootstrap failures.
		$updated = $wpdb->query(
			$wpdb->prepare(
				"UPDATE {$wpdb->options} SET option_value = CAST(option_value AS UNSIGNED) + %d WHERE option_name = %s",
				$count,
				self::OPTION_DROPPED_EVENTS
			)
		); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		if ( 0 === (int) $updated ) {
			add_option( self::OPTION_DROPPED_EVENTS, (string) $count, '', false );
		}
		wp_cache_delete( self::OPTION_DROPPED_EVENTS, 'options' );
		return false !== $updated;
	}

	private function capacity_eviction_ids( $rows, $count = null, $bytes = null ) {
		if ( null === $count ) {
			$count = count( $rows );
		}
		if ( null === $bytes ) {
			$bytes = 0;
			foreach ( $rows as $row ) {
				$bytes += max( 0, (int) $row['payload_bytes'] );
			}
		}
		$ids = array();
		foreach ( $rows as $row ) {
			if ( $count <= self::MAX_QUEUE && $bytes <= self::MAX_QUEUE_BYTES ) {
				break;
			}
			$ids[] = (int) $row['id'];
			--$count;
			$bytes -= max( 0, (int) $row['payload_bytes'] );
		}
		return $ids;
	}
}
