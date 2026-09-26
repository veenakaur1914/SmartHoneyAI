import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";

type AdvisoryLockClient = Pick<Prisma.TransactionClient, "$executeRaw">;

const AUTH_IDENTITY_NAMESPACE = "smarthoneyai:auth-identity:v1";
const INVITATION_IDENTITY_NAMESPACE = "smarthoneyai:invitation-identity:v1";
const INCIDENT_CORRELATION_NAMESPACE = "smarthoneyai:incident-correlation:v1";
const SELF_TEST_SITE_NAMESPACE = "smarthoneyai:self-test-site:v1";

/**
 * PostgreSQL's two-key advisory-lock form accepts signed 32-bit integers.
 * Deriving both keys from SHA-256 gives every application instance the same
 * stable 64-bit lock identity without relying on process-local hashing.
 */
export function advisoryTransactionLockKey(namespace: string, identity: string): readonly [number, number] {
  const digest = createHash("sha256")
    .update(namespace, "utf8")
    .update("\0", "utf8")
    .update(identity, "utf8")
    .digest();
  return [digest.readInt32BE(0), digest.readInt32BE(4)] as const;
}

export function authenticationIdentityLockKey(email: string): readonly [number, number] {
  return advisoryTransactionLockKey(AUTH_IDENTITY_NAMESPACE, email.trim().toLowerCase());
}

export function invitationIdentityLockKey(organizationId: string, email: string): readonly [number, number] {
  return advisoryTransactionLockKey(INVITATION_IDENTITY_NAMESPACE, `${organizationId}\0${email.trim().toLowerCase()}`);
}

async function acquireTransactionLock(client: AdvisoryLockClient, key: readonly [number, number]) {
  // Prisma binds JavaScript numbers as PostgreSQL bigint values. Cast both
  // parameters explicitly because the two-key advisory-lock overload accepts
  // int4, int4 (the bigint overload accepts a single key only).
  // Use executeRaw because pg_advisory_xact_lock returns PostgreSQL void,
  // which Prisma's query decoder cannot deserialize.
  await client.$executeRaw`SELECT pg_advisory_xact_lock(${key[0]}::int, ${key[1]}::int)`;
}

/** Must be called inside the transaction that reads or changes auth state. */
export async function acquireAuthenticationIdentityLock(client: AdvisoryLockClient, email: string) {
  await acquireTransactionLock(client, authenticationIdentityLockKey(email));
}

/** Must be called inside the transaction that reads or changes an invitation. */
export async function acquireInvitationIdentityLock(client: AdvisoryLockClient, organizationId: string, email: string) {
  await acquireTransactionLock(client, invitationIdentityLockKey(organizationId, email));
}

/** Serializes incident correlation for one tenant-scoped source identity. */
export async function acquireIncidentCorrelationLock(client: AdvisoryLockClient, organizationId: string, sourceIpHash: string) {
  await acquireTransactionLock(client, incidentCorrelationLockKey(organizationId, sourceIpHash));
}

export function incidentCorrelationLockKey(organizationId: string, sourceIpHash: string) {
  return advisoryTransactionLockKey(INCIDENT_CORRELATION_NAMESPACE, `${organizationId}\0${sourceIpHash}`);
}

/** Ensures one active self-test is created for a WordPress site at a time. */
export async function acquireSelfTestSiteLock(client: AdvisoryLockClient, organizationId: string, siteId: string) {
  await acquireTransactionLock(client, advisoryTransactionLockKey(SELF_TEST_SITE_NAMESPACE, `${organizationId}\0${siteId}`));
}
