<?php

class Honeypot_AI_Policy_Test extends WP_UnitTestCase
{
    public function setUp(): void
    {
        parent::setUp();
        Honeypot_AI_Storage::activate();
        delete_option(Honeypot_AI_Storage::OPTION_POLICY);
        delete_option(Honeypot_AI_Storage::OPTION_POLICY_CANDIDATE);
        delete_option(Honeypot_AI_Storage::OPTION_CREDENTIALS);
        global $wpdb;
        $wpdb->query('DELETE FROM ' . Honeypot_AI_Storage::rate_limit_table_name()); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
    }

    public function test_expired_or_missing_policy_is_monitor_only()
    {
        $storage = new Honeypot_AI_Storage();
        delete_option(Honeypot_AI_Storage::OPTION_POLICY);
        $policy = new Honeypot_AI_Policy($storage);
        $this->assertSame('MONITOR_ONLY', $policy->effective_mode());
    }

    public function test_valid_signed_policy_is_stored()
    {
        if (!function_exists('sodium_crypto_sign_keypair')) {
            $this->markTestSkipped('libsodium is required for policy verification.');
        }
        $keypair = sodium_crypto_sign_keypair();
        $public = sodium_crypto_sign_publickey($keypair);
        $secret = sodium_crypto_sign_secretkey($keypair);
        update_option(Honeypot_AI_Storage::OPTION_CREDENTIALS, array(
            'site_id' => 'site-test',
            'key_id' => 'key-test',
            'secret' => str_repeat('x', 32),
            'policy_public_key' => base64_encode($public),
        ), false);
        $storage = new Honeypot_AI_Storage();
        $verifier = new Honeypot_AI_Policy($storage);
        $document = array(
            'siteId' => 'site-test',
            'version' => 1,
            'issuedAt' => gmdate('c', time() - 10),
            'expiresAt' => gmdate('c', time() + 600),
            'mode' => 'ENFORCE',
            'rules' => array(),
            'honeypots' => array(
                array('id' => 'custom-one', 'key' => 'custom-one', 'name' => 'Safe diagnostic', 'path' => '/security-diagnostic', 'template' => 'DIAGNOSTIC', 'enabled' => true),
            ),
            'autoBlock' => array('enabled' => true, 'distinctRoutes' => 3, 'windowSeconds' => 600, 'blockSeconds' => 86400),
            'signature' => '',
        );
        $document['signature'] = base64_encode(sodium_crypto_sign_detached($verifier->canonical_json($document), $secret));

        $this->assertTrue($verifier->validate_and_store($document, '"v1"'));
        $this->assertSame('ENFORCE', $verifier->effective_mode());
        $this->assertSame('/security-diagnostic', $verifier->honeypots()[0]['path']);
        $this->assertSame(3, $verifier->auto_block_config()['distinctRoutes']);
    }

    public function test_rejects_tampered_policy()
    {
        if (!function_exists('sodium_crypto_sign_keypair')) {
            $this->markTestSkipped('libsodium is required for policy verification.');
        }
        $keypair = sodium_crypto_sign_keypair();
        update_option(Honeypot_AI_Storage::OPTION_CREDENTIALS, array(
            'site_id' => 'site-test',
            'key_id' => 'key-test',
            'secret' => str_repeat('x', 32),
            'policy_public_key' => base64_encode(sodium_crypto_sign_publickey($keypair)),
        ), false);
        $verifier = new Honeypot_AI_Policy(new Honeypot_AI_Storage());
        $document = array(
            'siteId' => 'site-test', 'version' => 2, 'issuedAt' => gmdate('c'),
            'expiresAt' => gmdate('c', time() + 600), 'mode' => 'ENFORCE', 'rules' => array(),
            'signature' => base64_encode(str_repeat('x', SODIUM_CRYPTO_SIGN_BYTES)),
        );
        $this->assertWPError($verifier->validate_and_store($document));
        $this->assertSame('MONITOR_ONLY', $verifier->effective_mode());
    }

    public function test_rejects_unbounded_policy_lifetime_before_storage()
    {
        update_option(Honeypot_AI_Storage::OPTION_CREDENTIALS, array(
            'site_id' => 'site-test',
            'key_id' => 'key-test',
            'secret' => str_repeat('x', 32),
            'policy_public_key' => base64_encode(str_repeat('x', 32)),
        ), false);
        $document = array(
            'siteId' => 'site-test', 'version' => 1, 'issuedAt' => gmdate('c'),
            'expiresAt' => gmdate('c', time() + Honeypot_AI_Policy::MAX_POLICY_LIFETIME + 60),
            'mode' => 'ENFORCE', 'rules' => array(), 'signature' => str_repeat('x', 64),
        );
        $result = (new Honeypot_AI_Policy(new Honeypot_AI_Storage()))->validate_and_store($document);
        $this->assertWPError($result);
        $this->assertSame('honeypot_ai_policy_shape', $result->get_error_code());
    }

    public function test_allow_rule_wins_over_matching_block()
    {
        $policy = $this->policy_with_rules(array(
            $this->rule('block', 'BLOCK_IP', '8.8.8.8', 1),
            $this->rule('allow', 'ALLOW_IP', '8.8.8.8', 100),
        ));

        $decision = $policy->decision($this->request('8.8.8.8'));

        $this->assertSame('ALLOWED', $decision['action']);
        $this->assertSame('allow', $decision['rule']['id']);
    }

    public function test_private_source_addresses_are_never_blocked()
    {
        $policy = $this->policy_with_rules(array(
            $this->rule('private-block', 'BLOCK_IP', '10.0.0.0/8', 1),
        ));

        $decision = $policy->decision($this->request('10.10.10.10'));

        $this->assertSame('ALLOWED', $decision['action']);
    }

    public function test_allowlist_and_protected_source_checks_are_available_in_observation_mode()
    {
        $policy = $this->policy_with_rules(array(
            $this->rule('allow', 'ALLOW_IP', '8.8.8.8', 100),
        ));

        $this->assertTrue($policy->source_is_allowlisted('8.8.8.8'));
        $this->assertFalse($policy->source_is_allowlisted('8.8.4.4'));
        $this->assertTrue($policy->source_is_protected('127.0.0.1'));
        $this->assertFalse($policy->source_is_protected('8.8.8.8'));
    }

    public function test_older_policy_falls_back_to_all_inert_routes()
    {
        $honeypots = (new Honeypot_AI_Policy(new Honeypot_AI_Storage()))->honeypots();
        $this->assertCount(15, $honeypots);
        $this->assertContains('sql-injection-trap', array_column($honeypots, 'key'));
        $this->assertContains('xss-probe-trap', array_column($honeypots, 'key'));
        $this->assertContains('command-injection-trap', array_column($honeypots, 'key'));
    }

    public function test_rate_limit_uses_atomic_database_bucket()
    {
        $policy = $this->policy_with_rules(array(
            $this->rule('rate', 'RATE_LIMIT', '1/60', 1),
        ));

        $this->assertSame('OBSERVED', $policy->decision($this->request('8.8.4.4'))['action']);
        $this->assertSame('RATE_LIMITED', $policy->decision($this->request('8.8.4.4'))['action']);

        global $wpdb;
        $this->assertSame('2', (string) $wpdb->get_var('SELECT hit_count FROM ' . Honeypot_AI_Storage::rate_limit_table_name())); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
    }

    private function policy_with_rules($rules)
    {
        update_option(Honeypot_AI_Storage::OPTION_POLICY, array(
            'document' => array(
                'siteId' => 'site-test',
                'version' => 1,
                'issuedAt' => gmdate('c', time() - 10),
                'expiresAt' => gmdate('c', time() + 600),
                'mode' => 'ENFORCE',
                'rules' => $rules,
                'signature' => 'test-only',
            ),
            'stored_at' => gmdate('c'),
        ), false);
        return new Honeypot_AI_Policy(new Honeypot_AI_Storage());
    }

    private function rule($id, $type, $value, $priority)
    {
        return array(
            'id' => $id,
            'type' => $type,
            'value' => $value,
            'priority' => $priority,
            'reason' => 'Unit test rule',
            'expiresAt' => null,
            'enabled' => true,
        );
    }

    private function request($ip)
    {
        return array(
            'ip' => $ip,
            'path' => '/blocked-test',
            'user_agent' => 'WordPress PHPUnit',
            'country' => '',
        );
    }
}
