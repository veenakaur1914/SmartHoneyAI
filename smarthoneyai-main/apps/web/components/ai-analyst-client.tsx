"use client";

import { useState } from "react";
import { AlertTriangle, BrainCircuit, Eraser, Send, ShieldCheck, Sparkles } from "lucide-react";
import type { Site } from "@/lib/control-plane-types";

type AnalystContext = {
  eventCount: number;
  window: string;
  model: string;
  mode?: "provider" | "local_summary" | "local_fallback";
  notice?: string;
};

type ChatMessage = { role: "user" | "assistant"; content: string; context?: AnalystContext };
const suggestions = ["Summarize the most important threats.", "Which routes and sources need investigation?", "Explain the latest blocked activity."];

export function AiAnalystClient({ sites }: { sites: Site[] }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [siteId, setSiteId] = useState("");
  const [windowValue, setWindowValue] = useState("24h");
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function ask(event?: React.FormEvent) {
    event?.preventDefault();
    const prompt = question.trim();
    if (!prompt || busy) return;
    const previous = messages.slice(-16).map(({ role, content }) => ({ role, content }));
    setMessages((current) => [...current, { role: "user", content: prompt }]);
    setQuestion(""); setBusy(true); setError("");
    try {
      const response = await fetch("/v1/ai/chat", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: prompt, history: previous, filters: { siteId: siteId || undefined, window: windowValue } }) });
      const body = await response.json().catch(() => ({})) as { answer?: string; message?: string; context?: AnalystContext };
      if (!response.ok) throw new Error(body.message ?? "The AI analyst could not answer.");
      if (!body.answer) throw new Error("The analyst returned an empty response. Try again.");
      setMessages((current) => [...current, { role: "assistant", content: body.answer!, context: body.context }]);
    } catch (reason) {
      setMessages((current) => current.at(-1)?.role === "user" && current.at(-1)?.content === prompt ? current.slice(0, -1) : current);
      setQuestion((current) => current.trim() ? current : prompt);
      setError(reason instanceof Error ? reason.message : "The AI analyst could not answer.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="ai-workbench">
    <aside className="ai-context-panel">
      <div className="ai-context-heading"><span className="dialog-icon"><BrainCircuit size={18}/></span><div><strong>Analysis context</strong><p>Only bounded, sanitized records from your current organization are analyzed.</p></div></div>
      <div className="field"><label htmlFor="ai-site">Site</label><select id="ai-site" value={siteId} onChange={(event) => setSiteId(event.target.value)}><option value="">All sites</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></div>
      <div className="field"><label htmlFor="ai-window">Time range</label><select id="ai-window" value={windowValue} onChange={(event) => setWindowValue(event.target.value)}><option value="1h">Last hour</option><option value="24h">Last 24 hours</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option></select></div>
      <div className="notice"><ShieldCheck size={15}/><span>Log-derived raw IP addresses, headers, cookies, payloads, and credentials are never sent to the chat model or shown by the local fallback.</span></div>
      <div className="ai-session-note"><strong>Temporary session</strong><p>This conversation is held only in this browser tab and disappears when you refresh or leave.</p></div>
    </aside>
    <section className="ai-chat-panel" aria-label="AI security analyst conversation">
      <header className="ai-chat-header"><div><span className="section-label">Read-only assistant</span><h2>Ask about your security logs</h2></div>{messages.length > 0 && <button className="button button-secondary button-sm" type="button" onClick={() => { setMessages([]); setError(""); }}><Eraser size={14}/> Clear chat</button>}</header>
      <div className="ai-messages" aria-live="polite">
        {messages.length === 0 ? <div className="ai-empty"><Sparkles size={28}/><h3>Start with a security question</h3><p>I can summarize activity, compare routes, explain assessments, and suggest human-verifiable next checks. If live AI is unavailable, you will receive a clearly labeled deterministic evidence summary.</p><div className="suggestion-list">{suggestions.map((suggestion) => <button type="button" key={suggestion} onClick={() => setQuestion(suggestion)}>{suggestion}</button>)}</div></div> : messages.map((message, index) => {
          const local = message.context?.mode === "local_fallback" || message.context?.mode === "local_summary";
          return <article className={`chat-message ${message.role}`} key={`${message.role}-${index}`}>
            <span>{message.role === "assistant" ? local ? "Evidence summary" : "AI analyst" : "You"}</span>
            <p>{message.content}</p>
            {message.context?.notice && <div className={`ai-response-notice ${message.context.mode === "local_fallback" ? "warning" : ""}`}>{message.context.mode === "local_fallback" ? <AlertTriangle size={13}/> : <ShieldCheck size={13}/>}<span>{message.context.notice}</span></div>}
            {message.context && <small>Analyzed {message.context.eventCount} events · {message.context.window} · {message.context.model}</small>}
          </article>;
        })}
        {busy && <div className="chat-message assistant loading-message"><span>AI analyst</span><p><i/><i/><i/> Analyzing bounded tenant evidence…</p></div>}
        {error && <div className="notice danger" role="alert"><span>{error} Your question is still in the editor so you can retry.</span></div>}
      </div>
      <form className="ai-composer" onSubmit={ask}><label className="sr-only" htmlFor="ai-question">Ask the AI analyst</label><textarea id="ai-question" value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={2000} placeholder="Ask for a summary, pattern, explanation, or recommended next check…" onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void ask(); } }}/><button className="button button-primary" disabled={busy || question.trim().length < 2}><Send size={15}/>{busy ? "Analyzing…" : "Ask AI"}</button></form>
    </section>
  </div>;
}
