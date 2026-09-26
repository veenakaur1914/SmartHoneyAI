import { z } from "zod";

const optionalSecret = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().min(1).optional()
);

function isPlaceholder(value: string) {
  return /replace[-_ ]?with|changethis|example\.(com|test)|placeholder/i.test(value);
}

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  APP_URL: z.string().url().default("http://localhost:3000").transform((value) => value.replace(/\/$/, "")),
  ANALYSIS_PROVIDER: z.enum(["huggingface", "local"]).default("huggingface"),
  ALLOW_LOCAL_ANALYSIS: z.enum(["0", "1"]).default("0"),
  ANALYSIS_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),
  ANALYSIS_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(10_000).default(30),
  HF_MODEL_ID: z.string().min(1).default("MoritzLaurer/deberta-v3-base-zeroshot-v1"),
  HF_MODEL_REVISION: optionalSecret,
  HF_TOKEN: optionalSecret,
  TELEGRAM_BOT_TOKEN: optionalSecret,
  TELEGRAM_API_BASE_URL: z.string().url().default("https://api.telegram.org").transform((value) => value.replace(/\/$/, "")),
  WORKER_HEALTH_PORT: z.coerce.number().int().min(1).max(65535).default(4001)
}).superRefine((value, context) => {
  const appUrl = new URL(value.APP_URL);
  if (appUrl.username || appUrl.password || appUrl.pathname !== "/" || appUrl.search || appUrl.hash) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["APP_URL"], message: "APP_URL must be an origin without credentials, a path, query, or fragment." });
  }
  if (value.ANALYSIS_PROVIDER === "local" && value.ALLOW_LOCAL_ANALYSIS !== "1") {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["ALLOW_LOCAL_ANALYSIS"], message: "Local analysis requires explicit authorization." });
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
  const publicProduction = !new Set(["localhost", "127.0.0.1", "::1"]).has(appUrl.hostname);
  if (value.ANALYSIS_PROVIDER === "local" && publicProduction) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["ANALYSIS_PROVIDER"], message: "Public production origins must use the configured remote analysis provider." });
  }
  if (value.ANALYSIS_PROVIDER === "huggingface" && publicProduction) {
    if (!value.HF_TOKEN || isPlaceholder(value.HF_TOKEN)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["HF_TOKEN"], message: "Public production Hugging Face analysis requires a non-placeholder HF_TOKEN." });
    if (!value.HF_MODEL_REVISION || !/^[a-f0-9]{40}$/i.test(value.HF_MODEL_REVISION) || /^0+$/.test(value.HF_MODEL_REVISION)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["HF_MODEL_REVISION"], message: "Public production requires a non-placeholder 40-character immutable model commit." });
    }
  }
});

export const env = EnvSchema.parse(process.env);
