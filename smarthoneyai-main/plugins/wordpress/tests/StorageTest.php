<?php

class Honeypot_AI_Storage_Test extends WP_UnitTestCase
{
    public function setUp(): void
    {
        parent::setUp();
        Honeypot_AI_Storage::activate();
        global $wpdb;
        $wpdb->query('DELETE FROM ' . Honeypot_AI_Storage::table_name()); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
        $wpdb->query('DELETE FROM ' . Honeypot_AI_Storage::rate_limit_table_name()); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
        $wpdb->query('DELETE FROM ' . Honeypot_AI_Storage::honeypot_hits_table_name()); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
        $wpdb->query('DELETE FROM ' . Honeypot_AI_Storage::auto_blocks_table_name()); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
        $wpdb->query(
            'UPDATE ' . Honeypot_AI_Storage::queue_state_table_name() . " SET row_count = 0, payload_bytes = 0, dropped_events = 0, updated_at = UTC_TIMESTAMP() WHERE singleton_id = 1"
        ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
        delete_option(Honeypot_AI_Storage::OPTION_POLICY);
        delete_option(Honeypot_AI_Storage::OPTION_POLICY_CANDIDATE);
        delete_option(Honeypot_AI_Storage::OPTION_DROPPED_EVENTS);
        add_option(Honeypot_AI_Storage::OPTION_DROPPED_EVENTS, '0', '', false);
    }

    public function test_enqueue_is_idempotent_and_reports_spool_bytes()
    {
        $storage = new Honeypot_AI_Storage();
        $event = array(
            'idempotencyKey' => 'storage-test-event',
            'kind' => 'HONEYPOT',
        );

        $this->assertTrue($storage->enqueue($event));
        $this->assertTrue($storage->enqueue($event));
        $this->assertSame(1, $storage->queue_depth());
        $this->assertGreaterThan(0, $storage->queue_bytes());
        $this->assertSame(0, $storage->dropped_events());

        global $wpdb;
        $actual = $wpdb->get_row(
            'SELECT COUNT(*) AS actual_rows, COALESCE(SUM(payload_bytes), 0) AS actual_bytes FROM ' . Honeypot_AI_Storage::table_name(),
            ARRAY_A
        ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
        $this->assertSame((int) $actual['actual_rows'], $storage->queue_depth());
        $this->assertSame((int) $actual['actual_bytes'], $storage->queue_bytes());
    }

    public function test_delivery_claims_are_disjoint_and_update_exact_counters()
    {
        $storage = new Honeypot_AI_Storage();
        for ($index = 0; $index < 5; ++$index) {
            $this->assertTrue($storage->enqueue(array(
                'idempotencyKey' => 'storage-claim-' . $index,
                'kind' => 'HONEYPOT',
            )));
        }
        $before_bytes = $storage->queue_bytes();

        $first = $storage->claim_pending(2);
        $second = $storage->claim_pending(2);
        $this->assertNotFalse($first);
        $this->assertNotFalse($second);
        $this->assertNotSame($first['token'], $second['token']);
        $this->assertSame(array(), array_values(array_intersect(
            wp_list_pluck($first['items'], 'row_id'),
            wp_list_pluck($second['items'], 'row_id')
        )));

        $this->assertSame(2, $storage->delete_claimed_rows($first['token']));
        $this->assertSame(0, $storage->delete_claimed_rows($first['token']));
        $this->assertSame(3, $storage->queue_depth());
        $this->assertLessThan($before_bytes, $storage->queue_bytes());

        global $wpdb;
        $actual = $wpdb->get_row(
            'SELECT COUNT(*) AS actual_rows, COALESCE(SUM(payload_bytes), 0) AS actual_bytes FROM ' . Honeypot_AI_Storage::table_name(),
            ARRAY_A
        ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
        $this->assertSame((int) $actual['actual_rows'], $storage->queue_depth());
        $this->assertSame((int) $actual['actual_bytes'], $storage->queue_bytes());
    }

    public function test_failed_claim_can_retry_and_expired_lease_can_be_reclaimed()
    {
        $storage = new Honeypot_AI_Storage();
        $this->assertTrue($storage->enqueue(array(
            'idempotencyKey' => 'storage-retry-claim',
            'kind' => 'HONEYPOT',
        )));
        $first = $storage->claim_pending(1, 15);
        $this->assertCount(1, $first['items']);
        $this->assertSame(1, $storage->retry_claim($first['token'], 1));

        global $wpdb;
        $table = Honeypot_AI_Storage::table_name();
        $wpdb->query("UPDATE {$table} SET available_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 SECOND)"); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
        $second = $storage->claim_pending(1, 15);
        $this->assertCount(1, $second['items']);
        $this->assertNotSame($first['token'], $second['token']);

        $wpdb->query("UPDATE {$table} SET claimed_until = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 SECOND)"); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
        $third = $storage->claim_pending(1, 15);
        $this->assertCount(1, $third['items']);
        $this->assertNotSame($second['token'], $third['token']);
        $this->assertSame(1, $storage->delete_claimed_rows($third['token']));
        $this->assertSame(0, $storage->queue_depth());
    }

    public function test_legacy_drop_fallback_is_visible_and_reconciled_into_state()
    {
        global $wpdb;
        $state_table = Honeypot_AI_Storage::queue_state_table_name();
        $wpdb->query("UPDATE {$state_table} SET dropped_events = 2 WHERE singleton_id = 1"); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
        update_option(Honeypot_AI_Storage::OPTION_DROPPED_EVENTS, '5', false);

        $storage = new Honeypot_AI_Storage();
        $this->assertSame(5, $storage->dropped_events());
        $this->assertTrue($storage->enqueue(array(
            'idempotencyKey' => 'drop-reconciliation-event',
            'kind' => 'HONEYPOT',
        )));
        $this->assertSame(5, (int) $wpdb->get_var("SELECT dropped_events FROM {$state_table} WHERE singleton_id = 1")); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
    }

    public function test_schema_upgrade_reconciles_queue_state_from_persisted_rows()
    {
        global $wpdb;
        $events_table = Honeypot_AI_Storage::table_name();
        $state_table = Honeypot_AI_Storage::queue_state_table_name();
        $payload = wp_json_encode(array('idempotencyKey' => 'upgrade-reconcile', 'kind' => 'HONEYPOT'));
        $wpdb->insert($events_table, array(
            'idempotency_key' => 'upgrade-reconcile',
            'payload' => $payload,
            'payload_bytes' => strlen($payload),
            'available_at' => current_time('mysql', true),
            'created_at' => current_time('mysql', true),
        ));
        $wpdb->query("UPDATE {$state_table} SET row_count = 99, payload_bytes = 99 WHERE singleton_id = 1"); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
        update_option(Honeypot_AI_Storage::OPTION_SCHEMA_VERSION, '2', false);

        Honeypot_AI_Storage::maybe_upgrade();

        $state = (new Honeypot_AI_Storage())->queue_stats();
        $this->assertSame(1, $state['rows']);
        $this->assertSame(strlen($payload), $state['bytes']);
        $this->assertSame(Honeypot_AI_Storage::SCHEMA_VERSION, (string) get_option(Honeypot_AI_Storage::OPTION_SCHEMA_VERSION));
    }

    public function test_capacity_selection_enforces_row_and_byte_limits()
    {
        $storage = new Honeypot_AI_Storage();
        $method = new ReflectionMethod($storage, 'capacity_eviction_ids');
        $method->setAccessible(true);

        $oversized = array(
            array('id' => 10, 'payload_bytes' => 40 * 1024 * 1024),
            array('id' => 11, 'payload_bytes' => 30 * 1024 * 1024),
        );
        $this->assertSame(array(10), $method->invoke($storage, $oversized));

        $too_many = array();
        for ($id = 1; $id <= Honeypot_AI_Storage::MAX_QUEUE + 1; ++$id) {
            $too_many[] = array('id' => $id, 'payload_bytes' => 1);
        }
        $this->assertSame(array(1), $method->invoke($storage, $too_many));
    }

    public function test_policy_candidate_is_selected_when_primary_is_corrupt()
    {
        $storage = new Honeypot_AI_Storage();
        $document = array('version' => 7, 'mode' => 'OBSERVE');
        $this->assertTrue($storage->save_policy($document, '"v7"'));

        $primary = get_option(Honeypot_AI_Storage::OPTION_POLICY);
        update_option(Honeypot_AI_Storage::OPTION_POLICY_CANDIDATE, $primary, false);
        $primary['source_hash'] = str_repeat('0', 64);
        update_option(Honeypot_AI_Storage::OPTION_POLICY, $primary, false);

        $selected = $storage->policy();
        $this->assertSame(7, $selected['document']['version']);
        $this->assertSame('"v7"', $selected['etag']);
    }

    public function test_error_code_is_sanitized_bounded_and_resolved_after_heartbeat()
    {
        $storage = new Honeypot_AI_Storage();
        $storage->record_error('A safe local message', str_repeat('CODE!/', 20));
        $error = $storage->last_error(true);

        $this->assertLessThanOrEqual(64, strlen($error['code']));
        $this->assertStringNotContainsString('!', $error['code']);
        $storage->record_heartbeat_success('DEGRADED');
        $this->assertSame(array(), $storage->last_error(true));
        $this->assertFalse($storage->last_error()['active']);
    }

    public function test_rate_limit_increment_returns_its_atomic_connection_value()
    {
        $storage = new Honeypot_AI_Storage();
        $key = hash('sha256', 'storage-rate-limit-test');
        $expires = time() + 60;

        $this->assertSame(1, $storage->increment_rate_limit($key, $expires));
        $this->assertSame(2, $storage->increment_rate_limit($key, $expires));
    }

    public function test_repeat_honeypot_tracking_requires_distinct_routes_and_expires()
    {
        $storage = new Honeypot_AI_Storage();
        $source = hash('sha256', 'opaque-source');
        $first = hash('sha256', 'first-route');
        $second = hash('sha256', 'second-route');
        $third = hash('sha256', 'third-route');

        $this->assertSame(1, $storage->record_honeypot_route_hit($source, $first, 600, 86400, 3)['distinct_routes']);
        $repeat = $storage->record_honeypot_route_hit($source, $first, 600, 86400, 3);
        $this->assertSame(1, $repeat['distinct_routes']);
        $this->assertFalse($repeat['activated']);
        $this->assertFalse($storage->auto_blocked_until($source));
        $this->assertSame(2, $storage->record_honeypot_route_hit($source, $second, 600, 86400, 3)['distinct_routes']);

        $activation = $storage->record_honeypot_route_hit($source, $third, 600, 86400, 3);
        $this->assertSame(3, $activation['distinct_routes']);
        $this->assertTrue($activation['activated']);
        $this->assertNotFalse($storage->auto_blocked_until($source));

        global $wpdb;
        $this->assertSame(64, strlen((string) $wpdb->get_var('SELECT source_hash FROM ' . Honeypot_AI_Storage::auto_blocks_table_name()))); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
        $wpdb->query('UPDATE ' . Honeypot_AI_Storage::auto_blocks_table_name() . ' SET blocked_until = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 SECOND)'); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
        $this->assertFalse($storage->auto_blocked_until($source));
        $storage->cleanup_security_buckets();
        $this->assertSame('0', (string) $wpdb->get_var('SELECT COUNT(*) FROM ' . Honeypot_AI_Storage::auto_blocks_table_name())); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
    }
}
