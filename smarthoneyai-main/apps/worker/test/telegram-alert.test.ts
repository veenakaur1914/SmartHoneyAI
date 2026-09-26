import { describe, expect, it } from "vitest";
import { blockedAccessTelegramMessage, formatMalaysiaDateTime, incidentTelegramMessage, telegramDeliveryError } from "../src/telegram-alert.js";

describe("Telegram blocked-access notifications", () => {
  it("formats received timestamps in Malaysia time", () => {
    expect(formatMalaysiaDateTime(new Date("2026-08-10T15:40:00.000Z"))).toContain("11:40");
    expect(formatMalaysiaDateTime(new Date("2026-08-10T15:40:00.000Z")).endsWith("MYT")).toBe(true);
  });

  it("includes blocked request evidence without exposing the raw source address", () => {
    const message = blockedAccessTelegramMessage({
      eventId: "cmsnef17p0069ru06r9c00u5b",
      siteName: "DEMO System",
      method: "GET",
      path: "/adminer.php",
      ipHash: "d8cb595cf8b3ecce4b0db3d7b64b8c9d",
      receivedAt: new Date("2026-08-10T15:40:00.000Z"),
      reviewUrl: "https://smarthoneyai.xyz/dashboard/events"
    });

    expect(message).toContain("🛑 SmartHoneyAI blocked access");
    expect(message).toContain("Request: GET /adminer.php");
    expect(message).toContain("Site: DEMO System");
    expect(message).toContain("Action: BLOCKED");
    expect(message).toContain("cmsnef17p0069ru06r9c00u5b");
    expect(message).toContain("MYT");
    expect(message).not.toContain("115.132.159.246");
  });

  it("removes control characters from untrusted event fields", () => {
    const message = blockedAccessTelegramMessage({
      eventId: "event-1",
      siteName: "DEMO\nSystem",
      method: "GET\r\nInjected: yes",
      path: "/safe\nAction: ALLOWED",
      ipHash: "abc123",
      receivedAt: new Date("2026-08-10T15:40:00.000Z"),
      reviewUrl: "https://smarthoneyai.xyz/dashboard/events"
    });

    expect(message).not.toContain("\nInjected: yes");
    expect(message).not.toContain("\nAction: ALLOWED");
  });

  it.each(["SQL_INJECTION", "XSS", "COMMAND_INJECTION"])("names %s in incident alerts", (threatType) => {
    const message = incidentTelegramMessage({
      siteName: "Protected WordPress",
      threatType,
      severity: threatType === "XSS" ? "HIGH" : "CRITICAL",
      sourceIpHash: "203.0.113.42",
      reviewUrl: "https://smarthoneyai.xyz/dashboard/events"
    });
    expect(message).toContain(`Threat: ${threatType.replaceAll("_", " ")}`);
    expect(message).toContain("Review: https://smarthoneyai.xyz/dashboard/events");
  });

  it("keeps queued delivery failures actionable and bounded", () => {
    expect(telegramDeliveryError(401)).toContain("worker bot token");
    expect(telegramDeliveryError(403)).toContain("posting permission");
    expect(telegramDeliveryError(429)).toContain("rate-limited");
    expect(telegramDeliveryError(503)).toBe("Telegram delivery failed with HTTP 503.");
  });
});
