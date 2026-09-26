"use client";

import { useId, useState } from "react";
import { Check, Copy, Link2, Share2, ShieldAlert } from "lucide-react";

export type InvitationShareDetails = {
  email: string;
  url: string;
  shareText: string;
  expiresAt?: string;
};

async function copyToClipboard(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const field = document.createElement("textarea");
  field.value = value;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.appendChild(field);
  field.select();
  const copied = document.execCommand("copy");
  field.remove();
  if (!copied) throw new Error("Clipboard access is unavailable.");
}

export function InvitationSharePanel({ invitation }: { invitation: InvitationShareDetails }) {
  const fieldId = useId();
  const [feedback, setFeedback] = useState<"" | "message" | "link" | "shared" | "error">("");

  async function copy(value: string, kind: "message" | "link") {
    try {
      await copyToClipboard(value);
      setFeedback(kind);
    } catch {
      setFeedback("error");
    }
  }

  async function share() {
    try {
      if (navigator.share) {
        await navigator.share({ title: "SmartHoneyAI invitation", text: invitation.shareText });
        setFeedback("shared");
      } else {
        await copyToClipboard(invitation.shareText);
        setFeedback("message");
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setFeedback("error");
    }
  }

  const feedbackText = feedback === "message" ? "Invitation message copied."
    : feedback === "link" ? "Invitation link copied."
      : feedback === "shared" ? "Invitation shared."
        : feedback === "error" ? "Automatic copying was blocked. Select the text and copy it manually."
          : "";

  return <section className="invitation-share" aria-label={`Share invitation with ${invitation.email}`}>
    <div className="invitation-share-heading">
      <span className="dialog-icon"><Link2 size={18}/></span>
      <div><h3>Share this invitation now</h3><p>The secure link is shown only once and cannot be recovered after you leave this result.</p></div>
    </div>
    <div className="notice warning"><ShieldAlert size={16}/><span>Anyone with this link can claim the invitation. Share it only with <strong>{invitation.email}</strong>.</span></div>
    <label className="sr-only" htmlFor={fieldId}>Invitation message</label>
    <textarea id={fieldId} className="invitation-share-text mono" readOnly value={invitation.shareText} onFocus={(event) => event.currentTarget.select()}/>
    <div className="invitation-share-actions">
      <button className="button button-primary button-sm" type="button" onClick={() => copy(invitation.shareText, "message")}><Copy size={14}/> Copy message</button>
      <button className="button button-secondary button-sm" type="button" onClick={() => copy(invitation.url, "link")}><Link2 size={14}/> Copy link</button>
      <button className="button button-secondary button-sm" type="button" onClick={share}><Share2 size={14}/> Share</button>
    </div>
    {feedbackText && <p className={`invitation-copy-feedback ${feedback === "error" ? "error" : "success"}`} role="status">{feedback === "error" ? <ShieldAlert size={14}/> : <Check size={14}/>} {feedbackText}</p>}
  </section>;
}
