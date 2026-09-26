"use client";

import { useState } from "react";
import { KeyRound, X } from "lucide-react";
import { InvitationSharePanel, type InvitationShareDetails } from "@/components/invitation-share-panel";

export function PlatformOwnerInvitationControl({ organizationId, organizationName }: { organizationId: string; organizationName: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [share, setShare] = useState<InvitationShareDetails | null>(null);

  async function replaceInvitation() {
    if (!window.confirm(`Generate a new owner link for ${organizationName}? Any previous owner invitation link will stop working.`)) return;
    setBusy(true); setError(""); setShare(null);
    try {
      const response = await fetch(`/v1/platform/organizations/${organizationId}/owner-invitation`, { method: "POST", credentials: "include" });
      const body = await response.json().catch(() => ({})) as { message?: string; invitation?: InvitationShareDetails };
      if (!response.ok) throw new Error(body.message ?? "The owner invitation could not be generated.");
      if (!body.invitation?.url || !body.invitation.shareText) throw new Error("The invitation was replaced, but its one-time link was not returned. Generate another replacement link.");
      setShare(body.invitation);
    } catch (reason) {
      setError(reason instanceof TypeError ? "The result is unknown because the service could not be reached. You can safely use this action again to replace any link that may have been created." : reason instanceof Error ? reason.message : "The owner invitation could not be generated.");
    } finally {
      setBusy(false);
    }
  }

  return <>
    <button className="button button-secondary button-sm" type="button" disabled={busy} onClick={replaceInvitation}><KeyRound size={13}/>{busy ? "Generating…" : "Generate owner link"}</button>
    {error && <span className="table-subtext danger-text" role="alert">{error}</span>}
    {share && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShare(null); }}>
      <section className="dialog-card" role="dialog" aria-modal="true" aria-label={`Owner invitation for ${organizationName}`}>
        <header className="dialog-header"><div className="dialog-icon"><KeyRound size={18}/></div><div><h2>Owner invitation generated</h2><p>{organizationName}</p></div><button className="icon-button" type="button" aria-label="Close" onClick={() => setShare(null)}><X size={17}/></button></header>
        <div className="dialog-body"><InvitationSharePanel key={share.url} invitation={share}/></div>
      </section>
    </div>}
  </>;
}
