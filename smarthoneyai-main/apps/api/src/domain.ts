import { createHash } from "node:crypto";
import { isIP } from "node:net";

export const OBSERVATION_PERIOD_MS = 7 * 86_400_000;
export const ONLINE_WINDOW_MS = 10 * 60_000;
export const OFFLINE_WINDOW_MS = 15 * 60_000;
export const POLICY_REFRESH_WINDOW_MS = 10 * 60_000;
export const POLICY_LIFETIME_MS = 60 * 60_000;
export const DEFAULT_DENY_TTL_MS = 24 * 60 * 60_000;
export const MAX_DENY_TTL_MS = 30 * 24 * 60 * 60_000;
export const MIN_DENY_TTL_MS = 60_000;
export const REPEAT_ATTACKER_AUTO_BLOCK = {
  enabled: true,
  distinctRoutes: 3,
  windowSeconds: 600,
  blockSeconds: 86_400
} as const;

export function canonicalJson(value: unknown): string {
  const normalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(normalize);
    if (item && typeof item === "object") {
      return Object.fromEntries(Object.entries(item as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, normalize(nested)]));
    }
    return item;
  };
  return JSON.stringify(normalize(value));
}

export const decoyDefinitions = {
  "sql-injection-trap": { name: "SQL injection honeypot", path: "/database/query", template: "DATABASE_LOGIN" },
  "xss-probe-trap": { name: "XSS honeypot", path: "/preview/render", template: "FAKE_LOGIN" },
  "command-injection-trap": { name: "Command injection honeypot", path: "/system/diagnostics", template: "DIAGNOSTIC" },
  "fake-login": { name: "Fake administration login", path: "/secure-admin-login", template: "FAKE_LOGIN" },
  "backup-archive": { name: "Backup archive", path: "/wp-content/backups/site-backup.zip", template: "ARCHIVE" },
  "admin-console": { name: "Internal administration console", path: "/internal/admin-console", template: "FAKE_LOGIN" },
  phpmyadmin: { name: "Database administration", path: "/phpmyadmin", template: "DATABASE_LOGIN" },
  "environment-file": { name: "Environment diagnostic endpoint", path: "/env", template: "DIAGNOSTIC" },
  "git-config": { name: "Source control diagnostic endpoint", path: "/git-config", template: "DIAGNOSTIC" },
  "wp-config-backup": { name: "WordPress configuration diagnostic", path: "/wp-config-backup", template: "DIAGNOSTIC" },
  "server-status": { name: "Server diagnostic endpoint", path: "/server-diagnostics", template: "DIAGNOSTIC" },
  adminer: { name: "Adminer database console", path: "/adminer.php", template: "DATABASE_LOGIN" },
  "debug-log": { name: "WordPress debug diagnostic", path: "/debug-log", template: "DIAGNOSTIC" },
  "database-dump": { name: "Database backup", path: "/backup.sql", template: "ARCHIVE" },
  "actuator-env": { name: "Application environment endpoint", path: "/actuator/env", template: "JSON_ERROR" }
} as const;

export function customHoneypotKey(entropy: string) {
  return `custom-${createHash("sha256").update(entropy).digest("hex").slice(0, 18)}`;
}

const protectedHoneypotPaths = ["/", "/wp-login.php", "/xmlrpc.php", "/wp-cron.php"];
const protectedHoneypotPrefixes = ["/wp-admin", "/wp-json"];

export function normalizeHoneypotPath(input: string) {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/") || trimmed.length > 190 || /[\s\\?#\u0000-\u001f\u007f]/.test(trimmed)) {
    throw new DomainValidationError("HONEYPOT_PATH", "Honeypot routes must be absolute paths without whitespace, queries, fragments, or control characters.");
  }
  const path = trimmed.replace(/\/{2,}/g, "/").replace(/\/$/, "") || "/";
  if (path.split("/").some((part) => part === "." || part === "..")) {
    throw new DomainValidationError("HONEYPOT_PATH", "Honeypot routes cannot contain relative path segments.");
  }
  const lower = path.toLowerCase();
  if (protectedHoneypotPaths.includes(lower) || protectedHoneypotPrefixes.some((prefix) => lower === prefix || lower.startsWith(`${prefix}/`))) {
    throw new DomainValidationError("HONEYPOT_PATH_RESERVED", "This route is reserved by WordPress and cannot be used as a honeypot.", 422);
  }
  return path;
}

export type ConnectionStatus = "PENDING" | "ONLINE" | "DEGRADED" | "OFFLINE" | "REVOKED";

export function connectionStatus(input: {
  persistedStatus: ConnectionStatus;
  lastSeenAt: Date | null;
  heartbeatHealth?: string | null;
}, now = new Date()): ConnectionStatus {
  if (input.persistedStatus === "REVOKED") return "REVOKED";
  if (!input.lastSeenAt) return input.persistedStatus === "PENDING" ? "PENDING" : "OFFLINE";
  const age = Math.max(0, now.getTime() - input.lastSeenAt.getTime());
  if (age > OFFLINE_WINDOW_MS) return "OFFLINE";
  if (age > ONLINE_WINDOW_MS || input.heartbeatHealth !== "HEALTHY") return "DEGRADED";
  return "ONLINE";
}

export type SelfTestCleanupDisposition = "ALREADY_CLEANED" | "RUN_ONLY" | "RULE" | "REJECT";

export function selfTestCleanupDisposition(status: string, firewallRuleId: string | null): SelfTestCleanupDisposition {
  if (status === "CLEANED") return "ALREADY_CLEANED";
  if (["CREATED", "RUNNING", "DETECTED"].includes(status) && !firewallRuleId) return "RUN_ONLY";
  if (status === "CONTAINED" && firewallRuleId) return "RULE";
  return "REJECT";
}

export function effectivePolicyMode(siteMode: string, hasContainedSelfTest: boolean): "ENFORCE" | "OBSERVE" {
  return siteMode === "ENFORCE" || hasContainedSelfTest ? "ENFORCE" : "OBSERVE";
}

export class DomainValidationError extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode = 400) {
    super(message);
  }
}

export function normalizeSiteUrl(value: string, allowLocalHttp = false) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new DomainValidationError("SITE_URL", "Enter a valid WordPress site URL.");
  }
  const localHosts = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
  const localHttp = allowLocalHttp && url.protocol === "http:" && localHosts.has(url.hostname.toLowerCase());
  if (url.protocol !== "https:" && !localHttp) {
    throw new DomainValidationError("SITE_URL_HTTPS", "WordPress site URLs must use HTTPS. HTTP is allowed only for local development.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new DomainValidationError("SITE_URL", "WordPress site URLs cannot contain credentials, a query, or a fragment.");
  }
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return { url: url.toString(), domain: url.hostname.toLowerCase() };
}

type RuleType = "ALLOW_IP" | "BLOCK_IP" | "BLOCK_COUNTRY" | "BLOCK_USER_AGENT" | "BLOCK_ROUTE" | "RATE_LIMIT";

function validateIpOrCidr(value: string) {
  const [address, prefix, extra] = value.split("/");
  const version = isIP(address ?? "");
  if (!version || extra !== undefined) return false;
  if (prefix === undefined) return true;
  if (!/^\d{1,3}$/.test(prefix)) return false;
  const bits = Number(prefix);
  return bits >= 0 && bits <= (version === 4 ? 32 : 128);
}

export function isProtectedAddress(value: string) {
  const address = value.trim().toLowerCase();
  const version = isIP(address);
  if (!version) return true;
  if (version === 4) {
    const octets = address.split(".").map(Number);
    const [a, b] = octets;
    const third = octets[2];
    return a === 0 || a === 10 || a === 127 ||
      (a === 100 && b! >= 64 && b! <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b! >= 16 && b! <= 31) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && third === 100) ||
      (a === 203 && b === 0 && third === 113) ||
      a! >= 224;
  }
  if (address.startsWith("::ffff:")) return isProtectedAddress(address.slice(7));
  return address === "::1" || address === "::" || address.startsWith("fc") || address.startsWith("fd") || /^fe[89ab]/.test(address) || address.startsWith("ff") || address.startsWith("2001:db8:");
}

function denyExpiry(type: RuleType, expiresAt: string | null | undefined, now: Date) {
  if (type === "ALLOW_IP") return expiresAt ? new Date(expiresAt) : null;
  const parsed = expiresAt ? new Date(expiresAt) : new Date(now.getTime() + DEFAULT_DENY_TTL_MS);
  const ttl = parsed.getTime() - now.getTime();
  if (!Number.isFinite(parsed.getTime()) || ttl < MIN_DENY_TTL_MS || ttl > MAX_DENY_TTL_MS) {
    throw new DomainValidationError("RULE_TTL", "Active deny and rate-limit rules must expire between one minute and 30 days from now.");
  }
  return parsed;
}

export function normalizeFirewallRule(input: {
  type: RuleType;
  value: string;
  expiresAt?: string | null;
}, now = new Date()) {
  const value = input.value.trim();
  if (input.type === "BLOCK_COUNTRY") {
    throw new DomainValidationError("GEOIP_NOT_CONFIGURED", "Country blocking is unavailable until a trusted GeoIP source is configured.", 422);
  }
  if (["ALLOW_IP", "BLOCK_IP"].includes(input.type) && !validateIpOrCidr(value)) {
    throw new DomainValidationError("RULE_VALUE", "IP rules require a valid IPv4/IPv6 address or CIDR range.");
  }
  if (input.type === "BLOCK_ROUTE" && (!value.startsWith("/") || /[\s?#]/.test(value) || value.slice(0, -1).includes("*"))) {
    throw new DomainValidationError("RULE_VALUE", "Route rules require an absolute path and may use a single trailing wildcard.");
  }
  if (input.type === "BLOCK_USER_AGENT" && (/\p{Cc}/u.test(value) || value.length > 256)) {
    throw new DomainValidationError("RULE_VALUE", "User-agent rules must be printable text no longer than 256 characters.");
  }
  if (input.type === "RATE_LIMIT") {
    const match = /^(\d{1,5})\/(\d{1,5})$/.exec(value);
    const limit = Number(match?.[1]);
    const windowSeconds = Number(match?.[2]);
    if (!match || limit < 1 || limit > 10_000 || windowSeconds < 10 || windowSeconds > 86_400) {
      throw new DomainValidationError("RULE_VALUE", "Rate limits use requests/window-seconds with ranges 1-10000/10-86400.");
    }
  }
  return { value, expiresAt: denyExpiry(input.type, input.expiresAt, now) };
}

export function normalizeFirewallRuleUpdate(input: {
  type: RuleType;
  currentExpiresAt: Date | null;
  enabled?: boolean;
  expiresAt?: string | null;
}, now = new Date()) {
  if (input.type === "BLOCK_COUNTRY" && input.enabled !== false) {
    throw new DomainValidationError("GEOIP_NOT_CONFIGURED", "Country blocking is unavailable until a trusted GeoIP source is configured.", 422);
  }
  if (input.type === "ALLOW_IP") return input.expiresAt === undefined ? input.currentExpiresAt : input.expiresAt ? new Date(input.expiresAt) : null;
  if (input.enabled === false && input.expiresAt === undefined) return input.currentExpiresAt;
  const requested = input.expiresAt === undefined ? input.currentExpiresAt?.toISOString() : input.expiresAt;
  return denyExpiry(input.type, requested, now);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonicalize(item)]));
  }
  return value;
}

export function policySourceHash(source: unknown) {
  return createHash("sha256").update(JSON.stringify(canonicalize(source))).digest("hex");
}

export function policyNeedsRefresh(expiresAt: Date, now = new Date()) {
  return expiresAt.getTime() - now.getTime() <= POLICY_REFRESH_WINDOW_MS;
}

export function policyCanBeReused(latest: { sourceHash: string; expiresAt: Date } | null, sourceHash: string, now = new Date()): latest is { sourceHash: string; expiresAt: Date } {
  return Boolean(latest && latest.sourceHash === sourceHash && !policyNeedsRefresh(latest.expiresAt, now));
}
