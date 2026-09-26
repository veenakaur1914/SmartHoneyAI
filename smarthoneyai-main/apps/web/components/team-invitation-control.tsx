"use client";

import { useState } from "react";
import { Mail, Plus, ShieldAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/dashboard-ui";
import { InvitationSharePanel, type InvitationShareDetails } from "@/components/invitation-share-panel";

type SubmissionState = "idle" | "submitting" | "success" | "error";

export function TeamInvitationControl({ canManage }: { canManage: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<SubmissionState>("idle");
  const [message, setMessage] = useState("");
  const [share, setShare] = useState<InvitationShareDetails | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setShare(null);
    setState("submitting");
    setMessage("");
    let response: Response;
    try {
      response = await fetch("/v1/team/invitations", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: form.get("email"), role: form.get("role") })
      });
    } catch {
      setState("error");
      setMessage("The connection was lost, so the result is unknown. Submit the same address again to safely generate a replacement link.");
      return;
    }
    const body = await response.json().catch(() => ({})) as { message?: string; invitation?: InvitationShareDetails };
    if (!response.ok) {
      setState("error");
      setMessage(body.message ?? "The invitation could not be created.");
      return;
    }
    if (!body.invitation?.url || !body.invitation.shareText) {
      setState("error");
      setMessage("The invitation was created, but its one-time share link was not returned. Create a replacement invitation.");
      router.refresh();
      return;
    }
    setShare(body.invitation);
    setState("success");
    setMessage(`Invitation created for ${body.invitation.email}. Copy and share it before leaving this page.`);
    formElement.reset();
    setOpen(false);
    router.refresh();
  }

  return <>
    <PageHeader
      title="Team"
      description="Review the people and pending invitations attached to the current organization."
      actions={canManage ? <button className="button button-primary button-sm" type="button" onClick={() => { setOpen((value) => !value); setShare(null); setMessage(""); setState("idle"); }}><Plus size={15}/> Invite teammate</button> : undefined}
    />
    {message && <div className={`notice ${state === "error" ? "danger" : ""}`} role={state === "error" ? "alert" : "status"} style={{ marginBottom: 16 }}>
      {state === "error" ? <ShieldAlert size={16}/> : <Mail size={16}/>}<span>{message}</span>
    </div>}
    {share && <InvitationSharePanel key={share.url} invitation={share}/>}
    {canManage && open && <section className="panel" style={{ marginBottom: 16 }} aria-label="Invite a teammate">
      <div className="panel-body">
        <form className="form-grid" onSubmit={submit}>
          <div className="form-row">
            <div className="field"><label htmlFor="invitation-email">Email address</label><input id="invitation-email" name="email" type="email" required maxLength={254} autoComplete="email" placeholder="teammate@company.com"/></div>
            <div className="field"><label htmlFor="invitation-role">Role</label><select id="invitation-role" name="role" defaultValue="ANALYST"><option value="ADMIN">Administrator</option><option value="ANALYST">Analyst</option><option value="VIEWER">Viewer</option></select></div>
          </div>
          <p className="field-help">A one-time link and ready-to-share message will be generated. The link expires after 72 hours; replacing it revokes the previous invitation.</p>
          <div style={{ display: "flex", gap: 10 }}><button className="button button-primary" type="submit" disabled={state === "submitting"}>{state === "submitting" ? "Creating…" : "Create invitation"}</button><button className="button button-secondary" type="button" onClick={() => setOpen(false)} disabled={state === "submitting"}>Cancel</button></div>
        </form>
      </div>
    </section>}
  </>;
}
