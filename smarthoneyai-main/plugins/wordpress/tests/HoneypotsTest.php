<?php

class Honeypot_AI_Honeypots_Test extends WP_UnitTestCase
{
    public function setUp(): void
    {
        parent::setUp();
        Honeypot_AI_Storage::activate();
        delete_option(Honeypot_AI_Storage::OPTION_POLICY);
        delete_option(Honeypot_AI_Storage::OPTION_POLICY_CANDIDATE);
    }

    public function test_request_path_fallback_resolves_new_and_custom_routes()
    {
        update_option(Honeypot_AI_Storage::OPTION_POLICY, array(
            'document' => array(
                'honeypots' => array(
                    array('id' => 'built-in-env', 'key' => 'environment-file', 'name' => 'Environment endpoint', 'path' => '/env', 'template' => 'DIAGNOSTIC', 'enabled' => true),
                    array('id' => 'custom-one', 'key' => 'custom-one', 'name' => 'Custom diagnostic', 'path' => '/custom-diagnostic', 'template' => 'DIAGNOSTIC', 'enabled' => true),
                ),
            ),
        ), false);

        $storage = new Honeypot_AI_Storage();
        $sensor = new Honeypot_AI_Honeypots($storage, new Honeypot_AI_Sanitizer(), new Honeypot_AI_Policy($storage));

        $this->assertSame('environment-file', $sensor->decoy_key_for_path('/env'));
        $this->assertNull($sensor->decoy_key_for_path('/.env'));
        $this->assertSame('custom-one', $sensor->decoy_key_for_path('/custom-diagnostic'));
        $this->assertSame('custom-one', $sensor->decoy_key_for_path('/CUSTOM-DIAGNOSTIC/'));
        $this->assertNull($sensor->decoy_key_for_path('/not-a-honeypot'));
    }

    public function test_policy_refresh_replaces_stale_plugin_rewrite_rules()
    {
        update_option(Honeypot_AI_Storage::OPTION_POLICY, array(
            'document' => array(
                'honeypots' => array(
                    array('id' => 'custom-current', 'key' => 'custom-current', 'name' => 'Current route', 'path' => '/current-decoy', 'template' => 'DIAGNOSTIC', 'enabled' => true),
                ),
            ),
        ), false);

        global $wp_rewrite;
        $wp_rewrite->extra_rules_top['^stale-decoy/?$'] = 'index.php?honeypot_ai_decoy=stale-decoy';

        Honeypot_AI_Honeypots::refresh_rewrite_rules();

        $this->assertArrayNotHasKey('^stale-decoy/?$', $wp_rewrite->extra_rules_top);
        $this->assertSame('index.php?honeypot_ai_decoy=custom-current', $wp_rewrite->extra_rules_top['^current\-decoy/?$']);
    }
}
