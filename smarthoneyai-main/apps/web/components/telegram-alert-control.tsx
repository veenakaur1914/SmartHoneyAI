"use client";

import { useState } from "react";
import { CheckCircle2, Copy, LoaderCircle, Send, ShieldAlert } from "lucide-react";
import { StatusBadge } from "./dashboard-ui";

export type TelegramAlertStatus = {
  configured: boolean;
  enabled: boolean;
  chatIdSuffix: string | null;
  chatTitle?: string | null;
  providerAvailable: boolean;
  canManage: boolean;
};

async function apiAction(path: string, method: "POST" | "PATCH", body?: unknown) {
  const response = await fetch(path, { method, credentials: "include", headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const payload = await response.json().catch(() => ({})) as { message?: string };
  if (!response.ok) throw new Error(payload.message ?? "Telegram settings could not be updated.");
  return payload;
}

export function TelegramAlertControl({ initialStatus }: { initialStatus: TelegramAlertStatus }) {
  const [status, setStatus] = useState(initialStatus);
  const [command, setCommand] = useState("");
  const [botUsername, setBotUsername] = useState("");
  const [busy, setBusy] = useState<"setup" | "verify" | "toggle" | "test" | "">("");
  const [message, setMessage] = useState("");
  const [tone, setTone] = useState<"success" | "warning" | "danger">("warning");

  async function generateCode() {
    setBusy("setup"); setMessage("");
    try {
      const result = await apiAction("/v1/alerts/telegram/setup", "POST") as { command: string; botUsername: string | null };
      setCommand(result.command); setBotUsername(result.botUsername ?? ""); setTone("success"); setMessage("Connection code generated. It expires in 10 minutes.");
    } catch (error) { setTone("danger"); setMessage(error instanceof Error ? error.message : "Could not generate a connection code."); }
    finally { setBusy(""); }
  }

  async function verify() {
    setBusy("verify"); setMessage("");
    try {
      const result = await apiAction("/v1/alerts/telegram/connect", "POST") as TelegramAlertStatus;
      setStatus(result); setCommand(""); setTone("success"); setMessage("Telegram connected. A confirmation message was sent to the selected chat.");
    } catch (error) { setTone("danger"); setMessage(error instanceof Error ? error.message : "Telegram verification failed."); }
    finally { setBusy(""); }
  }

  async function toggle() {
    setBusy("toggle"); setMessage("");
    try {
      const result = await apiAction("/v1/alerts/telegram", "PATCH", { enabled: !status.enabled }) as TelegramAlertStatus;
      setStatus((current) => ({ ...current, ...result })); setTone("success"); setMessage(result.enabled ? "Security alerts resumed." : "Security alerts paused.");
    } catch (error) { setTone("danger"); setMessage(error instanceof Error ? error.message : "Notification status could not be changed."); }
    finally { setBusy(""); }
  }

  async function sendTest() {
    setBusy("test"); setMessage("");
    try {
      const result = await apiAction("/v1/alerts/telegram/test", "POST", { scenario: "MANUAL" }) as { status: string };
      if (result.status !== "SENT") throw new Error("Telegram did not confirm the test delivery.");
      setTone("success"); setMessage("Test notification sent. Check the connected Telegram chat now.");
    } catch (error) { setTone("danger"); setMessage(error instanceof Error ? error.message : "Test notification could not be sent."); }
    finally { setBusy(""); }
  }

  async function copyCommand() {
    await navigator.clipboard.writeText(command);
    setTone("success"); setMessage("Connection command copied.");
  }

  if (!status.providerAvailable) return <div className="panel-body"><div className="notice warning"><ShieldAlert size={16}/><span>The Telegram provider is unavailable. Configure the bot token on the server first.</span></div></div>;

  return <div className="panel-body form-grid">
    <div className="check-row" style={{ alignItems:"center" }}>
      <span><strong>Security alerts</strong><small style={{ display:"block" }}>{status.configured ? `${status.chatTitle ?? "Connected Telegram chat"} · ID ending ${status.chatIdSuffix ?? "••••"}` : "No Telegram chat connected"}</small></span>
      <StatusBadge label={status.configured ? status.enabled ? "Active" : "Paused" : "Not connected"}/>
    </div>

    {message && <div className={`notice ${tone === "danger" ? "danger" : tone === "warning" ? "warning" : ""}`} role={tone === "danger" ? "alert" : "status"}>{tone === "success" ? <CheckCircle2 size={16}/> : <ShieldAlert size={16}/>}<span>{message}</span></div>}

    {!status.canManage ? <p className="muted">An organization owner or administrator can connect and manage Telegram notifications.</p>
      : status.configured ? <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}><button className="button button-primary" type="button" disabled={Boolean(busy) || !status.enabled} onClick={sendTest}>{busy === "test" ? <><LoaderCircle size={14}/> Sending…</> : <><Send size={14}/> Send test notification</>}</button><button className="button button-secondary" type="button" disabled={Boolean(busy)} onClick={toggle}>{busy === "toggle" ? <><LoaderCircle size={14}/> Saving…</> : status.enabled ? "Pause notifications" : "Resume notifications"}</button></div>
      : <>
        <ol className="muted" style={{ margin:0, paddingLeft:20, display:"grid", gap:7 }}>
          <li>Generate a one-time connection command.</li>
          <li>Send that exact command inside the Telegram group containing your SmartHoneyAI bot.</li>
          <li>Return here and verify the connection.</li>
        </ol>
        {!command ? <div><button className="button button-primary" type="button" disabled={Boolean(busy)} onClick={generateCode}>{busy === "setup" ? <><LoaderCircle size={14}/> Generating…</> : <><Send size={14}/> Generate connection code</>}</button></div>
          : <div className="form-grid">
            {botUsername && <p style={{ margin:0 }}>In the group containing <a href={`https://t.me/${botUsername}`} target="_blank" rel="noreferrer">@{botUsername}</a>, send the command below.</p>}
            <div className="field"><label htmlFor="telegram-command">Command to send in Telegram</label><div style={{ display:"flex", flexWrap:"wrap", gap:8 }}><input id="telegram-command" className="mono" value={command} readOnly style={{ flex:"1 1 220px", minWidth:0 }}/><button className="button button-secondary button-sm" type="button" onClick={copyCommand}><Copy size={14}/> Copy</button></div><small>Only the chat that sends this exact one-time command can be connected.</small></div>
            <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}><button className="button button-primary" type="button" disabled={Boolean(busy)} onClick={verify}>{busy === "verify" ? <><LoaderCircle size={14}/> Verifying…</> : "Verify and enable"}</button><button className="button button-secondary" type="button" disabled={Boolean(busy)} onClick={generateCode}>Generate new code</button></div>
          </div>}
      </>}
  </div>;
}
