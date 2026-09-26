<?php

if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

wp_clear_scheduled_hook( 'honeypot_ai_agent_tick' );
wp_clear_scheduled_hook( 'honeypot_ai_policy_sync' );
wp_clear_scheduled_hook( 'honeypot_ai_send_queue' );
delete_transient( 'honeypot_ai_policy_sync_lock' );

if ( 'yes' !== get_option( 'honeypot_ai_delete_data_on_uninstall', 'no' ) ) {
	return;
}

global $wpdb;
$table = $wpdb->prefix . 'honeypot_ai_events';
$wpdb->query( "DROP TABLE IF EXISTS {$table}" ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared,WordPress.DB.DirectDatabaseQuery.SchemaChange
$rate_limit_table = $wpdb->prefix . 'honeypot_ai_rate_limits';
$wpdb->query( "DROP TABLE IF EXISTS {$rate_limit_table}" ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared,WordPress.DB.DirectDatabaseQuery.SchemaChange
$queue_state_table = $wpdb->prefix . 'honeypot_ai_queue_state';
$wpdb->query( "DROP TABLE IF EXISTS {$queue_state_table}" ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared,WordPress.DB.DirectDatabaseQuery.SchemaChange
$hits_table = $wpdb->prefix . 'honeypot_ai_honeypot_hits';
$wpdb->query( "DROP TABLE IF EXISTS {$hits_table}" ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared,WordPress.DB.DirectDatabaseQuery.SchemaChange
$blocks_table = $wpdb->prefix . 'honeypot_ai_auto_blocks';
$wpdb->query( "DROP TABLE IF EXISTS {$blocks_table}" ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared,WordPress.DB.DirectDatabaseQuery.SchemaChange

foreach ( array(
	'honeypot_ai_settings',
	'honeypot_ai_credentials',
	'honeypot_ai_policy',
	'honeypot_ai_policy_candidate',
	'honeypot_ai_last_error',
	'honeypot_ai_agent_status',
	'honeypot_ai_dropped_events',
	'honeypot_ai_schema_version',
	'honeypot_ai_delete_data_on_uninstall',
) as $option ) {
	delete_option( $option );
}
