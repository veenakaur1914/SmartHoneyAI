import { z } from "zod";

const OneTimeTokenSchema = z.string()
  .min(40, "A valid one-time token is required.")
  .max(128, "A valid one-time token is required.")
  .regex(/^[A-Za-z0-9_-]+$/, "A valid one-time token is required.");

const PasswordSchema = z.string()
  .min(15, "Use a password between 15 and 128 characters.")
  .max(128, "Use a password between 15 and 128 characters.");

export const ForgotPasswordSchema = z.object({
  email: z.string().trim().email("Enter a valid email address.").max(254).transform((value) => value.toLowerCase())
}).strict();

export const ResetPasswordSchema = z.object({
  token: OneTimeTokenSchema,
  password: PasswordSchema
}).strict();

export const AcceptInvitationSchema = z.object({
  token: OneTimeTokenSchema,
  name: z.string().trim().min(2, "Enter a valid name.").max(120, "Enter a valid name."),
  password: PasswordSchema
}).strict();

export const TeamInvitationSchema = z.object({
  email: z.string().trim().email("Enter a valid email address.").max(254).transform((value) => value.toLowerCase()),
  role: z.enum(["ADMIN", "ANALYST", "VIEWER"])
}).strict();

export const AccessRequestRejectionSchema = z.object({
  reason: z.string().trim().min(3, "Enter a reason for rejecting this request.").max(500, "The rejection reason is too long.")
}).strict();
