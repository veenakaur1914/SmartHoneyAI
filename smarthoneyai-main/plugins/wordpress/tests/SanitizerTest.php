<?php

class Honeypot_AI_Sanitizer_Test extends WP_UnitTestCase
{
    public function test_redacts_credentials_and_auth_headers()
    {
        $sanitizer = new Honeypot_AI_Sanitizer();
        $headers = $sanitizer->headers(array(
            'HTTP_AUTHORIZATION' => 'Bearer secret',
            'HTTP_COOKIE' => 'session=secret',
            'HTTP_ACCEPT' => 'application/json',
        ));
        $payload = $sanitizer->payload(array(
            'username' => 'scanner',
            'password' => 'never-store-this',
            'nested' => array(
                'token' => 'also-secret',
                'login' => 'canary-login',
                'account' => 'canary-account',
            ),
        ));

        $this->assertSame('[REDACTED]', $headers['authorization']);
        $this->assertSame('[REDACTED]', $headers['cookie']);
        $this->assertStringNotContainsString('never-store-this', $payload);
        $this->assertStringNotContainsString('also-secret', $payload);
        $this->assertStringNotContainsString('scanner', $payload);
        $this->assertStringNotContainsString('canary-login', $payload);
        $this->assertStringNotContainsString('canary-account', $payload);
        $this->assertSame(5, substr_count($payload, '[REDACTED]'));
    }

    public function test_uses_only_remote_addr_for_client_ip()
    {
        $sanitizer = new Honeypot_AI_Sanitizer();
        $ip = $sanitizer->client_ip(array(
            'REMOTE_ADDR' => '203.0.113.9',
            'HTTP_X_FORWARDED_FOR' => '198.51.100.8',
        ));
        $this->assertSame('203.0.113.9', $ip);
    }

    public function test_caps_headers_and_payload_without_leaking_tail_content()
    {
        $sanitizer = new Honeypot_AI_Sanitizer();
        $headers = array();
        for ($index = 0; $index < 20; ++$index) {
            $headers['HTTP_X_TEST_' . $index] = str_repeat('h', 4096);
        }
        $input = array('password' => 'must-not-survive');
        for ($index = 0; $index < 20; ++$index) {
            $input['safe_' . $index] = str_repeat('p', 4096);
        }
        $payload = $sanitizer->payload($input);

        $clean_headers = $sanitizer->headers($headers);
        $this->assertSame('true', $clean_headers['x-honeypot-truncated']);
        $this->assertLessThanOrEqual(Honeypot_AI_Sanitizer::MAX_PAYLOAD_BYTES, strlen($payload));
        $this->assertStringNotContainsString('must-not-survive', $payload);
        $this->assertStringContainsString('[TRUNCATED]', $payload);
    }

    public function test_invalid_remote_addr_does_not_fall_back_to_forwarded_headers()
    {
        $sanitizer = new Honeypot_AI_Sanitizer();
        $ip = $sanitizer->client_ip(array(
            'REMOTE_ADDR' => 'not-an-ip',
            'HTTP_X_FORWARDED_FOR' => '8.8.8.8',
            'HTTP_CF_CONNECTING_IP' => '1.1.1.1',
        ));

        $this->assertSame('0.0.0.0', $ip);
    }
}
