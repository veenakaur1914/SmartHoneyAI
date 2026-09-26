import { describe, expect, it } from "vitest";
import { canonicalJson, connectionStatus, customHoneypotKey, decoyDefinitions, effectivePolicyMode, isProtectedAddress, normalizeFirewallRule, normalizeFirewallRuleUpdate, normalizeHoneypotPath, normalizeSiteUrl, policyCanBeReused, policyNeedsRefresh, policySourceHash, REPEAT_ATTACKER_AUTO_BLOCK, selfTestCleanupDisposition } from "../src/domain.js";

const now = new Date("2026-07-16T00:00:00.000Z");

describe("connection state", () => {
  it("ages a healthy heartbeat through online, degraded, and offline", () => {
    expect(connectionStatus({ persistedStatus: "ONLINE", lastSeenAt: new Date(now.getTime() - 9 * 60_000), heartbeatHealth: "HEALTHY" }, now)).toBe("ONLINE");
    expect(connectionStatus({ persistedStatus: "ONLINE", lastSeenAt: new Date(now.getTime() - 11 * 60_000), heartbeatHealth: "HEALTHY" }, now)).toBe("DEGRADED");
    expect(connectionStatus({ persistedStatus: "DEGRADED", lastSeenAt: new Date(now.getTime() - 16 * 60_000), heartbeatHealth: "DEGRADED" }, now)).toBe("OFFLINE");
  });

  it("keeps never-enrolled and revoked sites distinct", () => {
    expect(connectionStatus({ persistedStatus: "PENDING", lastSeenAt: null }, now)).toBe("PENDING");
    expect(connectionStatus({ persistedStatus: "REVOKED", lastSeenAt: now }, now)).toBe("REVOKED");
  });
});

describe("self-test cleanup state", () => {
  it("allows safe cancellation before containment and idempotent cleanup", () => {
    expect(selfTestCleanupDisposition("CREATED", null)).toBe("RUN_ONLY");
    expect(selfTestCleanupDisposition("RUNNING", null)).toBe("RUN_ONLY");
    expect(selfTestCleanupDisposition("DETECTED", null)).toBe("RUN_ONLY");
    expect(selfTestCleanupDisposition("CONTAINED", "rule-1")).toBe("RULE");
    expect(selfTestCleanupDisposition("CLEANED", null)).toBe("ALREADY_CLEANED");
  });

  it("rejects inconsistent or terminal states", () => {
    expect(selfTestCleanupDisposition("RUNNING", "unexpected-rule")).toBe("REJECT");
    expect(selfTestCleanupDisposition("CONTAINED", null)).toBe("REJECT");
    expect(selfTestCleanupDisposition("EXPIRED", null)).toBe("REJECT");
    expect(selfTestCleanupDisposition("FAILED", null)).toBe("REJECT");
  });
});

describe("self-test policy scope", () => {
  it("enforces only while an authorized run is contained", () => {
    expect(effectivePolicyMode("OBSERVE", false)).toBe("OBSERVE");
    expect(effectivePolicyMode("OBSERVE", true)).toBe("ENFORCE");
    expect(effectivePolicyMode("ENFORCE", false)).toBe("ENFORCE");
  });
});

describe("firewall rule safety", () => {
  it("validates IP/CIDR and adds a bounded default deny expiry", () => {
    const rule = normalizeFirewallRule({ type: "BLOCK_IP", value: "203.0.113.0/24" }, now);
    expect(rule.value).toBe("203.0.113.0/24");
    expect(rule.expiresAt?.getTime()).toBe(now.getTime() + 86_400_000);
    expect(() => normalizeFirewallRule({ type: "BLOCK_IP", value: "203.0.113.0/99" }, now)).toThrow(/valid IPv4/);
  });

  it("rejects unsafe routes, malformed rate limits, and unavailable country rules", () => {
    expect(() => normalizeFirewallRule({ type: "BLOCK_ROUTE", value: "https://example.test/a" }, now)).toThrow(/absolute path/);
    expect(() => normalizeFirewallRule({ type: "RATE_LIMIT", value: "0/1" }, now)).toThrow(/requests\/window/);
    expect(() => normalizeFirewallRule({ type: "BLOCK_COUNTRY", value: "MY" }, now)).toThrow(/GeoIP/);
  });

  it("turns a legacy permanent deny into a bounded temporary rule when re-enabled", () => {
    const expiresAt = normalizeFirewallRuleUpdate({ type: "BLOCK_ROUTE", currentExpiresAt: null, enabled: true }, now);
    expect(expiresAt?.getTime()).toBe(now.getTime() + 86_400_000);
  });

  it("rejects private, loopback, link-local, documentation, reserved and malformed containment sources", () => {
    for (const address of ["10.0.0.1", "127.0.0.1", "169.254.2.3", "172.16.0.1", "192.168.1.1", "198.51.100.20", "203.0.113.10", "::1", "fd00::1", "fe80::1", "2001:db8::1", "invalid"]) {
      expect(isProtectedAddress(address), address).toBe(true);
    }
    expect(isProtectedAddress("8.8.8.8")).toBe(false);
    expect(isProtectedAddress("2606:4700:4700::1111")).toBe(false);
  });
});

describe("WordPress site URL safety", () => {
  it("normalizes HTTPS URLs and rejects credentials or unsafe production HTTP", () => {
    expect(normalizeSiteUrl("https://Example.COM/wordpress/")).toEqual({ url: "https://example.com/wordpress", domain: "example.com" });
    expect(() => normalizeSiteUrl("https://user:pass@example.com/")).toThrow(/credentials/);
    expect(() => normalizeSiteUrl("http://example.com/")).toThrow(/HTTPS/);
  });

  it("permits loopback HTTP only when local development is explicit", () => {
    expect(normalizeSiteUrl("http://localhost:8080/", true).url).toBe("http://localhost:8080/");
    expect(() => normalizeSiteUrl("http://localhost:8080/")).toThrow(/HTTPS/);
  });
});

describe("honeypot route safety", () => {
  it("generates policy-safe custom keys for arbitrary URL-safe entropy", () => {
    expect(customHoneypotKey("abc_DEF-123")).toMatch(/^custom-[a-f0-9]{18}$/);
  });

  it("keeps repeat-attacker protection mandatory in every signed policy", () => {
    expect(REPEAT_ATTACKER_AUTO_BLOCK).toEqual({
      enabled: true,
      distinctRoutes: 3,
      windowSeconds: 600,
      blockSeconds: 86_400
    });
  });

  it("ships the three attack-specific honeypots with the existing built-in probes", () => {
    const definitions = Object.values(decoyDefinitions);
    expect(definitions).toHaveLength(15);
    expect(new Set(definitions.map((route) => route.path)).size).toBe(15);
    expect(decoyDefinitions["sql-injection-trap"].path).toBe("/database/query");
    expect(decoyDefinitions["xss-probe-trap"].path).toBe("/preview/render");
    expect(decoyDefinitions["command-injection-trap"].path).toBe("/system/diagnostics");
    expect(definitions.map((route) => route.path)).toContain("/env");
    expect(definitions.map((route) => route.path)).not.toContain("/.env");
    expect(definitions.map((route) => route.path)).toContain("/git-config");
    expect(definitions.map((route) => route.path)).toContain("/wp-config-backup");
    expect(definitions.map((route) => route.path)).toContain("/debug-log");
    expect(definitions.map((route) => route.path)).toContain("/server-diagnostics");
    expect(definitions.map((route) => route.path)).toContain("/actuator/env");
  });

  it("normalizes safe paths and rejects traversal, control data, and protected WordPress endpoints", () => {
    expect(normalizeHoneypotPath(" /security//diagnostic/ ")).toBe("/security/diagnostic");
    expect(() => normalizeHoneypotPath("security/diagnostic")).toThrow(/absolute paths/);
    expect(() => normalizeHoneypotPath("/safe/../secret")).toThrow(/relative path/);
    expect(() => normalizeHoneypotPath("/wp-admin/export.php")).toThrow(/reserved/);
    expect(() => normalizeHoneypotPath("/wp-json/custom")).toThrow(/reserved/);
    expect(() => normalizeHoneypotPath("/route?token=secret")).toThrow(/absolute paths/);
  });
});

describe("policy identity", () => {
  it("canonicalizes nested policy keys independently of database JSON key order", () => {
    expect(canonicalJson({ mode: "OBSERVE", rules: [], siteId: "site-1", version: 1 }))
      .toBe(canonicalJson({ version: 1, siteId: "site-1", rules: [], mode: "OBSERVE" }));
  });

  it("hashes semantically identical object key order consistently", () => {
    expect(policySourceHash({ mode: "OBSERVE", rules: [{ id: "a", priority: 1 }] })).toBe(policySourceHash({ rules: [{ priority: 1, id: "a" }], mode: "OBSERVE" }));
  });

  it("refreshes only inside the configured freshness window", () => {
    expect(policyNeedsRefresh(new Date(now.getTime() + 11 * 60_000), now)).toBe(false);
    expect(policyNeedsRefresh(new Date(now.getTime() + 9 * 60_000), now)).toBe(true);
  });

  it("never reuses an older policy after the source changes and later reverts", () => {
    const latest = { sourceHash: "newer-source", expiresAt: new Date(now.getTime() + 30 * 60_000) };
    expect(policyCanBeReused(latest, "older-source", now)).toBe(false);
    expect(policyCanBeReused(latest, "newer-source", now)).toBe(true);
  });
});
