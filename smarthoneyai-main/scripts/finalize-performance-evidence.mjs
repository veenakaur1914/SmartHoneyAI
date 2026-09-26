import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";

const command = process.argv[2] ?? "integrity";
const artifactDir = resolve(process.env.PERF_ARTIFACT_DIR ?? process.argv[3] ?? "");
const runId = process.env.PERF_RUN_ID ?? basename(artifactDir);
if (!artifactDir || !existsSync(artifactDir)) throw new Error("PERF_ARTIFACT_DIR is required.");

function readJson(path, fallback = null) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return fallback; }
}

function readJsonLines(path) {
  try { return readFileSync(path, "utf8").split("\n").filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } }); }
  catch { return []; }
}

function integrity() {
  const telemetry = readJsonLines(join(artifactDir, "telemetry.jsonl")).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const faults = readJsonLines(join(artifactDir, "faults.jsonl"));
  const abort = readJson(join(artifactDir, "abort.json"));
  const runComplete = readJson(join(artifactDir, "run-complete.json"));
  const scale = Number(readFileSync(join(artifactDir, "time-scale.txt"), "utf8").trim() || 1);
  const profile = readFileSync(join(artifactDir, "profile.txt"), "utf8").trim();
  const scaled = (seconds) => Math.max(1, Math.round(seconds * scale));
  const planned = Math.max(1, Math.round(1800 * scale));
  const soak = telemetry.filter((item) => item.phase?.phase === "soak-chaos").sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const observed = soak.length >= 2 ? Math.min(planned, Math.round((Date.parse(soak.at(-1).at) - Date.parse(soak[0].at)) / 1000)) : 0;
  const allGapSeconds = [];
  const gaps = [];
  for (let index = 1; index < telemetry.length; index += 1) {
    const seconds = (Date.parse(telemetry[index].at) - Date.parse(telemetry[index - 1].at)) / 1000;
    allGapSeconds.push(seconds);
    if (seconds > 10) gaps.push({ from: telemetry[index - 1].at, to: telemetry[index].at, seconds });
  }
  const sortedGaps = [...allGapSeconds].sort((a, b) => a - b);
  const p95GapSeconds = sortedGaps.length ? sortedGaps[Math.max(0, Math.ceil(sortedGaps.length * 0.95) - 1)] : Infinity;
  const maxGapSeconds = sortedGaps.length ? sortedGaps.at(-1) : Infinity;
  const telemetrySpanSeconds = telemetry.length >= 2 ? (Date.parse(telemetry.at(-1).at) - Date.parse(telemetry[0].at)) / 1000 : 0;
  const expectedTelemetrySamples = telemetrySpanSeconds > 0 ? Math.floor(telemetrySpanSeconds / 2) + 1 : 0;
  const telemetryDensity = expectedTelemetrySamples > 0 ? telemetry.length / expectedTelemetrySamples : 0;
  const telemetryDensityValid = telemetryDensity >= 0.90 && p95GapSeconds <= 3 && maxGapSeconds <= 10;
  const recovered = new Set(faults.filter((item) => item.action === "recovered").map((item) => item.service));
  const expectedServices = ["worker", "api", "redis", "wordpress-db"];
  const faultValidation = expectedServices.map((service) => {
    const entries = faults.filter((item) => item.service === service);
    const actions = entries.map((item) => item.action);
    const expectedActions = ["stop", "outage_started", "start", "recovered"];
    const ordered = expectedActions.every((action, index) => actions[index] === action) && actions.length === expectedActions.length;
    const outage = entries.find((item) => item.action === "outage_started");
    const start = entries.find((item) => item.action === "start");
    const recoveredEntry = entries.find((item) => item.action === "recovered");
    const outageSeconds = outage && start ? (Date.parse(start.at) - Date.parse(outage.at)) / 1000 : null;
    const recoverySeconds = start && recoveredEntry ? (Date.parse(recoveredEntry.at) - Date.parse(start.at)) / 1000 : null;
    const expectedOutageSeconds = Number(outage?.expectedOutageSeconds ?? scaled(120));
    // Browser screenshots and sanitized traces are intentionally captured
    // while each service is down. In the 0.1x rehearsal those fixed-duration
    // captures can be longer than the 12-second scaled outage; the full 1x
    // profile still enforces the narrow production timing tolerance.
    const outageToleranceSeconds = scale === 1 ? Math.max(5, expectedOutageSeconds * 0.125) : 35;
    const outageTimingValid = outageSeconds !== null && outageSeconds >= Math.max(0, expectedOutageSeconds - Math.max(5, expectedOutageSeconds * 0.125)) && outageSeconds <= expectedOutageSeconds + outageToleranceSeconds;
    const recoveryTimingValid = recoverySeconds !== null && recoverySeconds <= 60;
    const timingValid = outageTimingValid && recoveryTimingValid;
    return { service, actions, ordered, expectedOutageSeconds, outageSeconds, recoverySeconds, outageToleranceSeconds, outageTimingValid, recoveryTimingValid, timingValid, valid: ordered && timingValid };
  });
  const faultsComplete = faultValidation.every((item) => item.valid);
  const outageOrder = faults.filter((item) => item.action === "outage_started").map((item) => item.service);
  const faultOrderValid = JSON.stringify(outageOrder) === JSON.stringify(expectedServices);

  const summaries = readdirSync(join(artifactDir, "k6")).filter((name) => name.endsWith("-summary.json")).map((name) => readJson(join(artifactDir, "k6", name), {}));
  const summaryByPhase = new Map(summaries.map((item) => [item.phase, item]));
  const durationSeconds = (value) => {
    const match = /^(\d+(?:\.\d+)?)s$/.exec(String(value ?? ""));
    return match ? Number(match[1]) : NaN;
  };
  const expectedDurations = new Map([
    ["harness-smoke", scaled(60)], ["baseline", scaled(300)], ["ramp-10", scaled(200)], ["ramp-25", scaled(200)], ["ramp-50", scaled(200)], ["sustained", scaled(1200)], ["spike", scaled(120)], ["soak-chaos", scaled(1800)]
  ]);
  const breakpointPhases = summaries.map((item) => String(item.phase)).filter((phase) => /^breakpoint-(75|100|125|150|175|200)$/.test(phase)).sort((a, b) => Number(a.split("-")[1]) - Number(b.split("-")[1]));
  for (const phase of breakpointPhases) expectedDurations.set(phase, scaled(120));
  const durationChecks = [...expectedDurations].map(([phase, expectedSeconds]) => ({ phase, expectedSeconds, observedSeconds: durationSeconds(summaryByPhase.get(phase)?.duration), valid: durationSeconds(summaryByPhase.get(phase)?.duration) === expectedSeconds }));
  const requiredSummaryPhases = ["harness-smoke", "baseline", "ramp-10", "ramp-25", "ramp-50", "sustained", "spike", "soak-chaos"];
  const summariesComplete = requiredSummaryPhases.every((phase) => summaryByPhase.has(phase)) && breakpointPhases.length >= 2 && durationChecks.every((item) => item.valid);

  const observedPhaseOrder = [];
  for (const item of telemetry) {
    const phase = item.phase?.phase;
    if (phase && phase !== "unknown" && observedPhaseOrder.at(-1) !== phase) observedPhaseOrder.push(phase);
  }
  const requiredOrder = ["harness-smoke", "preflight", "baseline", "ramp-10", "ramp-25", "ramp-50", "sustained", "spike", ...breakpointPhases, "soak-chaos", "recovery", "cleanup"];
  let cursor = -1;
  const phaseOrderValid = requiredOrder.every((phase) => {
    const index = observedPhaseOrder.indexOf(phase, cursor + 1);
    if (index < 0) return false;
    cursor = index;
    return true;
  });
  const phaseSpan = (phase) => {
    const values = telemetry.filter((item) => item.phase?.phase === phase).map((item) => Date.parse(item.at)).filter(Number.isFinite);
    return values.length >= 2 ? (Math.max(...values) - Math.min(...values)) / 1000 : 0;
  };
  const preflightSeconds = phaseSpan("preflight");
  const recoveryProfileSeconds = phaseSpan("recovery");
  const wallSeconds = runComplete?.startedAtEpoch && runComplete?.completedAt ? (Date.parse(runComplete.completedAt) - Number(runComplete.startedAtEpoch) * 1000) / 1000 : 0;
  const scheduleCoverageValid = preflightSeconds >= scaled(300) - 20 && recoveryProfileSeconds >= scaled(360) - 20 && wallSeconds >= scaled(5400) - 30;
  const productionProfile = profile === "full" && scale === 1 && runComplete?.profile === "full" && Number(runComplete?.timeScale) === 1 && planned === 1800 && wallSeconds >= 5370;
  const teardown = readJson(join(artifactDir, "teardown-verification.json"), {});
  const original = readJson(join(artifactDir, "original-demo-verification.json"), {});
  const scaledProfileCompleted = Boolean(runComplete) && !abort && gaps.length === 0 && telemetryDensityValid && observed >= planned - 20 && faultsComplete && faultOrderValid && summariesComplete && phaseOrderValid && scheduleCoverageValid;
  const continuous = productionProfile && scaledProfileCompleted;
  const reason = continuous
    ? "The complete production-style profile ran without host suspension, telemetry gaps, safety aborts, or missing scheduled fault recoveries."
    : `Production profile incomplete: productionProfile=${productionProfile}, scaledProfileCompleted=${scaledProfileCompleted}, runComplete=${Boolean(runComplete)}, abort=${abort?.reason ?? "none"}, telemetryGaps=${gaps.length}, telemetryDensityValid=${telemetryDensityValid}, soak=${observed}/${planned}s, summariesComplete=${summariesComplete}, phaseOrderValid=${phaseOrderValid}, scheduleCoverageValid=${scheduleCoverageValid}, faultsComplete=${faultsComplete}, faultOrderValid=${faultOrderValid}.`;
  const maxDrops = Math.max(0, ...telemetry.map((item) => Number(item.deep?.wordpress?.droppedEvents ?? 0)));
  const output = {
    continuousProfileCompleted: continuous,
    scaledProfileCompleted,
    productionProfile,
    interruptionClassification: continuous ? "PASS" : (abort || runComplete ? "FAIL" : "BLOCKED"),
    reason,
    observedClockGaps: gaps,
    telemetryValidation: { samples: telemetry.length, expectedSamples: expectedTelemetrySamples, spanSeconds: telemetrySpanSeconds, density: telemetryDensity, p95GapSeconds, maxGapSeconds, valid: telemetryDensityValid },
    soakPlannedSeconds: planned,
    soakObservedActiveSeconds: observed,
    soakCompletionFraction: observed / planned,
    scheduledFaultsRecovered: [...recovered].sort(),
    faultValidation,
    faultOrderValid,
    phaseValidation: { profile, timeScale: scale, productionProfile, summariesComplete, durationChecks, breakpointPhases, observedPhaseOrder, requiredOrder, phaseOrderValid, preflightSeconds, recoveryProfileSeconds, wallSeconds, scheduleCoverageValid },
    teardownComplete: Boolean(teardown.complete),
    originalDemoRestored: original.status === "PASS" && Boolean(original.ready),
    queueDropRootCause: maxDrops === 0 ? "No queue drops were observed after the transactional queue-state and delivery-lease repair." : `${maxDrops} cumulative queue drops were observed; inspect the queue error evidence.`,
  };
  writeFileSync(join(artifactDir, "run-integrity.json"), `${JSON.stringify(output, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

function walk(path) {
  return readdirSync(path).flatMap((name) => {
    const child = join(path, name);
    return statSync(child).isDirectory() ? walk(child) : [child];
  });
}

async function digest(path) {
  const hash = createHash("sha256");
  await new Promise((resolveDone, reject) => createReadStream(path).on("data", (chunk) => hash.update(chunk)).on("error", reject).on("end", resolveDone));
  return hash.digest("hex");
}

async function manifest() {
  const entries = [];
  for (const path of walk(artifactDir).sort()) {
    if (["manifest.sha256", "manifest-verification.json"].includes(basename(path))) continue;
    entries.push(`${await digest(path)}  ${relative(artifactDir, path)}`);
  }
  const timestamp = runId.replace(/^perf-/, "");
  const pdf = resolve(artifactDir, "..", "..", "pdf", `honeypot-production-simulation-${timestamp}.pdf`);
  if (existsSync(pdf)) entries.push(`${await digest(pdf)}  ${relative(artifactDir, pdf)}`);
  writeFileSync(join(artifactDir, "manifest.sha256"), `${entries.join("\n")}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ ok: true, entries: entries.length })}\n`);
}

mkdirSync(artifactDir, { recursive: true, mode: 0o700 });
if (command === "integrity") integrity();
else if (command === "manifest") await manifest();
else throw new Error(`Unknown command: ${command}`);
