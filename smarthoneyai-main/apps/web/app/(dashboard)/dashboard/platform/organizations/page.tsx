import type { Metadata } from "next";
import { Building2, ShieldCheck, Users, Waypoints } from "lucide-react";
import { MetricCard, PageHeader, Panel } from "@/components/dashboard-ui";
import { PlatformAccessRequestsClient, type PlatformAccessRequestRecord } from "@/components/platform-access-requests-client";
import { apiGet } from "@/lib/api";
import { PlatformOrganizationCreate } from "@/components/platform-organization-create";
import { PlatformOwnerInvitationControl } from "@/components/platform-owner-invitation-control";
import { formatMalaysiaDateTime } from "@/lib/date-time";

type PlatformOrganization = {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  memberships: Array<{
    user: {
      name: string;
      email: string;
    };
  }>;
  _count: {
    sites: number;
    memberships: number;
    events: number;
  };
};

export const metadata: Metadata = { title: "Platform organizations" };

export default async function OrganizationsPage() {
  const [organizationResult, accessRequestResult] = await Promise.all([
    apiGet<{ data: PlatformOrganization[] }>("/v1/platform/organizations"),
    apiGet<{ data: PlatformAccessRequestRecord[] }>("/v1/platform/access-requests")
  ]);
  const organizations = organizationResult.data;
  const accessRequests = accessRequestResult.data;
  const siteCount = organizations.reduce((total, organization) => total + organization._count.sites, 0);
  const membershipCount = organizations.reduce((total, organization) => total + organization._count.memberships, 0);
  const pendingRequestCount = accessRequests.filter((request) => request.status === "PENDING").length;

  return <>
    <div className="notice warning" style={{ marginBottom: 18 }}>
      <ShieldCheck size={16}/>
      <span><strong>Platform administrator view.</strong> This page contains current records from every organization.</span>
    </div>
    <PageHeader title="Organizations" description="Live tenant, ownership, membership, and access-request records." actions={<PlatformOrganizationCreate/>}/>
    <div className="metric-grid">
      <MetricCard label="Organizations" value={String(organizations.length)} note="Current tenant records" icon={Building2}/>
      <MetricCard label="Managed sites" value={String(siteCount)} note="Sites across all organizations" icon={Waypoints}/>
      <MetricCard label="Memberships" value={String(membershipCount)} note="Assigned organization roles" icon={Users}/>
      <MetricCard label="Pending requests" value={String(pendingRequestCount)} trend="flat" note="Awaiting platform review" icon={ShieldCheck}/>
    </div>
    <Panel title="Organizations" description={`${organizations.length} current ${organizations.length === 1 ? "organization" : "organizations"}`}>
      {organizations.length === 0 ? <div className="panel-body">
        <h2>No organizations yet</h2>
        <p className="muted">Approved access requests will appear here after an organization is created.</p>
      </div> : <>
        <div className="data-table-wrap">
          <table className="data-table">
            <thead><tr><th>Organization</th><th>Owner</th><th>Sites</th><th>Members</th><th>Recorded events</th><th>Created</th></tr></thead>
            <tbody>{organizations.map((organization) => {
              const owner = organization.memberships[0]?.user;
              return <tr key={organization.id}>
                <td><div className="table-primary"><span className="table-icon"><Building2 size={15}/></span><div><strong>{organization.name}</strong><span>{organization.slug}</span></div></div></td>
                <td>{owner ? <div className="table-primary"><div><strong>{owner.name}</strong><span>{owner.email}</span></div></div> : <div className="table-primary"><div><span className="muted">No owner assigned</span><PlatformOwnerInvitationControl organizationId={organization.id} organizationName={organization.name}/></div></div>}</td>
                <td>{organization._count.sites}</td>
                <td>{organization._count.memberships}</td>
                <td>{organization._count.events}</td>
                <td>{formatMalaysiaDateTime(organization.createdAt)}</td>
              </tr>;
            })}</tbody>
          </table>
        </div>
        <div className="mobile-card-list">{organizations.map((organization) => {
          const owner = organization.memberships[0]?.user;
          return <article className="mobile-data-card" key={organization.id}>
            <div className="mobile-data-top"><h3>{organization.name}</h3><span className="mono">{organization.slug}</span></div>
            <p>{owner ? `${owner.name} · ${owner.email}` : "No owner assigned"}</p>
            {!owner && <PlatformOwnerInvitationControl organizationId={organization.id} organizationName={organization.name}/>}
            <div className="mobile-data-meta"><span>{organization._count.sites} sites</span><span>{organization._count.memberships} members</span><span>{organization._count.events} events</span><span>{formatMalaysiaDateTime(organization.createdAt)}</span></div>
          </article>;
        })}</div>
      </>}
    </Panel>
    <div style={{ marginTop: 16 }}>
      <PlatformAccessRequestsClient requests={accessRequests}/>
    </div>
  </>;
}
