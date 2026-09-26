import { api, assertRedacted, connectTelegram, dryRun, expectJson, platform, prepareDemoSensorBuild, probePort, recordStep, removeDemoSensorBuild, resetWordpressAutomation, root, saveEvidence, secretDir, sensorCompose, session, sql, syncWordpress, telegramMessages, validateId, waitFor, wordpressProbe } from "./demo-attack-common.mjs";

const args = process.argv.slice(2);
if (dryRun("docker-wordpress-plus-network-sensor", args)) process.exit(0);
const evidenceIndex = args.indexOf("--evidence");
const requestedEvidence = evidenceIndex >= 0 && args[evidenceIndex + 1] ? args[evidenceIndex + 1] : `${root}/output/demo/docker-sensor-demo.json`;
const sourceIp = "8.8.4.4";
const evidence = { title: "SmartHoneyAI Docker WordPress + Sensor Attack Demo", mode: "DOCKER_WITH_NETWORK_SENSOR", startedAt: new Date().toISOString(), sourceIp, sourceAttribution: "DEMO_OVERRIDE", telegram: { transport: "LOCAL_MOCK" }, steps: [] };
let state;
let run;
let contained = false;
let sensorEnvironment;
let originalEnforcementMode;

try {
  state = await session();
  validateId(state.site.id, "WordPress site ID");
  originalEnforcementMode = state.site.enforcementMode === "ENFORCE" ? "ENFORCE" : "OBSERVE";
  resetWordpressAutomation();
  sql(`UPDATE "Site" SET "deploymentType" = 'DOCKER', "enforcementMode" = 'ENFORCE' WHERE id = '${state.site.id}' AND "kind" = 'WORDPRESS'; DELETE FROM "Site" WHERE "pairedWordpressSiteId" = '${state.site.id}' AND name LIKE 'Local Docker Demo Sensor%';`);
  recordStep(evidence, "Docker site pairing ready", `Local site ${state.site.id} is marked DOCKER and temporarily ENFORCE; stale local demo sensors were removed.`);

  const telegram = await connectTelegram(state, "DOCKER_SENSOR");
  recordStep(evidence, "Telegram provider test", `Local mock channel returned ${telegram.testDelivery.status} for Docker WordPress + Network Sensor.`);

  const sensorName = `Local Docker Demo Sensor ${Date.now()}`;
  const paired = await api(state, `/v1/sites/${state.site.id}/network-sensor`, 201, { method: "POST", body: JSON.stringify({ name: sensorName }) });
  const sensor = paired.data.sensor;
  const selfTest = await api(state, "/v1/self-tests", 201, { method: "POST", body: JSON.stringify({ siteId: state.site.id, sensorId: sensor.id }) });
  run = { id: selfTest.data.run.id, token: selfTest.data.token };
  const authorization = { authorization: `Bearer ${run.token}`, "content-type": "application/json", "x-forwarded-for": sourceIp };
  const started = await expectJson(`${platform}/v1/self-tests/${run.id}/start`, 200, { method: "POST", headers: authorization, body: JSON.stringify({ confirmation: "AUTHORIZED-HYBRID-TEST" }) });
  if (started.data.sourceIp !== sourceIp) throw new Error(`Self-test source attribution mismatch (${started.data.sourceIp}).`);
  recordStep(evidence, "Scoped self-test started", `Run ${run.id}; 15-minute token; DEMO_OVERRIDE source ${sourceIp}.`);

  await prepareDemoSensorBuild();
  sensorEnvironment = {
    NETWORK_SENSOR_NAME: sensorName,
    NETWORK_SENSOR_ENROLLMENT_TOKEN: paired.data.enrollmentToken,
    NETWORK_SENSOR_CONTROL_PLANE_URL: "https://host.docker.internal:9443",
    NETWORK_SENSOR_ALLOWLIST: "127.0.0.1",
    PROVIDER_FIREWALL_ALLOWLIST_CONFIRMED: "LOCAL_ONLY",
    SENSOR_RUNTIME_PROFILE: "local-self-test",
    SENSOR_BIND_ADDRESS: "127.0.0.1",
    SENSOR_DEMO_SOURCE_IP: sourceIp,
    SENSOR_DEMO_RUN_ID: run.id,
    LOCAL_CONTROL_PLANE_CA_FILE: `${secretDir}/tls/fullchain.pem`
  };
  try { sensorCompose(["down", "--volumes", "--remove-orphans"], sensorEnvironment); } catch { /* clean slate */ }
  sensorCompose(["up", "--build", "--detach", "--wait"], sensorEnvironment, true);
  recordStep(evidence, "Isolated sensor module ready", "Standalone Compose is healthy; ports bind only to 127.0.0.1 and no WordPress/database network is joined.");

  await waitFor("loopback sensor listeners", async () => {
    try {
      await Promise.all([probePort(2222, { requireResponse: true }), probePort(13306, { requireResponse: true }), probePort(16379, { requireResponse: true })]);
      return true;
    } catch { return false; }
  }, 30_000, 500);
  await Promise.all([probePort(2222), probePort(13306), probePort(16379)]);
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 2_000));
  const sensorHealth = JSON.parse(sensorCompose(["exec", "-T", "network-sensor-agent", "wget", "-q", "-O", "-", "http://127.0.0.1:4010/health/live"], sensorEnvironment));
  evidence.sensorHealthAfterProbes = sensorHealth;
  if (sensorHealth.acceptedSignals < 2) throw new Error(`OpenCanary signals were not accepted: ${JSON.stringify(sensorHealth)}`);
  recordStep(evidence, "Harmless network probes", `SSH banner, MySQL handshake, and Redis PING sent; agent accepted ${sensorHealth.acceptedSignals} sanitized signal(s).`);

  const decoy = await wordpressProbe(`/env?smarthoneyai-self-test=${encodeURIComponent(run.id)}`, sourceIp);
  if (![401, 404].includes(decoy.status)) throw new Error(`WordPress decoy returned HTTP ${decoy.status}.`);
  syncWordpress();
  recordStep(evidence, "WordPress sensor probe", `One inert /env route returned HTTP ${decoy.status} and telemetry was synchronized.`);

  const tokenHeaders = { authorization: `Bearer ${run.token}` };
  const correlated = await waitFor("critical hybrid correlation", async () => {
    const status = await expectJson(`${platform}/v1/self-tests/${run.id}`, 200, { headers: tokenHeaders });
    return status.data.run.hybridReady && status.data.run.incident?.severity === "CRITICAL" ? status.data.run : null;
  }, 120_000, 2_000);
  evidence.incidentId = correlated.incident.id;
  recordStep(evidence, "Critical correlation", `Incident ${correlated.incident.id} linked WordPress and sensor telemetry at CRITICAL severity.`);

  const incidentTelegram = await waitFor("critical Telegram alert", async () => {
    const messages = await telegramMessages();
    return messages.some((message) => /critical/i.test(message.text)) ? messages : null;
  });
  assertRedacted(incidentTelegram);
  recordStep(evidence, "Incident Telegram delivered", `Mock Telegram received ${incidentTelegram.length} message(s), including the CRITICAL incident.`);

  const containment = await expectJson(`${platform}/v1/self-tests/${run.id}/contain`, 201, { method: "POST", headers: { ...tokenHeaders, "content-type": "application/json" }, body: JSON.stringify({ confirmation: "AUTHORIZED-HYBRID-TEST" }) });
  contained = true;
  evidence.containmentRuleId = containment.data.rule.id;
  syncWordpress();
  const blocked = await wordpressProbe("/", sourceIp);
  if (blocked.status !== 403) throw new Error(`Contained WordPress request expected HTTP 403, received ${blocked.status}.`);
  syncWordpress();
  recordStep(evidence, "24-hour application containment", `Owned rule ${containment.data.rule.id} synchronized and WordPress returned HTTP 403.`);

  const blockedTelegram = await waitFor("blocked-access Telegram alert", async () => {
    const messages = await telegramMessages();
    return messages.some((message) => /blocked/i.test(message.text)) ? messages : null;
  }, 90_000, 2_000);
  const alerts = (await api(state, "/v1/alerts")).data.data;
  if (!alerts.some((item) => item.status === "SENT")) throw new Error("No Telegram AlertDelivery reached SENT.");
  assertRedacted({ messages: blockedTelegram, alerts });
  evidence.telegram.messageCount = blockedTelegram.length;
  evidence.telegram.deliveryIds = alerts.filter((item) => item.status === "SENT").slice(0, 5).map((item) => item.id);
  recordStep(evidence, "Blocked-access Telegram delivered", `At least one AlertDelivery is SENT and the mock contains the blocked-access notification.`);

  await expectJson(`${platform}/v1/self-tests/${run.id}/cleanup`, 200, { method: "POST", headers: { ...tokenHeaders, "content-type": "application/json" }, body: "{}" });
  contained = false;
  syncWordpress();
  const restored = await wordpressProbe("/", sourceIp);
  if (restored.status !== 200) throw new Error(`Cleanup expected WordPress HTTP 200, received ${restored.status}.`);
  evidence.cleanup = true;
  recordStep(evidence, "Scoped cleanup", "Only the self-test-owned rule was disabled; WordPress returned HTTP 200.");

  await saveEvidence(evidence, requestedEvidence);
} catch (error) {
  evidence.status = "FAIL";
  evidence.error = error instanceof Error ? error.message : String(error);
  await saveEvidence(evidence, `${root}/output/demo/docker-sensor-demo-failed.json`).catch(() => undefined);
  throw error;
} finally {
  if (contained && run) {
    await expectJson(`${platform}/v1/self-tests/${run.id}/cleanup`, 200, { method: "POST", headers: { authorization: `Bearer ${run.token}`, "content-type": "application/json" }, body: "{}" }).catch(() => undefined);
    try { syncWordpress(); } catch { /* best effort safety cleanup */ }
  }
  if (sensorEnvironment && process.env.KEEP_DEMO_SENSOR !== "1") {
    try { sensorCompose(["down", "--volumes", "--remove-orphans"], sensorEnvironment); } catch { /* best effort */ }
  }
  if (state && originalEnforcementMode) {
    try {
      sql(`UPDATE "Site" SET "enforcementMode" = '${originalEnforcementMode}' WHERE id = '${state.site.id}' AND "kind" = 'WORDPRESS';`);
      syncWordpress();
    } catch { /* best-effort restoration of the local demo mode */ }
  }
  await removeDemoSensorBuild().catch(() => undefined);
}
