import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const evidenceDir = resolve(process.argv[2] ?? "");
if (!evidenceDir || !existsSync(evidenceDir)) throw new Error("An existing Playwright evidence directory is required.");

function walk(path) {
  return readdirSync(path).flatMap((name) => {
    const child = join(path, name);
    return statSync(child).isDirectory() ? walk(child) : [child];
  });
}

const files = walk(evidenceDir);
const traceFiles = files.filter((path) => path.endsWith(".trace"));
const networkFiles = files.filter((path) => path.endsWith(".network"));
const validation = [];

for (const path of traceFiles) {
  const counts = { contextOptions: 0, before: 0, after: 0, records: 0 };
  const beforeIds = new Set();
  const afterIds = new Set();
  let malformedRecords = 0;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean)) {
    try {
      const record = JSON.parse(line);
      counts.records += 1;
      if (record.type === "context-options") counts.contextOptions += 1;
      if (record.type === "before") {
        counts.before += 1;
        if (record.callId) beforeIds.add(record.callId);
      }
      if (record.type === "after") {
        counts.after += 1;
        if (record.callId) afterIds.add(record.callId);
      }
    } catch {
      malformedRecords += 1;
    }
  }
  const unmatchedBefore = [...beforeIds].filter((id) => !afterIds.has(id));
  const unmatchedAfter = [...afterIds].filter((id) => !beforeIds.has(id));
  const pass = malformedRecords === 0 && counts.contextOptions === 1 && counts.before >= 1 && counts.after >= 1 && unmatchedBefore.length === 0 && unmatchedAfter.length === 0;
  validation.push({ file: basename(path), status: pass ? "PASS" : "FAIL", counts, malformedRecords, unmatchedBefore: unmatchedBefore.length, unmatchedAfter: unmatchedAfter.length });
}

const status = traceFiles.length > 0 && networkFiles.length === 0 && validation.every((item) => item.status === "PASS") ? "PASS" : "FAIL";
const output = { status, traceFiles: traceFiles.length, networkFiles: networkFiles.length, validation };
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
if (status !== "PASS") process.exitCode = 1;
