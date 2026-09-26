<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Honeypot_AI_Agent {

	const MAX_BATCHES_PER_SEND = 20;
	const POLICY_SYNC_LOCK     = 'honeypot_ai_policy_sync_lock';

	private $storage;
	private $transport;
	private $policy;

	public function __construct( Honeypot_AI_Storage $storage, Honeypot_AI_Transport $transport, Honeypot_AI_Policy $policy ) {
		$this->storage   = $storage;
		$this->transport = $transport;
		$this->policy    = $policy;
	}

	public function register_hooks() {
		add_filter( 'cron_schedules', array( $this, 'cron_schedules' ) ); // phpcs:ignore WordPress.WP.CronInterval.CronSchedulesInterval -- Signed policy sync and security heartbeats require bounded custom intervals.
		add_action( 'init', array( $this, 'ensure_schedule' ) );
		add_action( 'honeypot_ai_agent_tick', array( $this, 'tick' ) );
		add_action( 'honeypot_ai_policy_sync', array( $this, 'sync_policy' ) );
		add_action( 'honeypot_ai_send_queue', array( $this, 'send_queue' ) );
	}

	public static function deactivate() {
		wp_clear_scheduled_hook( 'honeypot_ai_agent_tick' );
		wp_clear_scheduled_hook( 'honeypot_ai_policy_sync' );
		wp_clear_scheduled_hook( 'honeypot_ai_send_queue' );
		delete_transient( self::POLICY_SYNC_LOCK );
		flush_rewrite_rules( false );
	}

	public function cron_schedules( $schedules ) {
		$schedules['honeypot_ai_one_minute']   = array(
			'interval' => 60,
			'display'  => __( 'Every minute (SmartHoneyAI policy sync)', 'honeypot-ai' ),
		);
		$schedules['honeypot_ai_five_minutes'] = array(
			'interval' => 300,
			'display'  => __( 'Every five minutes (SmartHoneyAI)', 'honeypot-ai' ),
		);
		return $schedules;
	}

	public function ensure_schedule() {
		if ( $this->storage->is_enrolled() ) {
			Honeypot_AI_Storage::schedule_events();
		}
	}

	public function tick() {
		if ( ! $this->storage->is_enrolled() ) {
			return;
		}
		$this->storage->cleanup_rate_limits();
		$this->storage->cleanup_security_buckets();
		$this->send_queue();
		$this->sync_policy();
		$this->heartbeat();
	}

	public function sync_policy() {
		if ( ! $this->storage->is_enrolled() || false !== get_transient( self::POLICY_SYNC_LOCK ) ) {
			return;
		}
		set_transient( self::POLICY_SYNC_LOCK, '1', 55 );
		try {
			$this->poll_config();
		} finally {
			delete_transient( self::POLICY_SYNC_LOCK );
		}
	}

	public function schedule_queue_delivery( $delay_seconds = 10 ) {
		$delay_seconds = max( 1, min( 60, (int) $delay_seconds ) );
		if ( ! wp_next_scheduled( 'honeypot_ai_send_queue' ) ) {
			wp_schedule_single_event( time() + $delay_seconds, 'honeypot_ai_send_queue' );
		}
	}

	public function send_queue() {
		if ( ! $this->storage->is_enrolled() ) {
			return;
		}
		$credentials = $this->storage->credentials();
		for ( $batch = 0; $batch < self::MAX_BATCHES_PER_SEND; ++$batch ) {
			// 25 maximum-sized events remain below the API's 1 MiB uncompressed limit.
			$claim = $this->storage->claim_pending( 25, 120 );
			if ( false === $claim ) {
				$this->storage->record_error( __( 'The event spool could not claim a delivery batch.', 'honeypot-ai' ), 'honeypot_ai_queue_claim' );
				$this->schedule_queue_delivery();
				return;
			}
			$pending = $claim['items'];
			if ( ! $pending ) {
				return;
			}
			$events    = wp_list_pluck( $pending, 'event' );
			$batch_key = 'batch-' . hash( 'sha256', implode( '|', wp_list_pluck( $events, 'idempotencyKey' ) ) );
			$response  = $this->transport->signed_request(
				'POST',
				'/v1/agent/events/batch',
				array(
					'siteId'        => $credentials['site_id'],
					'pluginVersion' => HONEYPOT_AI_VERSION,
					'events'        => $events,
				),
				array( 'Idempotency-Key' => $batch_key )
			);

			if ( is_wp_error( $response ) ) {
				$this->storage->retry_claim( $claim['token'], 10 );
				$this->storage->record_error( $response->get_error_message(), $response->get_error_code() );
				$this->schedule_queue_delivery( 10 );
				return;
			}
			$deleted = $this->storage->delete_claimed_rows( $claim['token'] );
			if ( count( $pending ) !== $deleted ) {
				$this->storage->retry_claim( $claim['token'], 10 );
				$this->storage->record_error( __( 'The delivered event batch could not be removed from the local spool.', 'honeypot-ai' ), 'honeypot_ai_queue_delete' );
				$this->schedule_queue_delivery();
				return;
			}
		}
		if ( $this->storage->queue_depth() > 0 ) {
			$this->schedule_queue_delivery();
		}
	}

	public function poll_config() {
		$previous_honeypot_hash = $this->policy->honeypot_config_hash();
		$stored                 = $this->storage->policy();
		$headers                = array();
		if ( ! empty( $stored['etag'] ) ) {
			$headers['If-None-Match'] = $stored['etag'];
		}
		$response = $this->transport->signed_request( 'GET', '/v1/agent/config', null, $headers );
		if ( is_wp_error( $response ) ) {
			$this->storage->record_error( $response->get_error_message(), $response->get_error_code() );
			return;
		}
		if ( 304 === $response['status'] ) {
			return;
		}
		$body   = $response['body'];
		$policy = isset( $body['policy'] ) && is_array( $body['policy'] ) ? $body['policy'] : $body;
		$etag   = '';
		if ( isset( $response['headers']['etag'] ) ) {
			$etag = (string) $response['headers']['etag'];
		}
		$result = $this->policy->validate_and_store( $policy, $etag );
		if ( is_wp_error( $result ) ) {
			$this->storage->record_error( $result->get_error_message(), $result->get_error_code() );
			$this->ack_policy( isset( $policy['version'] ) ? (int) $policy['version'] : 0, 'REJECTED', $result->get_error_message() );
			return;
		}
		if ( ! hash_equals( $previous_honeypot_hash, $this->policy->honeypot_config_hash() ) ) {
			Honeypot_AI_Honeypots::refresh_rewrite_rules();
		}
		$this->ack_policy( (int) $policy['version'], 'APPLIED', null );
	}

	public function heartbeat() {
		$queue_depth    = $this->storage->queue_depth();
		$last_error     = $this->storage->last_error( true );
		$health         = $queue_depth > 5000 || $last_error ? 'DEGRADED' : 'HEALTHY';
		$enabled_decoys = array();
		foreach ( $this->policy->honeypots() as $honeypot ) {
			if ( ! empty( $honeypot['enabled'] ) && ! empty( $honeypot['key'] ) ) {
				$enabled_decoys[] = sanitize_key( (string) $honeypot['key'] );
			}
		}
		$enabled_decoys = array_values( array_slice( array_unique( $enabled_decoys ), 0, 200 ) );
		$body           = array(
			'pluginVersion' => HONEYPOT_AI_VERSION,
			'queueDepth'    => min( Honeypot_AI_Storage::MAX_QUEUE, $queue_depth ),
			'policyVersion' => $this->policy->version(),
			'mode'          => $this->policy->effective_mode(),
			'health'        => $health,
			'enabledDecoys' => $enabled_decoys,
			'droppedEvents' => min( 2147483647, $this->storage->dropped_events() ),
			'lastErrorCode' => $last_error && isset( $last_error['code'] ) ? substr( (string) $last_error['code'], 0, 64 ) : null,
		);
		$response       = $this->transport->signed_request( 'POST', '/v1/agent/heartbeat', $body );
		if ( is_wp_error( $response ) ) {
			$this->storage->record_error( $response->get_error_message(), $response->get_error_code() );
			return;
		}
		$this->storage->record_heartbeat_success( $health, isset( $response['body'] ) && is_array( $response['body'] ) ? $response['body'] : array() );
	}

	private function ack_policy( $version, $status, $message ) {
		$body = array(
			'version' => (int) $version,
			'status'  => $status,
		);
		if ( null !== $message ) {
			$body['message'] = substr( (string) $message, 0, 500 );
		}
		$response = $this->transport->signed_request( 'POST', '/v1/agent/config/ack', $body );
		if ( is_wp_error( $response ) ) {
			$this->storage->record_error( $response->get_error_message(), $response->get_error_code() );
		}
	}
}
