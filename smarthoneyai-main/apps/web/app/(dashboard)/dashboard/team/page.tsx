import type { Metadata } from "next";
import { Clock3, Mail, ShieldAlert, Users } from "lucide-react";
import { PageHeader, Panel, StatusBadge } from "@/components/dashboard-ui";
import { TeamInvitationControl } from "@/components/team-invitation-control";
import { apiGet } from "@/lib/api";
import { formatMalaysiaDateTime } from "@/lib/date-time";

type TeamMember = {
  id: string;
  role: string;
  createdAt: string;
  user: {
    id: string;
    name: string;
    email: string;
    lastLoginAt: string | null;
  };
};

type TeamInvitation = {
  id: string;
  email: string;
  role: string;
  createdAt: string;
  expiresAt: string;
};

type TeamResponse = {
  data: TeamMember[];
  invitations: TeamInvitation[];
  canManage: boolean;
};

export const metadata: Metadata = { title: "Team" };

function roleLabel(role: string) {
  return role.toLowerCase().replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

function initials(name: string, email: string) {
  const source = name.trim() || email.split("@")[0] || "Member";
  return source.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

export default async function TeamPage() {
  let team: TeamResponse | null = null;
  let errorMessage = "The team service could not be reached.";

  try {
    team = await apiGet<TeamResponse>("/v1/team");
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : "The team service could not be reached.";
  }

  if (!team) return <>
    <PageHeader title="Team" description="Review the people and pending invitations attached to the current organization."/>
    <section className="panel" aria-labelledby="team-unavailable-title">
      <div className="panel-body">
        <div className="notice danger" role="alert"><ShieldAlert size={16}/><span><strong id="team-unavailable-title">Team data is unavailable.</strong> {errorMessage}</span></div>
        <p className="muted" style={{ marginBottom:0 }}>Member and invitation totals are hidden until the live organization data can be loaded.</p>
      </div>
    </section>
  </>;

  const members = team.data;
  const invitations = team.invitations;

  return <>
    <TeamInvitationControl canManage={team.canManage}/>

    <div style={{ display:"grid", gap:16 }}>
    <Panel
      title="Organization members"
      description={`${members.length} ${members.length === 1 ? "member" : "members"}`}
    >
      {members.length === 0 ? <div className="panel-body">
        <div className="notice"><Users size={16}/><span>No members are available for the current organization.</span></div>
      </div> : <>
        <div className="data-table-wrap">
          <table className="data-table">
            <thead><tr><th>Member</th><th>Role</th><th>Joined</th><th>Last sign-in</th></tr></thead>
            <tbody>{members.map((member) => <tr key={member.id}>
              <td><div className="table-primary"><span className="user-avatar">{initials(member.user.name, member.user.email)}</span><div><strong>{member.user.name}</strong><span>{member.user.email}</span></div></div></td>
              <td><StatusBadge label={roleLabel(member.role)}/></td>
              <td><time dateTime={member.createdAt}>{formatMalaysiaDateTime(member.createdAt)}</time></td>
              <td>{member.user.lastLoginAt ? <time dateTime={member.user.lastLoginAt}>{formatMalaysiaDateTime(member.user.lastLoginAt)}</time> : "Never signed in"}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <div className="mobile-card-list">{members.map((member) => <article className="mobile-data-card" key={member.id}>
          <div className="mobile-data-top"><div className="table-primary"><span className="user-avatar">{initials(member.user.name, member.user.email)}</span><h3>{member.user.name}</h3></div><StatusBadge label={roleLabel(member.role)}/></div>
          <p>{member.user.email}</p>
          <div className="mobile-data-meta"><span>Joined {formatMalaysiaDateTime(member.createdAt)}</span><span>{member.user.lastLoginAt ? `Last sign-in ${formatMalaysiaDateTime(member.user.lastLoginAt)}` : "Never signed in"}</span></div>
        </article>)}</div>
      </>}
    </Panel>

    <Panel
      title="Pending invitations"
      description={`${invitations.length} ${invitations.length === 1 ? "invitation" : "invitations"} awaiting acceptance`}
    >
      {invitations.length === 0 ? <div className="panel-body">
        <div className="notice"><Mail size={16}/><span>There are no unexpired pending invitations for this organization.</span></div>
      </div> : <>
        <div className="data-table-wrap">
          <table className="data-table">
            <thead><tr><th>Email</th><th>Role</th><th>Created</th><th>Expires</th><th>Status</th></tr></thead>
            <tbody>{invitations.map((invitation) => <tr key={invitation.id}>
              <td><strong>{invitation.email}</strong></td>
              <td>{roleLabel(invitation.role)}</td>
              <td><time dateTime={invitation.createdAt}>{formatMalaysiaDateTime(invitation.createdAt)}</time></td>
              <td><time dateTime={invitation.expiresAt}>{formatMalaysiaDateTime(invitation.expiresAt)}</time></td>
              <td><StatusBadge label="Pending"/></td>
            </tr>)}</tbody>
          </table>
        </div>
        <div className="mobile-card-list">{invitations.map((invitation) => <article className="mobile-data-card" key={invitation.id}>
          <div className="mobile-data-top"><div className="table-primary"><span className="table-icon"><Mail size={15}/></span><h3>{invitation.email}</h3></div><StatusBadge label="Pending"/></div>
          <p>{roleLabel(invitation.role)}</p>
          <div className="mobile-data-meta"><span>Created {formatMalaysiaDateTime(invitation.createdAt)}</span><span><Clock3 size={12}/> Expires {formatMalaysiaDateTime(invitation.expiresAt)}</span></div>
        </article>)}</div>
      </>}
    </Panel>
    </div>
  </>;
}
