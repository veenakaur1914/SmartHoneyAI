import { maskedIp } from "./analysis-logic.js";

const malaysiaDateTime = new Intl.DateTimeFormat("en-MY", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kuala_Lumpur"
});

function safeLine(value: string, maxLength = 500) {
  return value.replace(/[\r\n\u0000-\u001f\u007f]/g, " ").trim().slice(0, maxLength);
}

export function formatMalaysiaDateTime(value: Date) {
  return `${malaysiaDateTime.format(value)} MYT`;
}

export function telegramDeliveryError(status: number) {
  if (status === 400) return "Telegram rejected the saved chat; reconnect it.";
  if (status === 401) return "Telegram rejected the worker bot token.";
  if (status === 403) return "Telegram blocked this bot or revoked its posting permission.";
  if (status === 429) return "Telegram rate-limited this bot.";
  return `Telegram delivery failed with HTTP ${status}.`;
}

export function blockedAccessTelegramMessage(input: {
  eventId: string;
  siteName: string;
  method: string;
  path: string;
  ipHash: string;
  receivedAt: Date;
  reviewUrl: string;
}) {
  return [
    "🛑 SmartHoneyAI blocked access",
    "Detection: FIREWALL",
    `Request: ${safeLine(input.method, 16)} ${safeLine(input.path)}`,
    `Site: ${safeLine(input.siteName, 160)}`,
    `Source: ${maskedIp(input.ipHash)}`,
    "Action: BLOCKED",
    `Received: ${formatMalaysiaDateTime(input.receivedAt)}`,
    `Event: ${safeLine(input.eventId, 128)}`,
    `Review: ${input.reviewUrl}`
  ].join("\n");
}

export function incidentTelegramMessage(input: {
  siteName: string;
  threatType: string;
  severity: string;
  sourceIpHash: string | null;
  reviewUrl: string;
}) {
  return [
    "🚨 SmartHoneyAI alert",
    `Site: ${safeLine(input.siteName, 160)}`,
    `Threat: ${safeLine(input.threatType.replaceAll("_", " "), 100)}`,
    `Risk: ${safeLine(input.severity, 20)}`,
    `Source: ${input.sourceIpHash ? maskedIp(input.sourceIpHash) : "redacted"}`,
    `Review: ${input.reviewUrl}`
  ].join("\n");
}
