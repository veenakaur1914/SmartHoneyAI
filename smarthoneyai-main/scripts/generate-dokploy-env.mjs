#!/usr/bin/env node

import { generateKeyPairSync, randomBytes } from "node:crypto";

function usage() {
  console.error([
    "Set HF_TOKEN in the environment, then run:",
    "node scripts/generate-dokploy-env.mjs --domain security.example.com --admin-email admin@example.com [--organization-name 'Security Operations']",
    "To enable optional password-reset email delivery, also set SMTP_PASSWORD and add --smtp-host smtp.provider.tld --smtp-user security@your-domain.tld --smtp-from 'SmartHoneyAI <security@your-domain.tld>' [--smtp-port 587]. Invitations use manual share links."
  ].join("\n"));
}

function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  usage();
  process.exit(0);
}

const domainInput = readArgument("--domain");
const adminEmail = readArgument("--admin-email");
const smtpHost = (readArgument("--smtp-host") ?? "").trim();
const smtpUser = (readArgument("--smtp-user") ?? "").trim();
const smtpFrom = (readArgument("--smtp-from") ?? "").trim();
const smtpPassword = (process.env.SMTP_PASSWORD ?? "").trim();
const hfToken = (process.env.HF_TOKEN ?? "").trim();
const smtpPortInput = readArgument("--smtp-port") ?? "587";
const smtpPort = Number(smtpPortInput);
if (!domainInput || !adminEmail || !hfToken) {
  usage();
  process.exit(1);
}

function isPlaceholder(value) {
  return /replace[-_ ]?with|changethis|example\.(com|test)|placeholder|temporary[-_ ]?value/i.test(value);
}

const smtpHostPattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const smtpFromPattern = /^(?:[^<>\s@]+@[^<>\s@]+\.[^<>\s@]+|[^\r\n<>]*<[^<>\s@]+@[^<>\s@]+\.[^<>\s@]+>)$/;
const smtpEnabled = [smtpHost, smtpUser, smtpFrom, smtpPassword].some(Boolean);
if (smtpEnabled && [smtpHost, smtpUser, smtpFrom, smtpPassword].some((value) => !value)) {
  console.error("SMTP is optional, but enabling it requires --smtp-host, --smtp-user, --smtp-from, and SMTP_PASSWORD together.");
  process.exit(1);
}
if (smtpEnabled && (!smtpHostPattern.test(smtpHost) || isPlaceholder(smtpHost))) {
  console.error("--smtp-host must be a non-placeholder fully qualified SMTP hostname.");
  process.exit(1);
}
if (smtpEnabled && (/[\0\r\n']/.test(smtpUser) || isPlaceholder(smtpUser))) {
  console.error("--smtp-user must be a non-placeholder SMTP username without quotes or line breaks.");
  process.exit(1);
}
if (smtpEnabled && (/[\0']/.test(smtpFrom) || !smtpFromPattern.test(smtpFrom) || isPlaceholder(smtpFrom))) {
  console.error("--smtp-from must contain a non-placeholder verified sender email address.");
  process.exit(1);
}
if (smtpEnabled && (/[\0\r\n']/.test(smtpPassword) || isPlaceholder(smtpPassword))) {
  console.error("SMTP_PASSWORD must be a non-placeholder secret without quotes or line breaks, supplied through the environment.");
  process.exit(1);
}
if (/[\0\r\n']/.test(hfToken) || isPlaceholder(hfToken)) {
  console.error("HF_TOKEN must be a non-placeholder secret without quotes or line breaks, supplied through the environment.");
  process.exit(1);
}
if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535) {
  console.error("--smtp-port must be an integer between 1 and 65535.");
  process.exit(1);
}

function formatEnvironmentValue(value) {
  if (value === "") return "";
  if (/^[a-zA-Z0-9._~:/@+,-]+$/.test(value)) return value;
  return `'${value}'`;
}

let origin;
try {
  const candidate = new URL(domainInput.includes("://") ? domainInput : `https://${domainInput}`);
  if (candidate.protocol !== "https:" || candidate.username || candidate.password || candidate.port || candidate.pathname !== "/" || candidate.search || candidate.hash) {
    throw new Error("invalid origin");
  }
  origin = candidate.origin;
} catch {
  console.error("--domain must be a hostname or an HTTPS origin without a port, path, query, or fragment.");
  process.exit(1);
}

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) {
  console.error("--admin-email must be a valid email address.");
  process.exit(1);
}

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const privateKeyValue = Buffer.from(privateKey.export({ type: "pkcs8", format: "pem" })).toString("base64");
const publicKeyValue = Buffer.from(publicKey.export({ type: "spki", format: "pem" })).toString("base64");
const hostname = new URL(origin).hostname;
const organizationName = (readArgument("--organization-name") ?? "Professional Security Operations").trim();
const organizationSlug = organizationName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 64).replace(/-+$/g, "");
if (organizationName.length < 2 || organizationName.length > 120 || /[\r\n#=]/.test(organizationName) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(organizationSlug)) {
  console.error("--organization-name must contain between 2 and 120 usable characters.");
  process.exit(1);
}

const values = {
  NODE_ENV: "production",
  APP_URL: origin,
  TRAEFIK_HOST: hostname,
  POSTGRES_USER: "honeypot",
  POSTGRES_DB: "honeypot_ai",
  POSTGRES_PASSWORD: randomBytes(32).toString("hex"),
  REDIS_PASSWORD: randomBytes(32).toString("hex"),
  SESSION_SECRET: randomBytes(48).toString("hex"),
  AGENT_SIGNING_SECRET: randomBytes(48).toString("hex"),
  POLICY_SIGNING_PRIVATE_KEY: privateKeyValue,
  POLICY_SIGNING_PUBLIC_KEY: publicKeyValue,
  PLATFORM_ADMIN_EMAIL: adminEmail.toLowerCase(),
  PLATFORM_ADMIN_PASSWORD: randomBytes(30).toString("base64url"),
  PLATFORM_ORGANIZATION_NAME: organizationName,
  PLATFORM_ORGANIZATION_SLUG: organizationSlug,
  RESET_PLATFORM_ADMIN_PASSWORD: "0",
  GRAFANA_ADMIN_USER: "admin",
  GRAFANA_ADMIN_PASSWORD: randomBytes(32).toString("base64url"),
  HF_MODEL_ID: "MoritzLaurer/deberta-v3-base-zeroshot-v1",
  HF_MODEL_REVISION: "c2040e8a2599abd2925fdc716cf40e8052d56ec4",
  HF_TOKEN: hfToken,
  HF_CHAT_MODEL: "Qwen/Qwen2.5-7B-Instruct-1M:cheapest",
  ANALYSIS_CONCURRENCY: "4",
  ANALYSIS_RATE_LIMIT_MAX: "30",
  TELEGRAM_BOT_TOKEN: "",
  SMTP_HOST: smtpHost,
  SMTP_PORT: String(smtpPort),
  SMTP_USER: smtpUser,
  SMTP_PASSWORD: smtpPassword,
  SMTP_FROM: smtpFrom
};

console.log("# Generated SmartHoneyAI Dokploy environment");
console.log("# Save PLATFORM_ADMIN_PASSWORD before closing this output.");
console.log("# Paste this block as-is; do not add API_URL, DATABASE_URL, REDIS_URL, or NEXT_PUBLIC_API_URL.");
for (const [name, value] of Object.entries(values)) {
  const rendered = name.startsWith("SMTP_") ? formatEnvironmentValue(value) : value;
  console.log(`${name}=${rendered}`);
}
