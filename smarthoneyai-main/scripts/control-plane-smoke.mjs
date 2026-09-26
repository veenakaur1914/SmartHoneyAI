import { createHash, createHmac, createPublicKey, randomUUID, verify } from "node:crypto";
import { assertSyntheticTarget } from "./synthetic-target-guard.mjs";

const baseUrl = (process.env.BASE_URL ?? "https://localhost").replace(/\/$/, "");
const appOrigin = (process.env.APP_ORIGIN ?? baseUrl).replace(/\/$/, "");
const email = process.env.ADMIN_EMAIL ?? "admin@smarthoneyai.local";
const password = process.env.ADMIN_PASSWORD ?? "ChangeThisLocalDemoPassword123!";

assertSyntheticTarget(baseUrl, { label: "Control-plane smoke test" });

async function call(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`${options.method ?? "GET"} ${path} failed (${response.status}): ${text.slice(0, 300)}`);
  return { response, data };
}

function signedHeaders(method, path, body, siteId, keyId, secret) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = randomUUID();
  const idempotencyKey = `smoke-${randomUUID()}`;
  const bodyHash = createHash("sha256").update(body).digest("hex");
  const canonical = [method, path, timestamp, nonce, bodyHash, idempotencyKey].join("\n");
  return {
    "content-type": "application/json",
    "x-honeypot-site-id": siteId,
    "x-honeypot-key-id": keyId,
    "x-honeypot-timestamp": timestamp,
    "x-honeypot-nonce": nonce,
    "x-honeypot-content-sha256": bodyHash,
    "x-honeypot-signature": createHmac("sha256", secret).update(canonical).digest("base64"),
    "idempotency-key": idempotencyKey
  };
}

function canonicalJson(value) {
  const normalize = (item) => {
    if (Array.isArray(item)) return item.map(normalize);
    if (item && typeof item === "object") return Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right)).map(([key, nested]) => [key, normalize(nested)]));
    return item;
  };
  return JSON.stringify(normalize(value));
}

const login = await call("/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
const cookie = login.response.headers.get("set-cookie")?.split(";")[0];
if (!cookie) throw new Error("Login did not return a session cookie");
const me = await call("/v1/auth/me", { headers: { cookie } });
const membership = me.data.user.memberships[0];
if (!membership) throw new Error("Seeded administrator has no organization membership");
const browserHeaders = { cookie, "x-organization-id": membership.organizationId, origin: appOrigin, "content-type": "application/json" };

const unique = Date.now().toString(36);
const siteUrl = `https://smoke-${unique}.example.test/`;
const siteResult = await call("/v1/sites", { method: "POST", headers: browserHeaders, body: JSON.stringify({ name: "Smoke Test WordPress", url: siteUrl }) });
const proof = createHmac("sha256", siteResult.data.enrollmentToken).update(siteUrl.replace(/\/$/, "")).digest("hex");
const enrollment = await call("/v1/agent/enroll", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: siteResult.data.enrollmentToken, siteUrl, siteName: "Smoke Test WordPress", pluginVersion: "1.0.0", proof }) });
const { siteId, keyId, secret, policyPublicKey } = enrollment.data;

const batchPath = "/v1/agent/events/batch";
const batchBody = JSON.stringify({ siteId, pluginVersion: "1.0.0", events: [{ idempotencyKey: `event-${randomUUID()}`, occurredAt: new Date().toISOString(), kind: "HONEYPOT", method: "POST", path: "/phpmyadmin", ipAddress: "198.51.100.80", userAgent: "SmartHoneyAI smoke test", headers: { accept: "*/*", authorization: "must-be-redacted" }, payload: "username=demo&password=must-be-redacted", honeypotKey: "phpmyadmin", action: "OBSERVED", metadata: { smoke: true } }] });
const ingested = await call(batchPath, { method: "POST", headers: signedHeaders("POST", batchPath, batchBody, siteId, keyId, secret), body: batchBody });
const storedEvents = await call("/v1/events?search=198.51.100.80", { headers: browserHeaders });
const storedEvent = storedEvents.data.data.find((event) => event.siteId === siteId);
if (!storedEvent || storedEvent.headers.authorization || storedEvent.payload?.includes("must-be-redacted")) throw new Error("Sensitive event evidence was not redacted before storage");

const configPath = "/v1/agent/config";
const policyResult = await call(configPath, { headers: signedHeaders("GET", configPath, "", siteId, keyId, secret) });
const { signature, ...unsignedPolicy } = policyResult.data;
const publicKey = createPublicKey(Buffer.from(policyPublicKey, "base64").toString("utf8"));
const signatureValid = verify(null, Buffer.from(canonicalJson(unsignedPolicy)), publicKey, Buffer.from(signature, "base64"));
if (!signatureValid) throw new Error("Published policy signature is invalid");

const heartbeatPath = "/v1/agent/heartbeat";
const heartbeatBody = JSON.stringify({
  pluginVersion: "1.0.0",
  queueDepth: 0,
  policyVersion: unsignedPolicy.version,
  mode: "OBSERVE",
  health: "HEALTHY",
  enabledDecoys: ["fake-login", "backup-archive", "admin-console", "phpmyadmin"],
  droppedEvents: 0,
  lastErrorCode: null
});
await call(heartbeatPath, { method: "POST", headers: signedHeaders("POST", heartbeatPath, heartbeatBody, siteId, keyId, secret), body: heartbeatBody });
const summary = await call("/v1/dashboard/summary", { headers: browserHeaders });

console.log(JSON.stringify({ ok: true, organizationId: membership.organizationId, siteId, acceptedEvents: ingested.data.accepted, redactionVerified: true, policyVersion: unsignedPolicy.version, signatureValid, dashboardSites: summary.data.sites }, null, 2));
