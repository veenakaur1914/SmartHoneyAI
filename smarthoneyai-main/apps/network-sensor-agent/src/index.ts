import { createHash, createHmac, randomBytes } from "node:crypto";
import { createServer as createHttpServer } from "node:http";
import { createServer as createTcpServer, isIP } from "node:net";
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { normalizeOpenCanary } from "./normalize.js";

declare const __SENSOR_DEMO_BUILD__: boolean;

const version = "1.1.0";
const dataDir = process.env.SENSOR_DATA_DIR ?? "/data";
const spoolDir = join(dataDir, "spool");
const credentialPath = join(dataDir, "credentials.json");
const controlPlane = (process.env.NETWORK_SENSOR_CONTROL_PLANE_URL ?? "").replace(/\/$/, "");
const sensorName = process.env.NETWORK_SENSOR_NAME ?? "";
const enrollmentToken = process.env.NETWORK_SENSOR_ENROLLMENT_TOKEN ?? "";
const allowlist = new Set((process.env.NETWORK_SENSOR_ALLOWLIST ?? "").split(",").map((item) => item.trim()).filter(Boolean));
let demoSourceIp = "";
let selfTestRunId = "";
let localDemo = false;
let localPackageTest = false;
if (__SENSOR_DEMO_BUILD__) {
  const runtimeProfile = process.env.SENSOR_RUNTIME_PROFILE ?? "production";
  demoSourceIp = (process.env.SENSOR_DEMO_SOURCE_IP ?? "").trim();
  selfTestRunId = (process.env.SENSOR_DEMO_RUN_ID ?? "").trim();
  localDemo = runtimeProfile === "local-self-test";
  localPackageTest = runtimeProfile === "local-package-test";
}
const maxSpoolBytes = 64 * 1024 * 1024;
let droppedEvents = 0;
let lastErrorCode: string | null = null;
let receivedSignals = 0;
let acceptedSignals = 0;
let ignoredSignals = 0;
let receivedFrames = 0;
let invalidFrames = 0;
let lastFrameShape: { bytes: number; firstCharacter: string | null } | null = null;
let lastSignalShape: { logtype: number | null; sourceType: string } | null = null;

type Credentials = { sensorId: string; keyId: string; secret: string };
type SafeEvent = NonNullable<ReturnType<typeof normalizeOpenCanary>> & {
  sourceAttribution?: "OBSERVED" | "DEMO_OVERRIDE";
  selfTestRunId?: string;
};

async function saveJsonAtomic(path: string, value: unknown) {
  const temp = `${path}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(temp, JSON.stringify(value), { mode: 0o600 });
  await rename(temp, path);
}

async function credentials(): Promise<Credentials> {
  let controlPlaneUrl: URL;
  try { controlPlaneUrl = new URL(controlPlane); } catch { throw new Error("CONTROL_PLANE_URL_INVALID"); }
  let validProtocol = controlPlaneUrl.protocol === "https:";
  if (__SENSOR_DEMO_BUILD__) validProtocol ||= localPackageTest && controlPlaneUrl.protocol === "http:";
  if (!validProtocol || controlPlaneUrl.username || controlPlaneUrl.password) throw new Error("CONTROL_PLANE_HTTPS_REQUIRED");
  const productionGate = !localDemo && allowlist.size > 0 && [...allowlist].every((address) => Boolean(isIP(address))) && process.env.PROVIDER_FIREWALL_ALLOWLIST_CONFIRMED === "YES";
  let localGate = false;
  let packageTestGate = false;
  if (__SENSOR_DEMO_BUILD__) {
    localGate = localDemo && Boolean(isIP(demoSourceIp)) && selfTestRunId.length > 10 && process.env.PROVIDER_FIREWALL_ALLOWLIST_CONFIRMED === "LOCAL_ONLY";
    packageTestGate = localPackageTest && process.env.PROVIDER_FIREWALL_ALLOWLIST_CONFIRMED === "LOCAL_ONLY";
  }
  if (!sensorName || (!productionGate && !localGate && !packageTestGate)) throw new Error("NETWORK_EXPOSURE_GATE_FAILED");
  try { return JSON.parse(await readFile(credentialPath, "utf8")) as Credentials; } catch { /* first boot */ }
  if (!enrollmentToken) throw new Error("ENROLLMENT_CONFIGURATION_MISSING");
  const response = await fetch(`${controlPlane}/v1/network-sensors/enroll`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: enrollmentToken, sensorName, agentVersion: version }), signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`ENROLLMENT_${response.status}`);
  const enrolled = await response.json() as Credentials;
  await saveJsonAtomic(credentialPath, enrolled);
  return enrolled;
}

async function signedFetch(path: string, method: "POST", body: unknown, auth: Credentials) {
  const raw = JSON.stringify(body);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = randomBytes(18).toString("base64url");
  const bodyHash = createHash("sha256").update(raw).digest("hex");
  const idempotencyKey = randomBytes(18).toString("base64url");
  const signature = createHmac("sha256", auth.secret).update([method, path, timestamp, nonce, bodyHash, idempotencyKey].join("\n")).digest("base64");
  return fetch(`${controlPlane}${path}`, { method, headers: { "content-type": "application/json", "x-honeypot-sensor-id": auth.sensorId, "x-honeypot-key-id": auth.keyId, "x-honeypot-timestamp": timestamp, "x-honeypot-nonce": nonce, "x-honeypot-content-sha256": bodyHash, "x-honeypot-signature": signature, "idempotency-key": idempotencyKey }, body: raw, signal: AbortSignal.timeout(15_000) });
}

async function spoolSize(files: string[]) {
  let bytes = 0;
  for (const file of files) bytes += (await stat(join(spoolDir, file))).size;
  return bytes;
}

async function retainWithinLimit() {
  const files = (await readdir(spoolDir)).filter((file) => file.endsWith(".json")).sort();
  let bytes = await spoolSize(files);
  while ((bytes > maxSpoolBytes || files.length > 10_000) && files.length) {
    const file = files.shift()!;
    const path = join(spoolDir, file);
    bytes -= (await stat(path)).size;
    await unlink(path);
    droppedEvents += 1;
  }
}

async function spool(event: SafeEvent) {
  await saveJsonAtomic(join(spoolDir, `${Date.now()}-${randomBytes(8).toString("hex")}.json`), event);
  await retainWithinLimit();
}

async function purgeStaleDemoSpool() {
  if (!__SENSOR_DEMO_BUILD__ || !localDemo) return;
  const files = (await readdir(spoolDir)).filter((file) => file.endsWith(".json"));
  for (const file of files) {
    const path = join(spoolDir, file);
    try {
      const event = JSON.parse(await readFile(path, "utf8")) as SafeEvent;
      if (event.sourceAttribution === "DEMO_OVERRIDE" && event.selfTestRunId !== selfTestRunId) await unlink(path);
    } catch {
      // Leave malformed files for the bounded spool logic instead of deleting
      // data whose ownership cannot be proven to belong to an older demo run.
    }
  }
}

async function flush(auth: Credentials) {
  const files = (await readdir(spoolDir)).filter((file) => file.endsWith(".json")).sort().slice(0, 100);
  if (!files.length) return;
  const events = await Promise.all(files.map(async (file) => JSON.parse(await readFile(join(spoolDir, file), "utf8")) as SafeEvent));
  const response = await signedFetch("/v1/agent/events/batch", "POST", { sensorId: auth.sensorId, agentVersion: version, events }, auth);
  if (!response.ok) throw new Error(`INGEST_${response.status}`);
  await Promise.all(files.map((file) => unlink(join(spoolDir, file))));
}

async function heartbeat(auth: Credentials) {
  const queueDepth = (await readdir(spoolDir)).filter((file) => file.endsWith(".json")).length;
  const response = await signedFetch("/v1/network-sensors/heartbeat", "POST", { agentVersion: version, queueDepth, health: lastErrorCode ? "DEGRADED" : "HEALTHY", enabledServices: ["SSH", "MYSQL", "REDIS"], droppedEvents, lastErrorCode }, auth);
  if (!response.ok) throw new Error(`HEARTBEAT_${response.status}`);
}

await mkdir(spoolDir, { recursive: true, mode: 0o700 });
await purgeStaleDemoSpool();
const auth = await credentials();

createTcpServer((socket) => {
  socket.setEncoding("utf8");
  let buffer = "";
  socket.on("data", (chunk) => {
    buffer += String(chunk);
    if (buffer.length > 65_536) { buffer = ""; socket.destroy(); return; }
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
      receivedFrames += 1;
      lastFrameShape = { bytes: Buffer.byteLength(line), firstCharacter: line.length ? line[0]! : null };
      try {
        const raw = JSON.parse(line) as Record<string, unknown>;
        receivedSignals += 1;
        lastSignalShape = { logtype: Number.isFinite(Number(raw.logtype)) ? Number(raw.logtype) : null, sourceType: typeof raw.src_host };
        const observed = normalizeOpenCanary(raw);
        let allowed = observed && allowlist.has(observed.ipAddress);
        let event: SafeEvent | null = observed;
        if (__SENSOR_DEMO_BUILD__) {
          allowed = observed && (localDemo || localPackageTest || allowlist.has(observed.ipAddress));
          if (allowed && localDemo && observed) {
            event = { ...observed, ipAddress: demoSourceIp, sourceAttribution: "DEMO_OVERRIDE", selfTestRunId };
          }
        }
        if (event && allowed) {
          acceptedSignals += 1;
          void spool(event).catch(() => { lastErrorCode = "SPOOL_WRITE"; });
        } else {
          ignoredSignals += 1;
          lastErrorCode = observed ? "SOURCE_NOT_ALLOWLISTED" : "UNSUPPORTED_SIGNAL";
        }
      } catch { invalidFrames += 1; lastErrorCode = "INVALID_SIGNAL"; }
      newline = buffer.indexOf("\n");
    }
  });
}).listen(1514, "0.0.0.0");

createHttpServer((request, response) => {
  if (request.url === "/health/live") response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ status: "ok", receivedFrames, invalidFrames, receivedSignals, acceptedSignals, ignoredSignals, lastFrameShape, lastSignalShape, lastErrorCode }));
  else response.writeHead(404).end();
}).listen(4010, "0.0.0.0");

async function cycle() {
  try { await flush(auth); lastErrorCode = null; } catch (error) { lastErrorCode = error instanceof Error ? error.message.slice(0, 64) : "INGEST_ERROR"; }
}
setInterval(() => void cycle(), 5_000).unref();
setInterval(() => void heartbeat(auth).catch((error) => { lastErrorCode = error instanceof Error ? error.message.slice(0, 64) : "HEARTBEAT_ERROR"; }), 300_000).unref();
await cycle();
await heartbeat(auth).catch(() => undefined);
let sourceAttribution = "OBSERVED";
if (__SENSOR_DEMO_BUILD__ && localDemo) sourceAttribution = "DEMO_OVERRIDE";
console.log(JSON.stringify({ level: "info", service: "network-sensor-agent", message: "Sensor agent ready", version, sourceAttribution }));
