import { describe, expect, it } from "vitest";
import { normalizeOpenCanary } from "../src/normalize.js";

describe("OpenCanary normalization", () => {
  it("maps SSH auth without retaining credentials", () => {
    const event = normalizeOpenCanary({ logtype: 4002, local_time: "2026-09-03T01:02:03Z", src_host: "203.0.113.44", src_port: 51234, dst_port: 2222, logdata: { USERNAME: "admin", PASSWORD: "top-secret", session: "do-not-store" } });
    expect(event).toMatchObject({ protocol: "SSH", activity: "AUTH_ATTEMPT", honeypotKey: "opencanary-ssh-auth" });
    expect(JSON.stringify(event)).not.toContain("top-secret");
    expect(JSON.stringify(event)).not.toContain("admin");
  });

  it("drops Redis AUTH arguments", () => {
    const event = normalizeOpenCanary({ logtype: 17001, src_host: "198.51.100.8", dst_port: 16379, logdata: { COMMAND: "AUTH hunter2", args: ["hunter2"] } });
    expect(event).toMatchObject({ protocol: "REDIS", activity: "COMMAND", honeypotKey: "opencanary-redis-command" });
    expect(JSON.stringify(event)).not.toContain("hunter2");
    expect(JSON.stringify(event)).not.toContain("AUTH hunter2");
  });

  it("ignores unsupported and malformed signals", () => {
    expect(normalizeOpenCanary({ logtype: 1000, src_host: "203.0.113.1" })).toBeNull();
    expect(normalizeOpenCanary({ logtype: 4000, src_host: "not-an-ip" })).toBeNull();
  });
});
