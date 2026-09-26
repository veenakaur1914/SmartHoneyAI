import { createHash, createHmac, randomUUID } from "node:crypto";
import { appendFileSync, chmodSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { assertSyntheticTarget } from "./synthetic-target-guard.mjs";

const command = process.env.PERF_AGENT_COMMAND ?? process.argv[2] ?? "runtime";
const baseUrl = (process.env.PERF_AGENT_BASE_URL ?? process.env.BASE_URL ?? "https://localhost").replace(/\/$/, "");
const origin = (process.env.PERF_AGENT_ORIGIN ?? process.env.APP_ORIGIN ?? "https://localhost").replace(/\/$/, "");
const runId = process.env.PERF_RUN_ID ?? "local-perf";
const agentDir = resolve(process.env.PERF_AGENT_DIR ?? "/agents");
const statePath = resolve(process.env.PERF_AGENT_STATE_PATH ?? join(agentDir, "runtime-state.json"));
const cycleLogPath = process.env.PERF_AGENT_CYCLE_LOG ? resolve(process.env.PERF_AGENT_CYCLE_LOG) : null;
const pluginVersion = "0.1.0-perf";
const decoys = ["fake-login", "backup-archive", "admin-console", "phpmyadmin"];

assertSyntheticTarget(baseUrl, { label: "Synthetic performance agents" });

function atomicJson(path, value, sensitive = false) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: sensitive ? 0o600 : 0o640 });
  renameSync(temporary, path);
  chmodSync(path, sensitive ? 0o600 : 0o640);
}

async function call(path, options = {}, expected = null) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (expected !== null && ![].concat(expected).includes(response.status)) {
    throw new Error(`${options.method ?? "GET"} ${path} returned ${response.status}: ${text.slice(0, 240)}`);
  }
  return { response, data, text };
}

function signedHeaders(method, path, body, agent, extra = {}) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = randomUUID();
  const idempotencyKey = `perf-${runId}-${randomUUID()}`;
  const bodyHash = createHash("sha256").update(body).digest("hex");
  const canonical = [method, path, timestamp, nonce, bodyHash, idempotencyKey].join("\n");
  return {
    ...extra,
    "content-type": "application/json",
    "x-honeypot-site-id": agent.siteId,
    "x-honeypot-key-id": agent.keyId,
    "x-honeypot-timestamp": timestamp,
    "x-honeypot-nonce": nonce,
    "x-honeypot-content-sha256": bodyHash,
    "x-honeypot-signature": createHmac("sha256", agent.secret).update(canonical).digest("base64"),
    "idempotency-key": idempotencyKey
  };
}

async function synchronize(agent, includeEvent = false, onEventSubmitted = () => {}, forcePolicyFetch = false) {
  const configPath = "/v1/agent/config";
  const config = await call(configPath, {
    headers: signedHeaders("GET", configPath, "", agent, !forcePolicyFetch && agent.etag ? { "if-none-match": agent.etag } : {})
  }, [200, 304]);
  if (config.response.status === 200) {
    agent.etag = config.response.headers.get("etag") ?? undefined;
    agent.policyVersion = Number(config.data.version);
    agent.mode = config.data.mode;
    const ackPath = "/v1/agent/config/ack";
    const ackBody = JSON.stringify({ version: agent.policyVersion, status: "APPLIED", message: `Synthetic performance agent ${agent.index}` });
    await call(ackPath, { method: "POST", headers: signedHeaders("POST", ackPath, ackBody, agent), body: ackBody }, 204);
  }

  if (includeEvent) {
    const batchPath = "/v1/agent/events/batch";
    const eventId = `perf-event-${runId}-${agent.index}-${randomUUID()}`;
    const batchBody = JSON.stringify({
      siteId: agent.siteId,
      pluginVersion,
      events: [{
        idempotencyKey: eventId,
        occurredAt: new Date().toISOString(),
        kind: "PLUGIN_HEALTH",
        method: "GET",
        path: `/synthetic-agent/${agent.index}`,
        ipAddress: `8.8.${Math.floor(agent.index / 250)}.${(agent.index % 250) + 1}`,
        userAgent: `SmartHoneyPerfAgent/${runId}/${agent.index}`,
        headers: { accept: "application/json" },
        action: "OBSERVED",
        metadata: { runId, agentIndex: agent.index }
      }]
    });
    await call(batchPath, { method: "POST", headers: signedHeaders("POST", batchPath, batchBody, agent), body: batchBody }, 202);
    onEventSubmitted(eventId);
  }

  const heartbeatPath = "/v1/agent/heartbeat";
  const heartbeatBody = JSON.stringify({
    pluginVersion,
    queueDepth: 0,
    policyVersion: agent.policyVersion ?? 0,
    mode: agent.mode ?? "OBSERVE",
    health: "HEALTHY",
    enabledDecoys: decoys,
    droppedEvents: 0,
    lastErrorCode: null
  });
  await call(heartbeatPath, { method: "POST", headers: signedHeaders("POST", heartbeatPath, heartbeatBody, agent), body: heartbeatBody }, 200);
}

async function seed() {
  const shardIndex = Number(process.env.PERF_AGENT_SHARD_INDEX ?? 0);
  const shardSize = Number(process.env.PERF_AGENT_SHARD_SIZE ?? 10);
  const total = Number(process.env.PERF_AGENT_TOTAL ?? 49);
  const email = process.env.PERF_ADMIN_EMAIL ?? "admin@smarthoneyai.local";
  const password = readFileSync("/run/secrets/platform_admin_password", "utf8").trim();
  const login = await call("/v1/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password })
  }, 200);
  const cookie = login.response.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("Seed login did not return hp_session.");
  const me = await call("/v1/auth/me", { headers: { cookie } }, 200);
  const organizationId = me.data.user.memberships[0]?.organizationId;
  if (!organizationId) throw new Error("Seed administrator has no organization membership.");
  const browserHeaders = { cookie, origin, "x-organization-id": organizationId, "content-type": "application/json" };
  const first = shardIndex * shardSize + 1;
  const last = Math.min(total, first + shardSize - 1);
  const agents = [];
  for (let index = first; index <= last; index += 1) {
    const label = String(index).padStart(2, "0");
    const siteUrl = `https://perf-agent-${label}-${runId}.invalid/`;
    const created = await call("/v1/sites", {
      method: "POST",
      headers: browserHeaders,
      body: JSON.stringify({ name: `Performance Agent ${label}`, url: siteUrl })
    }, 201);
    const proof = createHmac("sha256", created.data.enrollmentToken).update(siteUrl.replace(/\/$/, "")).digest("hex");
    const enrollment = await call("/v1/agent/enroll", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: created.data.enrollmentToken, siteUrl, siteName: `Performance Agent ${label}`, pluginVersion, proof })
    }, 200);
    const agent = { index, siteUrl, siteId: enrollment.data.siteId, keyId: enrollment.data.keyId, secret: enrollment.data.secret, policyPublicKey: enrollment.data.policyPublicKey, mode: enrollment.data.mode, policyVersion: 0 };
    await synchronize(agent, false);
    agents.push(agent);
  }
  const output = join(agentDir, `agents-shard-${shardIndex}.json`);
  atomicJson(output, { runId, shardIndex, agents }, true);
  process.stdout.write(JSON.stringify({ ok: true, shardIndex, enrolled: agents.length, first, last, output: output.replace(agentDir, "<agent-dir>") }) + "\n");
}

function loadAgents() {
  const files = readdirSync(agentDir).filter((file) => /^agents-shard-\d+\.json$/.test(file)).sort();
  return files.flatMap((file) => JSON.parse(readFileSync(join(agentDir, file), "utf8")).agents);
}

async function runtime() {
  const agents = loadAgents();
  if (agents.length !== Number(process.env.PERF_AGENT_TOTAL ?? 49)) throw new Error(`Expected 49 agents, found ${agents.length}.`);
  const state = { runId, startedAt: new Date().toISOString(), agentCount: agents.length, cyclesAttempted: 0, cyclesSucceeded: 0, cyclesFailed: 0, eventsSubmitted: 0, lastSuccessAt: null, lastErrorCode: null, stoppedAt: null };
  let stopping = false;
  let stopStarted = false;
  const timers = new Set();
  const inFlight = new Set();
  const save = () => atomicJson(statePath, state, false);
  const logCycle = (value) => {
    if (!cycleLogPath) return;
    mkdirSync(dirname(cycleLogPath), { recursive: true, mode: 0o700 });
    appendFileSync(cycleLogPath, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  };
  const cycle = async (agent) => {
    if (stopping) return;
    state.cyclesAttempted += 1;
    try {
      await synchronize(agent, true, () => { state.eventsSubmitted += 1; });
      state.cyclesSucceeded += 1;
      state.lastSuccessAt = new Date().toISOString();
      state.lastErrorCode = null;
      logCycle({ at: state.lastSuccessAt, agentIndex: agent.index, status: "PASS" });
    } catch (error) {
      state.cyclesFailed += 1;
      state.lastErrorCode = error instanceof Error ? error.message.slice(0, 160) : String(error).slice(0, 160);
      logCycle({ at: new Date().toISOString(), agentIndex: agent.index, status: "FAIL", errorCode: state.lastErrorCode });
    }
    save();
    if (!stopping) {
      const jitter = Math.floor((Math.random() * 60_000) - 30_000);
      const timer = setTimeout(() => { timers.delete(timer); launch(agent); }, 300_000 + jitter);
      timers.add(timer);
    }
  };
  const launch = (agent) => {
    if (stopping) return;
    const promise = cycle(agent);
    inFlight.add(promise);
    void promise.finally(() => inFlight.delete(promise));
  };
  agents.forEach((agent, offset) => {
    const timer = setTimeout(() => { timers.delete(timer); launch(agent); }, Math.floor((offset / agents.length) * 60_000));
    timers.add(timer);
  });
  save();
  const stop = async () => {
    if (stopStarted) return;
    stopStarted = true;
    stopping = true;
    for (const timer of timers) clearTimeout(timer);
    state.inFlightAtStop = inFlight.size;
    let shutdownTimedOut = false;
    await Promise.race([
      Promise.allSettled([...inFlight]),
      new Promise((resolveDelay) => setTimeout(() => { shutdownTimedOut = true; resolveDelay(); }, 30_000))
    ]);
    state.shutdownTimedOut = shutdownTimedOut;
    state.stoppedAt = new Date().toISOString();
    save();
    process.exit(shutdownTimedOut ? 1 : 0);
  };
  process.on("SIGTERM", () => { void stop(); });
  process.on("SIGINT", () => { void stop(); });
  await new Promise(() => {});
}

async function probe() {
  const agents = loadAgents();
  const agent = agents[0];
  if (!agent) throw new Error("No enrolled performance agent is available for the signed probe.");
  const heartbeatPath = "/v1/agent/heartbeat";
  const heartbeatBody = JSON.stringify({
    pluginVersion,
    queueDepth: 0,
    policyVersion: agent.policyVersion ?? 0,
    mode: agent.mode ?? "OBSERVE",
    health: "HEALTHY",
    enabledDecoys: decoys,
    droppedEvents: 0,
    lastErrorCode: null
  });
  const expectedStatus = Number(process.env.PERF_EXPECT_STATUS ?? 200);
  const result = await call(heartbeatPath, {
    method: "POST",
    headers: signedHeaders("POST", heartbeatPath, heartbeatBody, agent),
    body: heartbeatBody
  }, expectedStatus);
  if (expectedStatus === 503 && result.data?.code !== "REPLAY_PROTECTION_UNAVAILABLE") {
    throw new Error(`Expected REPLAY_PROTECTION_UNAVAILABLE, received ${JSON.stringify(result.data)}`);
  }
  process.stdout.write(`${JSON.stringify({ ok: true, status: result.response.status, code: result.data?.code ?? null })}\n`);
}

async function reconcile() {
  const agents = loadAgents();
  const startedAt = new Date().toISOString();
  const results = [];
  for (let offset = 0; offset < agents.length; offset += 10) {
    const batch = agents.slice(offset, offset + 10);
    results.push(...await Promise.all(batch.map(async (agent) => {
      let lastError = null;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          // synchronize() creates fresh timestamps and nonces on every call.
          // Retrying the complete signed cycle therefore proves recovery from
          // bounded proxy backpressure without replaying a signed request.
          await synchronize(agent, false, () => {}, true);
          return { agentIndex: agent.index, siteId: agent.siteId, status: "PASS", completedAt: new Date().toISOString(), policyVersion: agent.policyVersion, mode: agent.mode, attempts: attempt };
        } catch (error) {
          lastError = error;
          if (attempt < 3) await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 500));
        }
      }
      return { agentIndex: agent.index, siteId: agent.siteId, status: "FAIL", errorCode: lastError instanceof Error ? lastError.message.slice(0, 160) : String(lastError).slice(0, 160), attempts: 3 };
    })));
  }
  const failed = results.filter((item) => item.status !== "PASS");
  const requiredStartedAt = process.env.PERF_RECONCILIATION_STARTED_AT ?? startedAt;
  const allFresh = results.every((item) => item.status === "PASS" && Date.parse(item.completedAt) >= Date.parse(requiredStartedAt));
  const output = { ok: failed.length === 0 && results.length === 49 && allFresh, runId, requiredStartedAt, startedAt, completedAt: new Date().toISOString(), expected: 49, succeeded: results.length - failed.length, allFresh, results, failed };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (!output.ok) process.exitCode = 1;
}

if (command === "seed") await seed();
else if (command === "runtime") await runtime();
else if (command === "probe") await probe();
else if (command === "reconcile") await reconcile();
else throw new Error(`Unknown PERF_AGENT_COMMAND: ${command}`);
