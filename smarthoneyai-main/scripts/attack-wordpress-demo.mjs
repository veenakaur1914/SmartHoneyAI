import { api, assertRedacted, canaries, connectTelegram, dryRun, recordStep, resetWordpressAutomation, root, saveEvidence, session, syncWordpress, telegramMessages, waitFor, wordpressProbe } from "./demo-attack-common.mjs";

const args = process.argv.slice(2);
if (dryRun("normal-wordpress-hosting", args)) process.exit(0);
const evidenceIndex = args.indexOf("--evidence");
const requestedEvidence = evidenceIndex >= 0 && args[evidenceIndex + 1] ? args[evidenceIndex + 1] : `${root}/output/demo/normal-hosting-demo.json`;
const sourceIp = "8.8.8.8";
const evidence = { title: "SmartHoneyAI Normal Hosting Attack Demo", mode: "NORMAL_HOSTING", startedAt: new Date().toISOString(), sourceIp, telegram: { transport: "LOCAL_MOCK" }, steps: [] };

try {
  const state = await session();
  recordStep(evidence, "Control plane and plugin ready", `Site ${state.site.id} is enrolled at http://localhost:8080/.`);
  const telegram = await connectTelegram(state, "NORMAL_HOSTING");
  recordStep(evidence, "Telegram provider test", `Local mock chat ending ${telegram.chatIdSuffix} returned ${telegram.testDelivery.status} for Normal WordPress Hosting.`);

  resetWordpressAutomation();
  const beforeAlerts = (await api(state, "/v1/alerts")).data.data.map((item) => item.id);
  const secretValues = canaries();
  const probes = [
    ["/phpmyadmin", { method: "POST", includeSecrets: true, headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ username: secretValues[0], password: secretValues[1], token: secretValues[2] }) }],
    ["/secure-admin-login", {}],
    ["/wp-content/backups/site-backup.zip", {}]
  ];
  const statuses = [];
  for (const [path, options] of probes) {
    const response = await wordpressProbe(path, sourceIp, options);
    if (![401, 404].includes(response.status)) throw new Error(`${path} returned unexpected HTTP ${response.status}.`);
    statuses.push(`${path}:${response.status}`);
  }
  const blocked = await wordpressProbe("/internal/admin-console", sourceIp);
  if (blocked.status !== 403) throw new Error(`Repeat-attacker block expected 403, received ${blocked.status}.`);
  recordStep(evidence, "WordPress probes and local block", `${statuses.join(", ")}; fourth request: HTTP 403.`);

  const sync = syncWordpress();
  if (sync.queueDepth !== 0) throw new Error(`WordPress queue did not drain (${sync.queueDepth}).`);
  recordStep(evidence, "Signed telemetry sync", `Queue drained exactly once; policy ${sync.policyVersion}, health ${sync.health}.`);

  const event = await waitFor("blocked WordPress event", async () => {
    const events = (await api(state, `/v1/events?siteId=${state.site.id}`)).data.data;
    return events.find((item) => item.ipAddress === sourceIp && item.kind === "FIREWALL" && item.action === "BLOCKED");
  });
  const alert = await waitFor("Telegram delivery", async () => {
    const alerts = (await api(state, "/v1/alerts")).data.data;
    return alerts.find((item) => !beforeAlerts.includes(item.id) && item.eventId === event.id && item.status === "SENT");
  });
  const messages = await waitFor("Telegram mock message", async () => {
    const current = await telegramMessages();
    return current.some((item) => /blocked/i.test(item.text)) ? current : null;
  });
  assertRedacted({ event, alert, messages });
  evidence.eventId = event.id;
  evidence.alertDeliveryId = alert.id;
  evidence.telegram.messageCount = messages.length;
  evidence.telegram.lastMessage = messages.at(-1)?.text;
  recordStep(evidence, "Telegram alert delivered", `Delivery ${alert.id} is SENT; mock received ${messages.length} sanitized message(s).`);

  resetWordpressAutomation();
  const restored = await wordpressProbe("/", sourceIp);
  if (restored.status !== 200) throw new Error(`Cleanup expected HTTP 200, received ${restored.status}.`);
  recordStep(evidence, "Owned local cleanup", "Demo-only hit/block buckets cleared; WordPress returned HTTP 200.");
  await saveEvidence(evidence, requestedEvidence);
} catch (error) {
  evidence.status = "FAIL";
  evidence.error = error instanceof Error ? error.message : String(error);
  await saveEvidence(evidence, `${root}/output/demo/normal-hosting-demo-failed.json`).catch(() => undefined);
  throw error;
} finally {
  try { resetWordpressAutomation(); } catch { /* best-effort local demo cleanup */ }
}
