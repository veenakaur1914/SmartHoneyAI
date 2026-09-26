import type { Severity, ThreatType } from "@honeypot/database";

const seededHoneypotThreats: Record<string, ThreatType> = {
  "sql-injection-trap": "SQL_INJECTION",
  "xss-probe-trap": "XSS",
  "command-injection-trap": "COMMAND_INJECTION",
  "fake-login": "CREDENTIAL_STUFFING",
  "backup-archive": "SCANNER",
  "admin-console": "SCANNER",
  phpmyadmin: "SCANNER",
  "environment-file": "SCANNER",
  "git-config": "SCANNER",
  "wp-config-backup": "SCANNER",
  "server-status": "SCANNER",
  adminer: "SCANNER",
  "debug-log": "SCANNER",
  "database-dump": "SCANNER",
  "actuator-env": "SCANNER",
  "opencanary-ssh-connection": "SCANNER",
  "opencanary-ssh-auth": "BRUTE_FORCE",
  "opencanary-mysql-connection": "SCANNER",
  "opencanary-mysql-auth": "BRUTE_FORCE",
  "opencanary-redis-command": "SERVICE_ABUSE"
};

export function seededHoneypotClassification(honeypotKey: string | null): { threatType: ThreatType; confidence: number } | null {
  const threatType = honeypotKey ? seededHoneypotThreats[honeypotKey] : undefined;
  return threatType ? { threatType, confidence: 0.99 } : null;
}

export function localDeterministicClassification(text: string): { threatType: ThreatType; confidence: number } {
  const evidence = text.toLowerCase().slice(0, 12_000);
  if (evidence.includes("path: /secure-admin-login") && evidence.includes("payload:")) {
    return { threatType: "CREDENTIAL_STUFFING", confidence: 0.96 };
  }
  if (
    evidence.includes("path: /env") ||
    evidence.includes("path: /git-config") ||
    evidence.includes("path: /wp-config-backup") ||
    evidence.includes("path: /server-diagnostics") ||
    evidence.includes("path: /wp-content/backups/") ||
    evidence.includes("path: /debug-log") ||
    evidence.includes("path: /phpmyadmin") ||
    evidence.includes("path: /internal/admin-console")
  ) {
    return { threatType: "SCANNER", confidence: 0.94 };
  }
  if (evidence.includes("event kind: rate_limit")) {
    return { threatType: "BOT", confidence: 0.9 };
  }
  if (evidence.includes("smarthoneybotsim/")) {
    return { threatType: "BOT", confidence: 0.97 };
  }
  if (evidence.includes("event kind: firewall")) {
    return { threatType: "SCANNER", confidence: 0.88 };
  }
  return { threatType: "UNKNOWN", confidence: evidence.length > 0 ? 0.1 : 0 };
}

export function severityFor(type: ThreatType, confidence: number): Severity {
  if (confidence < 0.55 || type === "BENIGN" || type === "UNKNOWN") return "LOW";
  if (["SQL_INJECTION", "COMMAND_INJECTION", "CREDENTIAL_STUFFING"].includes(type) && confidence >= 0.9) return "CRITICAL";
  if (["XSS", "DIRECTORY_TRAVERSAL", "BRUTE_FORCE", "SERVICE_ABUSE"].includes(type) && confidence >= 0.8) return "HIGH";
  if (["SCANNER", "BOT"].includes(type)) return confidence >= 0.85 ? "HIGH" : "MEDIUM";
  return "MEDIUM";
}

export function maskedIp(value: string) {
  if (value.includes(":")) return `${value.split(":").slice(0, 3).join(":")}::/48`;
  return value.replace(/\d+$/, "xxx");
}
