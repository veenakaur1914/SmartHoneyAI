import nodemailer from "nodemailer";
import { env } from "./env.js";

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

const mailClient = env.SMTP_HOST ? nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_PORT === 465,
  requireTLS: env.SMTP_PORT !== 465,
  auth: env.SMTP_USER && env.SMTP_PASSWORD ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
  tls: { minVersion: "TLSv1.2", rejectUnauthorized: true },
  disableFileAccess: true,
  disableUrlAccess: true
}) : null;

export async function verifyActionEmailTransport() {
  if (!mailClient) return false;
  await mailClient.verify();
  return true;
}

export async function sendActionEmail(to: string, subject: string, heading: string, actionUrl: string, actionLabel: string) {
  if (!mailClient) return false;
  const safeHeading = escapeHtml(heading);
  const safeActionUrl = escapeHtml(actionUrl);
  const safeActionLabel = escapeHtml(actionLabel);
  await mailClient.sendMail({
    from: env.SMTP_FROM,
    to,
    subject,
    text: `${heading}\n\n${actionLabel}: ${actionUrl}\n\nThis link expires automatically.`,
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:32px;background:#07111f;color:#f4f7fb;border-radius:12px"><h1 style="font-size:24px">${safeHeading}</h1><p style="color:#9baabd">Use the secure link below. It expires automatically.</p><p><a href="${safeActionUrl}" style="display:inline-block;background:#f5b942;color:#07111f;padding:12px 18px;border-radius:8px;font-weight:700;text-decoration:none">${safeActionLabel}</a></p></div>`,
    disableFileAccess: true,
    disableUrlAccess: true
  });
  return true;
}
