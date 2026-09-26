import http from "k6/http";
import { check } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";
import { assertSyntheticTarget } from "./synthetic-target-guard.mjs";

const phase = __ENV.PERF_PHASE || "smoke";
const rate = Number(__ENV.PERF_RATE || 5);
const duration = __ENV.PERF_DURATION || "60s";
const testSecret = open("/run/secrets/wordpress_test_source_secret").trim();
const wordpressUrl = (__ENV.WORDPRESS_INTERNAL_URL || "http://wordpress").replace(/\/$/, "");
const platformUrl = (__ENV.PLATFORM_URL || "https://host.docker.internal").replace(/\/$/, "");
const host = __ENV.WORDPRESS_TEST_HOST || "localhost:8080";
const runId = __ENV.PERF_RUN_ID || "local-perf";

assertSyntheticTarget(wordpressUrl, { label: "k6 WordPress performance target", environment: __ENV });
assertSyntheticTarget(platformUrl, { label: "k6 platform performance target", environment: __ENV });

const expected = new Rate("expected_response_correct");
const normalCorrect = new Rate("normal_response_correct");
const honeypotCorrect = new Rate("honeypot_response_correct");
const firewallCorrect = new Rate("firewall_response_correct");
const rateLimitCorrect = new Rate("rate_limit_response_correct");
const platformCorrect = new Rate("platform_response_correct");
const normalLatency = new Trend("normal_latency", true);
const decoyLatency = new Trend("decoy_latency", true);
const firewallLatency = new Trend("firewall_latency", true);
const rateLimitLatency = new Trend("rate_limit_latency", true);
const platformLatency = new Trend("platform_latency", true);
const normalRequests = new Counter("normal_requests");
const honeypotRequests = new Counter("honeypot_requests");
const honeypotCaptured = new Counter("honeypot_captured");
const firewallRequests = new Counter("firewall_requests");
const rateLimitRequests = new Counter("rate_limit_requests");
const platformRequests = new Counter("platform_requests");
const status403 = new Counter("status_403");
const status429 = new Counter("status_429");
const firewallBlocked = new Counter("firewall_blocked");
const rateLimited = new Counter("rate_limited");

http.setResponseCallback(http.expectedStatuses({ min: 200, max: 399 }, 401, 403, 404, 429));

export const options = {
  scenarios: {
    mixed: {
      executor: "constant-arrival-rate",
      rate,
      timeUnit: "1s",
      duration,
      preAllocatedVUs: Math.max(20, Math.min(400, rate * 2)),
      maxVUs: Math.max(100, Math.min(800, rate * 5))
    }
  },
  thresholds: phase === "soak-chaos" ? {} : {
    normal_response_correct: [{ threshold: "rate>0.90", abortOnFail: true, delayAbortEval: "60s" }]
  },
  discardResponseBodies: true,
  noConnectionReuse: false,
  userAgent: `SmartHoneyPerf/${runId}`,
  tags: { phase, run_id: runId },
  summaryTrendStats: ["avg", "min", "med", "max", "p(90)", "p(95)", "p(99)"]
};

function sourceHeaders(source, userAgent = `SmartHoneyPerf/${runId}`, eventId = null) {
  const headers = {
    Host: host,
    "X-Honeypot-Test-Secret": testSecret,
    "X-Honeypot-Test-Remote-Addr": source,
    "User-Agent": userAgent
  };
  if (eventId) headers["X-Perf-Event-ID"] = eventId;
  return headers;
}

function eventId(category) {
  return `${runId}:${phase}:${category}:${__VU}:${__ITER}`;
}

function requestParams(headers, category) {
  return { headers, tags: { category }, timeout: "10s" };
}

function record(response, accepted, latency, counter, category) {
  counter.add(1, { phase, category });
  latency.add(response.timings.duration, { phase, category });
  if (response.status === 403) status403.add(1, { phase, category });
  if (response.status === 429) status429.add(1, { phase, category });
  expected.add(accepted, { phase, category });
  check(response, { [`${category} expected status`]: () => accepted }, { phase, category });
}

const decoys = [
  ["GET", "/wp-content/backups/site-backup.zip", 404],
  ["POST", "/secure-admin-login", 401],
  ["POST", "/internal/admin-console", 401],
  ["POST", "/phpmyadmin", 401]
];

export default function () {
  const pick = Math.random();
  const vu = Math.max(0, __VU - 1);
  // The normal range is deliberately disjoint from fixed firewall/rate test
  // sources, so ordinary requests can never inherit a test bucket.
  const source = `45.${1 + Math.floor(vu / 250)}.${1 + (vu % 250)}.${1 + (__ITER % 250)}`;
  if (pick < 0.60) {
    const response = http.get(`${wordpressUrl}/`, requestParams(sourceHeaders(source), "normal"));
    normalCorrect.add(response.status === 200, { phase, category: "normal" });
    record(response, response.status === 200, normalLatency, normalRequests, "normal");
    return;
  }
  if (pick < 0.75) {
    const [method, path, status] = decoys[__ITER % decoys.length];
    const body = `username=perf-user-${__VU}&password=PERF-PASSWORD-${runId}&marker=${runId}`;
    const response = method === "POST"
      ? http.post(`${wordpressUrl}${path}`, body, requestParams({ ...sourceHeaders(source, `SmartHoneyDecoy/${runId}`, eventId("honeypot")), "Content-Type": "application/x-www-form-urlencoded", Authorization: `Bearer PERF-AUTH-${runId}`, Cookie: `perf_session=PERF-COOKIE-${runId}` }, "honeypot"))
      : http.get(`${wordpressUrl}${path}`, requestParams(sourceHeaders(source, `SmartHoneyDecoy/${runId}`, eventId("honeypot")), "honeypot"));
    honeypotCorrect.add(response.status === status, { phase, category: "honeypot" });
    if (response.status === status) honeypotCaptured.add(1, { phase, category: "honeypot" });
    record(response, response.status === status, decoyLatency, honeypotRequests, "honeypot");
    return;
  }
  if (pick < 0.85) {
    const response = http.get(`${wordpressUrl}/blocked-test`, requestParams(sourceHeaders("9.9.9.9", `PerfBlockedBot/${runId}`, eventId("firewall")), "firewall"));
    firewallCorrect.add(response.status === 403, { phase, category: "firewall" });
    if (response.status === 403) firewallBlocked.add(1, { phase, category: "firewall" });
    record(response, response.status === 403, firewallLatency, firewallRequests, "firewall");
    return;
  }
  if (pick < 0.95) {
    const response = http.get(`${wordpressUrl}/`, requestParams(sourceHeaders("8.8.4.55", `PerfRateBot/${runId}`, eventId("rate-limit")), "rate_limit"));
    rateLimitCorrect.add(response.status === 200 || response.status === 429, { phase, category: "rate_limit" });
    if (response.status === 429) rateLimited.add(1, { phase, category: "rate_limit" });
    record(response, response.status === 200 || response.status === 429, rateLimitLatency, rateLimitRequests, "rate_limit");
    return;
  }
  const response = http.get(`${platformUrl}/health/ready`, { tags: { category: "platform" }, timeout: "10s" });
  platformCorrect.add(response.status === 200, { phase, category: "platform" });
  record(response, response.status === 200, platformLatency, platformRequests, "platform");
}

export function handleSummary(data) {
  return {
    [`/evidence/k6/${phase}-summary.json`]: JSON.stringify({ phase, rate, duration, generatedAt: new Date().toISOString(), data }, null, 2),
    stdout: `\nPERF_SUMMARY ${phase} rate=${rate} duration=${duration} checks=${data.metrics.checks?.values?.passes || 0}/${(data.metrics.checks?.values?.passes || 0) + (data.metrics.checks?.values?.fails || 0)}\n`
  };
}
