import { createHash } from "node:crypto";
import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";

const artifactDir = resolve(process.env.PERF_ARTIFACT_DIR ?? process.argv[2] ?? "");
const secretDir = resolve(process.env.E2E_SECRET_DIR ?? process.argv[3] ?? "");
const agentDir = resolve(process.env.PERF_AGENT_DIR ?? join(secretDir, "agents"));
const runId = process.env.PERF_RUN_ID ?? basename(artifactDir);
const stage = process.env.PERF_EVIDENCE_SCAN_STAGE ?? "pre-report";
const outputPath = resolve(process.env.PERF_EVIDENCE_SCAN_OUTPUT ?? join(artifactDir, `evidence-redaction-${stage}.json`));

if (!artifactDir || !existsSync(artifactDir)) throw new Error("PERF_ARTIFACT_DIR is required.");

function walk(path) {
  if (!existsSync(path)) return [];
  return readdirSync(path).flatMap((name) => {
    const child = join(path, name);
    return statSync(child).isDirectory() ? walk(child) : [child];
  });
}

const sensitiveValues = new Map();
function remember(rule, value) {
  const normalized = String(value ?? "").trim();
  if (normalized.length < 16) return;
  if (!sensitiveValues.has(normalized)) sensitiveValues.set(normalized, rule);
}

const sensitiveFiles = [
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
];
for (const name of sensitiveFiles) {
  const path = join(secretDir, name);
  if (!existsSync(path)) continue;
  const value = readFileSync(path, "utf8");
  remember(`secret:${name}`, value);
  for (const line of value.split(/\r?\n/)) {
    const candidate = line.includes("=") ? line.slice(line.indexOf("=") + 1) : line;
    remember(`secret:${name}`, candidate);
  }
}
const credentialsPath = join(secretDir, "credentials.txt");
if (existsSync(credentialsPath)) {
  for (const line of readFileSync(credentialsPath, "utf8").split(/\r?\n/)) {
    const separator = line.indexOf("=");
    if (separator >= 0) remember("secret:credentials", line.slice(separator + 1));
  }
}
for (const path of walk(agentDir).filter((value) => /^agents-shard-\d+\.json$/.test(basename(value)))) {
  try {
    const agents = JSON.parse(readFileSync(path, "utf8")).agents ?? [];
    for (const agent of agents) remember("secret:synthetic-agent", agent.secret);
  } catch { /* malformed credential input is handled by the simulation itself */ }
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

const regexRules = [
  ["private-key-pem", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ["session-cookie", /hp_session=[A-Za-z0-9_\-]{16,}/g],
  ["authorization-value", /authorization["'\s:=]+(?:bearer\s+)?[A-Za-z0-9_+\/=.-]{16,}/gi]
];
const findings = [];
const files = walk(artifactDir).filter((path) => resolve(path) !== outputPath);
const overlapBytes = Math.max(4096, ...[...sensitiveValues.keys()].map((value) => Buffer.byteLength(value)));
for (const path of files) {
  const descriptor = openSync(path, "r");
  let carry = Buffer.alloc(0);
  try {
    const buffer = Buffer.alloc(1024 * 1024);
    while (true) {
      const count = readSync(descriptor, buffer, 0, buffer.length, null);
      if (count === 0) break;
      const bytes = Buffer.concat([carry, buffer.subarray(0, count)]);
      for (const [value, rule] of sensitiveValues) {
        if (bytes.includes(Buffer.from(value))) findings.push({ rule, path: relative(artifactDir, path), fingerprint: createHash("sha256").update(`${rule}\0${relative(artifactDir, path)}`).digest("hex").slice(0, 16) });
      }
      const text = bytes.toString("latin1");
      for (const [rule, expression] of regexRules) {
        expression.lastIndex = 0;
        if (expression.test(text)) findings.push({ rule, path: relative(artifactDir, path), fingerprint: createHash("sha256").update(`${rule}\0${relative(artifactDir, path)}`).digest("hex").slice(0, 16) });
      }
      carry = bytes.subarray(Math.max(0, bytes.length - overlapBytes));
    }
  } finally {
    closeSync(descriptor);
  }
}

const unique = [...new Map(findings.map((item) => [`${item.rule}\0${item.path}`, item])).values()];
const output = {
  status: unique.length === 0 ? "PASS" : "FAIL",
  stage,
  scannedAt: new Date().toISOString(),
  scannedFiles: files.length,
  sensitiveValuesLoaded: sensitiveValues.size,
  findings: unique,
  findingCounts: Object.fromEntries([...new Set(unique.map((item) => item.rule))].sort().map((rule) => [rule, unique.filter((item) => item.rule === rule).length]))
};
writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${JSON.stringify({ status: output.status, stage, scannedFiles: files.length, findings: unique.length })}\n`);
if (output.status !== "PASS") process.exitCode = 1;
