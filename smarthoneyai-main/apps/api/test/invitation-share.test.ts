import { describe, expect, it } from "vitest";
import { buildInvitationShare } from "../src/invitation-share.js";

describe("manual invitation sharing", () => {
  it("keeps the one-time token in a URL fragment and produces bounded share text", () => {
    const token = "a".repeat(54);
    const expiresAt = new Date("2026-09-08T12:00:00.000Z");
    const result = buildInvitationShare({
      appUrl: "https://security.example.com",
      token,
      organizationName: "Example\nSecurity\u202e https://evil.example/invite",
      email: "analyst@example.com",
      role: "ANALYST",
      expiresAt
    });

    const url = new URL(result.url);
    expect(url.origin).toBe("https://security.example.com");
    expect(url.pathname).toBe("/accept-invitation");
    expect(url.search).toBe("");
    expect(url.hash.slice(1)).toBe(token);
    expect(result.shareText).toContain("Example Security");
    expect(result.shareText).toContain("[link removed]");
    expect(result.shareText).toContain("analyst@example.com");
    expect(result.shareText).toContain(result.url);
    expect(result.shareText).not.toContain("Example\nSecurity");
    expect(result.shareText).not.toContain("evil.example");
    expect(result.shareText).not.toContain("\u202e");
  });
});
