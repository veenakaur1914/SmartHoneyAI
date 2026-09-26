import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { Queue, Worker, type Job } from "bullmq";
import IORedis from "ioredis";
import { collectDefaultMetrics, Counter, Gauge, register as metricsRegister } from "prom-client";
import { acquireIncidentCorrelationLock, prisma, type Severity, type ThreatType } from "@honeypot/database";
import { localDeterministicClassification, seededHoneypotClassification, severityFor } from "./analysis-logic.js";
import { env } from "./env.js";
import { blockedAccessTelegramMessage, incidentTelegramMessage, telegramDeliveryError } from "./telegram-alert.js";

const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
const analysisProvider = env.ANALYSIS_PROVIDER;
const localAnalysisEnabled = env.ALLOW_LOCAL_ANALYSIS === "1";
const modelId = analysisProvider === "local" ? "local-deterministic-simulation-v1" : env.HF_MODEL_ID;
const modelRevision = analysisProvider === "local" ? "local-deterministic-simulation-v1" : env.HF_MODEL_REVISION ?? "unpinned-development";
const analysisQueue = new Queue("threat-analysis", { connection });
const alertQueue = new Queue("alert-delivery", { connection });
collectDefaultMetrics({ prefix: "honeypot_worker_" });
const aiRequests = new Counter({ name: "honeypot_ai_requests_total", help: "Threat-classification provider requests.", labelNames: ["result"] as const });
const queueOldestAge = new Gauge({ name: "honeypot_queue_oldest_job_age_seconds", help: "Age of the oldest waiting or delayed worker job." });
const deadLetterJobs = new Gauge({ name: "honeypot_dead_letter_jobs", help: "Jobs that exhausted their configured retries." });

const labels: Record<string, ThreatType> = {
  "automated bot activity": "BOT",
  "vulnerability scanning": "SCANNER",
  "brute force login": "BRUTE_FORCE",
  "SQL injection": "SQL_INJECTION",
  "cross-site scripting XSS": "XSS",
  "OS command injection": "COMMAND_INJECTION",
  "directory traversal": "DIRECTORY_TRAVERSAL",
  "credential stuffing": "CREDENTIAL_STUFFING",
  "service abuse": "SERVICE_ABUSE",
  "benign web request": "BENIGN",
  "unknown suspicious activity": "UNKNOWN"
};

async function classify(text: string) {
  try {
    if (analysisProvider === "local") {
      if (!localAnalysisEnabled) throw new Error("LOCAL_ANALYSIS_NOT_AUTHORIZED");
      // This deterministic, non-network classifier is enabled only by the
      // isolated performance overlay. It exercises the real durable worker
      // queue while external AI remains explicitly NOT CONFIGURED.
      aiRequests.inc({ result: "local" });
      return localDeterministicClassification(text);
    }
    if (analysisProvider !== "huggingface") throw new Error("ANALYSIS_PROVIDER_UNSUPPORTED");
    const token = env.HF_TOKEN;
    if (!token) throw new Error("HF_TOKEN is not configured");
    const response = await fetch(`https://router.huggingface.co/hf-inference/models/${encodeURIComponent(modelId)}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ inputs: text.slice(0, 12_000), parameters: { candidate_labels: Object.keys(labels), multi_label: false } }),
      signal: AbortSignal.timeout(20_000)
    });
    if (!response.ok) throw new Error(`Hugging Face returned ${response.status}`);
    const result = await response.json() as { labels?: string[]; scores?: number[] };
    const label = result.labels?.[0] ?? "unknown suspicious activity";
    const confidence = result.scores?.[0] ?? 0;
    aiRequests.inc({ result: "success" });
    return { threatType: labels[label] ?? "UNKNOWN" as ThreatType, confidence };
  } catch (error) {
    aiRequests.inc({ result: "failed" });
    throw error;
  }
}

async function analyze(job: Job<{ assessmentId: string }>) {
  const assessment = await prisma.threatAssessment.findUnique({ where: { id: job.data.assessmentId }, include: { event: { include: { site: true } } } });
  if (!assessment || assessment.status === "COMPLETE") return;
  await prisma.threatAssessment.update({ where: { id: assessment.id }, data: { status: "PROCESSING" } });
  const event = assessment.event;
  const text = [`Method: ${event.method}`, `Path: ${event.path}`, `Protocol: ${event.protocol ?? "HTTP"}`, `Activity: ${event.activity ?? "REQUEST"}`, `User agent: ${event.userAgent ?? "unknown"}`, `Headers: ${JSON.stringify(event.headers)}`, `Payload: ${event.payload ?? "none"}`, `Event kind: ${event.kind}`].join("\n");
  try {
    const seededClassification = seededHoneypotClassification(event.honeypotKey);
    const result = seededClassification ?? await classify(text);
    const resultModelId = seededClassification ? "seeded-honeypot-signal-v1" : modelId;
    const resultModelRevision = seededClassification ? "1" : modelRevision;
    const severity = severityFor(result.threatType, result.confidence);
    const recommendation = severity === "CRITICAL" ? "ALERT_ADMINISTRATOR" : severity === "HIGH" ? "MONITOR" : "IGNORE";
    const correlated = await prisma.$transaction(async (tx) => {
      await tx.threatAssessment.update({ where: { id: assessment.id }, data: { status: "COMPLETE", threatType: result.threatType, severity, confidence: result.confidence, recommendation, evidenceSummary: `${result.threatType.replaceAll("_", " ")} classification from a redacted honeypot interaction.`, modelId: resultModelId, modelRevision: resultModelRevision, completedAt: new Date() } });
      if (severity !== "HIGH" && severity !== "CRITICAL") return null;
      if (event.site.kind === "NETWORK_SENSOR" && !event.site.sourceIpVerifiedAt && event.sourceAttribution !== "DEMO_OVERRIDE") return null;
      await acquireIncidentCorrelationLock(tx, event.organizationId, event.ipHash);
      const cutoff = new Date(event.occurredAt.getTime() - 10 * 60_000);
      const existing = await tx.incident.findFirst({ where: { organizationId: event.organizationId, sourceIpHash: event.ipHash, status: { in: ["OPEN", "INVESTIGATING"] }, lastSeenAt: { gte: cutoff, lte: new Date(event.occurredAt.getTime() + 10 * 60_000) } }, orderBy: { lastSeenAt: "desc" } });
      const incident = existing
        ? await tx.incident.update({ where: { id: existing.id }, data: { firstSeenAt: event.occurredAt < existing.firstSeenAt ? event.occurredAt : existing.firstSeenAt, lastSeenAt: event.occurredAt > existing.lastSeenAt ? event.occurredAt : existing.lastSeenAt, events: { connectOrCreate: { where: { incidentId_eventId: { incidentId: existing.id, eventId: event.id } }, create: { eventId: event.id } } } } })
        : await tx.incident.create({ data: { organizationId: event.organizationId, siteId: event.siteId, title: `${severity === "CRITICAL" ? "Critical" : "High-risk"} ${result.threatType.replaceAll("_", " ").toLowerCase()} detected`, summary: `SmartHoneyAI classified a suspicious interaction on ${event.site.name}.`, severity, threatType: result.threatType, sourceIpHash: event.ipHash, firstSeenAt: event.occurredAt, lastSeenAt: event.occurredAt, events: { create: { eventId: event.id } } } });
      const links = await tx.incidentEvent.findMany({ where: { incidentId: incident.id }, select: { event: { select: { siteId: true, protocol: true } } } });
      const assetCount = new Set(links.map((link) => link.event.siteId)).size;
      const protocolCount = new Set(links.map((link) => link.event.protocol).filter(Boolean)).size;
      const coordinated = assetCount >= 2 || protocolCount >= 2;
      const rank: Record<Severity, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };
      const nextSeverity: Severity = coordinated || rank[severity] > rank[incident.severity] ? (coordinated ? "CRITICAL" : severity) : incident.severity;
      const finalIncident = nextSeverity !== incident.severity || coordinated
        ? await tx.incident.update({ where: { id: incident.id }, data: { severity: nextSeverity, title: coordinated ? "Critical multi-sensor activity detected" : incident.title, summary: coordinated ? `One source touched ${assetCount} assets across ${protocolCount} protocols within ten minutes.` : incident.summary } })
        : incident;
      return { incident: finalIncident, shouldAlert: !existing || (existing.severity !== "CRITICAL" && finalIncident.severity === "CRITICAL") };
    });
    if (correlated?.shouldAlert) {
      const incident = correlated.incident;
      const channels = await prisma.alertChannel.findMany({ where: { organizationId: event.organizationId, enabled: true } });
      for (const channel of channels) {
        const delivery = await prisma.alertDelivery.create({ data: { channelId: channel.id, siteId: event.siteId, incidentId: incident.id } });
        await alertQueue.add("deliver", { deliveryId: delivery.id }, { attempts: 5, backoff: { type: "exponential", delay: 5000 }, removeOnComplete: 500, removeOnFail: 500 });
      }
    }
  } catch (error) {
    const finalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    await prisma.threatAssessment.update({ where: { id: assessment.id }, data: { status: finalAttempt ? "UNAVAILABLE" : "PENDING", errorCode: error instanceof Error ? error.message.slice(0, 180) : "AI_PROVIDER_ERROR" } });
    throw error;
  }
}

async function deliverAlert(job: Job<{ deliveryId: string }>) {
  const delivery = await prisma.alertDelivery.findUnique({ where: { id: job.data.deliveryId }, include: { channel: true, site: true, event: true } });
  if (!delivery || delivery.status === "SENT") return;
  const incident = delivery.incidentId ? await prisma.incident.findUnique({ where: { id: delivery.incidentId } }) : null;
  const isBlockedEvent = delivery.event?.kind === "FIREWALL" && delivery.event.action === "BLOCKED";
  if ((!incident && !isBlockedEvent) || delivery.channel.type !== "TELEGRAM") {
    await prisma.alertDelivery.update({ where: { id: delivery.id }, data: { status: "FAILED", attempts: { increment: 1 }, lastError: delivery.channel.type !== "TELEGRAM" ? "Unsupported alert channel" : "Alert evidence not found" } });
    return;
  }
  const config = JSON.parse(delivery.channel.configEncrypted) as { chatId?: string };
  if (!config.chatId) throw new Error("Telegram chat ID is not configured");
  const botToken = env.TELEGRAM_BOT_TOKEN;
  if (!botToken) throw new Error("Telegram bot token is not configured");
  const eventLink = `${env.APP_URL}/dashboard/events`;
  const message = isBlockedEvent && delivery.event
    ? blockedAccessTelegramMessage({ eventId: delivery.event.id, siteName: delivery.site.name, method: delivery.event.method, path: delivery.event.path, ipHash: delivery.event.ipHash, receivedAt: delivery.event.receivedAt, reviewUrl: eventLink })
    : incidentTelegramMessage({ siteName: delivery.site.name, threatType: incident!.threatType, severity: incident!.severity, sourceIpHash: incident!.sourceIpHash, reviewUrl: eventLink });
  const response = await fetch(`${env.TELEGRAM_API_BASE_URL}/bot${botToken}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: config.chatId, text: message, disable_web_page_preview: true }), signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(telegramDeliveryError(response.status));
  await prisma.alertDelivery.update({ where: { id: delivery.id }, data: { status: "SENT", attempts: { increment: 1 }, sentAt: new Date(), lastError: null } });
}

const analysisWorker = new Worker("threat-analysis", analyze, { connection, concurrency: env.ANALYSIS_CONCURRENCY, limiter: { max: env.ANALYSIS_RATE_LIMIT_MAX, duration: 60_000 } });
const deliveryWorker = new Worker("alert-delivery", deliverAlert, { connection, concurrency: 4, limiter: { max: 20, duration: 1_000 } });

for (const worker of [analysisWorker, deliveryWorker]) {
  worker.on("failed", async (job, error) => {
    console.error(JSON.stringify({ level: "error", queue: worker.name, jobId: job?.id, error: error.message }));
    const alertData = job?.data as { deliveryId?: string } | undefined;
    if (worker.name === "alert-delivery" && alertData?.deliveryId) await prisma.alertDelivery.update({ where: { id: alertData.deliveryId }, data: { status: job!.attemptsMade >= (job!.opts.attempts ?? 1) ? "FAILED" : "RETRYING", attempts: { increment: 1 }, lastError: error.message.slice(0, 500) } }).catch(() => undefined);
  });
}

async function maintenance() {
  const now = new Date();
  const eventCutoff = new Date(now.getTime() - 30 * 86400000);
  const auditCutoff = new Date(now.getTime() - 400 * 86400000);
  await prisma.$transaction([
    prisma.session.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.agentHeartbeat.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 30 * 86400000) } } }),
    prisma.networkSensorHeartbeat.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 30 * 86400000) } } }),
    prisma.securityEvent.deleteMany({ where: { occurredAt: { lt: eventCutoff } } }),
    prisma.auditLog.deleteMany({ where: { createdAt: { lt: auditCutoff } } })
  ]);
}

async function expireSelfTests() {
  const now = new Date();
  const expired = await prisma.selfTestRun.findMany({ where: { expiresAt: { lte: now }, status: { in: ["CREATED", "RUNNING", "DETECTED", "CONTAINED"] } }, select: { id: true, organizationId: true, createdByUserId: true, firewallRuleId: true, status: true, expiresAt: true } });
  for (const run of expired) {
    await prisma.$transaction(async (tx) => {
      if (run.firewallRuleId) await tx.firewallRule.updateMany({ where: { id: run.firewallRuleId, organizationId: run.organizationId, reason: `Authorized self-test ${run.id}` }, data: { enabled: false } });
      await tx.selfTestRun.update({ where: { id: run.id }, data: { status: "EXPIRED", cleanedAt: run.firewallRuleId ? now : undefined } });
      await tx.auditLog.create({ data: { organizationId: run.organizationId, userId: run.createdByUserId, actorType: "SYSTEM", action: "SELF_TEST_EXPIRED", targetType: "SELF_TEST_RUN", targetId: run.id, reason: run.firewallRuleId ? "Expired self-test rule was disabled automatically." : "Self-test token expired.", metadata: { previousStatus: run.status, firewallRuleId: run.firewallRuleId, expiresAt: run.expiresAt.toISOString() } } });
    });
  }
}

async function reconcileSiteStatuses() {
  const now = Date.now();
  await prisma.$transaction([
    prisma.site.updateMany({ where: { status: { in: ["ONLINE", "DEGRADED"] }, lastSeenAt: { lt: new Date(now - 15 * 60_000) } }, data: { status: "OFFLINE" } }),
    prisma.site.updateMany({ where: { status: "ONLINE", lastSeenAt: { gte: new Date(now - 15 * 60_000), lt: new Date(now - 10 * 60_000) } }, data: { status: "DEGRADED" } })
  ]);
}

async function updateQueueMetrics() {
  const [analysisJobs, alertJobs, analysisFailed, alertFailed] = await Promise.all([
    analysisQueue.getJobs(["waiting", "delayed"], 0, 99, true),
    alertQueue.getJobs(["waiting", "delayed"], 0, 99, true),
    analysisQueue.getFailedCount(),
    alertQueue.getFailedCount()
  ]);
  const oldest = [...analysisJobs, ...alertJobs].reduce<number | null>((value, job) => value === null ? job.timestamp : Math.min(value, job.timestamp), null);
  queueOldestAge.set(oldest === null ? 0 : Math.max(0, (Date.now() - oldest) / 1000));
  deadLetterJobs.set(analysisFailed + alertFailed);
}

const healthServer = createServer(async (request, response) => {
  if (request.url === "/health/live") {
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ status: "ok", service: "worker" }));
    return;
  }
  if (request.url === "/health/ready") {
    const redisProbe = Promise.race([
      connection.ping(),
      new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("Redis readiness timed out")), 1_500))
    ]);
    const [database, redis] = await Promise.allSettled([prisma.$queryRaw`SELECT 1`, redisProbe]);
    const ready = database.status === "fulfilled" && redis.status === "fulfilled" && redis.value === "PONG";
    response.writeHead(ready ? 200 : 503, { "content-type": "application/json" }).end(JSON.stringify({ status: ready ? "ready" : "not-ready", database: database.status === "fulfilled" ? "ok" : "error", redis: redis.status === "fulfilled" ? "ok" : "error" }));
    return;
  }
  if (request.url === "/health/queue") {
    const [jobs, pending, processing] = await Promise.all([
      analysisQueue.getJobCounts("waiting", "active", "delayed", "failed"),
      prisma.threatAssessment.count({ where: { status: "PENDING" } }),
      prisma.threatAssessment.count({ where: { status: "PROCESSING" } })
    ]);
    const drained = jobs.waiting === 0 && jobs.active === 0 && jobs.delayed === 0 && pending === 0 && processing === 0;
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ status: drained ? "drained" : "busy", drained, jobs, assessments: { pending, processing } }));
    return;
  }
  if (request.url === "/metrics") {
    await updateQueueMetrics();
    response.writeHead(200, { "content-type": metricsRegister.contentType }).end(await metricsRegister.metrics());
    return;
  }
  response.writeHead(404).end();
});

setInterval(() => maintenance().catch((error) => console.error(error)), 3_600_000).unref();
setInterval(() => expireSelfTests().catch((error) => console.error(error)), 60_000).unref();
setInterval(() => reconcileSiteStatuses().catch((error) => console.error(error)), 60_000).unref();
await Promise.all([maintenance(), reconcileSiteStatuses(), expireSelfTests()]);
healthServer.listen(env.WORKER_HEALTH_PORT, "0.0.0.0");
console.log(JSON.stringify({ level: "info", service: "worker", message: "SmartHoneyAI workers started", fingerprint: createHash("sha256").update(modelId).digest("hex").slice(0, 12) }));

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  await new Promise<void>((resolve) => healthServer.close(() => resolve()));
  await Promise.all([analysisWorker.close(), deliveryWorker.close(), analysisQueue.close(), alertQueue.close()]);
  await connection.quit(); await prisma.$disconnect(); process.exit(0);
}
process.on("SIGTERM", shutdown); process.on("SIGINT", shutdown);
