import { z } from "zod";

export const roles = ["PLATFORM_ADMIN", "OWNER", "ADMIN", "ANALYST", "VIEWER"] as const;
export const RoleSchema = z.enum(roles);
export type Role = z.infer<typeof RoleSchema>;

export const severityLevels = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export const SeveritySchema = z.enum(severityLevels);
export type Severity = z.infer<typeof SeveritySchema>;

export const threatTypes = ["BOT", "SCANNER", "BRUTE_FORCE", "SQL_INJECTION", "XSS", "COMMAND_INJECTION", "DIRECTORY_TRAVERSAL", "CREDENTIAL_STUFFING", "SERVICE_ABUSE", "BENIGN", "UNKNOWN"] as const;
export const ThreatTypeSchema = z.enum(threatTypes);
export type ThreatType = z.infer<typeof ThreatTypeSchema>;

export const EventKindSchema = z.enum(["HONEYPOT", "FIREWALL", "RATE_LIMIT", "PLUGIN_HEALTH"]);
export const EventProtocolSchema = z.enum(["HTTP", "SSH", "MYSQL", "REDIS"]);
export const EventActivitySchema = z.enum(["CONNECTION", "BANNER", "AUTH_ATTEMPT", "COMMAND", "REQUEST"]);
export const EventSourceAttributionSchema = z.enum(["OBSERVED", "DEMO_OVERRIDE"]);
export const SecurityEventSchema = z.object({
  idempotencyKey: z.string().min(12).max(128),
  occurredAt: z.string().datetime({ offset: true }),
  kind: EventKindSchema,
  method: z.string().trim().toUpperCase().max(12),
  path: z.string().max(2048),
  ipAddress: z.string().ip(),
  userAgent: z.string().max(1024).optional(),
  referrer: z.string().max(2048).optional(),
  headers: z.record(z.string().max(4096)).default({}),
  payload: z.string().max(32768).optional(),
  honeypotKey: z.string().max(100).optional(),
  action: z.enum(["OBSERVED", "ALLOWED", "BLOCKED", "RATE_LIMITED"]).default("OBSERVED"),
  metadata: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
  protocol: EventProtocolSchema.optional(),
  activity: EventActivitySchema.optional(),
  sourcePort: z.number().int().min(1).max(65535).optional(),
  destinationPort: z.number().int().min(1).max(65535).optional(),
  sessionId: z.string().trim().min(1).max(128).optional(),
  sourceAttribution: EventSourceAttributionSchema.default("OBSERVED"),
  selfTestRunId: z.string().cuid().optional()
});
export type SecurityEventInput = z.infer<typeof SecurityEventSchema>;

export const EventBatchSchema = z.object({
  siteId: z.string().cuid().optional(),
  sensorId: z.string().cuid().optional(),
  pluginVersion: z.string().min(1).max(32).optional(),
  agentVersion: z.string().min(1).max(64).optional(),
  events: z.array(SecurityEventSchema).min(1).max(500)
})
  .refine((value) => Number(Boolean(value.siteId)) + Number(Boolean(value.sensorId)) === 1, { message: "Exactly one site or sensor ID is required." })
  .refine((value) => Boolean(value.pluginVersion || value.agentVersion), { message: "An agent or plugin version is required." });
export type EventBatch = z.infer<typeof EventBatchSchema>;

export const EnrollmentRequestSchema = z.object({
  token: z.string().min(32).max(256),
  siteUrl: z.string().url().max(2048),
  siteName: z.string().min(2).max(120),
  pluginVersion: z.string().min(1).max(32),
  proof: z.string().min(16).max(512)
});

export const HeartbeatSchema = z.object({
  pluginVersion: z.string().min(1).max(32),
  queueDepth: z.number().int().min(0).max(10000),
  policyVersion: z.number().int().min(0),
  mode: z.enum(["OBSERVE", "ENFORCE", "MONITOR_ONLY"]),
  health: z.enum(["HEALTHY", "DEGRADED", "ERROR"]),
  enabledDecoys: z.array(z.string().trim().min(1).max(100).regex(/^[a-z0-9-]+$/)).max(200).default([]),
  droppedEvents: z.number().int().min(0).max(2_147_483_647).default(0),
  lastErrorCode: z.string().trim().max(64).regex(/^[A-Za-z0-9_.:-]+$/).nullable().default(null)
});

export const NetworkSensorCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  wordpressSiteId: z.string().cuid().optional(),
  localSelfTest: z.boolean().default(false)
});

export const WordpressSiteCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  url: z.string().url().max(2048),
  deploymentType: z.enum(["NORMAL_HOSTING", "DOCKER"]).default("NORMAL_HOSTING")
});

export const PairedNetworkSensorCreateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional()
});

export const SelfTestCreateSchema = z.object({
  siteId: z.string().cuid(),
  sensorId: z.string().cuid()
});

export const SelfTestActionSchema = z.object({
  confirmation: z.literal("AUTHORIZED-HYBRID-TEST").optional()
});

export const NetworkSensorEnrollmentSchema = z.object({
  token: z.string().min(32).max(256),
  sensorName: z.string().trim().min(2).max(120),
  agentVersion: z.string().trim().min(1).max(64)
});

export const NetworkSensorHeartbeatSchema = z.object({
  agentVersion: z.string().trim().min(1).max(64),
  queueDepth: z.number().int().min(0).max(10_000),
  health: z.enum(["HEALTHY", "DEGRADED", "ERROR"]),
  enabledServices: z.array(z.enum(["SSH", "MYSQL", "REDIS"])).max(3),
  droppedEvents: z.number().int().min(0).max(2_147_483_647).default(0),
  lastErrorCode: z.string().trim().max(64).regex(/^[A-Za-z0-9_.:-]+$/).nullable().default(null)
});

export const NetworkSensorSourceIpVerificationSchema = z.object({
  expectedSourceIp: z.string().trim().ip()
});

export const IncidentContainmentSchema = z.object({
  reason: z.string().trim().min(3).max(500)
});

export const EnforcementModeChangeSchema = z.object({
  mode: z.enum(["OBSERVE", "ENFORCE"]),
  reason: z.string().trim().min(3).max(500)
});

export const FirewallRuleCreateSchema = z.object({
  siteId: z.string().cuid().nullable().optional(),
  type: z.enum(["ALLOW_IP", "BLOCK_IP", "BLOCK_COUNTRY", "BLOCK_USER_AGENT", "BLOCK_ROUTE", "RATE_LIMIT"]),
  value: z.string().trim().min(1).max(512),
  reason: z.string().trim().min(3).max(500),
  priority: z.number().int().min(0).max(10000).default(100),
  expiresAt: z.string().datetime().nullable().optional()
});

export const FirewallRuleUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  expiresAt: z.string().datetime().nullable().optional()
}).refine((value) => value.enabled !== undefined || value.expiresAt !== undefined, {
  message: "At least one supported firewall rule field is required."
});

export const RuleTypeSchema = z.enum(["ALLOW_IP", "BLOCK_IP", "BLOCK_COUNTRY", "BLOCK_USER_AGENT", "BLOCK_ROUTE", "RATE_LIMIT"]);
export const PolicyRuleSchema = z.object({
  id: z.string().cuid(),
  type: RuleTypeSchema,
  value: z.string().min(1).max(512),
  priority: z.number().int().min(0).max(10000),
  reason: z.string().min(3).max(500),
  expiresAt: z.string().datetime().nullable(),
  enabled: z.boolean()
});

export const honeypotTemplates = ["FAKE_LOGIN", "DATABASE_LOGIN", "ARCHIVE", "DIAGNOSTIC", "JSON_ERROR"] as const;
export const HoneypotTemplateSchema = z.enum(honeypotTemplates);
export const HoneypotPolicyItemSchema = z.object({
  id: z.string().cuid(),
  key: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
  name: z.string().min(2).max(120),
  path: z.string().min(2).max(190).startsWith("/"),
  template: HoneypotTemplateSchema,
  enabled: z.boolean()
});
export const AutoBlockPolicySchema = z.object({
  enabled: z.boolean(),
  distinctRoutes: z.number().int().min(2).max(20),
  windowSeconds: z.number().int().min(60).max(86400),
  blockSeconds: z.number().int().min(60).max(2_592_000)
});
export const AgentPolicySchema = z.object({
  siteId: z.string().cuid(),
  version: z.number().int().positive(),
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  mode: z.enum(["OBSERVE", "ENFORCE"]),
  rules: z.array(PolicyRuleSchema).max(2000),
  honeypots: z.array(HoneypotPolicyItemSchema).max(200).optional(),
  autoBlock: AutoBlockPolicySchema.optional(),
  signature: z.string().min(32)
});
export type AgentPolicy = z.infer<typeof AgentPolicySchema>;

export const ThreatAssessmentSchema = z.object({
  threatType: ThreatTypeSchema,
  severity: SeveritySchema,
  confidence: z.number().min(0).max(1),
  recommendation: z.enum(["IGNORE", "MONITOR", "BLOCK_TEMPORARILY", "ALERT_ADMINISTRATOR"]),
  evidenceSummary: z.string().max(1000),
  modelId: z.string(),
  modelRevision: z.string(),
  status: z.enum(["PENDING", "COMPLETE", "UNAVAILABLE", "FAILED"])
});
export type ThreatAssessment = z.infer<typeof ThreatAssessmentSchema>;

export const AccessRequestSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email().max(254),
  company: z.string().min(2).max(160),
  websiteCount: z.number().int().min(1).max(50),
  message: z.string().max(2000).optional(),
  consent: z.literal(true)
});

export const LoginSchema = z.object({
  email: z.string().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(15).max(128)
});

export const profileEmojis = ["🛡️", "🐝", "🧑‍💻", "👩‍💻", "👨‍💻", "🔐", "🕵️", "🤖"] as const;
export const ProfileUpdateSchema = z.object({ avatarEmoji: z.enum(profileEmojis) });

export const TelegramAlertUpdateSchema = z.object({ enabled: z.boolean() });

export const PlatformOrganizationCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  ownerEmail: z.string().trim().email().max(254).transform((value) => value.toLowerCase())
});

const HoneypotPathSchema = z.string().trim().min(2).max(190).startsWith("/");
export const HoneypotCreateSchema = z.object({
  siteId: z.string().cuid(),
  name: z.string().trim().min(2).max(120),
  path: HoneypotPathSchema,
  template: HoneypotTemplateSchema.default("DIAGNOSTIC"),
  enabled: z.boolean().default(true)
});
export const HoneypotImportSchema = z.object({
  siteId: z.string().cuid(),
  routes: z.array(HoneypotCreateSchema.omit({ siteId: true })).min(1).max(100)
});
export const HoneypotUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  path: HoneypotPathSchema.optional(),
  template: HoneypotTemplateSchema.optional(),
  enabled: z.boolean().optional()
}).refine((value) => Object.keys(value).length > 0, { message: "At least one honeypot field is required." });

export const AiChatSchema = z.object({
  message: z.string().trim().min(2).max(2000),
  history: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().trim().min(1).max(4000)
  })).max(16).default([]),
  filters: z.object({
    siteId: z.string().cuid().optional(),
    window: z.enum(["1h", "24h", "7d", "30d"]).default("24h")
  }).default({ window: "24h" })
});

export const ApiErrorSchema = z.object({
  statusCode: z.number().int(),
  code: z.string(),
  message: z.string(),
  requestId: z.string().optional()
});
