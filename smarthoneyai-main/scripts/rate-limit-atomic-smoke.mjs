import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertSyntheticTarget } from "./synthetic-target-guard.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const secretDir = resolve(process.env.E2E_SECRET_DIR ?? `${root}/secrets/perf`);
const outputPath = resolve(process.env.PERF_RATE_LIMIT_RESULT ?? `${root}/output/performance/rate-limit-atomic.json`);
const wordpressUrl = (process.env.WORDPRESS_URL ?? "http://localhost:8080").replace(/\/$/, "");
assertSyntheticTarget(wordpressUrl, { label: "Atomic rate-limit performance target" });
const runId = process.env.PERF_RUN_ID ?? "local-perf";
const sourceSecret = readFileSync(`${secretDir}/wordpress_test_source_secret`, "utf8").trim();

const headers = {
  Host: "localhost:8080",
  "X-Honeypot-Test-Secret": sourceSecret,
  "X-Honeypot-Test-Remote-Addr": "45.250.250.250",
  "User-Agent": `PerfRateAtomic/${runId}`,
};

// Keep the entire concurrent burst in one fixed window. Without alignment a
// perfectly atomic limiter can legitimately split requests across a boundary.
const boundaryDelayMs = Math.max(250, ((10_000 - (Date.now() % 10_000)) + 250) % 10_000);
await new Promise((resolveDelay) => setTimeout(resolveDelay, boundaryDelayMs));
const alignedAt = new Date().toISOString();
const startedAt = new Date().toISOString();
const responses = await Promise.all(Array.from({ length: 20 }, async (_, index) => {
  const started = performance.now();
  try {
    const response = await fetch(`${wordpressUrl}/?atomic-rate-request=${index}`, { headers: { ...headers, "X-Perf-Event-ID": `${runId}:atomic:${index}` }, signal: AbortSignal.timeout(10_000) });
    await response.arrayBuffer();
    return { index, status: response.status, durationMs: performance.now() - started };
  } catch (error) {
    return { index, status: 0, durationMs: performance.now() - started, error: error instanceof Error ? error.name : "request_error" };
  }
}));
const counts = Object.fromEntries([...new Set(responses.map((item) => item.status))].sort().map((status) => [String(status), responses.filter((item) => item.status === status).length]));
const ok = counts["200"] === 10 && counts["429"] === 10 && Object.keys(counts).length === 2;
const output = { ok, runId, alignmentDelayMs: boundaryDelayMs, alignedAt, startedAt, completedAt: new Date().toISOString(), expected: { 200: 10, 429: 10 }, counts, responses };
writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${JSON.stringify(output)}\n`);
if (!ok) process.exitCode = 1;
