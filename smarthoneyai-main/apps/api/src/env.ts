import { z } from "zod";
import { createPrivateKey, createPublicKey } from "node:crypto";

const normalizedOrigin = z.string().url().transform((value) => value.replace(/\/$/, ""));
const optionalValue = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().trim().min(1).optional()
);
const localHostnames = new Set(["localhost", "127.0.0.1", "::1"]);

function isPlaceholder(value: string) {
  return /replace[-_ ]?with|changethis|example\.(com|test)|placeholder|temporary[-_ ]?value/i.test(value);
}

function policyKeysMatch(privateValue: string, publicValue: string) {
  try {
    const privateKey = createPrivateKey(Buffer.from(privateValue, "base64").toString("utf8"));
    const publicKey = createPublicKey(Buffer.from(publicValue, "base64").toString("utf8"));
    const derived = createPublicKey(privateKey).export({ type: "spki", format: "der" });
    const provided = publicKey.export({ type: "spki", format: "der" });
    return privateKey.asymmetricKeyType === "ed25519" && publicKey.asymmetricKeyType === "ed25519" && Buffer.from(derived).equals(Buffer.from(provided));
  } catch {
    return false;
  }
}

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  HOSTNAME: z.string().default("0.0.0.0"),
  APP_URL: normalizedOrigin.default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  SESSION_SECRET: z.string().min(32),
  AGENT_SIGNING_SECRET: z.string().min(32),
  POLICY_SIGNING_PRIVATE_KEY: z.string().min(1).optional(),
  POLICY_SIGNING_PUBLIC_KEY: z.string().min(1).optional(),
  ALLOW_LOCAL_SITE_URLS: z.enum(["0", "1"]).default("0"),
  HF_TOKEN: optionalValue,
  HF_CHAT_MODEL: z.string().trim().min(1).default("Qwen/Qwen2.5-7B-Instruct-1M:cheapest"),
  TELEGRAM_BOT_TOKEN: optionalValue,
  TELEGRAM_API_BASE_URL: normalizedOrigin.default("https://api.telegram.org"),
  SMTP_HOST: optionalValue,
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_USER: optionalValue,
  SMTP_PASSWORD: optionalValue,
  SMTP_FROM: optionalValue
}).superRefine((value, context) => {
  const appUrl = new URL(value.APP_URL);
  if (appUrl.username || appUrl.password || appUrl.pathname !== "/" || appUrl.search || appUrl.hash) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["APP_URL"], message: "APP_URL must be an origin without credentials, a path, query, or fragment." });
  }
  if (value.NODE_ENV !== "production") return;
  if (value.TELEGRAM_API_BASE_URL !== "https://api.telegram.org") {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["TELEGRAM_API_BASE_URL"], message: "Production Telegram delivery must use the official Telegram API origin." });
  }
  if (appUrl.protocol !== "https:") {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["APP_URL"], message: "Production APP_URL must use HTTPS." });
  }
  if (appUrl.port) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["APP_URL"], message: "Production APP_URL must not include an internal container port." });
  }
  const publicProduction = !localHostnames.has(appUrl.hostname);
  if (value.ALLOW_LOCAL_SITE_URLS === "1" && publicProduction) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["ALLOW_LOCAL_SITE_URLS"], message: "Public production origins cannot enable local site URLs." });
  }
  for (const [name, secret] of [["SESSION_SECRET", value.SESSION_SECRET], ["AGENT_SIGNING_SECRET", value.AGENT_SIGNING_SECRET]] as const) {
    if (isPlaceholder(secret)) context.addIssue({ code: z.ZodIssueCode.custom, path: [name], message: `${name} contains a placeholder value.` });
  }
  if (!value.POLICY_SIGNING_PRIVATE_KEY || !value.POLICY_SIGNING_PUBLIC_KEY) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["POLICY_SIGNING_PRIVATE_KEY"], message: "Production requires a persistent Ed25519 policy signing key pair." });
  } else if (!policyKeysMatch(value.POLICY_SIGNING_PRIVATE_KEY, value.POLICY_SIGNING_PUBLIC_KEY)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["POLICY_SIGNING_PRIVATE_KEY"], message: "Policy signing keys must be a matching Ed25519 pair encoded as base64 PEM." });
  }
  if (publicProduction) {
    const smtpNames = ["SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM"] as const;
    const smtpEnabled = smtpNames.some((name) => Boolean(value[name]));
    if (smtpEnabled) {
      for (const name of smtpNames) {
        const configured = value[name];
        if (!configured || isPlaceholder(configured)) {
          context.addIssue({ code: z.ZodIssueCode.custom, path: [name], message: `SMTP is optional, but an enabled SMTP integration requires a non-placeholder ${name}.` });
        }
      }
    }
    if (value.SMTP_FROM && !/^(?:[^<>\s@]+@[^<>\s@]+\.[^<>\s@]+|[^\r\n<>]*<[^<>\s@]+@[^<>\s@]+\.[^<>\s@]+>)$/.test(value.SMTP_FROM)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["SMTP_FROM"], message: "SMTP_FROM must contain a valid sender email address." });
    }
  }
});

export const env = EnvSchema.parse(process.env);
