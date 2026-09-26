"use client";

import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { Panel, StatusBadge } from "@/components/dashboard-ui";
import { InvitationSharePanel, type InvitationShareDetails } from "@/components/invitation-share-panel";
import { formatMalaysiaDateTime } from "@/lib/date-time";

export type PlatformAccessRequestRecord = {
  id: string;
  name: string;
  email: string;
  company: string;
  websiteCount: number;
  message: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
  reviewedAt: string | null;
  createdAt: string;
};

export function PlatformAccessRequestsClient({ requests }: { requests: PlatformAccessRequestRecord[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [tone, setTone] = useState<"success" | "warning" | "danger">("success");
  const [share, setShare] = useState<InvitationShareDetails | null>(null);
  const pendingCount = requests.filter((request) => request.status === "PENDING").length;

  async function approve(id: string) {
    setBusy(id); setMessage(""); setShare(null);
    let response: Response;
    try {
      response = await fetch(`/v1/platform/access-requests/${id}/approve`, { method: "POST", credentials: "include" });
    } catch {
      setBusy(null); setTone("danger"); setMessage("The connection was lost, so the approval result is unknown. Refresh Organizations; if the tenant exists without an owner, generate a replacement owner link there."); return;
    }
    const body = await response.json().catch(() => ({})) as { message?: string; invitation?: InvitationShareDetails };
    setBusy(null);
    if (!response.ok) { setTone("danger"); setMessage(body.message ?? "The access request could not be approved."); return; }
    if (!body.invitation?.url || !body.invitation.shareText) { setTone("warning"); setMessage("The organization was created, but its one-time owner link was not returned. Generate a replacement owner link from Organizations before handing over access."); }
    else { setShare(body.invitation); setTone("success"); setMessage("The organization was created. Copy and share the owner invitation before leaving this page."); }
    router.refresh();
  }

  async function reject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!rejectingId) return;
    const form = new FormData(event.currentTarget);
    setBusy(rejectingId); setMessage(""); setShare(null);
    let response: Response;
    try {
      response = await fetch(`/v1/platform/access-requests/${rejectingId}/reject`, {
        method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason: form.get("reason") })
      });
    } catch {
      setBusy(null); setTone("danger"); setMessage("The platform review service could not be reached. No rejection was confirmed."); return;
    }
    const body = await response.json().catch(() => ({})) as { message?: string };
    setBusy(null);
    if (!response.ok) { setTone("danger"); setMessage(body.message ?? "The access request could not be rejected."); return; }
    setTone("success"); setMessage("The access request was rejected and recorded in the audit log."); setRejectingId(null); router.refresh();
  }

  const actions = (request: PlatformAccessRequestRecord) => request.status === "PENDING" ? <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
    <button className="button button-primary button-sm" type="button" disabled={busy === request.id} onClick={() => approve(request.id)}>{busy === request.id ? "Working…" : "Approve"}</button>
    <button className="button button-secondary button-sm" type="button" disabled={busy === request.id} onClick={() => { setRejectingId(request.id); setShare(null); setMessage(""); }}>Reject</button>
  </div> : <span className="muted">Reviewed</span>;

  return <Panel title="Access requests" description={`${pendingCount} pending · ${requests.length} total`}>
    {message && <div className={`notice ${tone === "danger" ? "danger" : tone === "warning" ? "warning" : ""}`} role={tone === "danger" ? "alert" : "status"} style={{ margin: 16 }}><ShieldAlert size={16}/><span>{message}</span></div>}
    {share && <div style={{ margin: 16 }}><InvitationSharePanel key={share.url} invitation={share}/></div>}
    {rejectingId && <div className="panel-body" style={{ borderBottom: "1px solid var(--border)" }}><form className="form-grid" onSubmit={reject}>
      <div className="field"><label htmlFor="access-rejection-reason">Rejection reason</label><textarea id="access-rejection-reason" name="reason" required minLength={3} maxLength={500} placeholder="Explain why this request is outside the approved production scope."/></div>
      <div style={{ display: "flex", gap: 10 }}><button className="button button-primary" disabled={busy === rejectingId}>{busy === rejectingId ? "Rejecting…" : "Confirm rejection"}</button><button className="button button-secondary" type="button" onClick={() => setRejectingId(null)} disabled={busy === rejectingId}>Cancel</button></div>
    </form></div>}
    {requests.length === 0 ? <div className="panel-body"><h2>No access requests</h2><p className="muted">New requests submitted through the public access form will appear here.</p></div> : <>
      <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Requester</th><th>Company</th><th>Sites requested</th><th>Status</th><th>Requested</th><th>Reviewed</th><th>Action</th></tr></thead><tbody>{requests.map((request) => <tr key={request.id}>
        <td><div className="table-primary"><div><strong>{request.name}</strong><span>{request.email}</span></div></div></td><td>{request.company}</td><td>{request.websiteCount}</td><td><StatusBadge label={request.status}/></td><td>{formatMalaysiaDateTime(request.createdAt)}</td><td>{formatMalaysiaDateTime(request.reviewedAt, "Not reviewed")}</td><td>{actions(request)}</td>
      </tr>)}</tbody></table></div>
      <div className="mobile-card-list">{requests.map((request) => <article className="mobile-data-card" key={request.id}><div className="mobile-data-top"><h3>{request.company}</h3><StatusBadge label={request.status}/></div><p>{request.name} · {request.email}</p><div className="mobile-data-meta"><span>{request.websiteCount} sites</span><span>Requested {formatMalaysiaDateTime(request.createdAt)}</span><span>{request.reviewedAt ? `Reviewed ${formatMalaysiaDateTime(request.reviewedAt)}` : "Not reviewed"}</span></div><div style={{ marginTop: 12 }}>{actions(request)}</div></article>)}</div>
    </>}
  </Panel>;
}
