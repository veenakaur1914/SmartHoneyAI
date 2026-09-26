import { createHash } from "node:crypto";
import { isIP } from "node:net";

type SafeEvent = {
  idempotencyKey: string;
  occurredAt: string;
  kind: "HONEYPOT";
  action: "OBSERVED";
  method: string;
  path: string;
  ipAddress: string;
  honeypotKey: string;
  protocol: "SSH" | "MYSQL" | "REDIS";
  activity: "CONNECTION" | "BANNER" | "AUTH_ATTEMPT" | "COMMAND";
  sourcePort?: number;
  destinationPort: number;
  sessionId?: string;
  metadata: Record<string, string | number | boolean | null>;
};

const signals: Record<number, Pick<SafeEvent, "honeypotKey" | "protocol" | "activity" | "method" | "path" | "destinationPort">> = {
  4000: { honeypotKey: "opencanary-ssh-connection", protocol: "SSH", activity: "CONNECTION", method: "CONNECT", path: "ssh://sensor:2222", destinationPort: 2222 },
  4001: { honeypotKey: "opencanary-ssh-connection", protocol: "SSH", activity: "BANNER", method: "BANNER", path: "ssh://sensor:2222", destinationPort: 2222 },
  4002: { honeypotKey: "opencanary-ssh-auth", protocol: "SSH", activity: "AUTH_ATTEMPT", method: "AUTH", path: "ssh://sensor:2222", destinationPort: 2222 },
  8001: { honeypotKey: "opencanary-mysql-auth", protocol: "MYSQL", activity: "AUTH_ATTEMPT", method: "AUTH", path: "mysql://sensor:13306", destinationPort: 13306 },
  9003: { honeypotKey: "opencanary-mysql-connection", protocol: "MYSQL", activity: "CONNECTION", method: "CONNECT", path: "mysql://sensor:13306", destinationPort: 13306 },
  17001: { honeypotKey: "opencanary-redis-command", protocol: "REDIS", activity: "COMMAND", method: "COMMAND", path: "redis://sensor:16379", destinationPort: 16379 }
};

function safePort(value: unknown) {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : undefined;
}

/** Allowlist-only projection. OpenCanary logdata is deliberately never copied. */
export function normalizeOpenCanary(raw: unknown): SafeEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const input = raw as Record<string, unknown>;
  const logtype = Number(input.logtype);
  const signal = signals[logtype];
  const ipAddress = String(input.src_host ?? "").trim();
  if (!signal || !isIP(ipAddress)) return null;
  const occurredAt = Number.isFinite(Date.parse(String(input.local_time ?? ""))) ? new Date(String(input.local_time)).toISOString() : new Date().toISOString();
  const sourcePort = safePort(input.src_port);
  const destinationPort = safePort(input.dst_port) ?? signal.destinationPort;
  const safeIdentity = JSON.stringify({ logtype, occurredAt, ipAddress, sourcePort, destinationPort, node: String(input.node_id ?? "sensor").slice(0, 80) });
  return {
    ...signal,
    idempotencyKey: `oc_${createHash("sha256").update(safeIdentity).digest("hex")}`,
    occurredAt,
    kind: "HONEYPOT",
    action: "OBSERVED",
    ipAddress,
    sourcePort,
    destinationPort,
    sessionId: createHash("sha256").update(`${ipAddress}:${sourcePort ?? 0}:${destinationPort}:${occurredAt}`).digest("hex").slice(0, 32),
    metadata: { provider: "opencanary", logtype }
  };
}
