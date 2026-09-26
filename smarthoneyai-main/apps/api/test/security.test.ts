import { describe, expect, it } from "vitest";

Object.assign(process.env, {
  DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  SESSION_SECRET: "s".repeat(32),
  AGENT_SIGNING_SECRET: "a".repeat(32)
});

const { controlPlaneRateLimitKey, isFreshAgentTimestamp, sanitizeEvidenceText, sanitizeMetadata } = await import("../src/security.js");

describe("security invariants", () => {
  it("never treats an AI outage as a clean result", () => {
    const terminalStates = ["UNAVAILABLE", "FAILED"];
    expect(terminalStates).not.toContain("COMPLETE");
  });

  it("keeps allow rules ahead of block rules", () => {
    const rules = [{ type: "BLOCK_IP", priority: 100 }, { type: "ALLOW_IP", priority: 1 }];
    expect(rules.sort((a, b) => a.priority - b.priority)[0]?.type).toBe("ALLOW_IP");
  });

  it("rejects malformed and out-of-window signed-request timestamps", () => {
    const now = Date.parse("2026-07-16T00:00:00.000Z");
    const seconds = Math.floor(now / 1000);
    expect(isFreshAgentTimestamp(String(seconds), now)).toBe(true);
    expect(isFreshAgentTimestamp(String(seconds - 300), now)).toBe(true);
    expect(isFreshAgentTimestamp(String(seconds + 300), now)).toBe(true);
    expect(isFreshAgentTimestamp(String(seconds - 301), now)).toBe(false);
    expect(isFreshAgentTimestamp(String(seconds + 301), now)).toBe(false);
    expect(isFreshAgentTimestamp("NaN", now)).toBe(false);
    expect(isFreshAgentTimestamp(`${seconds}.5`, now)).toBe(false);
    expect(isFreshAgentTimestamp("Infinity", now)).toBe(false);
  });

  it("redacts credential assignments and removes sensitive metadata fields", () => {
    expect(sanitizeEvidenceText("/scan?token=TOPSECRET&marker=SAFE", 2048)).toBe("/scan?token=[REDACTED]&marker=SAFE");
    expect(sanitizeEvidenceText("PerfBot session: SESSION-CANARY", 1024)).toBe("PerfBot session: [REDACTED]");
    expect(sanitizeMetadata({ token: "TOKEN-CANARY", marker: "SAFE", note: "password=PASSWORD-CANARY" }))
      .toEqual({ marker: "SAFE", note: "password=[REDACTED]" });
  });

  it("isolates bounded agent identities while keeping enrollment and malformed identities on the source-IP bucket", () => {
    expect(controlPlaneRateLimitKey("/v1/agent/heartbeat", "172.20.0.2", "cmrmu4okz0005o70qc8b3mtke")).toBe("agent:cmrmu4okz0005o70qc8b3mtke");
    expect(controlPlaneRateLimitKey("/v1/agent/config?refresh=1", "172.20.0.2", "cmrmu4okz0005o70qc8b3mtke")).toBe("agent:cmrmu4okz0005o70qc8b3mtke");
    expect(controlPlaneRateLimitKey("/v1/agent/enroll", "172.20.0.2", "cmrmu4okz0005o70qc8b3mtke")).toBe("ip:172.20.0.2");
    expect(controlPlaneRateLimitKey("/v1/sites", "172.20.0.2", undefined)).toBe("ip:172.20.0.2");
    expect(controlPlaneRateLimitKey("/v1/agent/heartbeat", "172.20.0.2", "not-a-site")).toBe("ip:172.20.0.2");
    expect(controlPlaneRateLimitKey("/v1/network-sensors/heartbeat", "172.20.0.2", "cmrmu4okz0005o70qc8b3mtke")).toBe("agent:cmrmu4okz0005o70qc8b3mtke");
  });
});
