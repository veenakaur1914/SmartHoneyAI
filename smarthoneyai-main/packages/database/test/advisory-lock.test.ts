import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  acquireAuthenticationIdentityLock,
  acquireInvitationIdentityLock,
  advisoryTransactionLockKey,
  authenticationIdentityLockKey,
  incidentCorrelationLockKey,
  invitationIdentityLockKey
} from "../src/advisory-lock.js";

describe("transaction advisory lock identities", () => {
  it("normalizes auth email identity across login, reset, and seed callers", () => {
    assert.deepEqual(
      authenticationIdentityLockKey(" Admin@SmartHoneyAI.XYZ "),
      authenticationIdentityLockKey("admin@smarthoneyai.xyz")
    );
  });

  it("keeps invitation identity scoped to both organization and normalized email", () => {
    const first = invitationIdentityLockKey("org-a", "User@Example.COM");
    assert.deepEqual(first, invitationIdentityLockKey("org-a", " user@example.com "));
    assert.notDeepEqual(first, invitationIdentityLockKey("org-b", "user@example.com"));
    assert.notDeepEqual(first, invitationIdentityLockKey("org-a", "other@example.com"));
  });

  it("uses separate namespaces for unrelated state transitions", () => {
    const auth = authenticationIdentityLockKey("user@example.com");
    const invitation = invitationIdentityLockKey("org-a", "user@example.com");
    const raw = advisoryTransactionLockKey("another-domain", "user@example.com");
    assert.notDeepEqual(auth, invitation);
    assert.notDeepEqual(auth, raw);
  });

  it("serializes one source per tenant without cross-tenant collisions", () => {
    const first = incidentCorrelationLockKey("org-a", "ip-hash");
    assert.deepEqual(first, incidentCorrelationLockKey("org-a", "ip-hash"));
    assert.notDeepEqual(first, incidentCorrelationLockKey("org-b", "ip-hash"));
    assert.notDeepEqual(first, incidentCorrelationLockKey("org-a", "other-ip-hash"));
  });

  it("returns signed PostgreSQL int4 keys deterministically", () => {
    const key = advisoryTransactionLockKey("namespace", "identity");
    assert.deepEqual(key, advisoryTransactionLockKey("namespace", "identity"));
    for (const value of key) {
      assert.ok(Number.isInteger(value));
      assert.ok(value >= -2_147_483_648 && value <= 2_147_483_647);
    }
  });

  it("requests transaction-scoped PostgreSQL locks with the derived keys", async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = [];
    const client = {
      async $executeRaw(strings: TemplateStringsArray, ...values: unknown[]) {
        calls.push({ sql: strings.join("?"), values });
        return 1;
      }
    } as unknown as Parameters<typeof acquireAuthenticationIdentityLock>[0];

    await acquireAuthenticationIdentityLock(client, "User@Example.COM");
    await acquireInvitationIdentityLock(client, "org-a", "User@Example.COM");

    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.sql, "SELECT pg_advisory_xact_lock(?::int, ?::int)");
    assert.deepEqual(calls[0]?.values, authenticationIdentityLockKey("user@example.com"));
    assert.deepEqual(calls[1]?.values, invitationIdentityLockKey("org-a", "user@example.com"));
  });
});
