#!/usr/bin/env node

import { assertSyntheticTarget } from "./synthetic-target-guard.mjs";

const baseUrl = (process.env.BASE_URL ?? "http://127.0.0.1:14000").replace(/\/$/, "");
const adminEmail = process.env.ADMIN_EMAIL ?? "admin@smarthoneyai.local";
const adminPassword = process.env.ADMIN_PASSWORD;
if (!adminPassword) throw new Error("ADMIN_PASSWORD is required.");
assertSyntheticTarget(baseUrl, { label: "Production-core authentication smoke test" });

async function call(path, { cookie, organizationId, ...options } = {}) {
  const headers = new Headers(options.headers);
  headers.set("origin", baseUrl);
  if (cookie) headers.set("cookie", cookie);
  if (organizationId) headers.set("x-organization-id", organizationId);
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers });
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { response, body, text };
}

async function expect(path, status, options) {
  const result = await call(path, options);
  if (result.response.status !== status) throw new Error(`${options?.method ?? "GET"} ${path}: expected ${status}, received ${result.response.status}: ${result.text.slice(0, 300)}`);
  return result;
}

async function login(email, password) {
  const result = await expect("/v1/auth/login", 200, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
  const cookie = result.response.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error(`Login for ${email} did not return a session cookie.`);
  const me = await expect("/v1/auth/me", 200, { cookie });
  return { cookie, user: me.body.user };
}

function tokenFromManualInvitation(result, expectedEmail) {
  const invitation = result.body?.invitation;
  if (result.body && ("invitationToken" in result.body || "mailSent" in result.body)) throw new Error("Invitation response exposed a removed legacy delivery field.");
  if (!invitation?.url || !invitation?.shareText) throw new Error("Invitation response did not include a manual share URL and message.");
  if ("token" in invitation || "tokenHash" in invitation) throw new Error("Invitation response exposed token material outside the fragment URL.");
  const url = new URL(invitation.url);
  if (url.origin !== new URL(baseUrl).origin || url.pathname !== "/accept-invitation" || url.search) throw new Error("Invitation URL is not scoped to the expected application origin and fragment route.");
  const token = url.hash.slice(1);
  if (token.length < 40 || !/^[A-Za-z0-9_-]+$/.test(token)) throw new Error("Invitation URL did not contain a valid one-time fragment token.");
  if (invitation.email !== expectedEmail || !invitation.shareText.includes(invitation.url) || !invitation.shareText.includes(expectedEmail)) throw new Error("Invitation share text is incomplete or addressed to the wrong recipient.");
  if (!result.response.headers.get("cache-control")?.split(",").map((value) => value.trim().toLowerCase()).includes("no-store")) throw new Error("Invitation response must prevent caching of the one-time link.");
  return token;
}

const suffix = Date.now().toString(36);
const admin = await login(adminEmail, adminPassword);
const adminOrganizationId = admin.user.memberships[0]?.organizationId;
if (!adminOrganizationId || admin.user.isPlatformAdmin !== true) throw new Error("Bootstrap administrator is missing its platform role or organization membership.");

const replacementOwnerEmail = `replacement-owner-${suffix}@example.test`;
const replacementOwnerPassword = `Replacement-${suffix}-Passphrase!9`;
const directProvision = await expect("/v1/platform/organizations", 201, { method: "POST", cookie: admin.cookie, organizationId: adminOrganizationId, headers: { "content-type": "application/json" }, body: JSON.stringify({ name: `Replacement Link Company ${suffix}`, ownerEmail: replacementOwnerEmail }) });
const originalOwnerToken = tokenFromManualInvitation(directProvision, replacementOwnerEmail);
const replacementInvitation = await expect(`/v1/platform/organizations/${directProvision.body.organization.id}/owner-invitation`, 201, { method: "POST", cookie: admin.cookie, organizationId: adminOrganizationId });
const replacementOwnerToken = tokenFromManualInvitation(replacementInvitation, replacementOwnerEmail);
if (replacementOwnerToken === originalOwnerToken) throw new Error("Replacing an owner invitation did not issue new token material.");
await expect("/v1/invitations/accept", 400, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: originalOwnerToken, name: "Replacement Owner", password: replacementOwnerPassword }) });
await expect("/v1/invitations/accept", 200, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: replacementOwnerToken, name: "Replacement Owner", password: replacementOwnerPassword }) });

const rejectedEmail = `rejected-${suffix}@example.test`;
const rejected = await expect("/v1/access-requests", 201, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Rejected Request", email: rejectedEmail, company: "Rejected Request Company", websiteCount: 2, message: "Authorized isolated workflow test.", consent: true }) });
await expect(`/v1/platform/access-requests/${rejected.body.id}/reject`, 200, { method: "POST", cookie: admin.cookie, organizationId: adminOrganizationId, headers: { "content-type": "application/json" }, body: JSON.stringify({ reason: "Rejected by the isolated production-core smoke test." }) });
const requestsAfterReject = await expect("/v1/platform/access-requests", 200, { cookie: admin.cookie, organizationId: adminOrganizationId });
if (requestsAfterReject.body.data.find((item) => item.id === rejected.body.id)?.status !== "REJECTED") throw new Error("Rejected access request did not persist its status.");

const ownerEmail = `owner-${suffix}@example.test`;
const ownerPassword = `Owner-${suffix}-Passphrase!9`;
const approved = await expect("/v1/access-requests", 201, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Approved Owner", email: ownerEmail, company: `Approved Company ${suffix}`, websiteCount: 1, message: "Authorized isolated workflow test.", consent: true }) });
const approval = await expect(`/v1/platform/access-requests/${approved.body.id}/approve`, 201, { method: "POST", cookie: admin.cookie, organizationId: adminOrganizationId });
const ownerInvitationToken = tokenFromManualInvitation(approval, ownerEmail);
await expect("/v1/invitations/accept", 200, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: ownerInvitationToken, name: "Approved Owner", password: ownerPassword }) });
const owner = await login(ownerEmail, ownerPassword);
const ownerOrganizationId = owner.user.memberships.find((membership) => membership.organizationId === approval.body.organization.id)?.organizationId;
if (!ownerOrganizationId) throw new Error("Approved owner did not receive membership in the new organization.");

const viewerEmail = `viewer-${suffix}@example.test`;
const viewerPassword = `Viewer-${suffix}-Passphrase!9`;
const invitation = await expect("/v1/team/invitations", 201, { method: "POST", cookie: owner.cookie, organizationId: ownerOrganizationId, headers: { "content-type": "application/json" }, body: JSON.stringify({ email: viewerEmail, role: "VIEWER" }) });
const viewerInvitationToken = tokenFromManualInvitation(invitation, viewerEmail);
await expect("/v1/invitations/accept", 200, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: viewerInvitationToken, name: "Authorized Viewer", password: viewerPassword }) });
await expect("/v1/invitations/accept", 400, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: viewerInvitationToken, name: "Authorized Viewer", password: viewerPassword }) });
const viewer = await login(viewerEmail, viewerPassword);
await expect("/v1/team/invitations", 403, { method: "POST", cookie: viewer.cookie, organizationId: ownerOrganizationId, headers: { "content-type": "application/json" }, body: JSON.stringify({ email: `denied-${suffix}@example.test`, role: "VIEWER" }) });
const pendingEmail = `pending-${suffix}@example.test`;
const pendingInvitation = await expect("/v1/team/invitations", 201, { method: "POST", cookie: owner.cookie, organizationId: ownerOrganizationId, headers: { "content-type": "application/json" }, body: JSON.stringify({ email: pendingEmail, role: "ANALYST" }) });
tokenFromManualInvitation(pendingInvitation, pendingEmail);
const team = await expect("/v1/team", 200, { cookie: owner.cookie, organizationId: ownerOrganizationId });
if (!team.body.data.some((membership) => membership.user.email === viewerEmail) || team.body.canManage !== true) throw new Error("Accepted viewer or owner management capability is missing from the live team response.");
const pendingReadback = team.body.invitations.find((item) => item.email === pendingEmail);
if (!pendingReadback || "url" in pendingReadback || "shareText" in pendingReadback || "token" in pendingReadback || "tokenHash" in pendingReadback) throw new Error("Pending invitation readback is missing or exposed one-time share material.");

await expect("/v1/auth/logout", 204, { method: "POST", cookie: viewer.cookie, organizationId: ownerOrganizationId });
await expect("/v1/auth/me", 401, { cookie: viewer.cookie });

console.log(JSON.stringify({ ok: true, checks: { directOrganizationProvision: true, replaceLostOwnerInvitation: true, revokedOwnerLinkRejected: true, rejectAccessRequest: true, approveAccessRequest: true, acceptOwnerInvitation: true, inviteViewer: true, acceptViewerInvitation: true, invitationSingleUse: true, viewerAuthorizationDenied: true, pendingInvitationSecretBoundary: true, teamReadback: true, logoutRevokesSession: true, loggedOutMeUnauthorized: true } }, null, 2));
