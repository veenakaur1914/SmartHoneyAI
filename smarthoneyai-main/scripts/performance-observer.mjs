import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { appendFileSync, chmodSync, closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const project = process.env.COMPOSE_PROJECT_NAME ?? "honeypot-ai-perf";
const artifactDir = resolve(process.env.PERF_ARTIFACT_DIR ?? `${root}/output/performance/unknown`);
const phasePath = resolve(process.env.PERF_PHASE_FILE ?? `${artifactDir}/phase.json`);
const abortPath = resolve(process.env.PERF_ABORT_FILE ?? `${artifactDir}/abort.json`);
const outputPath = resolve(process.env.PERF_TELEMETRY_PATH ?? `${artifactDir}/telemetry.jsonl`);
const agentStatePath = resolve(process.env.PERF_AGENT_STATE_PATH ?? `${root}/secrets/perf/agents/runtime-state.json`);
const secretDir = resolve(process.env.E2E_SECRET_DIR ?? `${root}/secrets/perf`);
const overlayFiles = (process.env.COMPOSE_OVERLAY_FILES ?? `${root}/docker-compose.wordpress-demo.yml:${root}/docker-compose.performance.yml`).split(":").filter(Boolean);
const composeArgs = ["compose", "-p", project, "-f", `${root}/docker-compose.yml`, ...overlayFiles.flatMap((file) => ["-f", resolve(file)])];
const dockerMemTotal = Number(exec("docker", ["info", "--format", "{{.MemTotal}}"], "0"));
const initialRestarts = new Map();
let stopping = false;
let sampleIndex = 0;
let memoryHighSince = null;
let readinessDownSince = null;
let lastSampleStartedAt = null;
let k6TailPath = null;
let k6TailOffset = 0;
let k6TailPartial = "";
let normalWindow = [];
const unhealthySince = new Map();
const inFlightSamples = new Set();
const pendingSamples = new Map();
let nextSampleToWrite = 0;
const execFileAsync = promisify(execFile);
const requiredRuntimeServices = ["postgres", "redis", "api", "worker", "wordpress-db", "wordpress", "wordpress-cron", "web", "nginx", "prometheus", "alertmanager", "grafana"];

mkdirSync(artifactDir, { recursive: true, mode: 0o700 });
writeFileSync(outputPath, "", { mode: 0o600 });

function exec(program, args, fallback = "") {
  try { return execFileSync(program, args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 8000, env: process.env }).trim(); }
  catch { return fallback; }
}

function compose(args, fallback = "") {
  return exec("docker", [...composeArgs, ...args], fallback);
}

async function execAsync(program, args, fallback = "") {
  try {
    const result = await execFileAsync(program, args, { cwd: root, encoding: "utf8", timeout: 8000, env: process.env, maxBuffer: 16 * 1024 * 1024 });
    return result.stdout.trim();
  } catch {
    return fallback;
  }
}

function composeAsync(args, fallback = "") {
  return execAsync("docker", [...composeArgs, ...args], fallback);
}

function parseBytes(value) {
  const match = /^\s*([\d.]+)\s*([KMGTP]?i?B)\s*$/i.exec(value ?? "");
  if (!match) return null;
  const unit = match[2].toUpperCase();
  const multipliers = { B: 1, KB: 1000, KIB: 1024, MB: 1e6, MIB: 1024 ** 2, GB: 1e9, GIB: 1024 ** 3, TB: 1e12, TIB: 1024 ** 4 };
  return Number(match[1]) * (multipliers[unit] ?? 1);
}

function readJson(path, fallback = null) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return fallback; }
}

async function containerSamples() {
  const ids = exec("docker", ["ps", "-aq", "--filter", `label=com.docker.compose.project=${project}`]).split("\n").filter(Boolean);
  if (!ids.length) return [];
  const [statsRaw, inspectRaw] = await Promise.all([
    execAsync("docker", ["stats", "--no-stream", "--format", "{{json .}}", ...ids]),
    execAsync("docker", ["inspect", ...ids], "[]")
  ]);
  const stats = new Map(statsRaw.split("\n").filter(Boolean).map((line) => { const item = JSON.parse(line); return [item.ID, item]; }));
  const inspected = JSON.parse(inspectRaw);
  return inspected.map((item) => {
    const shortId = item.Id.slice(0, 12);
    const stat = stats.get(shortId) ?? [...stats.values()].find((candidate) => candidate.Name === item.Name.replace(/^\//, "")) ?? {};
    const service = item.Config.Labels?.["com.docker.compose.service"] ?? item.Name.replace(/^\//, "");
    const restartCount = Number(item.RestartCount ?? 0);
    if (!initialRestarts.has(service)) initialRestarts.set(service, restartCount);
    const usageText = String(stat.MemUsage ?? "").split("/")[0]?.trim();
    return {
      service,
      container: item.Name.replace(/^\//, ""),
      state: item.State.Status,
      health: item.State.Health?.Status ?? null,
      cpuPercent: Number(String(stat.CPUPerc ?? "0").replace("%", "")) || 0,
      memoryBytes: parseBytes(usageText),
      memoryPercent: Number(String(stat.MemPerc ?? "0").replace("%", "")) || 0,
      networkIO: stat.NetIO ?? null,
      blockIO: stat.BlockIO ?? null,
      pids: Number(stat.PIDs ?? 0),
      restartCount,
      oomKilled: Boolean(item.State.OOMKilled),
      unexpectedRestart: restartCount > (initialRestarts.get(service) ?? 0)
    };
  });
}

function hostAvailableBytes() {
  const raw = exec("vm_stat", []);
  const pageSize = Number(/page size of (\d+) bytes/.exec(raw)?.[1] ?? 4096);
  const values = Object.fromEntries(raw.split("\n").map((line) => {
    const match = /^Pages ([^:]+):\s+(\d+)/.exec(line);
    return match ? [match[1], Number(match[2])] : [];
  }).filter((entry) => entry.length));
  return ((values.free ?? 0) + (values.inactive ?? 0) + (values.speculative ?? 0)) * pageSize;
}

async function readiness() {
  const [code, worker] = await Promise.all([
    execAsync("curl", ["--silent", "--show-error", "--max-time", "2", "--cacert", `${secretDir}/tls/fullchain.pem`, "--output", "/dev/null", "--write-out", "%{http_code}", "https://localhost/health/ready"], "000"),
    composeAsync(["exec", "-T", "worker", "wget", "-q", "-O", "-", "http://127.0.0.1:4001/health/ready"], "")
  ]);
  return { apiStatus: Number(code) || 0, worker: readJsonText(worker) };
}

function readJsonText(value) {
  try { return JSON.parse(value); } catch { return value || null; }
}

function normalErrorSafety(phase) {
  const path = resolve(artifactDir, "k6", `${phase.phase}.jsonl`);
  if (path !== k6TailPath) {
    k6TailPath = path;
    k6TailOffset = 0;
    k6TailPartial = "";
    normalWindow = [];
  }
  if (!existsSync(path)) return { samples: 0, errorRate: 0, windowSeconds: 0 };
  const descriptor = openSync(path, "r");
  try {
    const size = fstatSync(descriptor).size;
    if (size < k6TailOffset) {
      k6TailOffset = 0;
      k6TailPartial = "";
      normalWindow = [];
    }
    const length = size - k6TailOffset;
    if (length > 0) {
      const buffer = Buffer.alloc(length);
      readSync(descriptor, buffer, 0, length, k6TailOffset);
      k6TailOffset = size;
      const lines = `${k6TailPartial}${buffer.toString("utf8")}`.split("\n");
      k6TailPartial = lines.pop() ?? "";
      if (phase.scheduledFault === "wordpress-db") {
        normalWindow = [];
      } else {
        for (const line of lines) {
          try {
            const item = JSON.parse(line);
            if (item.type === "Point" && item.metric === "normal_response_correct") {
              normalWindow.push({ at: Date.parse(item.data.time), correct: Number(item.data.value) === 1 });
            }
          } catch { /* a partial or malformed metric cannot establish an abort */ }
        }
      }
    }
  } finally {
    closeSync(descriptor);
  }
  if (phase.scheduledFault === "wordpress-db" || normalWindow.length === 0) return { samples: 0, errorRate: 0, windowSeconds: 0, suppressed: phase.scheduledFault === "wordpress-db" };
  const newest = normalWindow.at(-1).at;
  normalWindow = normalWindow.filter((item) => newest - item.at <= 60_000);
  const windowSeconds = (newest - normalWindow[0].at) / 1000;
  const errors = normalWindow.filter((item) => !item.correct).length;
  const errorRate = errors / normalWindow.length;
  if (windowSeconds >= 59 && errorRate > 0.10) abort("NORMAL_ERRORS_HIGH", { phase, samples: normalWindow.length, errors, errorRate, windowSeconds });
  return { samples: normalWindow.length, errors, errorRate, windowSeconds };
}

async function deepState() {
  const prometheusQuery = encodeURIComponent('{__name__=~"honeypot_.+"}');
  const [database, wordpressRaw, redisRaw, prometheusRaw] = await Promise.all([
    composeAsync(["exec", "-T", "postgres", "psql", "-tA", "-F", "|", "-U", "honeypot", "-d", "honeypot_ai", "-c", `SELECT
      (SELECT COUNT(*) FROM "SecurityEvent"),
      (SELECT COUNT(*) FROM "ThreatAssessment" WHERE status='PENDING'),
      (SELECT COUNT(*) FROM "ThreatAssessment" WHERE status='PROCESSING'),
      (SELECT COUNT(*) FROM "ThreatAssessment" WHERE status IN ('FAILED','UNAVAILABLE')),
      (SELECT COUNT(*) FROM "Site"),
      (SELECT COUNT(*) FROM "AgentHeartbeat"),
      (SELECT COUNT(*) FROM "Site" WHERE status='ONLINE'),
      (SELECT COUNT(*) FROM "Site" WHERE status='DEGRADED'),
      (SELECT COUNT(*) FROM "Site" WHERE status='OFFLINE'),
      (SELECT COUNT(*) FROM "Site" WHERE status='PENDING'),
      (SELECT COUNT(*) FROM "Site" WHERE "enforcementMode"='OBSERVE'),
      (SELECT COUNT(*) FROM "Site" WHERE "enforcementMode"='ENFORCE'),
      (SELECT COUNT(*) FROM "FirewallRule" WHERE enabled=true AND ("expiresAt" IS NULL OR "expiresAt">NOW())),
      (SELECT COUNT(*) FROM "RuleSet" WHERE "expiresAt">NOW()),
      (SELECT COUNT(*) FROM "Site" s WHERE EXISTS (
        SELECT 1 FROM "RuleSet" rs JOIN "RuleAcknowledgement" ra ON ra."ruleSetId"=rs.id
        WHERE rs."siteId"=s.id AND rs.version=s."currentPolicyVersion" AND rs."expiresAt">NOW() AND ra.status='APPLIED'
      ));`], ""),
    composeAsync(["exec", "-T", "wordpress-db", "sh", "-lc", "mariadb -N -uwordpress -p\"$(cat /run/secrets/wordpress_db_password)\" wordpress -e 'SELECT row_count,payload_bytes,dropped_events FROM wp_honeypot_ai_queue_state WHERE singleton_id=1'"], ""),
    composeAsync(["exec", "-T", "redis", "sh", "-c", "redis-cli -a \"$(cat /run/secrets/redis_password)\" --no-auth-warning DBSIZE | cut -d: -f2"], "NaN"),
    composeAsync(["exec", "-T", "prometheus", "wget", "-q", "-O", "-", `http://127.0.0.1:9090/api/v1/query?query=${prometheusQuery}`], "")
  ]);
  const [events, pending, processing, failed, sites, heartbeats, online, degraded, offline, connectionPending, observe, enforce, activeRules, unexpiredPolicies, synchronizedPolicies] = database.split("|").map(Number);
  const [queueDepth, queueBytes, droppedEvents] = wordpressRaw.trim().split(/\s+/).map(Number);
  const redisKeys = Number(redisRaw);
  return {
    database: {
      events, pending, processing, failed, sites, heartbeats,
      connection: { online, degraded, offline, pending: connectionPending },
      policy: { observe, enforce, activeRules, unexpiredPolicies, synchronizedPolicies }
    },
    wordpress: { queueDepth, queueBytes, droppedEvents },
    redisKeys: Number.isFinite(redisKeys) ? redisKeys : null,
    prometheus: readJsonText(prometheusRaw),
    agentRuntime: readJson(agentStatePath)
  };
}

function containerHealthSafety(containers, phase, atMs) {
  const byService = new Map(containers.map((item) => [item.service, item]));
  const scheduled = phase.scheduledFault;
  const exemptions = new Set(scheduled === "redis" ? ["redis", "api", "worker"] : scheduled ? [scheduled] : []);
  const unhealthy = [];
  for (const service of requiredRuntimeServices) {
    const container = byService.get(service);
    const bad = !container || container.state !== "running" || container.health === "unhealthy";
    if (!bad || exemptions.has(service)) {
      unhealthySince.delete(service);
      continue;
    }
    const since = unhealthySince.get(service) ?? atMs;
    unhealthySince.set(service, since);
    const durationMs = atMs - since;
    unhealthy.push({ service, durationMs, state: container?.state ?? "missing", health: container?.health ?? null });
    if (durationMs >= 30_000) abort("UNPLANNED_CONTAINER_UNHEALTHY", { phase, service, durationMs, state: container?.state ?? "missing", health: container?.health ?? null });
  }
  return { requiredServices: requiredRuntimeServices, exemptions: [...exemptions], unhealthy };
}

function abort(reason, details) {
  if (readJson(abortPath)) return;
  const value = { at: new Date().toISOString(), reason, details };
  writeFileSync(abortPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  chmodSync(abortPath, 0o600);
}

async function sample() {
  const sampleStarted = performance.now();
  const at = new Date();
  if (lastSampleStartedAt !== null && at.getTime() - lastSampleStartedAt > 15_000) {
    abort("HOST_SUSPEND_OR_TELEMETRY_GAP", { previousSampleAt: new Date(lastSampleStartedAt).toISOString(), resumedAt: at.toISOString(), gapMs: at.getTime() - lastSampleStartedAt });
  }
  lastSampleStartedAt = at.getTime();
  const currentSample = sampleIndex;
  sampleIndex += 1;
  const phase = readJson(phasePath, { phase: "unknown", scheduledFault: null });
  const loadSafety = normalErrorSafety(phase);
  const [containers, ready, deep] = await Promise.all([containerSamples(), readiness(), deepState()]);
  const totalMemory = containers.reduce((sum, item) => sum + (item.memoryBytes ?? 0), 0);
  const hostFree = hostAvailableBytes();
  const healthSafety = containerHealthSafety(containers, phase, at.getTime());
  const value = {
    at: at.toISOString(),
    sample: currentSample,
    sampleDurationMs: performance.now() - sampleStarted,
    phase,
    loadSafety,
    healthSafety,
    readiness: ready,
    resources: { dockerMemoryBytes: totalMemory, dockerMemoryLimitBytes: dockerMemTotal, dockerMemoryPercent: dockerMemTotal ? (100 * totalMemory) / dockerMemTotal : null, hostAvailableBytes: hostFree },
    containers,
    deep
  };
  pendingSamples.set(currentSample, value);
  while (pendingSamples.has(nextSampleToWrite)) {
    appendFileSync(outputPath, `${JSON.stringify(pendingSamples.get(nextSampleToWrite))}\n`, { mode: 0o600 });
    pendingSamples.delete(nextSampleToWrite);
    nextSampleToWrite += 1;
  }
  const memoryHigh = dockerMemTotal && totalMemory / dockerMemTotal >= 0.90;
  memoryHighSince = memoryHigh ? (memoryHighSince ?? at.getTime()) : null;
  if (memoryHighSince && at.getTime() - memoryHighSince >= 30_000) abort("DOCKER_MEMORY_HIGH", value.resources);
  if (hostFree > 0 && hostFree < 1024 ** 3) abort("HOST_MEMORY_LOW", value.resources);
  const badContainer = containers.find((item) => item.oomKilled || item.unexpectedRestart);
  if (badContainer) abort(badContainer.oomKilled ? "CONTAINER_OOM" : "UNEXPECTED_RESTART", badContainer);
  const expectedReadinessFailure = Boolean(phase.scheduledFault && ["api", "redis"].includes(phase.scheduledFault));
  readinessDownSince = ready.apiStatus !== 200 && !expectedReadinessFailure ? (readinessDownSince ?? at.getTime()) : null;
  if (readinessDownSince && at.getTime() - readinessDownSince >= 30_000) abort("UNPLANNED_READINESS_LOSS", { phase, readiness: ready });
}

const runSample = () => {
  if (stopping) return;
  if (inFlightSamples.size >= 5) {
    abort("TELEMETRY_SAMPLER_OVERLOAD", { inFlight: inFlightSamples.size });
    return;
  }
  const promise = sample().catch((error) => abort("TELEMETRY_SAMPLE_FAILED", { error: error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240) }));
  inFlightSamples.add(promise);
  void promise.finally(() => inFlightSamples.delete(promise));
};
const timer = setInterval(runSample, 2000);
runSample();
const stop = async () => {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  await Promise.allSettled([...inFlightSamples]);
  process.exit(0);
};
process.on("SIGTERM", () => { void stop(); });
process.on("SIGINT", () => { void stop(); });
