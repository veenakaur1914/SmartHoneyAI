import type { FastifyReply, FastifyRequest } from "fastify";
import { prisma, type Role } from "@honeypot/database";
import { sha256 } from "./security.js";

declare module "fastify" {
  interface FastifyRequest {
    auth: { userId: string; organizationId: string | null; role: Role | "PLATFORM_ADMIN"; isPlatformAdmin: boolean } | null;
  }
}

export async function resolveAuth(request: FastifyRequest) {
  const token = request.cookies.hp_session;
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: { include: { memberships: true } } }
  });
  if (!session || session.expiresAt <= new Date()) return null;
  if (Date.now() - session.lastSeenAt.getTime() >= 5 * 60_000) {
    // A concurrent logout or password reset may delete the session after the
    // lookup. updateMany makes that race a harmless no-op instead of a 500.
    await prisma.session.updateMany({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
  }
  const requestedOrganization = typeof request.headers["x-organization-id"] === "string" ? request.headers["x-organization-id"] : null;
  const membership = requestedOrganization
    ? session.user.memberships.find((entry) => entry.organizationId === requestedOrganization)
    : session.user.memberships[0];
  if (requestedOrganization && !membership && !session.user.isPlatformAdmin) return null;
  return {
    userId: session.userId,
    organizationId: membership?.organizationId ?? requestedOrganization,
    role: session.user.isPlatformAdmin && !membership ? "PLATFORM_ADMIN" as const : membership?.role ?? "VIEWER",
    isPlatformAdmin: session.user.isPlatformAdmin
  };
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  if (!request.auth) return reply.code(401).send({ statusCode: 401, code: "UNAUTHENTICATED", message: "Sign in to continue." });
}

export function requireRoles(...roles: Array<Role | "PLATFORM_ADMIN">) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.auth) return reply.code(401).send({ statusCode: 401, code: "UNAUTHENTICATED", message: "Sign in to continue." });
    if (!roles.includes(request.auth.role) && !(roles.includes("PLATFORM_ADMIN") && request.auth.isPlatformAdmin)) {
      return reply.code(403).send({ statusCode: 403, code: "FORBIDDEN", message: "You do not have permission to perform this action." });
    }
  };
}
