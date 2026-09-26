import { describe, expect, it } from "vitest";
import { matchingTelegramChat, telegramProviderError } from "../src/telegram.js";

describe("Telegram organization connection", () => {
  it("selects the newest chat with the exact one-time command", () => {
    expect(matchingTelegramChat([
      { update_id: 1, message: { text: "/connect 12345678", chat: { id: 111, type: "private" } } },
      { update_id: 2, message: { text: "/connect@SmartHoneyAlertBot 12345678", chat: { id: -222, type: "supergroup", title: "FYP 26S2G1" } } }
    ], "12345678")).toEqual({ id: -222, type: "supergroup", title: "FYP 26S2G1" });
  });

  it("rejects partial, stale, and unsupported chat evidence", () => {
    expect(matchingTelegramChat([
      { message: { text: "/connect 1234567", chat: { id: 111, type: "private" } } },
      { message: { text: "/connect 12345678 extra", chat: { id: 222, type: "private" } } },
      { message: { text: "/connect 12345678", chat: { id: 333, type: "channel" } } }
    ], "12345678")).toBeUndefined();
  });

  it("returns actionable provider errors without exposing provider bodies", () => {
    expect(telegramProviderError(401)).toContain("bot token");
    expect(telegramProviderError(403)).toContain("posting permission");
    expect(telegramProviderError(429)).toContain("rate-limiting");
    expect(telegramProviderError(502)).toBe("Telegram delivery failed with HTTP 502.");
  });
});
