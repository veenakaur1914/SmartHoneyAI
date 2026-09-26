export type AnalystEvidence = {
  eventId: string;
  occurredAtMalaysia: string;
  site: { name: string; kind?: string };
  kind: string;
  protocol?: string | null;
  activity?: string | null;
  action: string;
  request: string;
  sourceAlias: string;
  assessment?: { status?: string; threatType?: string | null; severity?: string | null; confidence?: number | null } | null;
  incidents?: Array<{ id: string; title: string; severity: string; status: string }>;
};

type EvidenceSummaryInput = {
  message: string;
  evidence: AnalystEvidence[];
  window: string;
};

function safeLine(value: unknown, maxLength = 180) {
  return String(value ?? "unknown").replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]+/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength) || "unknown";
}

function topCounts(values: string[], limit = 3) {
  const counts = new Map<string, number>();
  for (const rawValue of values) {
    const value = safeLine(rawValue, 180);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([leftValue, leftCount], [rightValue, rightCount]) => rightCount - leftCount || (leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0))
    .slice(0, limit);
}

export function safeAnalystRequest(method: string, target: string) {
  const safeMethod = safeLine(method, 16).toUpperCase();
  const withoutFragment = String(target ?? "/").split("#", 1)[0] ?? "/";
  const withoutQuery = (withoutFragment.split("?", 1)[0] ?? "/").split(/%(?:23|3f)/i, 1)[0] ?? "/";
  let redactNextSegment = false;
  const segments = safeLine(withoutQuery, 300).split("/").map((segment) => {
    if (!segment) return segment;
    if (redactNextSegment) {
      redactNextSegment = false;
      return "[redacted]";
    }
    const sensitiveLabel = /^(?:access[-_]?token|api[-_]?key|auth|authorization|credential|nonce|pass(?:word|wd)?|pwd|reset|secret|session|token)$/i.test(segment);
    if (sensitiveLabel) {
      redactNextSegment = true;
      return segment;
    }
    if (/^[A-Za-z0-9_-]{24,}$/.test(segment)) return "[opaque]";
    return segment.replace(/((?:token|secret|pass(?:word|wd)?|pwd|credential|session|nonce|api[-_]?key)[=:_-])[^/]+/gi, "$1[redacted]");
  });
  const safeTarget = segments.join("/").slice(0, 160);
  return `${safeMethod} ${safeTarget.startsWith("/") ? safeTarget : "/"}`;
}

function countLabel(entries: Array<[string, number]>) {
  return entries.length > 0 ? entries.map(([value, count]) => `${value} (${count})`).join(", ") : "none";
}

function eventLine(event: AnalystEvidence) {
  const assessment = event.assessment?.status === "COMPLETE" && event.assessment.severity && event.assessment.threatType
    ? `; ${safeLine(event.assessment.severity, 20)} ${safeLine(event.assessment.threatType, 40)}`
    : event.assessment?.status ? `; assessment ${safeLine(event.assessment.status, 24)}` : "";
  return `- ${safeLine(event.occurredAtMalaysia, 80)} · ${safeLine(event.site.name, 100)} · ${safeLine(event.action, 24)} ${safeLine(event.request)} · ${safeLine(event.protocol ?? event.kind, 32)} · event ${safeLine(event.eventId, 64)} · ${safeLine(event.sourceAlias, 32)}${assessment}`;
}

export function buildEvidenceSummary({ message, evidence, window }: EvidenceSummaryInput) {
  if (evidence.length === 0) {
    return {
      answer: [
        "Findings",
        `No security events were recorded in the selected ${safeLine(window, 20)} window, so there is no activity to analyze yet.`,
        "",
        "Evidence",
        "The bounded organization query returned 0 events.",
        "",
        "Recommended next checks",
        "- Confirm the intended site is connected and has checked in recently.",
        "- Expand the time range, then review Events for incoming telemetry.",
        "- If activity was expected, verify the WordPress or network sensor queue is draining."
      ].join("\n"),
      model: "local-evidence-summary-v1"
    };
  }

  const normalizedQuestion = message.toLowerCase();
  const blocked = evidence.filter((event) => event.action === "BLOCKED" || event.action === "RATE_LIMITED");
  const highRisk = evidence.filter((event) => event.assessment?.status === "COMPLETE" && ["HIGH", "CRITICAL"].includes(event.assessment.severity ?? ""));
  const incidentEvents = evidence.filter((event) => (event.incidents?.length ?? 0) > 0);
  const routes = topCounts(evidence.map((event) => event.request));
  const sources = topCounts(evidence.map((event) => event.sourceAlias));
  const protocols = topCounts(evidence.map((event) => event.protocol ?? event.kind));
  const siteCount = new Set(evidence.map((event) => safeLine(event.site.name, 100))).size;
  const latestBlocked = blocked.slice(0, 3);
  const latestEvents = evidence.slice(0, 3);
  const asksAboutBlocking = /\b(block|blocked|rate.?limit)\b/.test(normalizedQuestion);
  const asksAboutPatterns = /\b(pattern|route|source|compare|repeat|common)\b/.test(normalizedQuestion);
  const asksAboutAssessment = /\b(incident|assessment|classif|severity|threat)\b/.test(normalizedQuestion);

  const findings = asksAboutBlocking
    ? blocked.length > 0
      ? `${blocked.length} of ${evidence.length} events were blocked or rate-limited. The latest was ${safeLine(latestBlocked[0]?.action, 24)} on ${safeLine(latestBlocked[0]?.site.name, 100)} at ${safeLine(latestBlocked[0]?.occurredAtMalaysia, 80)}.`
      : `None of the ${evidence.length} events in the selected ${safeLine(window, 20)} window were marked blocked or rate-limited.`
    : asksAboutPatterns
      ? `The most frequent request was ${routes[0] ? `${routes[0][0]} (${routes[0][1]} events)` : "not available"}; the most frequent source alias was ${sources[0] ? `${sources[0][0]} (${sources[0][1]} events)` : "not available"}.`
      : asksAboutAssessment
        ? `${highRisk.length} of ${evidence.length} events have a completed high or critical assessment, and ${incidentEvents.length} are linked to an incident.`
        : `${evidence.length} events were found across ${siteCount} site${siteCount === 1 ? "" : "s"}; ${blocked.length} were blocked or rate-limited and ${highRisk.length} were assessed high or critical.`;

  const assessedEvidence = evidence.filter((event) => highRisk.includes(event) || (event.incidents?.length ?? 0) > 0).slice(0, 3);
  const selectedEvidence = asksAboutBlocking
    ? (latestBlocked.length > 0 ? latestBlocked : latestEvents)
    : asksAboutAssessment
      ? (assessedEvidence.length > 0 ? assessedEvidence : latestEvents)
      : highRisk.length > 0 && !asksAboutPatterns
        ? highRisk.slice(0, 3)
        : latestEvents;
  const recommendations = [
    "- Open the cited event records and verify their assessment evidence before changing policy.",
    blocked.length > 0 ? "- Confirm the matching firewall or rate-limit rule was intended and check whether the same source alias repeated across routes." : "- Review the most frequent routes and source aliases for repetition or unusual timing.",
    highRisk.length > 0 ? "- Escalate the cited high/critical records to an owner or administrator; use temporary containment only after verifying the source." : "- Continue monitoring; the selected evidence does not contain a completed high/critical assessment."
  ];

  const answer = [
    "Findings",
    findings,
    "",
    "Evidence",
    ...selectedEvidence.map(eventLine),
    `- Top routes: ${countLabel(routes)}`,
    `- Top source aliases: ${countLabel(sources)}`,
    `- Protocols: ${countLabel(protocols)}`,
    "",
    "Recommended next checks",
    ...recommendations
  ].join("\n").slice(0, 12_000);

  return { answer, model: "local-evidence-summary-v1" };
}
