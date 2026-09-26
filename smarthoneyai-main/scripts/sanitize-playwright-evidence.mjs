import {
  chmodSync,
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync
} from "node:fs";
import { basename, join, resolve } from "node:path";

const evidenceDir = resolve(process.argv[2] ?? "");
const secretDir = resolve(process.argv[3] ?? "");
const runId = process.env.PERF_RUN_ID ?? "";

if (!evidenceDir || !existsSync(evidenceDir)) throw new Error("An existing Playwright evidence directory is required.");
if (!secretDir || !existsSync(secretDir)) throw new Error("An existing secret directory is required.");

function walk(path) {
  return readdirSync(path).flatMap((name) => {
    const child = join(path, name);
    return statSync(child).isDirectory() ? walk(child) : [child];
  });
}

const sensitiveValues = new Map();
function remember(label, value) {
  const normalized = String(value ?? "").trim();
  if (normalized.length >= 12 && !sensitiveValues.has(normalized)) sensitiveValues.set(normalized, label);
}

for (const name of [
  "agent_signing_secret",
  "grafana_admin_password",
  "platform_admin_password",
  "policy_signing_private_key",
  "postgres_password",
  "redis_password",
  "session_secret",
  "wordpress_admin_password",
  "wordpress_db_password",
  "wordpress_db_root_password",
  "wordpress_test_source_secret",
  "tls/privkey.pem"
]) {
  const path = join(secretDir, name);
  if (!existsSync(path)) continue;
  const value = readFileSync(path, "utf8");
  remember(name, value);
  for (const line of value.split(/\r?\n/)) remember(name, line.includes("=") ? line.slice(line.indexOf("=") + 1) : line);
}

const credentialsPath = join(secretDir, "credentials.txt");
if (existsSync(credentialsPath)) {
  for (const line of readFileSync(credentialsPath, "utf8").split(/\r?\n/)) {
    const separator = line.indexOf("=");
    if (separator >= 0) remember("credentials", line.slice(separator + 1));
  }
}

const statePath = join(secretDir, "playwright-auth-state.json");
if (existsSync(statePath)) {
  try {
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    for (const cookie of state.cookies ?? []) remember(`cookie-${cookie.name ?? "value"}`, cookie.value);
    for (const origin of state.origins ?? []) {
      for (const entry of origin.localStorage ?? []) {
        if (/token|secret|session|auth|key/i.test(entry.name ?? "")) remember(`storage-${entry.name}`, entry.value);
      }
    }
  } catch {
    throw new Error("The restricted Playwright authentication state is malformed.");
  }
}

const agentDir = join(secretDir, "agents");
if (existsSync(agentDir)) {
  for (const path of walk(agentDir).filter((value) => /^agents-shard-\d+\.json$/.test(basename(value)))) {
    try {
      for (const agent of JSON.parse(readFileSync(path, "utf8")).agents ?? []) remember("synthetic-agent", agent.secret);
    } catch {
      throw new Error(`Malformed synthetic-agent secret file: ${basename(path)}`);
    }
  }
}

for (const canary of [
  `PERF-PASSWORD-${runId}`,
  `PERF-AUTH-${runId}`,
  `PERF-COOKIE-${runId}`,
  `SIM-PASSWORD-bot-${runId}`,
  `SIM-DB-PASSWORD-bot-${runId}`,
  `SIM-AUTH-bot-${runId}`,
  `SIM-COOKIE-bot-${runId}`
]) remember("submitted-canary", canary);

let sanitizedFiles = 0;
let replacements = 0;
for (const path of walk(evidenceDir)) {
  const original = readFileSync(path);
  if (original.includes(0)) {
    chmodSync(path, 0o600);
    continue;
  }
  let text = original.toString("utf8");
  let changed = false;
  for (const [value, label] of sensitiveValues) {
    if (!text.includes(value)) continue;
    const parts = text.split(value);
    replacements += parts.length - 1;
    text = parts.join(`[REDACTED:${label}]`);
    changed = true;
  }
  const substitutions = [
    [/hp_session=[A-Za-z0-9_\-]{12,}/g, "hp_session=[REDACTED]"],
    [/(\"name\"\s*:\s*\"hp_session\"\s*,\s*\"value\"\s*:\s*\")[^\"]+(\")/gi, "$1[REDACTED]$2"],
    [/(authorization[\"'\s:=]+(?:bearer\s+)?)[A-Za-z0-9_+\/=.-]{12,}/gi, "$1[REDACTED]"]
  ];
  for (const [pattern, replacement] of substitutions) {
    text = text.replace(pattern, (...args) => {
      changed = true;
      replacements += 1;
      return typeof replacement === "string" ? replacement.replace(/\$(\d)/g, (_match, index) => args[Number(index)] ?? "") : replacement;
    });
  }
  if (changed) {
    writeFileSync(path, text, { mode: 0o600 });
    sanitizedFiles += 1;
  } else {
    chmodSync(path, 0o600);
  }
}

process.stdout.write(`${JSON.stringify({ status: "PASS", files: walk(evidenceDir).length, sanitizedFiles, replacements })}\n`);
