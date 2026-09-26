import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertSyntheticTarget } from "./synthetic-target-guard.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const command = process.argv[2] ?? "snapshot";
const baseUrl = (process.env.BASE_URL ?? "https://localhost").replace(/\/$/, "");
const origin = (process.env.APP_ORIGIN ?? baseUrl).replace(/\/$/, "");
const wordpressUrl = (process.env.WORDPRESS_URL ?? "http://localhost:8080").replace(/\/$/, "");
assertSyntheticTarget(baseUrl, { label: "Performance control plane" });
assertSyntheticTarget(wordpressUrl, { label: "Performance WordPress target" });
const secretDir = resolve(process.env.E2E_SECRET_DIR ?? `${root}/secrets/perf`);
const statePath = resolve(process.env.PERF_CONTROL_STATE ?? `${secretDir}/performance-control.json`);
const project = process.env.COMPOSE_PROJECT_NAME ?? "honeypot-ai-perf";
const overlayFiles = (process.env.COMPOSE_OVERLAY_FILES ?? `${root}/docker-compose.wordpress-demo.yml:${root}/docker-compose.performance.yml`).split(":").filter(Boolean);
const composeArgs = ["compose", "-p", project, "-f", `${root}/docker-compose.yml`, ...overlayFiles.flatMap((file) => ["-f", resolve(file)])];
const email = process.env.ADMIN_EMAIL ?? "admin@smarthoneyai.local";
const password = process.env.ADMIN_PASSWORD ?? readFileSync(`${secretDir}/platform_admin_password`, "utf8").trim();
const runId = process.env.PERF_RUN_ID ?? "local-perf";

let cookie = "";
let organizationId = "";

function compose(args, { allowFailure = false } = {}) {
  try {
    return execFileSync("docker", [...composeArgs, ...args], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, APP_URL: baseUrl, PLATFORM_ADMIN_EMAIL: email, E2E_SECRET_DIR: secretDir }
    }).trim();
  } catch (error) {
    if (allowFailure) return "";
    throw error;
  }
}

async function request(path, options = {}, expected = null) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (expected !== null && ![].concat(expected).includes(response.status)) throw new Error(`${options.method ?? "GET"} ${path} returned ${response.status}: ${text.slice(0, 300)}`);
  return { response, data, text };
}

async function login() {
  const saved = readState();
  if (saved.sessionCookie && saved.organizationId) {
    const existing = await request("/v1/auth/me", { headers: { cookie: saved.sessionCookie } });
    if (existing.response.status === 200) {
      cookie = saved.sessionCookie;
      organizationId = saved.organizationId;
      return;
    }
  }
  const response = await request("/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) }, 200);
  cookie = response.response.headers.get("set-cookie")?.split(";")[0] ?? "";
  if (!cookie) throw new Error("Control login did not return a session cookie.");
  const me = await request("/v1/auth/me", { headers: { cookie } }, 200);
  organizationId = me.data.user.memberships[0]?.organizationId ?? "";
  if (!organizationId) throw new Error("Control administrator has no organization membership.");
  const state = readState();
  state.sessionCookie = cookie;
  state.organizationId = organizationId;
  saveState(state);
}

function browserHeaders(json = true) {
  return { cookie, origin, "x-organization-id": organizationId, ...(json ? { "content-type": "application/json" } : {}) };
}

function readState() {
  try { return JSON.parse(readFileSync(statePath, "utf8")); } catch { return { runId, siteId: null, ruleIds: [] }; }
}

function saveState(state) {
  mkdirSync(dirname(statePath), { recursive: true, mode: 0o700 });
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

function wpEval(file) {
  const output = compose(["exec", "-T", "wordpress-cron", "wp", "eval-file", `/demo/${file}`, "--path=/var/www/html"]);
  const lines = output.split("\n").filter(Boolean);
  try { return JSON.parse(lines.at(-1)); } catch { return output; }
}

function wordpressReadOnlyStatus() {
  const raw = compose(["exec", "-T", "wordpress-db", "sh", "-lc", "mariadb -N -uwordpress -p\"$(cat /run/secrets/wordpress_db_password)\" wordpress -e 'SELECT row_count,payload_bytes,dropped_events FROM wp_honeypot_ai_queue_state WHERE singleton_id=1'"], { allowFailure: true });
  const [queueDepth, queueBytes, droppedEvents] = raw.split(/\s+/).map(Number);
  if (![queueDepth, queueBytes, droppedEvents].every(Number.isFinite)) return null;
  return { queueDepth, queueBytes, droppedEvents, readOnly: true };
}

async function bootstrap() {
  await login();
  const sites = await request("/v1/sites", { headers: browserHeaders(false) }, 200);
  let site = sites.data.data.find((item) => item.domain === "localhost");
  if (!site) {
    const created = await request("/v1/sites", {
      method: "POST",
      headers: browserHeaders(),
      body: JSON.stringify({ name: "Performance WordPress", url: `${wordpressUrl}/` })
    }, 201);
    site = created.data.site;
    compose(["exec", "-T", "-e", `HONEYPOT_ENROLLMENT_TOKEN=${created.data.enrollmentToken}`, "-e", "HONEYPOT_CONTROL_URL=https://host.docker.internal", "wordpress-cron", "wp", "eval-file", "/demo/enroll-wordpress.php", "--path=/var/www/html"]);
  }
  const synced = wpEval("sync-wordpress.php");
  const refreshed = await request("/v1/sites", { headers: browserHeaders(false) }, 200);
  site = refreshed.data.data.find((item) => item.id === site.id);
  if (!site || site.connectionStatus !== "ONLINE") throw new Error(`Real WordPress did not become ONLINE: ${JSON.stringify(site)}`);
  const state = { runId, project, organizationId, sessionCookie: cookie, siteId: site.id, ruleIds: [], createdAt: new Date().toISOString() };
  saveState(state);
  process.stdout.write(`${JSON.stringify({ ok: true, siteId: site.id, connectionStatus: site.connectionStatus, wordpress: synced })}\n`);
}

async function createRule(siteId, type, value, priority) {
  const expiresAt = new Date(Date.now() + 3 * 60 * 60_000).toISOString();
  const response = await request("/v1/firewall/rules", {
    method: "POST",
    headers: browserHeaders(),
    body: JSON.stringify({ siteId, type, value, priority, expiresAt, reason: `Authorized isolated performance simulation ${runId}` })
  }, 201);
  return response.data.rule.id;
}

async function prepare() {
  await login();
  const state = readState();
  if (!state.siteId || !/^c[a-z0-9]+$/i.test(state.siteId)) throw new Error("Control state has no safe WordPress site ID.");
  compose(["exec", "-T", "postgres", "psql", "-v", "ON_ERROR_STOP=1", "-U", "honeypot", "-d", "honeypot_ai", "-c", `UPDATE \"Site\" SET \"observeUntil\"=NOW()-INTERVAL '1 minute' WHERE id='${state.siteId}';`]);
  state.ruleIds = state.ruleIds ?? [];
  saveState(state);
  for (const [type, value, priority] of [
    ["BLOCK_ROUTE", "/blocked-test", 50],
    ["BLOCK_USER_AGENT", "PerfBlockedBot/", 60],
    ["RATE_LIMIT", "10/10", 100]
  ]) {
    const id = await createRule(state.siteId, type, value, priority);
    state.ruleIds.push(id);
    saveState(state);
  }
  const ruleIds = state.ruleIds;
  state.preparedAt = new Date().toISOString();
  saveState(state);
  await request(`/v1/sites/${state.siteId}/enforcement-mode`, { method: "PATCH", headers: browserHeaders(), body: JSON.stringify({ mode: "ENFORCE", reason: `Authorized temporary performance enforcement ${runId}` }) }, 200);
  const wordpress = wpEval("sync-wordpress.php");
  if (wordpress.effectiveMode !== "ENFORCE") throw new Error(`WordPress effective mode is ${wordpress.effectiveMode}.`);
  process.stdout.write(`${JSON.stringify({ ok: true, siteId: state.siteId, ruleIds, wordpress })}\n`);
}

async function snapshot() {
  await login();
  const state = readState();
  const [ready, sites, rules, summary, events] = await Promise.all([
    request("/health/ready", {}, 200),
    request("/v1/sites", { headers: browserHeaders(false) }, 200),
    request("/v1/firewall/rules", { headers: browserHeaders(false) }, 200),
    request("/v1/dashboard/summary", { headers: browserHeaders(false) }, 200),
    request("/v1/events", { headers: browserHeaders(false) }, 200)
  ]);
  const activeRules = rules.data.data.filter((rule) => rule.enabled && (!rule.expiresAt || new Date(rule.expiresAt) > new Date()));
  const wordpressSite = sites.data.data.find((site) => site.id === state.siteId) ?? null;
  const wordpress = compose(["ps", "--status", "running", "wordpress-db"], { allowFailure: true }) ? wordpressReadOnlyStatus() : null;
  const output = { generatedAt: new Date().toISOString(), runId, project, ready: ready.data, siteCount: sites.data.data.length, connectionCounts: sites.data.data.reduce((acc, site) => ({ ...acc, [site.connectionStatus]: (acc[site.connectionStatus] ?? 0) + 1 }), {}), wordpressSite, wordpress, activeRules: activeRules.map(({ id, type, value, siteId }) => ({ id, type, value, siteId })), dashboard: summary.data, eventTotal: events.data.total };
  saveState(state);
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

async function cleanup() {
  for (const service of ["postgres", "wordpress-db", "redis", "api", "worker", "wordpress", "wordpress-cron", "web", "nginx"]) compose(["start", service], { allowFailure: true });
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    try { const ready = await request("/health/ready"); if (ready.response.status === 200) break; } catch { /* retry */ }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 2000));
  }
  await login();
  const state = readState();
  const errors = [];
  for (const id of state.ruleIds ?? []) {
    try { await request(`/v1/firewall/rules/${id}`, { method: "PATCH", headers: browserHeaders(), body: JSON.stringify({ enabled: false }) }, [200, 404]); } catch (error) { errors.push(String(error)); }
  }
  if (state.siteId) {
    try { await request(`/v1/sites/${state.siteId}/enforcement-mode`, { method: "PATCH", headers: browserHeaders(), body: JSON.stringify({ mode: "OBSERVE", reason: `Safe performance cleanup ${runId}` }) }, 200); } catch (error) { errors.push(String(error)); }
  }
  if ((state.ruleIds ?? []).every((id) => /^c[a-z0-9]+$/i.test(id)) && state.ruleIds?.length) {
    const quoted = state.ruleIds.map((id) => `'${id}'`).join(",");
    compose(["exec", "-T", "postgres", "psql", "-v", "ON_ERROR_STOP=1", "-U", "honeypot", "-d", "honeypot_ai", "-c", `DELETE FROM \"FirewallRule\" WHERE id IN (${quoted});`], { allowFailure: true });
  }
  // A partially interrupted prepare may have created a rule before its ID was
  // recorded. The run ID is shell-validated and is safe in this local query.
  compose(["exec", "-T", "postgres", "psql", "-v", "ON_ERROR_STOP=1", "-U", "honeypot", "-d", "honeypot_ai", "-c", `DELETE FROM "FirewallRule" WHERE reason LIKE '%${runId}%';`], { allowFailure: true });
  compose(["exec", "-T", "wordpress-cron", "wp", "db", "query", "TRUNCATE TABLE wp_honeypot_ai_rate_limits", "--path=/var/www/html"], { allowFailure: true });
  let wordpress = null;
  try {
    compose(["exec", "-T", "wordpress-cron", "wp", "db", "query", "UPDATE wp_honeypot_ai_events SET available_at=UTC_TIMESTAMP()", "--path=/var/www/html"], { allowFailure: true });
    for (let attempt = 0; attempt < 500; attempt += 1) {
      wordpress = wpEval("sync-wordpress.php");
      // A successful heartbeat deliberately resolves the previous transport
      // error after reporting one recovery heartbeat. Require the subsequent
      // healthy heartbeat as part of cleanup rather than preserving a
      // transient DEGRADED state in the final evidence.
      if (wordpress.queueDepth === 0 && wordpress.connectionStatus === "ONLINE" && wordpress.health === "HEALTHY" && wordpress.effectiveMode === "OBSERVE" && wordpress.policyRules?.length === 0) break;
      compose(["exec", "-T", "wordpress-cron", "wp", "db", "query", "UPDATE wp_honeypot_ai_events SET available_at=UTC_TIMESTAMP()", "--path=/var/www/html"], { allowFailure: true });
    }
    if (wordpress?.queueDepth !== 0) errors.push(`Operational cleanup could not drain queue: ${wordpress?.queueDepth}.`);
    if (wordpress?.connectionStatus !== "ONLINE" || wordpress?.health !== "HEALTHY") errors.push(`Operational cleanup did not reach a healthy WordPress heartbeat: ${JSON.stringify(wordpress)}.`);
  } catch (error) { errors.push(String(error)); }
  const [sites, rules] = await Promise.all([
    request("/v1/sites", { headers: browserHeaders(false) }, 200),
    request("/v1/firewall/rules", { headers: browserHeaders(false) }, 200)
  ]);
  const activeRules = rules.data.data.filter((rule) => rule.enabled && (!rule.expiresAt || new Date(rule.expiresAt) > new Date()));
  const residualRunRules = rules.data.data.filter((rule) => String(rule.reason ?? "").includes(runId));
  const real = sites.data.data.find((site) => site.id === state.siteId);
  if (real?.enforcementMode !== "OBSERVE") errors.push(`Real site mode is ${real?.enforcementMode}.`);
  if (activeRules.length) errors.push(`${activeRules.length} active rule(s) remain.`);
  if (residualRunRules.length) errors.push(`${residualRunRules.length} run-tagged test rule(s) remain.`);
  if (wordpress && wordpress.effectiveMode !== "OBSERVE") errors.push(`WordPress effective mode is ${wordpress.effectiveMode}.`);
  const output = { ok: errors.length === 0, generatedAt: new Date().toISOString(), siteCount: sites.data.data.length, connectionCounts: sites.data.data.reduce((acc, site) => ({ ...acc, [site.connectionStatus]: (acc[site.connectionStatus] ?? 0) + 1 }), {}), realSite: real ? { id: real.id, connectionStatus: real.connectionStatus, enforcementMode: real.enforcementMode, policyState: real.policyState } : null, wordpress, activeRules: activeRules.length, residualRunRules: residualRunRules.length, errors };
  state.cleanedAt = output.generatedAt;
  state.cleanup = output;
  if (process.env.PERF_CONTROL_FINAL === "1") {
    await request("/v1/auth/logout", { method: "POST", headers: { cookie, origin } }, 204);
    delete state.sessionCookie;
  } else {
    state.sessionCookie = cookie;
  }
  saveState(state);
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (!output.ok) process.exitCode = 1;
}

async function reconcile() {
  await login();
  const state = readState();
  const requiredStartedAt = process.env.PERF_RECONCILIATION_STARTED_AT ?? new Date().toISOString();
  // Force a verified 200 policy read so the real WordPress agent emits a fresh
  // acknowledgement instead of reusing a 304 response during final evidence.
  compose(["exec", "-T", "wordpress-cron", "wp", "eval", "$r=get_option(Honeypot_AI_Storage::OPTION_POLICY,array());if(is_array($r)){ $r['etag']=''; update_option(Honeypot_AI_Storage::OPTION_POLICY,$r,false); }", "--path=/var/www/html"]);
  let wordpress = wpEval("sync-wordpress.php");
  // The first successful heartbeat after an outage reports the prior
  // sanitized error and marks it resolved. Emit and verify the next heartbeat
  // so final fleet evidence represents the recovered steady state.
  for (let attempt = 0; attempt < 2 && (wordpress.connectionStatus !== "ONLINE" || wordpress.health !== "HEALTHY"); attempt += 1) {
    wordpress = wpEval("sync-wordpress.php");
  }
  const sites = await request("/v1/sites", { headers: browserHeaders(false) }, 200);
  const counts = sites.data.data.reduce((acc, site) => ({ ...acc, [site.connectionStatus]: (acc[site.connectionStatus] ?? 0) + 1 }), {});
  const real = sites.data.data.find((site) => site.id === state.siteId) ?? null;
  const freshnessFailures = sites.data.data.filter((site) => {
    const heartbeatAt = Date.parse(site.latestHeartbeat?.createdAt ?? "");
    const acknowledgementAt = Date.parse(site.latestPolicy?.acknowledgement?.createdAt ?? "");
    return site.connectionStatus !== "ONLINE" || site.latestHeartbeat?.health !== "HEALTHY" || heartbeatAt < Date.parse(requiredStartedAt) || site.policyState !== "SYNCHRONIZED" || acknowledgementAt < Date.parse(requiredStartedAt) || site.latestHeartbeat?.policyVersion !== site.latestPolicy?.version;
  }).map((site) => site.id);
  const ok = sites.data.data.length === 50 && counts.ONLINE === 50 && real?.connectionStatus === "ONLINE" && freshnessFailures.length === 0;
  const output = { ok, requiredStartedAt, generatedAt: new Date().toISOString(), siteCount: sites.data.data.length, connectionCounts: counts, freshnessFailures, realSite: real, wordpress };
  state.sessionCookie = cookie;
  saveState(state);
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (!ok) process.exitCode = 1;
}

if (command === "bootstrap") await bootstrap();
else if (command === "prepare") await prepare();
else if (command === "snapshot") await snapshot();
else if (command === "cleanup") await cleanup();
else if (command === "reconcile") await reconcile();
else throw new Error(`Unknown performance-control command: ${command}`);
