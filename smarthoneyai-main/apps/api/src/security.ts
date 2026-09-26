import { createCipheriv, createDecipheriv, createHash, createHmac, generateKeyPairSync, randomBytes, sign, timingSafeEqual } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { canonicalJson } from "./domain.js";
import { env } from "./env.js";

export const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

export function controlPlaneRateLimitKey(path: string, ip: string, siteIdHeader: string | string[] | undefined) {
  const siteId = Array.isArray(siteIdHeader) ? "" : String(siteIdHeader ?? "");
  const signedAgentPath = (path.startsWith("/v1/agent/") && path !== "/v1/agent/enroll") || path === "/v1/network-sensors/heartbeat";
  if (signedAgentPath && /^c[a-z0-9]{10,63}$/i.test(siteId)) {
    return `agent:${siteId}`;
  }
  return `ip:${ip}`;
}

const encryptionKey = createHash("sha256").update(env.AGENT_SIGNING_SECRET).digest();
export function encryptSecret(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptSecret(value: string) {
  const [ivValue, tagValue, encryptedValue] = value.split(".");
  if (!ivValue || !tagValue || !encryptedValue) throw new Error("Invalid encrypted secret");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey, Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedValue, "base64url")), decipher.final()]).toString("utf8");
}

const generatedKeys = generateKeyPairSync("ed25519");
const privateKey = env.POLICY_SIGNING_PRIVATE_KEY
  ? Buffer.from(env.POLICY_SIGNING_PRIVATE_KEY, "base64").toString("utf8")
  : generatedKeys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
export const policyPublicKey = env.POLICY_SIGNING_PUBLIC_KEY
  ? Buffer.from(env.POLICY_SIGNING_PUBLIC_KEY, "base64").toString("utf8")
  : generatedKeys.publicKey.export({ type: "spki", format: "pem" }).toString();

export function signPolicy(policy: Record<string, unknown>) {
  const canonical = canonicalJson(policy);
  return sign(null, Buffer.from(canonical), privateKey).toString("base64");
}

export function verifyAgentSignature(request: FastifyRequest, body: string, secret: string) {
  const headers = request.headers;
  const timestamp = String(headers["x-honeypot-timestamp"] ?? "");
  const nonce = String(headers["x-honeypot-nonce"] ?? "");
  const bodyHash = String(headers["x-honeypot-content-sha256"] ?? "");
  const provided = String(headers["x-honeypot-signature"] ?? "");
  const idempotencyKey = String(headers["idempotency-key"] ?? "");
  const path = request.url.split("?")[0] ?? request.url;
  if (!timestamp || !nonce || !bodyHash || !provided || !idempotencyKey) return false;
  if (!isFreshAgentTimestamp(timestamp) || bodyHash !== sha256(body)) return false;
  const canonical = [request.method, path, timestamp, nonce, bodyHash, idempotencyKey].join("\n");
  const expected = createHmac("sha256", secret).update(canonical).digest("base64");
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function isFreshAgentTimestamp(timestamp: string, now = Date.now()) {
  if (!/^\d+$/.test(timestamp)) return false;
  const seconds = Number(timestamp);
  return Number.isSafeInteger(seconds) && Math.abs(now - seconds * 1000) <= 300_000;
}

const disallowedHeaders = new Set(["authorization", "cookie", "set-cookie", "proxy-authorization", "x-api-key"]);
export function sanitizeHeaders(input: Record<string, string>) {
  const output: Record<string, string> = {};
  let size = 0;
  for (const [rawKey, rawValue] of Object.entries(input)) {
    const key = rawKey.toLowerCase();
    if (disallowedHeaders.has(key) || /token|secret|password|credential/i.test(key)) continue;
    const value = String(rawValue).slice(0, 4096);
    size += key.length + value.length;
    if (size > 16_384) break;
    output[key] = value;
  }
  return output;
}

const sensitiveField = /password|passwd|pwd|token|secret|authorization|cookie|credential|nonce|session/i;
const sensitiveAssignment = /((?:password|passwd|pwd|token|secret|authorization|cookie|credential|nonce|session)["'\s:=/?&-]+)[^&\s"'/?]+/gi;

export function sanitizeEvidenceText(value: string | undefined, maxLength: number) {
  if (!value) return undefined;
  return value.replace(sensitiveAssignment, "$1[REDACTED]").slice(0, maxLength);
}

export function sanitizePayload(value?: string) {
  return sanitizeEvidenceText(value, 32_768);
}

export function sanitizeMetadata(input: Record<string, string | number | boolean | null>) {
  const output: Record<string, string | number | boolean | null> = {};
  for (const [rawKey, rawValue] of Object.entries(input).slice(0, 100)) {
    const key = rawKey.slice(0, 128);
    if (sensitiveField.test(key)) continue;
    output[key] = typeof rawValue === "string" ? (sanitizeEvidenceText(rawValue, 4096) ?? "") : rawValue;
  }
  return output;
}
