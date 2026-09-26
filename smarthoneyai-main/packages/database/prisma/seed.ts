import { PrismaClient, Role } from "@prisma/client";
import { hash } from "@node-rs/argon2";
import { acquireAuthenticationIdentityLock } from "../src/advisory-lock.js";

const prisma = new PrismaClient();

const attackHoneypots = [
  { key: "sql-injection-trap", name: "SQL injection honeypot", path: "/database/query", template: "DATABASE_LOGIN" },
  { key: "xss-probe-trap", name: "XSS honeypot", path: "/preview/render", template: "FAKE_LOGIN" },
  { key: "command-injection-trap", name: "Command injection honeypot", path: "/system/diagnostics", template: "DIAGNOSTIC" }
] as const;

function requiredProductionValue(name: string, value: string | undefined) {
  const normalized = (value ?? "").trim();
  if (!normalized) throw new Error(`${name} is required in production.`);
  return normalized;
}

async function main() {
  const production = process.env.NODE_ENV === "production";
  const email = (production
    ? requiredProductionValue("PLATFORM_ADMIN_EMAIL", process.env.PLATFORM_ADMIN_EMAIL)
    : process.env.PLATFORM_ADMIN_EMAIL ?? "admin@smarthoneyai.local").trim().toLowerCase();
  const password = production
    ? requiredProductionValue("PLATFORM_ADMIN_PASSWORD", process.env.PLATFORM_ADMIN_PASSWORD)
    : process.env.PLATFORM_ADMIN_PASSWORD ?? "ChangeThisLocalPassword123!";
  const workspaceName = (process.env.PLATFORM_ORGANIZATION_NAME ?? "Professional Security Operations").trim();
  const workspaceSlug = (process.env.PLATFORM_ORGANIZATION_SLUG ?? (production ? "smarthoneyai-operations" : "smarthoneyai-local")).trim().toLowerCase();

  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("PLATFORM_ADMIN_EMAIL must be a valid email address.");
  if (password.length < 20 || (production && /replace|changethis|example/i.test(password))) {
    throw new Error("PLATFORM_ADMIN_PASSWORD must be a non-placeholder value of at least 20 characters.");
  }
  if (workspaceName.length < 2 || workspaceName.length > 120 || (production && /\b(?:demo|sample|fixture|test)\b/i.test(workspaceName))) {
    throw new Error("PLATFORM_ORGANIZATION_NAME must be a real workspace name between 2 and 120 characters.");
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(workspaceSlug) || workspaceSlug.length > 64 || (production && /(?:^|-)(?:demo|sample|fixture|test)(?:-|$)/.test(workspaceSlug))) {
    throw new Error("PLATFORM_ORGANIZATION_SLUG must be a production-safe lowercase URL slug of at most 64 characters.");
  }

  const resetExistingPassword = process.env.RESET_PLATFORM_ADMIN_PASSWORD === "1";
  const passwordHash = await hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
  const result = await prisma.$transaction(async (tx) => {
    await acquireAuthenticationIdentityLock(tx, email);
    const admin = await tx.user.upsert({
      where: { email },
      update: { isPlatformAdmin: true, ...(resetExistingPassword ? { passwordHash } : {}) },
      create: { email, name: "Platform Administrator", passwordHash, isPlatformAdmin: true }
    });
    const resetAt = new Date();
    const revokedSessions = resetExistingPassword ? await tx.session.deleteMany({ where: { userId: admin.id } }) : { count: 0 };
    const revokedResetTokens = resetExistingPassword
      ? await tx.passwordResetToken.updateMany({ where: { userId: admin.id, usedAt: null }, data: { usedAt: resetAt } })
      : { count: 0 };
    const organization = await tx.organization.upsert({
      where: { slug: workspaceSlug },
      update: { name: workspaceName },
      create: { name: workspaceName, slug: workspaceSlug }
    });
    await tx.membership.upsert({
      where: { organizationId_userId: { organizationId: organization.id, userId: admin.id } },
      update: { role: Role.OWNER },
      create: { organizationId: organization.id, userId: admin.id, role: Role.OWNER }
    });
    const sites = await tx.site.findMany({ select: { id: true } });
    for (const site of sites) {
      for (const honeypot of attackHoneypots) {
        await tx.honeypotDeployment.upsert({
          where: { siteId_key: { siteId: site.id, key: honeypot.key } },
          update: { name: honeypot.name, path: honeypot.path, template: honeypot.template, source: "BUILT_IN" },
          create: { siteId: site.id, ...honeypot, source: "BUILT_IN", enabled: true }
        });
      }
    }
    return { organization, seededHoneypots: sites.length * attackHoneypots.length, revokedSessions: revokedSessions.count, revokedResetTokens: revokedResetTokens.count };
  });

  console.info(JSON.stringify({
    event: production ? "production_bootstrap_complete" : "local_bootstrap_complete",
    organizationSlug: result.organization.slug,
    operationalRecordsCreated: result.seededHoneypots,
    revokedAdminSessions: result.revokedSessions,
    revokedAdminResetTokens: result.revokedResetTokens
  }));
}

main().finally(() => prisma.$disconnect());
