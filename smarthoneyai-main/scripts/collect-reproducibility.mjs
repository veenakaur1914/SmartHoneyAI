import { execFileSync, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const outputPath = resolve(process.argv[2] ?? "reproducibility.json");
function run(command, args = [], fallback = "unavailable") {
  try { return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }
  catch { return fallback; }
}
function runCombined(command, args = [], fallback = "unavailable") {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.error || result.status !== 0) return fallback;
  return `${result.stdout ?? ""}${result.stderr ?? ""}`.trim() || fallback;
}

const dockerCpus = Number(run("docker", ["info", "--format", "{{.NCPU}}"], "0"));
const dockerMemoryBytes = Number(run("docker", ["info", "--format", "{{.MemTotal}}"], "0"));
const vmStat = run("vm_stat", [], "");
const pageSize = Number(/page size of (\d+) bytes/.exec(vmStat)?.[1] ?? 4096);
const vmValues = Object.fromEntries(vmStat.split("\n").flatMap((line) => {
  const match = /^Pages ([^:]+):\s+(\d+)/.exec(line);
  return match ? [[match[1], Number(match[2])]] : [];
}));
const reclaimableMemoryBytes = ((vmValues.free ?? 0) + (vmValues.inactive ?? 0) + (vmValues.speculative ?? 0)) * pageSize;
const hostFreeMemoryBytes = reclaimableMemoryBytes || Number(run(process.execPath, ["-e", "process.stdout.write(String(require('os').freemem()))"], "0"));
const sourceRevision = run("git", ["rev-parse", "HEAD"]);
const sourceDirty = run("git", ["status", "--porcelain"], "").length > 0;
const allocationPass = dockerCpus >= 8 && dockerMemoryBytes >= Math.floor(7.5 * 1024 ** 3) && hostFreeMemoryBytes >= 1024 ** 3;

const output = {
  status: allocationPass ? "PASS" : "FAIL",
  capturedAt: new Date().toISOString(),
  source: { revision: sourceRevision, dirty: sourceDirty },
  docker: {
    serverVersion: run("docker", ["version", "--format", "{{.Server.Version}}"]),
    composeVersion: run("docker", ["compose", "version", "--short"]),
    operatingSystem: run("docker", ["info", "--format", "{{.OperatingSystem}}"]),
    architecture: run("docker", ["info", "--format", "{{.Architecture}}"]),
    cpus: dockerCpus,
    memoryBytes: dockerMemoryBytes
  },
  host: {
    operatingSystem: run("uname", ["-s"]),
    kernelRelease: run("uname", ["-r"]),
    architecture: run("uname", ["-m"]),
    freeMemoryBytes: hostFreeMemoryBytes
  },
  tools: {
    node: process.version,
    pnpm: run("pnpm", ["--version"]),
    python: run("python3", ["--version"]),
    reportlab: run("python3", ["-c", "import reportlab;print(reportlab.Version)"]),
    pypdf: run("python3", ["-c", "import pypdf;print(pypdf.__version__)"]),
    pdfplumber: run("python3", ["-c", "import pdfplumber;print(pdfplumber.__version__)"]),
    poppler: runCombined("pdfinfo", ["-v"]).split("\n")[0]
  },
  requirements: { minimumDockerCpus: 8, minimumDockerMemoryBytes: Math.floor(7.5 * 1024 ** 3), minimumHostFreeMemoryBytes: 1024 ** 3 }
};

writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, { mode: 0o600 });
if (!allocationPass) process.exitCode = 1;
