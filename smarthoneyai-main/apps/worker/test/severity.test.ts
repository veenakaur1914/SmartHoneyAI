import { describe, expect, it } from "vitest";
import { localDeterministicClassification, maskedIp, seededHoneypotClassification, severityFor } from "../src/analysis-logic.js";

describe("threat analysis safety", () => {
  it("maps only high-confidence injection and credential attacks to critical", () => {
    expect(severityFor("SQL_INJECTION", 0.9)).toBe("CRITICAL");
    expect(severityFor("COMMAND_INJECTION", 0.99)).toBe("CRITICAL");
    expect(severityFor("CREDENTIAL_STUFFING", 0.89)).toBe("MEDIUM");
  });

  it("classifies the three seeded attack honeypots without provider ambiguity", () => {
    expect(seededHoneypotClassification("sql-injection-trap")).toEqual({ threatType: "SQL_INJECTION", confidence: 0.99 });
    expect(seededHoneypotClassification("xss-probe-trap")).toEqual({ threatType: "XSS", confidence: 0.99 });
    expect(seededHoneypotClassification("command-injection-trap")).toEqual({ threatType: "COMMAND_INJECTION", confidence: 0.99 });
    expect(seededHoneypotClassification("fake-login")).toEqual({ threatType: "CREDENTIAL_STUFFING", confidence: 0.99 });
    expect(seededHoneypotClassification("environment-file")).toEqual({ threatType: "SCANNER", confidence: 0.99 });
  });

  it("normalizes OpenCanary service signals deterministically", () => {
    expect(seededHoneypotClassification("opencanary-ssh-connection")).toEqual({ threatType: "SCANNER", confidence: 0.99 });
    expect(seededHoneypotClassification("opencanary-mysql-auth")).toEqual({ threatType: "BRUTE_FORCE", confidence: 0.99 });
    expect(seededHoneypotClassification("opencanary-redis-command")).toEqual({ threatType: "SERVICE_ABUSE", confidence: 0.99 });
    expect(severityFor("SERVICE_ABUSE", 0.99)).toBe("HIGH");
  });

  it("keeps unknown and low-confidence classifications low severity", () => {
    expect(severityFor("UNKNOWN", 0.99)).toBe("LOW");
    expect(severityFor("XSS", 0.54)).toBe("LOW");
  });

  it("masks source addresses before alert delivery", () => {
    expect(maskedIp("203.0.113.42")).toBe("203.0.113.xxx");
    expect(maskedIp("2001:db8:abcd:1::42")).toBe("2001:db8:abcd::/48");
  });

  it("classifies authorized local bot and scanner evidence deterministically", () => {
    expect(localDeterministicClassification("Path: /secure-admin-login\nPayload: username=admin")).toEqual({
      threatType: "CREDENTIAL_STUFFING",
      confidence: 0.96
    });
    expect(localDeterministicClassification("Path: /env\nEvent kind: FIREWALL")).toEqual({
      threatType: "SCANNER",
      confidence: 0.94
    });
    expect(localDeterministicClassification("User agent: SmartHoneyBotSim/1.0\nEvent kind: HONEYPOT")).toEqual({
      threatType: "BOT",
      confidence: 0.97
    });
  });
});
