import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertSyntheticTarget } from "./synthetic-target-guard.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const baseUrl = (process.env.BASE_URL ?? "https://localhost").replace(/\/$/, "");
assertSyntheticTarget(baseUrl, { label: "Local WordPress E2E control plane" });
assertSyntheticTarget("http://localhost:8080", { label: "Local WordPress E2E target" });
const origin = (process.env.APP_ORIGIN ?? baseUrl).replace(/\/$/, "");
const secretDir = resolve(process.env.E2E_SECRET_DIR ?? `${root}/secrets/e2e`);
const adminEmail = process.env.ADMIN_EMAIL ?? "admin@smarthoneyai.local";
const adminPassword = process.env.ADMIN_PASSWORD ?? readFileSync(`${secretDir}/platform_admin_password`, "utf8").trim();
const controlPort = process.env.HTTPS_PORT ?? "443";
const controlUrl = `https://host.docker.internal${controlPort === "443" ? "" : `:${controlPort}`}`;
const resultPath = resolve(process.env.E2E_RESULT_PATH ?? `${root}/output/e2e/local-wordpress-e2e.json`);
const composeFiles = ["-p", "honeypot-ai-e2e", "-f", `${root}/docker-compose.yml`, "-f", `${root}/docker-compose.wordpress-demo.yml`];
const results = [];
const createdRuleIds = [];
let cookie = "";
let organizationId = "";
let siteId = "";

function record(name, status, evidence, mandatory = true, startedAt = Date.now()) {
  results.push({ name, status, mandatory, evidence, durationMs: Date.now() - startedAt });
  process.stdout.write(`${status.padEnd(7)} ${name}: ${evidence}\n`);
}

async function check(name, action, mandatory = true) {
  const startedAt = Date.now();
  try {
    const evidence = await action();
    record(name, "PASS", evidence ?? "Completed.", mandatory, startedAt);
    return true;
  } catch (error) {
    record(name, "FAIL", error instanceof Error ? error.message : String(error), mandatory, startedAt);
    return false;
  }
}

function compose(args, options = {}) {
  return execFileSync("docker", ["compose", ...composeFiles, ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: options.capture === false ? "inherit" : ["ignore", "pipe", "pipe"],
    env: { ...process.env, E2E_SECRET_DIR: secretDir, APP_URL: baseUrl, E2E_APP_URL: baseUrl, PLATFORM_ADMIN_EMAIL: adminEmail, HF_MODEL_REVISION: process.env.HF_MODEL_REVISION ?? "0000000000000000000000000000000000000000", ...options.env }
  }).trim();
}

function wpEval(file, environment = {}) {
  const args = ["exec", "-T"];
  for (const name of Object.keys(environment)) args.push("-e", name);
  args.push("wordpress-cron", "wp", "eval-file", `/demo/${file}`, "--path=/var/www/html");
  return compose(args, { env: environment });
}

function wpCli(args) {
  return compose(["exec", "-T", "wordpress-cron", "wp", ...args, "--path=/var/www/html"]);
}

function firewallSmoke(expected, { path = "/blocked-test", source = "8.8.4.4", userAgent = "HoneypotE2E/1.0" } = {}) {
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
    "-e", "WORDPRESS_CONCURRENT_REQUESTS=8",
    "-e", "WORDPRESS_EXPECTED_ALLOWED=2",
    "wordpress-e2e", "/demo/wordpress-rate-limit-concurrent.sh"
  ]);
}

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { response, data, text };
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

async function createRule(type, value, priority = 100) {
  const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
  const response = await expect("/v1/firewall/rules", 201, {
    method: "POST",
    headers: browserHeaders(),
    body: JSON.stringify({ siteId, type, value, priority, expiresAt, reason: `Authorized local E2E ${type} validation` })
  });
  createdRuleIds.push(response.data.rule.id);
  return response.data.rule;
}

async function setRuleEnabled(id, enabled) {
  return expect(`/v1/firewall/rules/${id}`, 200, { method: "PATCH", headers: browserHeaders(), body: JSON.stringify({ enabled }) });
}

async function setMode(mode, reason) {
  return expect(`/v1/sites/${siteId}/enforcement-mode`, 200, { method: "PATCH", headers: browserHeaders(), body: JSON.stringify({ mode, reason }) });
}

function setObservationComplete() {
  if (!/^c[a-z0-9]+$/i.test(siteId)) throw new Error("Unsafe site identifier refused by E2E SQL helper.");
  compose(["exec", "-T", "postgres", "psql", "-v", "ON_ERROR_STOP=1", "-U", "honeypot", "-d", "honeypot_ai", "-c", `UPDATE \"Site\" SET \"observeUntil\" = NOW() - INTERVAL '1 minute' WHERE id = '${siteId}';`]);
}

function removeUnenrolledLocalSite(id) {
  if (!/^c[a-z0-9]+$/i.test(id)) throw new Error("Unsafe site identifier refused by E2E SQL helper.");
  compose(["exec", "-T", "postgres", "psql", "-v", "ON_ERROR_STOP=1", "-U", "honeypot", "-d", "honeypot_ai", "-c", `DELETE FROM \"Site\" WHERE id = '${id}' AND status = 'PENDING';`]);
}

async function waitFor(url, expectedStatus = 200, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let last = "no response";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      last = `HTTP ${response.status}`;
      if (response.status === expectedStatus) return;
    } catch (error) { last = error instanceof Error ? error.message : String(error); }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1000));
  }
  throw new Error(`Timed out waiting for ${url} (${last}).`);
}

async function main() {
  await check("TLS trust configured", async () => {
    if (!process.env.NODE_EXTRA_CA_CERTS) throw new Error("NODE_EXTRA_CA_CERTS is required; TLS verification must not be disabled.");
    await expect("/health/ready", 200);
    return "The generated CA is trusted and API readiness is HTTP 200.";
  });

  const authenticated = await check("Database-backed login", async () => {
    const login = await expect("/v1/auth/login", 200, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: adminEmail, password: adminPassword }) });
    cookie = login.response.headers.get("set-cookie")?.split(";")[0] ?? "";
    if (!cookie.startsWith("hp_session=")) throw new Error("Fastify did not issue hp_session.");
    const me = await expect("/v1/auth/me", 200, { headers: { cookie } });
    organizationId = me.data.user.memberships[0]?.organizationId ?? "";
    if (!organizationId) throw new Error("Administrator has no organization membership.");
    return "Fastify session issued and /v1/auth/me resolved an organization.";
  });
  if (!authenticated) throw new Error("Cannot continue without an authenticated organization.");

  const enrolled = await check("Real WordPress enrollment", async () => {
    const sites = await expect("/v1/sites", 200, { headers: browserHeaders(false) });
    let site = sites.data.data.find((item) => item.url === "http://localhost:8080/");
    let token = "";
    const wpState = JSON.parse(wpCli(["eval", "echo wp_json_encode(array('enrolled' => (new Honeypot_AI_Storage())->is_enrolled(), 'siteId' => ((new Honeypot_AI_Storage())->credentials())['site_id'] ?? null));"]));
    if (site && !wpState.enrolled && site.storedStatus === "PENDING") {
      removeUnenrolledLocalSite(site.id);
      site = null;
    }
    if (!site) {
      const created = await expect("/v1/sites", 201, { method: "POST", headers: browserHeaders(), body: JSON.stringify({ name: "Local WordPress Honeypot", url: "http://localhost:8080/" }) });
      site = created.data.site;
      token = created.data.enrollmentToken;
    }
    siteId = site.id;
    if (!wpState.enrolled) {
      if (!token) throw new Error("Site exists but WordPress is not enrolled and no one-time token is available.");
      wpEval("enroll-wordpress.php", { HONEYPOT_ENROLLMENT_TOKEN: token, HONEYPOT_CONTROL_URL: controlUrl });
    } else if (wpState.siteId !== siteId) {
      throw new Error("Existing WordPress credentials belong to another site in the isolated database.");
    }
    const state = await sync();
    if (state.policyVersion < 1 || state.connectionStatus === "OFFLINE") throw new Error(`Initial sync incomplete: ${JSON.stringify(state)}`);
    return `Plugin enrolled as ${siteId}; policy ${state.policyVersion}; ${state.connectionStatus}.`;
  });
  if (!enrolled) throw new Error("Cannot continue without an enrolled WordPress agent.");

  await check("Custom honeypot signed sync and detection", async () => {
    const path = "/e2e-custom-diagnostic";
    const routes = await expect("/v1/honeypots", 200, { headers: browserHeaders(false) });
    let route = routes.data.data.find((item) => item.siteId === siteId && item.path === path);
    if (!route) {
      const created = await expect("/v1/honeypots", 201, {
        method: "POST",
        headers: browserHeaders(),
        body: JSON.stringify({ siteId, name: "E2E custom diagnostic", path, template: "DIAGNOSTIC", enabled: true })
      });
      route = created.data.route;
    }
    await sync();
    const policyKey = wpCli(["eval", `foreach ((new Honeypot_AI_Policy(new Honeypot_AI_Storage()))->honeypots() as $route) { if ($route['path'] === '${path}') { echo $route['key']; break; } }`]);
    if (policyKey !== route.key) throw new Error(`Custom route was not present in the verified policy (expected ${route.key}, received ${policyKey || "none"}).`);
    const response = await fetch(`http://localhost:8080${path}`, { redirect: "manual", headers: { "user-agent": "HoneypotCustomRouteE2E/1.0" } });
    if (![401, 404].includes(response.status)) throw new Error(`Custom inert route returned unexpected HTTP ${response.status}.`);
    await sync();
    const events = await expect(`/v1/events?siteId=${siteId}&search=${encodeURIComponent(path)}`, 200, { headers: browserHeaders(false) });
    if (!events.data.data.some((event) => event.kind === "HONEYPOT" && event.honeypotKey === route.key && event.path === path)) {
      throw new Error("Custom route request did not produce a delivered HONEYPOT event.");
    }
    const schedule = wpCli(["eval", "echo (string) wp_get_schedule('honeypot_ai_policy_sync');"]);
    if (schedule !== "honeypot_ai_one_minute") throw new Error(`Automatic policy sync schedule is missing (${schedule || "none"}).`);
    return `Custom route ${path} synchronized as ${route.key}, rendered inertly, emitted an event, and has a one-minute automatic sync schedule.`;
  });

  await check("All built-in honeypot endpoints", async () => {
    const configured = await expect("/v1/honeypots", 200, { headers: browserHeaders(false) });
    const routes = configured.data.data.filter((route) => route.siteId === siteId && route.source === "BUILT_IN" && route.enabled);
    if (routes.length !== 15) throw new Error(`Expected 15 enabled built-ins, found ${routes.length}.`);
    const paths = new Set(routes.map((route) => route.path));
    for (const required of ["/env", "/git-config", "/wp-config-backup", "/debug-log", "/server-diagnostics"]) {
      if (!paths.has(required)) throw new Error(`Missing hosting-safe built-in endpoint ${required}.`);
    }
    for (const route of routes) {
      const response = await fetch(`http://localhost:8080${route.path}`, { redirect: "manual", headers: { "user-agent": `HoneypotBuiltInE2E/${route.key}` } });
      if (![401, 404].includes(response.status)) throw new Error(`${route.path} returned unexpected HTTP ${response.status}.`);
    }
    await sync();
    const events = await expect(`/v1/events?siteId=${siteId}`, 200, { headers: browserHeaders(false) });
    const detected = new Set(events.data.data.filter((event) => event.kind === "HONEYPOT").map((event) => event.honeypotKey));
    for (const route of routes) if (!detected.has(route.key)) throw new Error(`No delivered event for built-in ${route.key} (${route.path}).`);
    return "All 15 hosting-safe built-ins rendered inertly and delivered tenant-scoped HONEYPOT events.";
  });

  await check("Honeypot routes and local spooling", async () => {
    wpCli(["db", "query", "TRUNCATE TABLE wp_honeypot_ai_honeypot_hits; TRUNCATE TABLE wp_honeypot_ai_auto_blocks"]);
    const output = compose(["--profile", "e2e", "run", "--rm", "wordpress-e2e"]);
    const queued = Number(wpCli(["eval", "echo (new Honeypot_AI_Storage())->queue_depth();"]));
    const automation = JSON.parse(wpCli(["eval", "global $wpdb; echo wp_json_encode(array('hits'=>(int)$wpdb->get_var('SELECT COUNT(*) FROM '.Honeypot_AI_Storage::honeypot_hits_table_name()),'blocks'=>(int)$wpdb->get_var('SELECT COUNT(*) FROM '.Honeypot_AI_Storage::auto_blocks_table_name())));"]));
    wpCli(["db", "query", "TRUNCATE TABLE wp_honeypot_ai_honeypot_hits; TRUNCATE TABLE wp_honeypot_ai_auto_blocks"]);
    if (automation.hits !== 3 || automation.blocks !== 1) throw new Error(`Unexpected repeat-attacker state: ${JSON.stringify(automation)}`);
    return `${output} Queue depth was ${queued} after the concurrent cron drain; three opaque route hashes activated one local block, then the isolated test buckets were cleared.`;
  });

  await check("Exact-once drain and redaction", async () => {
    const before = await expect(`/v1/events?siteId=${siteId}`, 200, { headers: browserHeaders(false) });
    const first = await sync();
    const after = await expect(`/v1/events?siteId=${siteId}`, 200, { headers: browserHeaders(false) });
    const decoys = new Set(after.data.data.filter((event) => event.kind === "HONEYPOT").map((event) => event.honeypotKey));
    for (const key of ["fake-login", "backup-archive", "phpmyadmin"]) if (!decoys.has(key)) throw new Error(`Missing ${key} event after queue drain.`);
    if (!after.data.data.some((event) => event.kind === "FIREWALL" && event.action === "BLOCKED" && event.metadata?.automation === "REPEAT_HONEYPOT_AUTO_BLOCK")) throw new Error("Missing repeat-honeypot automation block event after queue drain.");
    const serialized = JSON.stringify(after.data.data);
    for (const canary of ["HPA-E2E-COOKIE-CANARY", "HPA-E2E-AUTH-CANARY", "HPA-E2E-PASSWORD-CANARY", "HPA-E2E-TOKEN-CANARY"]) {
      if (serialized.includes(canary)) throw new Error(`Sensitive canary escaped redaction: ${canary}`);
    }
    await sync();
    const again = await expect(`/v1/events?siteId=${siteId}`, 200, { headers: browserHeaders(false) });
    if (again.data.total !== after.data.total) throw new Error("A second drain produced duplicate stored events.");
    if (first.queueDepth !== 0) throw new Error(`Queue did not drain: ${first.queueDepth}.`);
    return `${after.data.total - before.data.total} events delivered once; three activating decoys and the subsequent local block are present; credential canaries absent.`;
  });

  await check("Observation gate", async () => {
    const response = await request(`/v1/sites/${siteId}/enforcement-mode`, { method: "PATCH", headers: browserHeaders(), body: JSON.stringify({ mode: "ENFORCE", reason: "Verify seven-day E2E observation gate" }) });
    if (response.response.status !== 409 || response.data?.code !== "OBSERVATION_REQUIRED") throw new Error(`Expected 409 OBSERVATION_REQUIRED, got ${response.response.status} ${response.data?.code}.`);
    setObservationComplete();
    return "Premature ENFORCE rejected; isolated demo observation timestamp then aged for authorized tests.";
  });

  await check("OBSERVE fail-open", async () => {
    const rule = await createRule("BLOCK_ROUTE", "/blocked-test", 100);
    await sync();
    firewallSmoke(200);
    await setRuleEnabled(rule.id, false);
    await sync();
    return "A matching deny rule remained monitor-only in OBSERVE mode.";
  });

  await check("Route block and 403 event", async () => {
    const rule = await createRule("BLOCK_ROUTE", "/blocked-test", 100);
    await setMode("ENFORCE", "Authorized route-block E2E validation after observation gate");
    await sync();
    firewallSmoke(403);
    await sync();
    const events = await expect(`/v1/events?siteId=${siteId}&search=%2Fblocked-test`, 200, { headers: browserHeaders(false) });
    if (!events.data.data.some((event) => event.kind === "FIREWALL" && event.action === "BLOCKED")) throw new Error("No FIREWALL/BLOCKED event was delivered.");
    await setRuleEnabled(rule.id, false);
    await sync();
    return "Synthetic public source received HTTP 403 and a FIREWALL/BLOCKED event was delivered.";
  });

  await check("Private-source protection", async () => {
    const rule = await createRule("BLOCK_ROUTE", "/blocked-test", 100);
    await sync();
    const response = await fetch("http://localhost:8080/blocked-test", { redirect: "manual" });
    if (response.status === 403 || response.status === 429) throw new Error(`Private loopback source was blocked with ${response.status}.`);
    await setRuleEnabled(rule.id, false);
    await sync();
    return `Loopback request was protected from blocking (HTTP ${response.status}).`;
  });

  await check("Exact IP and CIDR blocks", async () => {
    for (const value of ["8.8.4.4", "8.8.4.0/24"]) {
      const rule = await createRule("BLOCK_IP", value, 100);
      await sync();
      firewallSmoke(403);
      await setRuleEnabled(rule.id, false);
      await sync();
    }
    return "Exact 8.8.4.4 and CIDR 8.8.4.0/24 rules each returned HTTP 403.";
  });

  await check("User-agent block", async () => {
    const rule = await createRule("BLOCK_USER_AGENT", "HoneypotE2E/1.0", 100);
    await sync();
    firewallSmoke(403, { userAgent: "HoneypotE2E/1.0" });
    await setRuleEnabled(rule.id, false);
    await sync();
    return "A bounded user-agent match returned HTTP 403.";
  });

  await check("Atomic rate limit and 429 event", async () => {
    const rule = await createRule("RATE_LIMIT", "2/10", 100);
    await sync();
    wpCli(["db", "query", "TRUNCATE TABLE wp_honeypot_ai_rate_limits"]);
    const concurrent = concurrentRateLimitSmoke();
    await sync();
    const events = await expect(`/v1/events?siteId=${siteId}`, 200, { headers: browserHeaders(false) });
    if (!events.data.data.some((event) => event.kind === "RATE_LIMIT" && event.action === "RATE_LIMITED")) throw new Error("No RATE_LIMIT/RATE_LIMITED event was delivered.");
    await setRuleEnabled(rule.id, false);
    await sync();
    return `${concurrent} Rate-limit events were delivered.`;
  });

  await check("Allowlist precedence", async () => {
    const deny = await createRule("BLOCK_IP", "8.8.4.4", 10);
    const allow = await createRule("ALLOW_IP", "8.8.4.4", 500);
    await sync();
    firewallSmoke(200);
    await setRuleEnabled(deny.id, false);
    await setRuleEnabled(allow.id, false);
    await sync();
    return "ALLOW_IP won over a higher-priority-number deny rule for the same source.";
  });

  await check("Expired policy monitor-only", async () => {
    const rule = await createRule("BLOCK_ROUTE", "/blocked-test", 100);
    await sync();
    wpCli(["eval", "$s=new Honeypot_AI_Storage();$p=$s->policy();$p['document']['expiresAt']=gmdate('c',time()-60);update_option(Honeypot_AI_Storage::OPTION_POLICY,$p,false);"]);
    firewallSmoke(200);
    await setRuleEnabled(rule.id, false);
    await sync();
    return "A locally expired signed policy switched to MONITOR_ONLY and failed open.";
  });

  await check("API outage spool and recovery", async () => {
    compose(["stop", "api"]);
    const response = await fetch("http://localhost:8080/secure-admin-login");
    if (![401, 404].includes(response.status)) throw new Error(`WordPress decoy was not available during API outage: ${response.status}.`);
    const queuedBefore = Number(wpCli(["eval", "echo (new Honeypot_AI_Storage())->queue_depth();"]));
    if (queuedBefore < 1) throw new Error("Event did not spool while API was stopped.");
    compose(["start", "api"]);
    await waitFor(`${baseUrl}/health/ready`);
    wpCli(["db", "query", "UPDATE wp_honeypot_ai_events SET available_at=UTC_TIMESTAMP()"]);
    await sync();
    const recovered = await sync();
    if (recovered.queueDepth !== 0) throw new Error(`Recovered queue depth is ${recovered.queueDepth}.`);
    return `WordPress stayed available, queued ${queuedBefore}, and drained to zero after API recovery.`;
  });

  await check("Redis replay fail-closed and recovery", async () => {
    compose(["stop", "redis"]);
    const wpResponse = await fetch("http://localhost:8080/");
    if (wpResponse.status !== 200) throw new Error(`WordPress home failed during Redis outage: ${wpResponse.status}.`);
    const readiness = await request("/health/ready");
    if (readiness.response.status !== 503) throw new Error(`API readiness should be 503, received ${readiness.response.status}.`);
    const outage = await sync();
    if (!outage.lastErrorCode) throw new Error("WordPress did not retain a sanitized sync error during Redis outage.");
    compose(["start", "redis"]);
    await waitFor(`${baseUrl}/health/ready`);
    await sync();
    const recovered = await sync();
    if (recovered.connectionStatus === "OFFLINE") throw new Error(`Agent did not recover: ${JSON.stringify(recovered)}`);
    return `API readiness failed closed; WordPress remained HTTP 200; agent recovered with ${recovered.connectionStatus}.`;
  });

  await check("Live connection and policy acknowledgement", async () => {
    const sites = await expect("/v1/sites", 200, { headers: browserHeaders(false) });
    const site = sites.data.data.find((item) => item.id === siteId);
    if (!site || site.connectionStatus !== "ONLINE" || !site.latestHeartbeat || site.policyState !== "SYNCHRONIZED") throw new Error(`Unexpected site state: ${JSON.stringify(site)}`);
    const enabled = new Set(site.latestHeartbeat.enabledDecoys);
    const builtIns = ["fake-login", "backup-archive", "admin-console", "phpmyadmin", "environment-file", "git-config", "wp-config-backup", "server-status", "adminer", "debug-log", "database-dump", "actuator-env"];
    for (const key of builtIns) if (!enabled.has(key)) throw new Error(`Heartbeat inventory is missing built-in decoy ${key}.`);
    if (![...enabled].some((key) => key.startsWith("custom-"))) throw new Error("Heartbeat inventory is missing the synchronized custom decoy.");
    const policySafety = JSON.parse(wpCli(["eval", "$stored=(new Honeypot_AI_Storage())->policy(); $document=$stored['document']; $env=null; foreach($document['honeypots'] as $route){if($route['key']==='environment-file'){$env=$route['path']; break;}} echo wp_json_encode(array('autoBlock'=>$document['autoBlock'],'environmentPath'=>$env));"]));
    if (policySafety.autoBlock?.enabled !== true || policySafety.autoBlock?.distinctRoutes !== 3 || policySafety.autoBlock?.windowSeconds !== 600 || policySafety.autoBlock?.blockSeconds !== 86400) throw new Error(`Unsafe repeat-attacker policy: ${JSON.stringify(policySafety.autoBlock)}`);
    if (policySafety.environmentPath !== "/env") throw new Error(`Environment honeypot did not migrate to /env: ${JSON.stringify(policySafety)}`);
    return `ONLINE; heartbeat queue=${site.latestHeartbeat.queueDepth}; drops=${site.latestHeartbeat.droppedEvents}; policy=${site.latestPolicy.version} acknowledged.`;
  });
}

try {
  await main();
} catch (error) {
  record("E2E continuation", "BLOCKED", error instanceof Error ? error.message : String(error), true);
} finally {
  if (cookie && siteId) {
    for (const id of createdRuleIds) {
      try { await setRuleEnabled(id, false); } catch { /* best-effort safe cleanup */ }
    }
    try { await setMode("OBSERVE", "Return isolated local demo to safe observation mode"); } catch { /* best-effort safe cleanup */ }
    try { await sync(); } catch { /* report captures prior failure */ }
  }
  mkdirSync(dirname(resultPath), { recursive: true });
  const mandatoryFailures = results.filter((item) => item.mandatory && item.status !== "PASS");
  const output = {
    generatedAt: new Date().toISOString(),
    project: "honeypot-ai-e2e",
    baseUrl,
    wordpressUrl: "http://localhost:8080",
    siteId: siteId || null,
    verdict: mandatoryFailures.length === 0 ? "PASS" : "FAIL",
    results,
    finalSafety: { requestedMode: "OBSERVE", activeTestRulesRequested: false },
    providers: [
      { name: "Hugging Face", status: "NOT CONFIGURED", mandatory: false },
      { name: "Telegram", status: "NOT CONFIGURED", mandatory: false },
      { name: "SMTP", status: "NOT CONFIGURED", mandatory: false }
    ]
  };
  writeFileSync(resultPath, `${JSON.stringify(output, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`Evidence JSON: ${resultPath}\n`);
  process.exitCode = mandatoryFailures.length === 0 ? 0 : 1;
}
