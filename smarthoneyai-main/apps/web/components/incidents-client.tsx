"use client";

import { useState } from "react";
import Link from "next/link";
import { Clock3, ShieldBan, ShieldCheck } from "lucide-react";
import { PageHeader, StatusBadge } from "./dashboard-ui";
import type { Incident } from "@/lib/control-plane-types";
import { formatMalaysiaDateTime } from "@/lib/date-time";

function incidentFacts(incident: Incident) {
  const assets = new Set(incident.events.map((link) => link.event.siteId)).size;
  const protocols = [...new Set(incident.events.map((link) => link.event.protocol).filter(Boolean))];
  const source = incident.sourceIpHash ? `${incident.sourceIpHash.slice(0, 16)}…` : "Unavailable";
  return { assets, protocols, source };
}

function IncidentTimeline({ incident }: { incident: Incident }) {
  return <ol className="incident-timeline" id={`incident-timeline-${incident.id}`}>{incident.events.map(({ event }, index) => <li key={`${event.occurredAt}-${index}`}>
    <span>{formatMalaysiaDateTime(event.occurredAt)}</span>
    <strong>{event.site.name}</strong>
    <code>{event.protocol ?? "HTTP"} · {event.activity ?? event.path} · {event.sourceAttribution ?? "OBSERVED"}</code>
  </li>)}</ol>;
}

export function IncidentsClient({ incidents, canContain }: { incidents: Incident[]; canContain: boolean }) {
  const [message, setMessage] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function contain(incident: Incident) {
    if (!incident.sourceIpHash) {
      setMessage("This legacy incident has no verified source identifier and cannot be contained safely.");
      return;
    }
    const reason = window.prompt("Reason for 24-hour containment", `Approved containment for incident ${incident.id}`)?.trim();
    if (!reason) return;
    setBusy(incident.id); setMessage("");
    try {
      const response = await fetch(`/v1/incidents/${incident.id}/contain`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason }) });
      const body = await response.json().catch(() => ({})) as { message?: string; reused?: boolean; affectedSites?: unknown[] };
      if (!response.ok) throw new Error(body.message ?? "Containment failed.");
      setMessage(`${body.reused ? "Reused" : "Created"} a signed 24-hour WordPress BLOCK_IP policy for ${body.affectedSites?.length ?? 0} site(s).`);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Containment failed.");
    } finally {
      setBusy(null);
    }
  }

  function containmentAction(incident: Incident) {
    if (incident.events.length === 0) return <span className="muted">Event evidence no longer retained</span>;
    if (!canContain) return <span className="muted">Owner/Admin approval required</span>;
    if (!incident.sourceIpHash) return <span className="muted">Verified source unavailable</span>;
    return <button className="button button-primary button-sm" disabled={busy === incident.id} onClick={() => contain(incident)}><ShieldBan size={13}/>{busy === incident.id ? "Applying…" : "Contain for 24 hours"}</button>;
  }

  return <>
    <PageHeader title="Incidents" description="Ten-minute correlation across WordPress and optional client network telemetry."/>
    {message && <div className="notice" role="status" style={{ marginBottom: 16 }}><ShieldBan size={15}/><span>{message}</span></div>}
    <section className="panel">
      {incidents.length === 0 ? <div className="panel-body">
        <div className="notice"><ShieldCheck size={16}/><span><strong>No correlated incidents yet.</strong> Incoming telemetry is still available in <Link href="/dashboard/events" className="inline-link">Events</Link>; an incident appears when high- or critical-severity activity is correlated.</span></div>
      </div> : <>
        <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Incident</th><th>Severity</th><th>Timeline</th><th>Assets / protocols</th><th>Events</th><th>Response</th></tr></thead><tbody>{incidents.map((incident) => {
          const { assets, protocols, source } = incidentFacts(incident);
          return <tr key={incident.id}>
            <td>{incident.events.length > 0 ? <button className="button button-ghost button-sm" aria-expanded={expanded === incident.id} aria-controls={`incident-timeline-${incident.id}`} onClick={() => setExpanded((current) => current === incident.id ? null : incident.id)}>{incident.title}</button> : <strong>{incident.title}</strong>}<span className="table-subtext">{incident.summary}</span><span className="table-subtext mono">Source {source}</span>{incident.events.length === 0 && <span className="table-subtext">Event evidence is outside the retention window.</span>}{expanded === incident.id && incident.events.length > 0 && <IncidentTimeline incident={incident}/>}</td>
            <td><StatusBadge label={incident.severity} kind="severity"/></td>
            <td><Clock3 size={13}/> {formatMalaysiaDateTime(incident.firstSeenAt)}<span className="table-subtext">to {formatMalaysiaDateTime(incident.lastSeenAt)}</span></td>
            <td><strong>{assets} asset{assets === 1 ? "" : "s"}</strong><span className="table-subtext">{protocols.join(", ") || "HTTP"}</span></td>
            <td>{incident._count.events}</td>
            <td>{containmentAction(incident)}</td>
          </tr>;
        })}</tbody></table></div>
        <div className="mobile-card-list">{incidents.map((incident) => {
          const { assets, protocols, source } = incidentFacts(incident);
          return <article className={`mobile-data-card severity-${incident.severity.toLowerCase()}`} key={incident.id}>
            <div className="mobile-data-top"><h3>{incident.title}</h3><StatusBadge label={incident.severity} kind="severity"/></div>
            <p>{incident.summary}</p>
            <div className="mobile-data-meta"><span>{assets} asset{assets === 1 ? "" : "s"}</span><span>{incident._count.events} event{incident._count.events === 1 ? "" : "s"}</span><span>{protocols.join(", ") || "HTTP"}</span><span>Source {source}</span><span>Last seen {formatMalaysiaDateTime(incident.lastSeenAt)}</span></div>
            <div className="incident-mobile-actions">{incident.events.length > 0 && <button className="button button-secondary button-sm" type="button" aria-expanded={expanded === incident.id} aria-controls={`incident-timeline-${incident.id}`} onClick={() => setExpanded((current) => current === incident.id ? null : incident.id)}>{expanded === incident.id ? "Hide timeline" : "Show timeline"}</button>}{containmentAction(incident)}</div>
            {expanded === incident.id && incident.events.length > 0 && <IncidentTimeline incident={incident}/>}
          </article>;
        })}</div>
      </>}
    </section>
  </>;
}
