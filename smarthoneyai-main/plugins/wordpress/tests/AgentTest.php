<?php

class Honeypot_AI_Test_Transport extends Honeypot_AI_Transport
{
    public $requests = array();

    public function signed_request($method, $path, $body = null, $extra_headers = array())
    {
        $this->requests[] = compact('method', 'path', 'body', 'extra_headers');
        return array('status' => 200, 'body' => array(), 'headers' => array());
    }
}

class Honeypot_AI_Failing_Test_Transport extends Honeypot_AI_Transport
{
    public function signed_request($method, $path, $body = null, $extra_headers = array())
    {
        return new WP_Error('simulated_api_outage', 'Simulated API outage');
    }
}

class Honeypot_AI_Agent_Test extends WP_UnitTestCase
{
    public function setUp(): void
    {
        parent::setUp();
        Honeypot_AI_Storage::activate();
        global $wpdb;
        $wpdb->query('DELETE FROM ' . Honeypot_AI_Storage::table_name()); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
        $wpdb->query(
            'UPDATE ' . Honeypot_AI_Storage::queue_state_table_name() . " SET row_count = 0, payload_bytes = 0, dropped_events = 0, updated_at = UTC_TIMESTAMP() WHERE singleton_id = 1"
        ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
        update_option(Honeypot_AI_Storage::OPTION_CREDENTIALS, array(
            'site_id' => 'site-test',
            'key_id' => 'key-test',
            'secret' => str_repeat('s', 32),
        ), false);
        update_option(Honeypot_AI_Storage::OPTION_SETTINGS, array(
            'api_url' => 'https://localhost',
            'enabled_decoys' => array('fake-login', 'phpmyadmin', 'not-a-real-decoy'),
            'poll_interval' => 300,
        ), false);
        delete_option(Honeypot_AI_Storage::OPTION_LAST_ERROR);
        delete_option(Honeypot_AI_Storage::OPTION_AGENT_STATUS);
        delete_option(Honeypot_AI_Storage::OPTION_DROPPED_EVENTS);
        add_option(Honeypot_AI_Storage::OPTION_DROPPED_EVENTS, '0', '', false);
    }

    public function test_heartbeat_contains_bounded_runtime_telemetry()
    {
        $storage = new Honeypot_AI_Storage();
        $transport = new Honeypot_AI_Test_Transport($storage);
        $policy = new Honeypot_AI_Policy($storage);
        $agent = new Honeypot_AI_Agent($storage, $transport, $policy);

        $agent->heartbeat();

        $this->assertCount(1, $transport->requests);
        $request = $transport->requests[0];
        $this->assertSame('/v1/agent/heartbeat', $request['path']);
        $this->assertCount(15, $request['body']['enabledDecoys']);
        $this->assertContains('fake-login', $request['body']['enabledDecoys']);
        $this->assertContains('actuator-env', $request['body']['enabledDecoys']);
        $this->assertSame(0, $request['body']['droppedEvents']);
        $this->assertNull($request['body']['lastErrorCode']);
        $this->assertSame('HEALTHY', $request['body']['health']);
        $this->assertSame('ONLINE', $storage->connection_status());
    }

    public function test_honeypot_policy_sync_is_scheduled_every_minute()
    {
        wp_clear_scheduled_hook('honeypot_ai_policy_sync');

        Honeypot_AI_Storage::schedule_events();

        $scheduled = wp_next_scheduled('honeypot_ai_policy_sync');
        $this->assertNotFalse($scheduled);
        $this->assertLessThanOrEqual(time() + 20, $scheduled);
        $this->assertSame('honeypot_ai_one_minute', wp_get_schedule('honeypot_ai_policy_sync'));
    }

    public function test_queue_delivery_drains_multiple_bounded_batches_per_tick()
    {
        $storage = new Honeypot_AI_Storage();
        for ($index = 0; $index < 60; ++$index) {
            $this->assertTrue($storage->enqueue(array(
                'idempotencyKey' => 'agent-batch-test-' . $index,
                'occurredAt' => gmdate('c'),
                'kind' => 'PLUGIN_HEALTH',
            )));
        }

        $transport = new Honeypot_AI_Test_Transport($storage);
        $agent = new Honeypot_AI_Agent($storage, $transport, new Honeypot_AI_Policy($storage));
        $agent->send_queue();

        $this->assertCount(3, $transport->requests);
        $this->assertSame(array(25, 25, 10), array_map(function ($request) {
            return count($request['body']['events']);
        }, $transport->requests));
        $this->assertSame(0, $storage->queue_depth());
        $this->assertSame(0, $storage->dropped_events());
    }

    public function test_failed_delivery_releases_claim_and_schedules_prompt_retry()
    {
        $storage = new Honeypot_AI_Storage();
        $this->assertTrue($storage->enqueue(array(
            'idempotencyKey' => 'agent-retry-test',
            'occurredAt' => gmdate('c'),
            'kind' => 'PLUGIN_HEALTH',
        )));

        $transport = new Honeypot_AI_Failing_Test_Transport($storage);
        $agent = new Honeypot_AI_Agent($storage, $transport, new Honeypot_AI_Policy($storage));
        $before = time();
        $agent->send_queue();

        $this->assertSame(1, $storage->queue_depth());
        $scheduled = wp_next_scheduled('honeypot_ai_send_queue');
        $this->assertNotFalse($scheduled);
        $this->assertLessThanOrEqual($before + 15, $scheduled);
        global $wpdb;
        $row = $wpdb->get_row('SELECT attempts, claim_token, claimed_until FROM ' . Honeypot_AI_Storage::table_name(), ARRAY_A); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
        $this->assertSame(1, (int) $row['attempts']);
        $this->assertNull($row['claim_token']);
        $this->assertNull($row['claimed_until']);

        $wpdb->query('UPDATE ' . Honeypot_AI_Storage::table_name() . ' SET available_at = UTC_TIMESTAMP()'); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
        $success = new Honeypot_AI_Test_Transport($storage);
        (new Honeypot_AI_Agent($storage, $success, new Honeypot_AI_Policy($storage)))->send_queue();
        $this->assertSame(0, $storage->queue_depth());
        $this->assertCount(1, $success->requests);
    }
}
