type InvitationShareInput = {
  appUrl: string;
  token: string;
  organizationName: string;
  email: string;
  role: string;
  expiresAt: Date;
};

function safeDisplayText(value: string, maxLength: number) {
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/\b(?:(?:https?|ftp):\/\/|www\.)[^\s]+/gi, "[link removed]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function roleLabel(role: string) {
  return role.toLowerCase().replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

export function buildInvitationShare(input: InvitationShareInput) {
  const url = new URL("/accept-invitation", `${input.appUrl}/`);
  url.hash = input.token;
  const invitationUrl = url.toString();
  const organizationName = safeDisplayText(input.organizationName, 120) || "SmartHoneyAI workspace";
  const email = safeDisplayText(input.email, 254);
  const shareText = [
    "SmartHoneyAI invitation",
    `Recipient: ${email}`,
    `Organization: ${organizationName}`,
    `Role: ${roleLabel(input.role)}`,
    `Accept the invitation: ${invitationUrl}`,
    `This single-use link expires at ${input.expiresAt.toISOString()} and should only be shared with ${email}.`
  ].join("\n\n");

  return { url: invitationUrl, shareText };
}
