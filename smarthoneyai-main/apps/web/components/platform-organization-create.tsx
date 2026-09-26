"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Plus, X } from "lucide-react";
import { InvitationSharePanel, type InvitationShareDetails } from "@/components/invitation-share-panel";

export function PlatformOrganizationCreate() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [warning, setWarning] = useState(false);
  const [share, setShare] = useState<InvitationShareDetails | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage(""); setWarning(false); setShare(null);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      const response = await fetch("/v1/platform/organizations", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: form.get("name"), ownerEmail: form.get("ownerEmail") }) });
      const body = await response.json().catch(() => ({})) as { message?: string; invitation?: InvitationShareDetails; organization?: { name?: string } };
      if (!response.ok) { setWarning(true); setMessage(body.message ?? "Unable to create the organization."); return; }
      if (!body.invitation?.url || !body.invitation.shareText) { setWarning(true); setMessage(`${body.organization?.name ?? "The organization"} was created, but its one-time owner link was not returned.`); }
      else { setShare(body.invitation); setMessage(`${body.organization?.name ?? "Organization"} was created. Copy and share the owner invitation now.`); }
      formElement.reset(); router.refresh();
    } catch {
      setWarning(true);
      setMessage("The organization service could not be reached. The result is unknown. Check the Organizations list; if the tenant exists without an owner, generate a replacement owner link there.");
    } finally {
      setBusy(false);
    }
  }

  return <>
    <button className="button button-primary button-sm" type="button" onClick={() => { setOpen(true); setMessage(""); setShare(null); }}><Plus size={14}/> Create organization</button>
    {open && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setOpen(false); }}>
      <section className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="create-organization-title">
        <header className="dialog-header"><div className="dialog-icon"><Building2 size={18}/></div><div><h2 id="create-organization-title">Create organization</h2><p>Set up the tenant and generate its first owner invitation.</p></div><button className="icon-button" type="button" aria-label="Close" disabled={busy} onClick={() => setOpen(false)}><X size={17}/></button></header>
        <form className="dialog-body form-grid" onSubmit={submit}>
          <div className="field"><label htmlFor="organization-name">Organization name</label><input id="organization-name" name="name" minLength={2} maxLength={120} required autoFocus placeholder="Professional security team"/></div>
          <div className="field"><label htmlFor="organization-owner-email">Owner email</label><input id="organization-owner-email" name="ownerEmail" type="email" maxLength={254} required autoComplete="email" placeholder="owner@example.com"/><small>The invitation expires after 72 hours.</small></div>
          {message && <div className={`notice ${warning ? "warning" : ""}`} role={warning ? "alert" : "status"}>{message}</div>}
          {share && <InvitationSharePanel key={share.url} invitation={share}/>}
          <div className="dialog-actions"><button className="button button-secondary" type="button" disabled={busy} onClick={() => setOpen(false)}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? "Creating…" : "Create and generate link"}</button></div>
        </form>
      </section>
    </div>}
  </>;
}
