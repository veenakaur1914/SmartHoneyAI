import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertSyntheticTarget } from "./synthetic-target-guard.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const baseUrl = (process.env.BASE_URL ?? "https://localhost").replace(/\/$/, "");
const origin = (process.env.APP_ORIGIN ?? baseUrl).replace(/\/$/, "");
const secretDir = resolve(process.env.E2E_SECRET_DIR ?? `${root}/secrets/e2e`);
const adminEmail = process.env.ADMIN_EMAIL ?? "admin@smarthoneyai.local";
const adminPassword = process.env.ADMIN_PASSWORD ?? readFileSync(`${secretDir}/platform_admin_password`, "utf8").trim();
const simulationId = process.env.BOT_SIMULATION_ID ?? `bot-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;
const sourceHost = 20 + (Number.parseInt(createHash("sha256").update(simulationId).digest("hex").slice(0, 2), 16) % 220);
const sourceIp = process.env.BOT_SOURCE_IP ?? `8.8.8.${sourceHost}`;
const sourceCidr = `${sourceIp.split(".").slice(0, 3).join(".")}.0/24`;
const botUserAgent = `Mozilla/5.0 (compatible; SmartHoneyBotSim/1.0; campaign=${simulationId})`;
const neutralUserAgent = `Mozilla/5.0 (compatible; SmartHoneyNeutral/1.0; campaign=${simulationId})`;
const reconnaissancePaths = ["/env", "/git-config", "/wp-config-backup", "/actuator/env"];
const resultPath = resolve(process.env.BOT_SIM_RESULT_PATH ?? `${root}/output/simulations/${simulationId}/result.json`);
const reportPath = resolve(process.env.BOT_SIM_REPORT_PATH ?? `${root}/output/reports/honeypot-bot-simulation-${simulationId}.md`);
const composeProject = process.env.COMPOSE_PROJECT_NAME ?? "honeypot-ai-e2e";
const composeOverlayFiles = (process.env.COMPOSE_OVERLAY_FILES ?? `${root}/docker-compose.wordpress-demo.yml`).split(":").filter(Boolean);
const composeFiles = ["-p", composeProject, "-f", `${root}/docker-compose.yml`, ...composeOverlayFiles.flatMap((file) => ["-f", resolve(file)])];
const wordpressUrl = (process.env.WORDPRESS_URL ?? "http://localhost:8080").replace(/\/$/, "");

assertSyntheticTarget(baseUrl, { label: "Bot simulation control plane" });
assertSyntheticTarget(wordpressUrl, { label: "Bot simulation WordPress target" });

if (!/^[A-Za-z0-9_-]+$/.test(simulationId)) throw new Error("BOT_SIMULATION_ID contains unsafe characters.");
if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(sourceIp)) throw new Error("BOT_SOURCE_IP must be an IPv4 address.");

const results = [];
const createdRuleIds = [];
let cookie = "";
let organizationId = "";
let siteId = "";
let campaignLog = "";
let capturedEvents = [];
let classificationSummary = null;
let finalState = null;

function record(name, status, evidence, startedAt = Date.now()) {
  results.push({ name, status, mandatory: true, evidence, durationMs: Date.now() - startedAt });
  process.stdout.write(`${status.padEnd(7)} ${name}: ${evidence}\n`);
}

async function verify(name, action) {
  const startedAt = Date.now();
  try {
    const evidence = await action();
    record(name, "PASS", typeof evidence === "string" ? evidence : evidence.evidence, startedAt);
    return evidence;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    record(name, "FAIL", message, startedAt);
    throw error;
  }
}

function compose(args, options = {}) {
  return execFileSync("docker", ["compose", ...composeFiles, ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      E2E_SECRET_DIR: secretDir,
      APP_URL: baseUrl,
      E2E_APP_URL: baseUrl,
      PLATFORM_ADMIN_EMAIL: adminEmail,
      HF_MODEL_REVISION: process.env.HF_MODEL_REVISION ?? "0000000000000000000000000000000000000000",
      ...options.env
    }
  }).trim();
}

function wpEval(file) {
  return compose(["exec", "-T", "wordpress-cron", "wp", "eval-file", `/demo/${file}`, "--path=/var/www/html"]);
}

function wpCli(args) {
  return compose(["exec", "-T", "wordpress-cron", "wp", ...args, "--path=/var/www/html"]);
}

async function request(path, options = {}) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(`${baseUrl}${path}`, options);
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (response.status !== 429 || attempt === 4) return { response, data, text };
    const retryAfter = Math.max(1, Math.min(30, Number(response.headers.get("retry-after") ?? 1)));
    await new Promise((resolveDelay) => setTimeout(resolveDelay, retryAfter * 1000));
  }
  throw new Error(`Request retry loop exhausted for ${path}.`);
}

async function expect(path, status, options = {}) {
  const result = await request(path, options);
  if (result.response.status !== status) {
    throw new Error(`${options.method ?? "GET"} ${path}: expected ${status}, received ${result.response.status}: ${result.text.slice(0, 300)}`);
  }
  return result;
}

function browserHeaders(json = true) {
  return { cookie, origin, "x-organization-id": organizationId, ...(json ? { "content-type": "application/json" } : {}) };
}

async function sync() {
  const lines = wpEval("sync-wordpress.php").split("\n").filter(Boolean);
  const state = JSON.parse(lines.at(-1));
  if (!state.enrolled) throw new Error(`WordPress is not enrolled: ${JSON.stringify(state)}`);
  return state;
}

async function syncUntilRule(ruleId, enabled = true) {
  let state;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    state = await sync();
    const rule = (state.policyRules ?? []).find((item) => item.id === ruleId);
    if ((enabled && rule?.enabled) || (!enabled && !rule)) return state;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  }
  throw new Error(`WordPress policy did not ${enabled ? "activate" : "remove"} rule ${ruleId}: ${JSON.stringify(state)}`);
}

async function createRule(type, value, priority = 100) {
  const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
  const response = await expect("/v1/firewall/rules", 201, {
    method: "POST",
    headers: browserHeaders(),
    body: JSON.stringify({ siteId, type, value, priority, expiresAt, reason: `Authorized local bot simulation ${simulationId}: ${type}` })
  });
  createdRuleIds.push(response.data.rule.id);
  return response.data.rule;
}

async function setRuleEnabled(id, enabled) {
  return expect(`/v1/firewall/rules/${id}`, 200, {
    method: "PATCH",
    headers: browserHeaders(),
    body: JSON.stringify({ enabled })
  });
}

async function setMode(mode, reason) {
  return expect(`/v1/sites/${siteId}/enforcement-mode`, 200, {
    method: "PATCH",
    headers: browserHeaders(),
    body: JSON.stringify({ mode, reason })
  });
}

function ageObservationGateForIsolatedTest() {
  if (!/^c[a-z0-9]+$/i.test(siteId)) throw new Error("Unsafe site identifier refused by simulation SQL helper.");
  compose(["exec", "-T", "postgres", "psql", "-v", "ON_ERROR_STOP=1", "-U", "honeypot", "-d", "honeypot_ai", "-c", `UPDATE \"Site\" SET \"observeUntil\" = NOW() - INTERVAL '1 minute' WHERE id = '${siteId}';`]);
}

function firewallSmoke(expected, { path = "/blocked-test", source = sourceIp, userAgent = botUserAgent } = {}) {
  return compose([
    "--profile", "e2e", "run", "--rm", "--no-deps", "--entrypoint", "sh",
    "-e", `WORDPRESS_EXPECTED_STATUS=${expected}`,
    "-e", `WORDPRESS_FIREWALL_PATH=${path}`,
    "-e", `WORDPRESS_TEST_SOURCE=${source}`,
    "-e", `WORDPRESS_TEST_USER_AGENT=${userAgent}`,
    "wordpress-e2e", "/demo/wordpress-firewall-smoke.sh"
  ]);
}

function concurrentRateLimitSmoke() {
  return compose([
    "--profile", "e2e", "run", "--rm", "--no-deps", "--entrypoint", "sh",
    "-e", "WORDPRESS_CONCURRENT_REQUESTS=10",
    "-e", "WORDPRESS_EXPECTED_ALLOWED=3",
    "-e", `WORDPRESS_TEST_SOURCE=${sourceIp}`,
    "-e", `WORDPRESS_TEST_USER_AGENT=${neutralUserAgent}`,
    "wordpress-e2e", "/demo/wordpress-rate-limit-concurrent.sh"
  ]);
}

function runBotCampaign() {
  return compose([
    "--profile", "e2e", "run", "--rm", "--no-deps", "--entrypoint", "sh",
    "-e", `BOT_SIMULATION_ID=${simulationId}`,
    "-e", `BOT_SOURCE_IP=${sourceIp}`,
    "-e", `BOT_USER_AGENT=${botUserAgent}`,
    "wordpress-e2e", "/demo/wordpress-bot-campaign.sh"
  ]);
}

async function fetchCampaignEvents() {
  const events = [];
  let page = 1;
  let total = 0;
  do {
    const response = await expect(`/v1/events?siteId=${siteId}&search=${encodeURIComponent(sourceIp)}&page=${page}`, 200, { headers: browserHeaders(false) });
    total = response.data.total;
    events.push(...response.data.data);
    page += 1;
  } while (events.length < total && page <= 10);
  return events;
}

async function waitForHoneypotAssessments() {
  let events = [];
  for (let attempt = 0; attempt < 30; attempt += 1) {
    events = await fetchCampaignEvents();
    const honeypotEvents = events.filter((event) => event.kind === "HONEYPOT");
    const complete = honeypotEvents.filter((event) => event.assessments?.[0]?.status === "COMPLETE");
    if (honeypotEvents.length >= 6 && complete.length === honeypotEvents.length) return honeypotEvents;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1000));
  }
  const states = events.filter((event) => event.kind === "HONEYPOT").map((event) => event.assessments?.[0]?.status ?? "MISSING");
  throw new Error(`Honeypot assessments did not complete in 30 seconds: ${states.join(", ") || "no events"}.`);
}

function deleteCreatedRules() {
  if (createdRuleIds.length === 0) return;
  if (!createdRuleIds.every((id) => /^c[a-z0-9]+$/i.test(id))) throw new Error("Unsafe rule identifier refused by cleanup helper.");
  const ids = createdRuleIds.map((id) => `'${id}'`).join(",");
  compose(["exec", "-T", "postgres", "psql", "-v", "ON_ERROR_STOP=1", "-U", "honeypot", "-d", "honeypot_ai", "-c", `DELETE FROM \"FirewallRule\" WHERE id IN (${ids});`]);
}

async function main() {
  await verify("Trusted local platform connection", async () => {
    if (!process.env.NODE_EXTRA_CA_CERTS) throw new Error("NODE_EXTRA_CA_CERTS is required; TLS verification must remain enabled.");
    const ready = await expect("/health/ready", 200);
    if (ready.data?.database !== "ok" || ready.data?.replayProtection !== "ok") throw new Error(`Platform not fully ready: ${ready.text}`);
    return "HTTPS readiness returned database=ok and replayProtection=ok with exact local certificate trust.";
  });

  await verify("Database-backed simulation session", async () => {
    const login = await expect("/v1/auth/login", 200, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: adminEmail, password: adminPassword })
    });
    cookie = login.response.headers.get("set-cookie")?.split(";")[0] ?? "";
    if (!cookie.startsWith("hp_session=")) throw new Error("Fastify did not issue hp_session.");
    const me = await expect("/v1/auth/me", 200, { headers: { cookie } });
    organizationId = me.data.user.memberships[0]?.organizationId ?? "";
    if (!organizationId) throw new Error("Administrator has no organization membership.");
    return "A live Fastify session resolved the local tenant.";
  });

  await verify("Enrolled WordPress target", async () => {
    const sites = await expect("/v1/sites", 200, { headers: browserHeaders(false) });
    const site = sites.data.data.find((item) => item.domain === "localhost");
    if (!site || site.connectionStatus !== "ONLINE") throw new Error(`No ONLINE localhost site: ${JSON.stringify(site)}`);
    siteId = site.id;
    const rules = await expect("/v1/firewall/rules", 200, { headers: browserHeaders(false) });
    const active = rules.data.data.filter((rule) => rule.enabled && (!rule.expiresAt || new Date(rule.expiresAt) > new Date()));
    if (active.length) throw new Error(`Simulation refused to start with ${active.length} active firewall rule(s).`);
    await setMode("OBSERVE", `Start authorized local bot simulation ${simulationId} safely`);
    const state = await sync();
    return `Local WordPress ${siteId} is ONLINE; queue=${state.queueDepth}; initial mode=${state.effectiveMode}.`;
  });

  await verify("Realistic bot campaign hits all decoys", async () => {
    campaignLog = runBotCampaign();
    const resultLines = campaignLog.split("\n").filter((line) => line.startsWith("BOT_RESULT "));
    if (resultLines.length !== 6) throw new Error(`Expected 6 bot attempts, found ${resultLines.length}: ${campaignLog}`);
    const queueDepth = Number(wpCli(["eval", "echo (new Honeypot_AI_Storage())->queue_depth();"]));
    if (queueDepth < 6) throw new Error(`Expected at least 6 locally spooled bot events, found ${queueDepth}.`);
    return `Six credential-stuffing/reconnaissance requests returned inert 401/404 responses and spooled ${queueDepth} event(s).`;
  });

  await verify("Submitted command remains inert", async () => {
    compose(["exec", "-T", "wordpress", "sh", "-lc", `test ! -e /tmp/honeypot-sim-${simulationId}`]);
    const home = await fetch(`${wordpressUrl}/`);
    const body = await home.text();
    if (body.includes(simulationId)) throw new Error("Simulation marker appeared in the public WordPress response.");
    return "The submitted touch command was not executed and the campaign marker was not reflected publicly.";
  });

  await verify("Honeypot events drain to control plane", async () => {
    const state = await sync();
    if (state.queueDepth !== 0) throw new Error(`Queue did not drain: ${state.queueDepth}.`);
    capturedEvents = await fetchCampaignEvents();
    const keys = new Set(capturedEvents.filter((event) => event.kind === "HONEYPOT").map((event) => event.honeypotKey));
    for (const key of ["fake-login", "backup-archive", "admin-console", "phpmyadmin"]) {
      if (!keys.has(key)) throw new Error(`Missing captured ${key} event.`);
    }
    return `${capturedEvents.filter((event) => event.kind === "HONEYPOT").length} bot honeypot events arrived with all four decoy types represented.`;
  });

  await verify("Crawler identity correlated in evidence", async () => {
    const honeypotEvents = capturedEvents.filter((event) => event.kind === "HONEYPOT");
    if (honeypotEvents.length < 6) throw new Error(`Expected at least 6 honeypot events, got ${honeypotEvents.length}.`);
    const mismatched = honeypotEvents.filter((event) => event.ipAddress !== sourceIp || !event.userAgent?.includes("SmartHoneyBotSim/1.0"));
    if (mismatched.length) throw new Error(`${mismatched.length} event(s) lost the synthetic source or bot user-agent correlation.`);
    return `All ${honeypotEvents.length} honeypot events retain source ${sourceIp} and SmartHoneyBotSim/1.0 identity.`;
  });

  await verify("Automated bot threat assessments complete", async () => {
    const honeypotEvents = await waitForHoneypotAssessments();
    const assessments = honeypotEvents.map((event) => event.assessments[0]);
    const detected = assessments.filter((assessment) => ["BOT", "SCANNER", "CREDENTIAL_STUFFING"].includes(assessment.threatType));
    if (detected.length !== assessments.length) {
      throw new Error(`Expected every honeypot event to classify as bot/scanner/credential stuffing: ${JSON.stringify(assessments)}`);
    }
    const byThreat = assessments.reduce((acc, assessment) => ({ ...acc, [assessment.threatType]: (acc[assessment.threatType] ?? 0) + 1 }), {});
    const bySeverity = assessments.reduce((acc, assessment) => ({ ...acc, [assessment.severity]: (acc[assessment.severity] ?? 0) + 1 }), {});
    const models = [...new Set(assessments.map((assessment) => assessment.modelId))];
    classificationSummary = { total: assessments.length, byThreat, bySeverity, models };
    capturedEvents = await fetchCampaignEvents();
    return `${assessments.length} queued assessments completed: ${Object.entries(byThreat).map(([type, count]) => `${type}=${count}`).join(", ")}.`;
  });

  const uaRule = await verify("OBSERVE mode detects without blocking", async () => {
    const rule = await createRule("BLOCK_USER_AGENT", "SmartHoneyBotSim/1.0", 100);
    await syncUntilRule(rule.id);
    firewallSmoke(200, { userAgent: botUserAgent });
    return { evidence: "The matching bot user-agent remained HTTP 200 in OBSERVE mode.", rule };
  }).then((result) => result.rule);

  await verify("Temporary ENFORCE activation", async () => {
    const premature = await request(`/v1/sites/${siteId}/enforcement-mode`, {
      method: "PATCH",
      headers: browserHeaders(),
      body: JSON.stringify({ mode: "ENFORCE", reason: `Verify observation gate for ${simulationId}` })
    });
    if (premature.response.status !== 409 || premature.data?.code !== "OBSERVATION_REQUIRED") {
      throw new Error(`Expected 409 OBSERVATION_REQUIRED, got ${premature.response.status}.`);
    }
    ageObservationGateForIsolatedTest();
    await setMode("ENFORCE", `Authorized temporary local bot simulation ${simulationId}`);
    const state = await sync();
    if (state.effectiveMode !== "ENFORCE") throw new Error(`WordPress effective mode is ${state.effectiveMode}.`);
    return "The real seven-day gate rejected ENFORCE first; only the isolated test timestamp was then aged and policy switched to ENFORCE.";
  });

  await verify("Bot user-agent receives real 403", async () => {
    const output = firewallSmoke(403, { userAgent: botUserAgent });
    return `${output} The response was generated by the WordPress application firewall.`;
  });

  await verify("Private and loopback sources remain protected", async () => {
    const output = firewallSmoke(200, { source: "127.0.0.1", userAgent: botUserAgent });
    return `${output} Reserved/private sources bypass deny controls to prevent administrative lockout.`;
  });

  const ipRule = await verify("Exact bot IP receives real 403", async () => {
    const rule = await createRule("BLOCK_IP", sourceIp, 90);
    await syncUntilRule(rule.id);
    const output = firewallSmoke(403, { userAgent: neutralUserAgent });
    return { evidence: `${output} Exact synthetic public source matching passed.`, rule };
  }).then((result) => result.rule);

  await setRuleEnabled(ipRule.id, false);
  await syncUntilRule(ipRule.id, false);

  const cidrRule = await verify("Bot CIDR range receives real 403", async () => {
    const rule = await createRule("BLOCK_IP", sourceCidr, 95);
    await syncUntilRule(rule.id);
    const output = firewallSmoke(403, { userAgent: neutralUserAgent });
    return { evidence: `${output} Synthetic source ${sourceIp} matched ${sourceCidr}.`, rule };
  }).then((result) => result.rule);

  const allowRule = await verify("Allowlist overrides bot deny rules", async () => {
    const rule = await createRule("ALLOW_IP", sourceIp, 500);
    await syncUntilRule(rule.id);
    const output = firewallSmoke(200, { userAgent: botUserAgent });
    return { evidence: `${output} ALLOW_IP took precedence over CIDR and user-agent denies.`, rule };
  }).then((result) => result.rule);

  await setRuleEnabled(allowRule.id, false);
  await setRuleEnabled(cidrRule.id, false);
  await setRuleEnabled(uaRule.id, false);
  await syncUntilRule(uaRule.id, false);

  const routeRules = await verify("Common crawler reconnaissance routes receive real 403", async () => {
    const rules = [];
    for (const path of reconnaissancePaths) {
      const rule = await createRule("BLOCK_ROUTE", path, 80);
      rules.push(rule);
      await syncUntilRule(rule.id);
      firewallSmoke(403, { path, userAgent: neutralUserAgent });
    }
    await sync();
    const events = await fetchCampaignEvents();
    const blockedPaths = new Set(events.filter((event) => event.kind === "FIREWALL" && event.action === "BLOCKED").map((event) => event.path));
    for (const path of reconnaissancePaths) {
      if (!blockedPaths.has(path)) throw new Error(`${path} returned 403 without a matching WordPress firewall event.`);
    }
    return { evidence: `${rules.length} live probes returned 403 and produced matching firewall events: ${reconnaissancePaths.join(", ")}.`, rules };
  }).then((result) => result.rules);
  for (const rule of routeRules) await setRuleEnabled(rule.id, false);
  await syncUntilRule(routeRules.at(-1).id, false);

  const rateRule = await verify("Concurrent bot burst receives real 429", async () => {
    const rule = await createRule("RATE_LIMIT", "3/10", 70);
    const state = await syncUntilRule(rule.id);
    if (state.effectiveMode !== "ENFORCE") throw new Error(`Rate-limit policy unexpectedly entered ${state.effectiveMode}.`);
    wpCli(["db", "query", "TRUNCATE TABLE wp_honeypot_ai_rate_limits"]);
    let output;
    try {
      output = concurrentRateLimitSmoke();
    } catch (error) {
      const buckets = wpCli(["db", "query", "SELECT bucket_key,hit_count,expires_at FROM wp_honeypot_ai_rate_limits ORDER BY updated_at DESC LIMIT 5", "--skip-column-names"]);
      throw new Error(`${error instanceof Error ? error.message : String(error)} Active policy=${JSON.stringify(state.policyRules)}; rate buckets=${buckets || "empty"}`);
    }
    return { evidence: `${output} Atomic database-backed buckets enforced the burst.`, rule };
  }).then((result) => result.rule);
  await setRuleEnabled(rateRule.id, false);
  await sync();

  await verify("Firewall and rate-limit events captured", async () => {
    await sync();
    capturedEvents = await fetchCampaignEvents();
    const counts = capturedEvents.reduce((acc, event) => ({ ...acc, [event.kind]: (acc[event.kind] ?? 0) + 1 }), {});
    if ((counts.HONEYPOT ?? 0) < 6) throw new Error(`Expected >=6 HONEYPOT events, got ${counts.HONEYPOT ?? 0}.`);
    if ((counts.FIREWALL ?? 0) < 7) throw new Error(`Expected >=7 FIREWALL events, got ${counts.FIREWALL ?? 0}.`);
    if ((counts.RATE_LIMIT ?? 0) < 7) throw new Error(`Expected >=7 RATE_LIMIT events, got ${counts.RATE_LIMIT ?? 0}.`);
    return `Captured ${counts.HONEYPOT} HONEYPOT, ${counts.FIREWALL} FIREWALL, and ${counts.RATE_LIMIT} RATE_LIMIT event(s) for ${sourceIp}.`;
  });

  await verify("Credential and header redaction", async () => {
    const serialized = JSON.stringify(capturedEvents);
    const secrets = [`SIM-PASSWORD-${simulationId}`, `SIM-DB-PASSWORD-${simulationId}`, `SIM-AUTH-${simulationId}`, `SIM-COOKIE-${simulationId}`];
    for (const secret of secrets) if (serialized.includes(secret)) throw new Error(`Sensitive simulation canary escaped redaction: ${secret}`);
    return "Password, database-password, Authorization, and Cookie canaries are absent from central event evidence.";
  });
}

let mainError = null;
try {
  await main();
} catch (error) {
  mainError = error;
  record("Simulation continuation", "BLOCKED", error instanceof Error ? error.message : String(error));
} finally {
  const cleanupStarted = Date.now();
  const cleanupErrors = [];
  if (cookie && siteId) {
    for (const id of createdRuleIds) {
      try { await setRuleEnabled(id, false); } catch (error) { cleanupErrors.push(`disable ${id}: ${error instanceof Error ? error.message : String(error)}`); }
    }
    try { await setMode("OBSERVE", `Return ${simulationId} to safe observation mode`); } catch (error) { cleanupErrors.push(`mode: ${error instanceof Error ? error.message : String(error)}`); }
    try { deleteCreatedRules(); } catch (error) { cleanupErrors.push(`delete rules: ${error instanceof Error ? error.message : String(error)}`); }
    try {
      const wordpress = await sync();
      const sites = await expect("/v1/sites", 200, { headers: browserHeaders(false) });
      const site = sites.data.data.find((item) => item.id === siteId);
      const rules = await expect("/v1/firewall/rules", 200, { headers: browserHeaders(false) });
      const activeRules = rules.data.data.filter((rule) => rule.enabled && (!rule.expiresAt || new Date(rule.expiresAt) > new Date())).length;
      finalState = {
        siteId,
        connectionStatus: site?.connectionStatus ?? null,
        enforcementMode: site?.enforcementMode ?? null,
        policyVersion: wordpress.policyVersion,
        effectiveMode: wordpress.effectiveMode,
        queueDepth: wordpress.queueDepth,
        droppedEvents: wordpress.droppedEvents,
        activeRules
      };
      if (finalState.enforcementMode !== "OBSERVE" || finalState.effectiveMode !== "OBSERVE" || finalState.queueDepth !== 0 || activeRules !== 0) {
        cleanupErrors.push(`unsafe final state: ${JSON.stringify(finalState)}`);
      }
    } catch (error) { cleanupErrors.push(`final sync: ${error instanceof Error ? error.message : String(error)}`); }
    try { await request("/v1/auth/logout", { method: "POST", headers: { cookie, origin } }); } catch { /* expired local session is non-critical */ }
  }
  record("Safe OBSERVE cleanup", cleanupErrors.length ? "FAIL" : "PASS", cleanupErrors.length ? cleanupErrors.join("; ") : `OBSERVE restored; active rules=0; queue=0; policy=${finalState?.policyVersion ?? "unknown"}.`, cleanupStarted);
}

const mandatoryFailures = results.filter((item) => item.mandatory && item.status !== "PASS");
const output = {
  generatedAt: new Date().toISOString(),
  simulationId,
  project: composeProject,
  authorizedLocalOnly: true,
  sourceIp,
  sourceCidr,
  botUserAgent,
  reconnaissancePaths,
  siteId: siteId || null,
  verdict: mandatoryFailures.length === 0 ? "PASS" : "FAIL",
  results,
  campaignResponses: campaignLog.split("\n").filter((line) => line.startsWith("BOT_RESULT ")),
  classificationSummary,
  capturedEventCounts: capturedEvents.reduce((acc, event) => ({ ...acc, [event.kind]: (acc[event.kind] ?? 0) + 1 }), {}),
  finalState
};

mkdirSync(dirname(resultPath), { recursive: true });
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(resultPath, `${JSON.stringify(output, null, 2)}\n`, { mode: 0o600 });

const table = results.map((result) => `| ${result.name} | ${result.status} | ${String(result.evidence).replaceAll("|", "\\|")} | ${result.durationMs} |`).join("\n");
const responseTable = output.campaignResponses.map((line) => {
  const [, label, method, path, status] = line.split(" ");
  return `| ${label} | ${method} | ${path} | ${status} |`;
}).join("\n");
const report = `# Local Bot-to-Honeypot and Firewall Simulation\n\nGenerated: ${output.generatedAt}  \nSimulation: \`${simulationId}\`  \nSource: \`${sourceIp}\` (secret-gated synthetic public source inside the isolated local demo)  \nVerdict: **${output.verdict}**\n\n## Outcome\n\nThis authorized simulation sent realistic but harmless credential-stuffing and crawler reconnaissance requests through real HTTP to the local WordPress plugin. It then exercised queued threat assessment, live OBSERVE and ENFORCE policies, exact IP/CIDR/user-agent/route blocking, protected-source and allowlist precedence, and a concurrent rate-limit burst.\n\n| Check | Status | Evidence | Duration ms |\n|---|---|---|---:|\n${table}\n\n## Bot decoy responses\n\n| Attempt | Method | Decoy route | HTTP |\n|---|---|---|---:|\n${responseTable}\n\n## Captured event totals\n\n- HONEYPOT: ${output.capturedEventCounts.HONEYPOT ?? 0}\n- FIREWALL: ${output.capturedEventCounts.FIREWALL ?? 0}\n- RATE_LIMIT: ${output.capturedEventCounts.RATE_LIMIT ?? 0}\n\n## Completed threat assessments\n\n\`\`\`json\n${JSON.stringify(output.classificationSummary, null, 2)}\n\`\`\`\n\n## Final safety\n\n\`\`\`json\n${JSON.stringify(finalState, null, 2)}\n\`\`\`\n\nThe simulation leaves the site in OBSERVE mode with no active test rules. Credentials and submitted commands are inert test canaries; redaction checks confirm secrets did not reach central evidence.\n`;
writeFileSync(reportPath, report, { mode: 0o600 });

process.stdout.write(`Simulation JSON: ${resultPath}\nSimulation report: ${reportPath}\n`);
if (mainError || mandatoryFailures.length) process.exitCode = 1;
