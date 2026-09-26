"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const choices = ["🛡️", "🐝", "🧑‍💻", "👩‍💻", "👨‍💻", "🔐", "🕵️", "🤖"];

export function ProfileEmojiControl({ current }: { current: string }) {
  const router = useRouter();
  const [selected, setSelected] = useState(current);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function save() {
    setBusy(true); setMessage("");
    const response = await fetch("/v1/auth/profile", { method: "PATCH", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ avatarEmoji: selected }) });
    const body = await response.json().catch(() => ({})) as { message?: string };
    setBusy(false);
    if (!response.ok) { setMessage(body.message ?? "Unable to update your profile emoji."); return; }
    setMessage("Profile emoji updated.");
    router.refresh();
  }

  return <div className="profile-emoji-control">
    <div className="emoji-picker" role="radiogroup" aria-label="Profile emoji">
      {choices.map((emoji) => <button key={emoji} type="button" role="radio" aria-checked={selected === emoji} className={selected === emoji ? "selected" : ""} onClick={() => setSelected(emoji)}>{emoji}</button>)}
    </div>
    <div className="inline-actions"><button className="button button-primary button-sm" type="button" disabled={busy || selected === current} onClick={save}>{busy ? "Saving…" : "Save profile emoji"}</button>{message && <span className="muted" role="status">{message}</span>}</div>
  </div>;
}
