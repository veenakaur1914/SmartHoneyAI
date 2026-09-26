import { connect } from "node:net";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertSyntheticTarget } from "./synthetic-target-guard.mjs";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const platform = (process.env.DEMO_PLATFORM_URL ?? "https://localhost:9443").replace(/\/$/, "");
const wordpress = (process.env.DEMO_WORDPRESS_URL ?? "http://localhost:8080").replace(/\/$/, "");
const telegramMock = (process.env.DEMO_TELEGRAM_MOCK_URL ?? "http://localhost:18099").replace(/\/$/, "");
const secretDir = resolve(process.env.E2E_SECRET_DIR ?? `${root}/secrets/e2e`);
const composeFiles = ["-p", "honeypot-ai-e2e", "-f", `${root}/docker-compose.yml`, "-f", `${root}/docker-compose.wordpress-demo.yml`];
const redactionCanaries = ["DEMO-USERNAME-MUST-NOT-LEAK", "DEMO-PASSWORD-MUST-NOT-LEAK", "DEMO-TOKEN-MUST-NOT-LEAK"];

assertSyntheticTarget(platform, { label: "Local attack demo control plane" });
assertSyntheticTarget(wordpress, { label: "Local attack demo WordPress" });
assertSyntheticTarget(telegramMock, { label: "Local attack demo Telegram mock" });

export function dryRun(mode, args) {
  if (args.includes("--execute")) return false;
  process.stdout.write(`${JSON.stringify({ mode, dryRun: true, targets: { platform, wordpress, telegramMock }, safety: ["loopback targets only", "harmless inert decoys", "synthetic source header accepted only by the local MU-plugin", "Telegram mock only", "owned rule cleanup"] }, null, 2)}\nDry run only. Re-run with --execute after pnpm demo:local:e2e.\n`);
  return true;
}

export function compose(args, options = {}) {
  const output = execFileSync("docker", ["compose", ...composeFiles, ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: options.inherit ? "inherit" : ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      E2E_SECRET_DIR: secretDir,
      APP_URL: platform,
      E2E_APP_URL: platform,
      PLATFORM_ADMIN_EMAIL: process.env.E2E_PLATFORM_ADMIN_EMAIL ?? "admin@smarthoneyai.local",
      PLATFORM_ORGANIZATION_NAME: "SmartHoneyAI Local Acceptance",
      PLATFORM_ORGANIZATION_SLUG: "smarthoneyai-local-acceptance",
      HF_MODEL_REVISION: "0000000000000000000000000000000000000000",
      SMTP_HOST: "smtp.local.invalid",
      SMTP_USER: "local-demo",
      SMTP_FROM: "SmartHoneyAI <security@localhost.invalid>"
    }
  });
  return typeof output === "string" ? output.trim() : "";
}

export function wpEval(file) {
  const output = compose(["exec", "-T", "wordpress-cron", "wp", "eval-file", `/demo/${file}`, "--path=/var/www/html"]);
  return output.split("\n").filter(Boolean).at(-1) ?? "";
}

export function wpQuery(sql) {
  return compose(["exec", "-T", "wordpress-cron", "wp", "db", "query", sql, "--path=/var/www/html"]);
}

export function sql(statement) {
  return compose(["exec", "-T", "postgres", "psql", "-v", "ON_ERROR_STOP=1", "-U", "honeypot", "-d", "honeypot_ai", "-c", statement]);
}

export function validateId(value, label = "identifier") {
  if (!/^c[a-z0-9]+$/i.test(value)) throw new Error(`Unsafe ${label} refused.`);
  return value;
}

export async function httpJson(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(options.timeoutMs ?? 20_000) });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { response, data, text };
}

export async function expectJson(url, status, options = {}) {
  const result = await httpJson(url, options);
  if (result.response.status !== status) throw new Error(`${options.method ?? "GET"} ${url} expected ${status}, received ${result.response.status}: ${result.text.slice(0, 300)}`);
  return result;
}

export async function session() {
  await expectJson(`${platform}/health/ready`, 200);
  const password = readFileSync(`${secretDir}/platform_admin_password`, "utf8").trim();
  const loginRequest = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: process.env.E2E_PLATFORM_ADMIN_EMAIL ?? "admin@smarthoneyai.local", password }) };
  let login = await httpJson(`${platform}/v1/auth/login`, loginRequest);
  if (login.response.status === 429) {
    compose(["restart", "api"]);
    await waitFor("local API restart", async () => (await httpJson(`${platform}/health/ready`)).response.status === 200, 60_000, 1_000);
    login = await httpJson(`${platform}/v1/auth/login`, loginRequest);
  }
  if (login.response.status !== 200) throw new Error(`Local platform login returned HTTP ${login.response.status}: ${login.text.slice(0, 240)}`);
  const cookie = login.response.headers.get("set-cookie")?.split(";")[0] ?? "";
  if (!cookie.startsWith("hp_session=")) throw new Error("Local platform login did not issue a session.");
  const me = await expectJson(`${platform}/v1/auth/me`, 200, { headers: { cookie } });
  const organizationId = me.data.user.memberships[0]?.organizationId;
  if (!organizationId) throw new Error("Local administrator has no organization.");
  const headers = { cookie, origin: platform, "x-organization-id": organizationId };
  const sites = await expectJson(`${platform}/v1/sites`, 200, { headers });
  const site = sites.data.data.find((item) => item.url === `${wordpress}/`);
  if (!site || site.status === "PENDING") throw new Error("Local WordPress is not enrolled. Run RESET_E2E=1 pnpm demo:local:e2e first.");
  return { cookie, organizationId, headers, site };
}

export async function api(sessionState, path, status = 200, options = {}) {
  return expectJson(`${platform}${path}`, status, { ...options, headers: { ...sessionState.headers, ...(options.body ? { "content-type": "application/json" } : {}), ...options.headers } });
}

export async function connectTelegram(sessionState, scenario) {
  await expectJson(`${telegramMock}/test/reset`, 200, { method: "POST" });
  const setup = await api(sessionState, "/v1/alerts/telegram/setup", 200, { method: "POST", body: "{}" });
  await expectJson(`${telegramMock}/test/connect`, 200, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: setup.data.code }) });
  const connected = await api(sessionState, "/v1/alerts/telegram/connect", 200, { method: "POST", body: "{}" });
  if (!connected.data.enabled || !connected.data.providerAvailable) throw new Error("Telegram demo channel was not enabled.");
  const testDelivery = await api(sessionState, "/v1/alerts/telegram/test", 200, { method: "POST", body: JSON.stringify({ scenario }) });
  if (testDelivery.data.status !== "SENT") throw new Error("Telegram provider test did not return SENT.");
  return { ...connected.data, testDelivery: testDelivery.data };
}

export async function telegramMessages() {
  return (await expectJson(`${telegramMock}/test/messages`, 200)).data.messages;
}

export function wordpressHeaders(sourceIp, includeSecrets = false) {
  const secret = readFileSync(`${secretDir}/wordpress_test_source_secret`, "utf8").trim();
  return {
    "user-agent": "SmartHoneyAI-Authorized-Demo/1.1",
    "x-honeypot-test-secret": secret,
    "x-honeypot-test-remote-addr": sourceIp,
    ...(includeSecrets ? { authorization: `Bearer ${redactionCanaries[2]}`, cookie: `demo_session=${redactionCanaries[1]}` } : {})
  };
}

export async function wordpressProbe(path, sourceIp, options = {}) {
  return fetch(`${wordpress}${path}`, { redirect: "manual", ...options, headers: { ...wordpressHeaders(sourceIp, options.includeSecrets), ...options.headers }, signal: AbortSignal.timeout(15_000) });
}

export async function waitFor(name, action, timeoutMs = 90_000, intervalMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await action();
      if (result) return result;
    } catch (error) { lastError = error; }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, intervalMs));
  }
  throw new Error(`${name} timed out${lastError instanceof Error ? `: ${lastError.message}` : ""}.`);
}

export function resetWordpressAutomation() {
  wpQuery("TRUNCATE TABLE wp_honeypot_ai_honeypot_hits; TRUNCATE TABLE wp_honeypot_ai_auto_blocks;");
}

export function syncWordpress() {
  return JSON.parse(wpEval("sync-wordpress.php"));
}

export function assertRedacted(value) {
  const serialized = JSON.stringify(value);
  for (const canary of redactionCanaries) if (serialized.includes(canary)) throw new Error(`Redaction failed for ${canary}.`);
}

export function canaries() { return [...redactionCanaries]; }

export function recordStep(evidence, name, detail) {
  evidence.steps.push({ name, status: "PASS", detail, at: new Date().toISOString() });
  process.stdout.write(`PASS    ${name}: ${detail}\n`);
}

export async function saveEvidence(evidence, requestedPath) {
  evidence.completedAt = new Date().toISOString();
  evidence.status ??= "PASS";
  const path = resolve(requestedPath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  const markdown = path.replace(/\.json$/i, ".md");
  const rows = evidence.steps.map((step) => `| ${step.name} | ${step.status} | ${String(step.detail).replaceAll("|", "\\|")} |`).join("\n");
  await writeFile(markdown, `# ${evidence.title}\n\n- Status: ${evidence.status}\n- Started: ${evidence.startedAt}\n- Completed: ${evidence.completedAt}\n- Scope: local-only authorized demonstration\n\n| Gate | Result | Evidence |\n|---|---|---|\n${rows}\n`, { mode: 0o600 });
  process.stdout.write(`Evidence: ${path}\n`);
  return { path, markdown };
}

export function sensorCompose(args, environment, inherit = false) {
  const result = spawnSync("docker", ["compose", "-p", "smarthoneyai-local-hybrid-demo", "-f", "client-sensor/docker-compose.yml", "-f", "client-sensor/docker-compose.local.yml", "--profile", "sensor", ...args], { cwd: root, env: { ...process.env, ...environment }, stdio: inherit ? "inherit" : ["ignore", "pipe", "pipe"], encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || `Sensor compose failed (${result.status}).`);
  return result.stdout?.trim() ?? "";
}

export async function prepareDemoSensorBuild() {
  const build = spawnSync("corepack", ["pnpm", "--filter", "@honeypot/network-sensor-agent", "build:demo"], { cwd: root, stdio: "inherit" });
  if (build.status !== 0) throw new Error("Sensor demo build failed.");
  await copyFile(`${root}/apps/network-sensor-agent/dist/index.js`, `${root}/client-sensor/agent/index.js`);
}

export async function removeDemoSensorBuild() {
  await rm(`${root}/client-sensor/agent/index.js`, { force: true });
}

export function probePort(port, options = {}) {
  return new Promise((resolveProbe, reject) => {
    let settled = false;
    let receivedBytes = 0;
    const socket = connect({ host: "127.0.0.1", port }, () => {
      if (port === 16379) socket.write("*1\r\n$4\r\nPING\r\n");
      else if (port === 2222) socket.write("SSH-2.0-SmartHoneyAIAuthorizedDemo\r\n");
      setTimeout(() => socket.end(), 1_500);
    });
    socket.on("data", (chunk) => { receivedBytes += chunk.length; /* Never retain protocol content. */ });
    socket.setTimeout(5_000, () => socket.destroy(new Error(`Port ${port} timed out.`)));
    socket.once("error", (error) => { if (!settled) { settled = true; reject(error); } });
    socket.once("close", () => {
      if (settled) return;
      settled = true;
      if (options.requireResponse && receivedBytes === 0) reject(new Error(`Port ${port} closed before a protocol response.`));
      else resolveProbe({ port, receivedBytes });
    });
  });
}

export { platform, wordpress, telegramMock, secretDir };
