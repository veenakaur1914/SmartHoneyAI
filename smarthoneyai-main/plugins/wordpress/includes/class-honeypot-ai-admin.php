<?php

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Honeypot_AI_Admin {

	private $storage;
	private $transport;
	private $agent;
	private $policy;

	public function __construct( Honeypot_AI_Storage $storage, Honeypot_AI_Transport $transport, Honeypot_AI_Agent $agent, Honeypot_AI_Policy $policy ) {
		$this->storage   = $storage;
		$this->transport = $transport;
		$this->agent     = $agent;
		$this->policy    = $policy;
	}

	public function register_hooks() {
		add_action( 'admin_menu', array( $this, 'admin_menu' ) );
		add_action( 'admin_post_honeypot_ai_enroll', array( $this, 'enroll' ) );
		add_action( 'admin_post_honeypot_ai_save', array( $this, 'save' ) );
		add_action( 'admin_post_honeypot_ai_disconnect', array( $this, 'disconnect' ) );
		add_action( 'admin_post_honeypot_ai_sync', array( $this, 'sync' ) );
		add_action( 'admin_enqueue_scripts', array( $this, 'enqueue_assets' ) );
		add_filter( 'plugin_action_links_' . HONEYPOT_AI_BASENAME, array( $this, 'action_links' ) );
	}

	public function enqueue_assets( $hook ) {
		if ( 'settings_page_honeypot-ai' !== $hook ) {
			return;
		}
		wp_enqueue_style( 'honeypot-ai-admin', HONEYPOT_AI_URL . 'assets/admin.css', array(), HONEYPOT_AI_VERSION );
	}

	public function admin_menu() {
		add_options_page(
			__( 'SmartHoneyAI', 'honeypot-ai' ),
			__( 'SmartHoneyAI', 'honeypot-ai' ),
			'manage_options',
			'honeypot-ai',
			array( $this, 'render' )
		);
	}

	public function action_links( $links ) {
		array_unshift( $links, '<a href="' . esc_url( admin_url( 'options-general.php?page=honeypot-ai' ) ) . '">' . esc_html__( 'Settings', 'honeypot-ai' ) . '</a>' );
		return $links;
	}

	public function enroll() {
		$this->authorize( 'honeypot_ai_enroll' );
		if ( ! function_exists( 'sodium_crypto_sign_verify_detached' ) ) {
			$this->redirect( 'error', __( 'Enrollment stopped: PHP Sodium is required to verify signed policies. Ask your hosting provider to enable the sodium extension, then try again.', 'honeypot-ai' ) );
		}
		$api_url = isset( $_POST['api_url'] ) ? esc_url_raw( wp_unslash( $_POST['api_url'] ) ) : '';
		$token   = isset( $_POST['enrollment_token'] ) ? trim( sanitize_text_field( wp_unslash( $_POST['enrollment_token'] ) ) ) : '';
		if ( strlen( $token ) < 32 ) {
			$this->redirect( 'error', __( 'Enrollment token is invalid.', 'honeypot-ai' ) );
		}
		$settings            = $this->storage->settings();
		$settings['api_url'] = untrailingslashit( $api_url );
		update_option( Honeypot_AI_Storage::OPTION_SETTINGS, $settings, false );
		$response = $this->transport->enroll( $settings['api_url'], $token );
		if ( is_wp_error( $response ) ) {
			$this->redirect( 'error', $response->get_error_message() );
		}
		$body       = $response['body'];
		$credential = isset( $body['credential'] ) && is_array( $body['credential'] ) ? $body['credential'] : $body;
		$site_id    = isset( $body['siteId'] ) ? $body['siteId'] : ( isset( $credential['siteId'] ) ? $credential['siteId'] : '' );
		$key_id     = isset( $body['keyId'] ) ? $body['keyId'] : ( isset( $credential['keyId'] ) ? $credential['keyId'] : '' );
		$secret     = isset( $body['secret'] ) ? $body['secret'] : ( isset( $credential['secret'] ) ? $credential['secret'] : '' );
		$public_key = isset( $body['policyPublicKey'] ) ? $body['policyPublicKey'] : ( isset( $credential['policyPublicKey'] ) ? $credential['policyPublicKey'] : '' );
		if ( ! $site_id || ! $key_id || strlen( (string) $secret ) < 32 || ! $public_key ) {
			$this->redirect( 'error', __( 'Enrollment response omitted required credentials or policy public key.', 'honeypot-ai' ) );
		}
		$this->storage->save_credentials(
			array(
				'site_id'           => sanitize_text_field( $site_id ),
				'key_id'            => sanitize_text_field( $key_id ),
				'secret'            => (string) $secret,
				'policy_public_key' => (string) $public_key,
				'enrolled_at'       => gmdate( 'c' ),
				'deployment_type'   => isset( $body['deploymentType'] ) && 'DOCKER' === $body['deploymentType'] ? 'DOCKER' : 'NORMAL_HOSTING',
			)
		);
		Honeypot_AI_Storage::schedule_events();
		$this->agent->sync_policy();
		$this->agent->heartbeat();
		$this->redirect( 'success', __( 'Site enrolled successfully.', 'honeypot-ai' ) );
	}

	public function save() {
		$this->authorize( 'honeypot_ai_save' );
		$settings = $this->storage->settings();
		if ( ! $this->storage->is_enrolled() && isset( $_POST['api_url'] ) ) {
			$settings['api_url'] = untrailingslashit( esc_url_raw( wp_unslash( $_POST['api_url'] ) ) );
		}
		update_option( Honeypot_AI_Storage::OPTION_SETTINGS, $settings, false );
		update_option( Honeypot_AI_Storage::OPTION_DELETE_DATA, ! empty( $_POST['delete_data'] ) ? 'yes' : 'no', false );
		$this->redirect( 'success', __( 'Settings saved.', 'honeypot-ai' ) );
	}

	public function disconnect() {
		$this->authorize( 'honeypot_ai_disconnect' );
		$this->storage->disconnect();
		wp_clear_scheduled_hook( 'honeypot_ai_agent_tick' );
		wp_clear_scheduled_hook( 'honeypot_ai_policy_sync' );
		delete_transient( Honeypot_AI_Agent::POLICY_SYNC_LOCK );
		$this->redirect( 'success', __( 'This site has been disconnected locally. Revoke its credential in the SmartHoneyAI dashboard as well.', 'honeypot-ai' ) );
	}

	public function sync() {
		$this->authorize( 'honeypot_ai_sync' );
		$this->agent->tick();
		$this->redirect( 'success', __( 'Synchronization attempted. Review the status below.', 'honeypot-ai' ) );
	}

	public function render() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}
		$settings       = $this->storage->settings();
		$credentials    = $this->storage->credentials();
		$policy         = $this->storage->policy();
		$queue          = $this->storage->queue_stats();
		$agent_status   = $this->storage->agent_status();
		$last_error     = $this->storage->last_error();
		$connection     = $this->storage->is_enrolled() ? $this->storage->connection_status() : 'NOT ENROLLED';
		$policy_expires = isset( $policy['document']['expiresAt'] ) ? $policy['document']['expiresAt'] : '';
		$heartbeat_at   = isset( $agent_status['last_heartbeat_at'] ) ? $this->malaysia_time( $agent_status['last_heartbeat_at'] ) : '—';
		$policy_expires = $policy_expires ? $this->malaysia_time( $policy_expires ) : '';
		$last_error_at  = $last_error && isset( $last_error['at'] ) ? $this->malaysia_time( $last_error['at'] ) : '—';
		$honeypots      = $this->policy->honeypots();
		$enabled_decoys = array_values(
			array_filter(
				$honeypots,
				function ( $honeypot ) {
					return ! empty( $honeypot['enabled'] );
				}
			)
		);
		$auto_block     = $this->policy->auto_block_config();
		$deployment     = isset( $credentials['deployment_type'] ) ? $credentials['deployment_type'] : 'NORMAL_HOSTING';
		$paired_sensor  = isset( $agent_status['paired_network_sensor'] ) && is_array( $agent_status['paired_network_sensor'] ) ? $agent_status['paired_network_sensor'] : array();
		$sodium_ready   = function_exists( 'sodium_crypto_sign_verify_detached' );
		$https_ready    = empty( $settings['api_url'] ) || 0 === strpos( $settings['api_url'], 'https://' );
		$external_cron  = defined( 'HONEYPOT_AI_EXTERNAL_CRON' ) && HONEYPOT_AI_EXTERNAL_CRON;
		$cron_ready     = ! defined( 'DISABLE_WP_CRON' ) || ! DISABLE_WP_CRON || $external_cron;
		$links_ready    = '' !== (string) get_option( 'permalink_structure', '' );
		$queue_ready    = is_array( $queue ) && isset( $queue['rows'], $queue['bytes'] );
		$notice         = isset( $_GET['hpa_notice'] ) ? sanitize_key( wp_unslash( $_GET['hpa_notice'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		$message        = isset( $_GET['hpa_message'] ) ? sanitize_text_field( wp_unslash( $_GET['hpa_message'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		?>
		<div class="wrap hpa-wrap">
			<h1><?php esc_html_e( 'SmartHoneyAI Agent', 'honeypot-ai' ); ?></h1>
			<?php if ( $notice && $message ) : ?>
				<div class="notice notice-<?php echo 'error' === $notice ? 'error' : 'success'; ?> is-dismissible"><p><?php echo esc_html( $message ); ?></p></div>
			<?php endif; ?>
			<p class="hpa-lead"><?php esc_html_e( 'Application-layer detection and signed policy enforcement for this WordPress site.', 'honeypot-ai' ); ?></p>
			<div class="hpa-scope"><strong><?php esc_html_e( 'Protection boundary:', 'honeypot-ai' ); ?></strong> <?php esc_html_e( 'blocking protects this WordPress installation only. It is not a hosting firewall. Docker deployments may pair an optional network sensor for detection; OpenCanary never performs blocking.', 'honeypot-ai' ); ?></div>
			<div class="hpa-summary-grid">
				<div class="hpa-card"><span><?php esc_html_e( 'Connection', 'honeypot-ai' ); ?></span><strong><?php echo esc_html( $connection ); ?></strong><small><?php echo esc_html( $heartbeat_at ); ?></small></div>
				<div class="hpa-card"><span><?php esc_html_e( 'Protection', 'honeypot-ai' ); ?></span><strong><?php echo esc_html( $this->policy->effective_mode() ); ?></strong><small><?php echo esc_html( isset( $policy['document']['version'] ) ? 'Policy v' . $policy['document']['version'] : 'No policy yet' ); ?></small></div>
				<div class="hpa-card"><span><?php esc_html_e( 'Telemetry', 'honeypot-ai' ); ?></span><strong><?php echo esc_html( sprintf( '%d queued', $queue['rows'] ) ); ?></strong><small><?php echo esc_html( sprintf( '%d dropped', $this->storage->dropped_events() ) ); ?></small></div>
			</div>
			<h2><?php esc_html_e( 'Readiness checklist', 'honeypot-ai' ); ?></h2>
			<div class="hpa-readiness">
			<?php foreach ( array( array( $sodium_ready, 'PHP Sodium', 'Required for signed policy verification' ), array( $https_ready, 'Outbound HTTPS', 'Required to reach the control plane securely' ), array( $cron_ready, 'WP-Cron / external runner', 'Required for queued upload and policy sync' ), array( $links_ready, 'Pretty permalinks', 'Required for decoy route handling' ), array( $queue_ready, 'Database queue', 'Bounded local telemetry spool is available' ) ) as $check ) : ?>
				<div class="hpa-check <?php echo $check[0] ? 'is-ready' : 'is-blocked'; ?>"><span aria-hidden="true"><?php echo $check[0] ? '✓' : '!'; ?></span><div><strong><?php echo esc_html( $check[1] ); ?></strong><small><?php echo esc_html( $check[2] ); ?></small></div></div>
			<?php endforeach; ?>
			</div>
			<table class="widefat striped hpa-details">
				<tbody>
				<tr><th><?php esc_html_e( 'Connection', 'honeypot-ai' ); ?></th><td><strong><?php echo esc_html( $connection ); ?></strong></td></tr>
				<tr><th><?php esc_html_e( 'Last successful heartbeat', 'honeypot-ai' ); ?></th><td><?php echo esc_html( $heartbeat_at ); ?></td></tr>
				<tr><th><?php esc_html_e( 'Control plane', 'honeypot-ai' ); ?></th><td><?php echo ! empty( $settings['api_url'] ) ? '<code>' . esc_html( $settings['api_url'] ) . '</code>' : '—'; ?></td></tr>
				<tr><th><?php esc_html_e( 'Site ID', 'honeypot-ai' ); ?></th><td><code><?php echo esc_html( isset( $credentials['site_id'] ) ? $credentials['site_id'] : '—' ); ?></code></td></tr>
				<tr><th><?php esc_html_e( 'Deployment package', 'honeypot-ai' ); ?></th><td><?php echo esc_html( 'DOCKER' === $deployment ? 'Docker WordPress + Network Sensor' : 'Normal WordPress Hosting' ); ?></td></tr>
				<?php if ( 'DOCKER' === $deployment ) : ?>
				<tr><th><?php esc_html_e( 'Paired network module', 'honeypot-ai' ); ?></th><td><?php echo $paired_sensor ? esc_html( ( isset( $paired_sensor['name'] ) ? $paired_sensor['name'] : 'Sensor' ) . ' · ' . ( isset( $paired_sensor['status'] ) ? $paired_sensor['status'] : 'UNKNOWN' ) ) : esc_html__( 'Not paired', 'honeypot-ai' ); ?></td></tr>
				<?php endif; ?>
				<tr><th><?php esc_html_e( 'Enabled decoys', 'honeypot-ai' ); ?></th><td><?php echo esc_html( $enabled_decoys ? implode( ', ', wp_list_pluck( $enabled_decoys, 'name' ) ) : 'None' ); ?></td></tr>
				<tr><th><?php esc_html_e( 'Repeat-attacker automation', 'honeypot-ai' ); ?></th><td><?php // translators: 1: distinct route threshold, 2: observation window in minutes, 3: block duration in hours. ?><?php echo ! empty( $auto_block['enabled'] ) ? esc_html( sprintf( __( 'Enabled: %1$d distinct routes in %2$d minutes blocks locally for %3$d hours', 'honeypot-ai' ), (int) $auto_block['distinctRoutes'], (int) $auto_block['windowSeconds'] / 60, (int) $auto_block['blockSeconds'] / 3600 ) ) : esc_html__( 'Disabled', 'honeypot-ai' ); ?></td></tr>
				<tr><th><?php esc_html_e( 'Event spool', 'honeypot-ai' ); ?></th><td><?php echo esc_html( sprintf( '%d / %d events, %s / %s', $queue['rows'], Honeypot_AI_Storage::MAX_QUEUE, size_format( $queue['bytes'], 1 ), size_format( Honeypot_AI_Storage::MAX_QUEUE_BYTES, 0 ) ) ); ?></td></tr>
				<tr><th><?php esc_html_e( 'Dropped events', 'honeypot-ai' ); ?></th><td><?php echo esc_html( (string) $this->storage->dropped_events() ); ?></td></tr>
				<tr><th><?php esc_html_e( 'Policy', 'honeypot-ai' ); ?></th><td><?php echo esc_html( isset( $policy['document']['version'] ) ? 'v' . $policy['document']['version'] : 'None' ); ?> · <?php echo esc_html( $this->policy->effective_mode() ); ?><?php /* translators: %s is the policy expiry timestamp. */ echo $policy_expires ? ' · ' . esc_html( sprintf( __( 'expires %s', 'honeypot-ai' ), $policy_expires ) ) : ''; ?></td></tr>
				<tr><th><?php esc_html_e( 'Last agent error', 'honeypot-ai' ); ?></th><td>
				<?php
				if ( $last_error ) :
					?>
					<code><?php echo esc_html( isset( $last_error['code'] ) ? $last_error['code'] : 'honeypot_ai_error' ); ?></code> — <?php echo esc_html( isset( $last_error['message'] ) ? $last_error['message'] : '' ); ?> (<?php echo ! empty( $last_error['active'] ) ? esc_html__( 'active', 'honeypot-ai' ) : esc_html__( 'resolved', 'honeypot-ai' ); ?>, <?php echo esc_html( $last_error_at ); ?>)
					<?php
else :
	?>
					—<?php endif; ?></td></tr>
				</tbody>
			</table>

			<?php if ( ! $this->storage->is_enrolled() ) : ?>
				<h2><?php esc_html_e( 'Enroll this site', 'honeypot-ai' ); ?></h2>
				<form action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" method="post">
					<input type="hidden" name="action" value="honeypot_ai_enroll">
					<?php wp_nonce_field( 'honeypot_ai_enroll' ); ?>
					<table class="form-table"><tbody>
					<tr><th><label for="hpa-api-url"><?php esc_html_e( 'Control plane URL', 'honeypot-ai' ); ?></label></th><td><input class="regular-text" id="hpa-api-url" type="url" name="api_url" value="<?php echo esc_attr( $settings['api_url'] ); ?>" placeholder="https://security.example.com" required></td></tr>
					<tr><th><label for="hpa-token"><?php esc_html_e( 'One-time enrollment token', 'honeypot-ai' ); ?></label></th><td><input class="regular-text" id="hpa-token" type="password" name="enrollment_token" minlength="32" autocomplete="off" required><p class="description"><?php esc_html_e( 'The token is sent once and is never stored by WordPress.', 'honeypot-ai' ); ?></p></td></tr>
					</tbody></table>
					<?php submit_button( __( 'Enroll site', 'honeypot-ai' ) ); ?>
				</form>
			<?php else : ?>
				<div class="hpa-actions">
					<form action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" method="post"><input type="hidden" name="action" value="honeypot_ai_sync"><?php wp_nonce_field( 'honeypot_ai_sync' ); ?><?php submit_button( __( 'Sync now', 'honeypot-ai' ), 'primary', 'submit', false ); ?></form>
					<form class="hpa-danger" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" method="post" onsubmit="return confirm('<?php echo esc_js( __( 'Disconnect this site locally?', 'honeypot-ai' ) ); ?>')"><input type="hidden" name="action" value="honeypot_ai_disconnect"><?php wp_nonce_field( 'honeypot_ai_disconnect' ); ?><?php submit_button( __( 'Disconnect', 'honeypot-ai' ), 'delete', 'submit', false ); ?></form>
				</div>
			<?php endif; ?>

			<h2><?php esc_html_e( 'Local settings', 'honeypot-ai' ); ?></h2>
			<p><?php esc_html_e( 'Honeypot routes and repeat-attacker automation are managed in the Professional Security Operations dashboard. The plugin checks for a new verified signed policy every minute and also supports manual synchronization.', 'honeypot-ai' ); ?></p>
			<form action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" method="post">
				<input type="hidden" name="action" value="honeypot_ai_save">
				<?php wp_nonce_field( 'honeypot_ai_save' ); ?>
				<p><label><input type="checkbox" name="delete_data" value="1" <?php checked( 'yes', get_option( Honeypot_AI_Storage::OPTION_DELETE_DATA, 'no' ) ); ?>> <?php esc_html_e( 'Delete plugin settings, credentials, cached policy, and queued events when uninstalling.', 'honeypot-ai' ); ?></label></p>
				<?php submit_button( __( 'Save settings', 'honeypot-ai' ) ); ?>
			</form>
		</div>
		<?php
	}

	private function authorize( $action ) {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'You are not permitted to manage SmartHoneyAI.', 'honeypot-ai' ), '', array( 'response' => 403 ) );
		}
		check_admin_referer( $action );
	}

	private function malaysia_time( $value ) {
		$timestamp = is_numeric( $value ) ? (int) $value : strtotime( (string) $value );
		if ( false === $timestamp ) {
			return '—';
		}
		return wp_date( 'j M Y, g:i:s a', $timestamp, new DateTimeZone( 'Asia/Kuala_Lumpur' ) ) . ' MYT';
	}

	private function redirect( $type, $message ) {
		wp_safe_redirect(
			add_query_arg(
				array(
					'page'        => 'honeypot-ai',
					'hpa_notice'  => $type,
					'hpa_message' => (string) $message,
				),
				admin_url( 'options-general.php' )
			)
		);
		exit;
	}
}
