import { describe, expect, it } from "vitest";
import { AcceptInvitationSchema, AccessRequestRejectionSchema, ForgotPasswordSchema, ResetPasswordSchema, TeamInvitationSchema } from "../src/auth-schemas.js";

const token = "a".repeat(54);
const password = "a-secure-password-with-15-characters";

describe("account action schemas", () => {
  it("normalizes account email addresses", () => {
    expect(ForgotPasswordSchema.parse({ email: "  User@Example.COM " })).toEqual({ email: "user@example.com" });
    expect(TeamInvitationSchema.parse({ email: "  Member@Example.COM ", role: "ANALYST" })).toEqual({ email: "member@example.com", role: "ANALYST" });
  });

  it("rejects malformed request bodies", () => {
    expect(() => ForgotPasswordSchema.parse(null)).toThrow();
    expect(() => ResetPasswordSchema.parse({ token, password, unexpected: true })).toThrow();
    expect(() => AcceptInvitationSchema.parse({ token, name: "A", password })).toThrow();
    expect(() => TeamInvitationSchema.parse({ email: "member@example.com", role: "OWNER" })).toThrow();
    expect(() => AccessRequestRejectionSchema.parse({ reason: "" })).toThrow();
    expect(() => AccessRequestRejectionSchema.parse({ reason: "No", unexpected: true })).toThrow();
  });

  it("normalizes a bounded access-request rejection reason", () => {
    expect(AccessRequestRejectionSchema.parse({ reason: "  Outside the production pilot scope.  " }))
      .toEqual({ reason: "Outside the production pilot scope." });
  });

  it("bounds and constrains one-time tokens", () => {
    expect(() => ResetPasswordSchema.parse({ token: "short", password })).toThrow();
    expect(() => ResetPasswordSchema.parse({ token: "a".repeat(129), password })).toThrow();
    expect(() => ResetPasswordSchema.parse({ token: `${"a".repeat(53)}!`, password })).toThrow();
    expect(ResetPasswordSchema.parse({ token, password })).toEqual({ token, password });
  });
});
