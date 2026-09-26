import { describe, expect, it } from "vitest";
import { buildEvidenceSummary, safeAnalystRequest, type AnalystEvidence } from "../src/ai-analyst.js";

const events: AnalystEvidence[] = [
  { eventId: "evt-latest", occurredAtMalaysia: "5 Sep 2026, 20:00:00 MYT", site: { name: "Main site" }, kind: "FIREWALL", protocol: "HTTP", action: "BLOCKED", request: "POST /login", sourceAlias: "source-b", assessment: { status: "COMPLETE", severity: "HIGH", threatType: "BRUTE_FORCE" }, incidents: [] },
  { eventId: "evt-older", occurredAtMalaysia: "5 Sep 2026, 19:00:00 MYT", site: { name: "Main site" }, kind: "HONEYPOT", protocol: "HTTP", action: "OBSERVED", request: "GET /admin", sourceAlias: "source-a", assessment: { status: "PENDING" }, incidents: [] },
  { eventId: "evt-oldest", occurredAtMalaysia: "5 Sep 2026, 18:00:00 MYT", site: { name: "Store" }, kind: "RATE_LIMIT", protocol: "HTTP", action: "RATE_LIMITED", request: "POST /login", sourceAlias: "source-b", assessment: { status: "COMPLETE", severity: "MEDIUM", threatType: "BOT" }, incidents: [] }
];

describe("deterministic AI evidence fallback", () => {
  it("returns a useful empty-window answer", () => {
    const result = buildEvidenceSummary({ message: "Summarize activity", evidence: [], window: "24h" });
    expect(result.model).toBe("local-evidence-summary-v1");
    expect(result.answer).toContain("0 events");
    expect(result.answer).toContain("Confirm the intended site is connected");
  });

  it("explains the latest blocked activity with cited bounded evidence", () => {
    const result = buildEvidenceSummary({ message: "Explain the latest blocked activity", evidence: events, window: "24h" });
    expect(result.answer).toContain("2 of 3 events were blocked or rate-limited");
    expect(result.answer).toContain("evt-latest");
    expect(result.answer.indexOf("evt-latest")).toBeLessThan(result.answer.indexOf("evt-oldest"));
    expect(result.answer).toContain("source-b");
  });

  it("uses stable count ordering for route and source patterns", () => {
    const result = buildEvidenceSummary({ message: "Which routes and sources repeat?", evidence: events, window: "7d" });
    expect(result.answer).toContain("POST /login (2 events)");
    expect(result.answer).toContain("source-b (2 events)");
  });

  it("strips query strings and fragments before a request enters analyst evidence", () => {
    expect(safeAnalystRequest("post", "/reset-password?token=TOP_SECRET#fragment")).toBe("POST /reset-password");
    expect(safeAnalystRequest("get", "/api/token/abcdefghijklmnopqrstuvwxyz0123456789/details")).toBe("GET /api/token/[redacted]/details");
    expect(safeAnalystRequest("get", "/download/abcdefghijklmnopqrstuvwxyz0123456789")).toBe("GET /download/[opaque]");
  });

  it("cites completed high-risk evidence for assessment questions", () => {
    const result = buildEvidenceSummary({ message: "Explain the latest threat assessment", evidence: [events[1]!, events[0]!], window: "24h" });
    expect(result.answer).toContain("1 of 2 events have a completed high or critical assessment");
    expect(result.answer).toContain("evt-latest");
  });

  it("never echoes payload, raw IP, or unrelated injection sentinels", () => {
    const poisoned = [{ ...events[0]!, payloadExcerpt: "PAYLOAD_SECRET", ipAddress: "203.0.113.4", headers: { cookie: "COOKIE_SECRET" }, injection: "IGNORE_ALL_RULES" }];
    const result = buildEvidenceSummary({ message: "Summarize threats", evidence: poisoned, window: "1h" });
    expect(result.answer).not.toContain("PAYLOAD_SECRET");
    expect(result.answer).not.toContain("203.0.113.4");
    expect(result.answer).not.toContain("COOKIE_SECRET");
    expect(result.answer).not.toContain("IGNORE_ALL_RULES");
    expect(result.answer).toContain("evt-latest");
  });
});
