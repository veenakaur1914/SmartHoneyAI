import type { Metadata } from "next";
import { Building2, KeyRound, Mail, Send, ShieldAlert, ShieldCheck, UserRound } from "lucide-react";
import { PageHeader, Panel, StatusBadge } from "@/components/dashboard-ui";
import { apiGet } from "@/lib/api";
import { ProfileEmojiControl } from "@/components/profile-emoji-control";
import { formatMalaysiaDateTime } from "@/lib/date-time";
import { TelegramAlertControl, type TelegramAlertStatus } from "@/components/telegram-alert-control";

type AuthResponse = {
  user: {
    id: string;
    name: string;
    email: string;
    avatarEmoji: string;
    isPlatformAdmin: boolean;
    memberships: Array<{
      id: string;
      role: string;
      createdAt: string;
      organization: { id: string; name: string; slug: string };
    }>;
  };
};

type Session = {
  id: string;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  current: boolean;
};

type SessionsResponse = { data: Session[] };

export const metadata: Metadata = { title: "Settings" };

function roleLabel(role: string) {
  return role.toLowerCase().replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

function describeUserAgent(userAgent: string | null) {
  if (!userAgent) return "Device details unavailable";
  const browser = userAgent.includes("Edg/") ? "Microsoft Edge"
    : userAgent.includes("Firefox/") ? "Firefox"
    : userAgent.includes("Chrome/") || userAgent.includes("CriOS/") ? "Chrome"
    : userAgent.includes("Safari/") ? "Safari"
    : "Browser";
  const platform = userAgent.includes("Windows") ? "Windows"
    : userAgent.includes("Android") ? "Android"
    : /iPhone|iPad/.test(userAgent) ? "iOS"
    : userAgent.includes("Mac OS X") ? "macOS"
    : userAgent.includes("Linux") ? "Linux"
    : "unreported device";
  return `${browser} on ${platform}`;
}

export default async function SettingsPage() {
  const [authResult, sessionsResult, telegramResult] = await Promise.allSettled([
    apiGet<AuthResponse>("/v1/auth/me"),
    apiGet<SessionsResponse>("/v1/auth/sessions"),
    apiGet<TelegramAlertStatus>("/v1/alerts/telegram")
  ]);

  if (authResult.status === "rejected") {
    const detail = authResult.reason instanceof Error ? authResult.reason.message : "The account service could not be reached.";
    return <>
      <PageHeader title="Settings" description="Review your account, workspace access, and active sessions."/>
      <div className="notice danger" role="alert"><ShieldAlert size={16}/><span>Account details are currently unavailable. {detail}</span></div>
    </>;
  }

  const user = authResult.value.user;
  const sessions = sessionsResult.status === "fulfilled" ? sessionsResult.value.data : [];
  const sessionsError = sessionsResult.status === "rejected"
    ? sessionsResult.reason instanceof Error ? sessionsResult.reason.message : "The session service could not be reached."
    : "";
  const telegramStatus = telegramResult.status === "fulfilled" ? telegramResult.value : { configured:false, enabled:false, chatIdSuffix:null, providerAvailable:false, canManage:false };

  return <>
    <PageHeader title="Settings" description="Review your account, workspace access, and active sessions."/>

    {sessionsError && <div className="notice warning" role="alert" style={{ marginBottom:16 }}><ShieldAlert size={16}/><span>Active sessions are currently unavailable. {sessionsError}</span></div>}

    <div className="split-layout">
      <div style={{ display:"grid", gap:16, alignContent:"start" }}>
        <Panel title="Account profile" description="Identity and profile appearance">
          <div className="panel-body form-grid">
            <div style={{ display:"flex", alignItems:"center", gap:12 }}>
              <span className="user-avatar emoji-avatar" style={{ width:42, height:42, fontSize:22 }}>{user.avatarEmoji}</span>
              <div><strong>{user.name}</strong><div className="muted" style={{ fontSize:11 }}>{user.isPlatformAdmin ? "Platform administrator" : "SmartHoneyAI account"}</div></div>
            </div>
            <ProfileEmojiControl current={user.avatarEmoji}/>
          </div>
          <div className="rule-row"><span className="table-icon"><UserRound size={15}/></span><div><h3>Name</h3><p>{user.name}</p></div></div>
          <div className="rule-row"><span className="table-icon"><Mail size={15}/></span><div><h3>Email</h3><p>{user.email}</p></div></div>
          {user.isPlatformAdmin && <div className="rule-row"><span className="table-icon"><ShieldCheck size={15}/></span><div><h3>Platform access</h3><p>This account has platform-administrator access.</p></div><StatusBadge label="Platform admin"/></div>}
        </Panel>

        <Panel
          title="Workspace access"
          description={`${user.memberships.length} organization ${user.memberships.length === 1 ? "membership" : "memberships"}`}
        >
          {user.memberships.length === 0 ? <div className="panel-body">
            <div className="notice"><Building2 size={16}/><span>{user.isPlatformAdmin ? "This platform administrator is not assigned to an organization." : "No organization membership is associated with this account."}</span></div>
          </div> : user.memberships.map((membership) => <div className="rule-row" key={membership.id}>
            <span className="table-icon"><Building2 size={15}/></span>
            <div><h3>{membership.organization.name}</h3><p>Workspace identifier: {membership.organization.slug}</p></div>
            <StatusBadge label={roleLabel(membership.role)}/>
          </div>)}
        </Panel>
      </div>

      <div style={{ display:"grid", gap:16, alignContent:"start" }}>
        <Panel title="Telegram alerts" description="Immediate notifications for blocked access and high-risk honeypot attacks">
          <TelegramAlertControl initialStatus={telegramStatus}/>
          <div className="rule-row"><span className="table-icon"><Send size={15}/></span><div><h3>Notification content</h3><p>Blocked-request evidence or classified attack type, severity, site, masked source alias, and a review link. Raw IP addresses are not sent.</p></div></div>
        </Panel>

        <Panel
          title="Active sessions"
          description={sessionsError ? "Session data unavailable" : `${sessions.length} unexpired ${sessions.length === 1 ? "session" : "sessions"}`}
        >
          {!sessionsError && sessions.length === 0 ? <div className="panel-body">
            <div className="notice"><KeyRound size={16}/><span>No unexpired sessions were returned for this account.</span></div>
          </div> : sessions.map((session) => <div className="rule-row" key={session.id}>
            <span className="table-icon"><KeyRound size={15}/></span>
            <div title={session.userAgent ?? undefined}>
              <h3>{describeUserAgent(session.userAgent)}</h3>
              <p>Started {formatMalaysiaDateTime(session.createdAt)}</p>
              <p>Last active {formatMalaysiaDateTime(session.lastSeenAt)} · expires {formatMalaysiaDateTime(session.expiresAt)}</p>
            </div>
            <StatusBadge label={session.current ? "Current" : "Active"}/>
          </div>)}
        </Panel>
      </div>
    </div>
  </>;
}
