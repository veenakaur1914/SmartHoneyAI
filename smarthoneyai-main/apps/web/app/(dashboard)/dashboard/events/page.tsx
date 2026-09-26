import type { Metadata } from "next";
import { CheckCircle2, Fingerprint, LockKeyhole, ShieldAlert } from "lucide-react";
import { PageHeader, StatusBadge } from "@/components/dashboard-ui";
import { apiGet } from "@/lib/api";
import type { SecurityEvent } from "@/lib/control-plane-types";
import { formatMalaysiaDateTime } from "@/lib/date-time";

export const metadata:Metadata={title:"Live events"};

function titleFor(event:SecurityEvent){return event.assessments[0]?.threatType?.replaceAll("_"," ")??event.honeypotKey?.replaceAll("-"," ")??event.kind.replaceAll("_"," ");}
function severityFor(event:SecurityEvent){return event.assessments[0]?.severity??null;}
function assessmentStatusFor(event:SecurityEvent){return event.assessments[0]?.status?.replaceAll("_"," ")??"Not assessed";}

export default async function EventsPage(){
  const result=await apiGet<{data:SecurityEvent[];total:number;page:number;pageSize:number}>("/v1/events");
  const selected=result.data[0];
  return <>
    <PageHeader title="Live events" description="Sanitized telemetry reported by enrolled WordPress sites and optional client sensor modules."/>
    <div className="event-view-tabs"><span className="active" style={{padding:"10px 14px"}}>All events <strong>{result.total}</strong></span><span style={{padding:"10px 14px"}}>Blocked on this page <strong>{result.data.filter(event=>event.action==="BLOCKED"||event.action==="RATE_LIMITED").length}</strong></span><span style={{padding:"10px 14px"}}>AI pending on this page <strong>{result.data.filter(event=>event.assessments[0]?.status==="PENDING").length}</strong></span></div>
    {result.data.length===0?<section className="panel"><div className="panel-body"><h2>No live events yet</h2><p className="muted">Trigger an enabled honeypot from an authorized demonstration source.</p></div></section>:<div className="events-workbench">
      <section className="events-surface" aria-label="Security event queue">
        <header className="workbench-header"><div><strong>Security event queue</strong><span>{result.total} results · newest first · Malaysia Time (UTC+8)</span></div></header>
        <div className="data-table-wrap"><table className="data-table security-table events-table"><thead><tr><th>Detection</th><th>Sensor evidence</th><th>Asset</th><th>Source</th><th>Severity</th><th>Action</th><th>Received</th></tr></thead><tbody>{result.data.map((event,index)=>{const severity=severityFor(event);return <tr className={`event-row ${severity?`severity-${severity.toLowerCase()}`:""} ${index===0?"selected":""}`} key={event.id}><td><div className="detection-cell"><span className="mono detection-code">{event.protocol??event.kind}</span><strong>{titleFor(event)}</strong><span className="mono">{event.id}</span></div></td><td><code>{event.method} {event.path}</code></td><td><strong>{event.site.name}</strong><span className="table-subtext">{event.honeypotKey??"policy sensor"}</span></td><td className="mono">{event.ipAddress}<span className="table-subtext">{event.sourceAttribution??"OBSERVED"}</span></td><td>{severity?<StatusBadge label={severity} kind="severity"/>:<span className="muted">{assessmentStatusFor(event)}</span>}</td><td><StatusBadge label={event.action} kind="state"/></td><td className="mono">{formatMalaysiaDateTime(event.receivedAt)}</td></tr>})}</tbody></table></div>
        <div className="mobile-card-list">{result.data.map(event=>{const severity=severityFor(event);return <article className={`mobile-data-card ${severity?`severity-${severity.toLowerCase()}`:""}`} key={event.id}><div className="mobile-data-top"><h3>{titleFor(event)}</h3><StatusBadge label={event.action} kind="state"/></div><code>{event.method} {event.path}</code><p>{event.site.name} · {event.protocol??event.honeypotKey??"policy sensor"}</p><div className="mobile-data-meta"><span>{severity?<StatusBadge label={severity} kind="severity"/>:assessmentStatusFor(event)}</span><span className="mono">{event.ipAddress}</span><span>{formatMalaysiaDateTime(event.receivedAt)}</span></div></article>})}</div>
        <footer className="workbench-footer"><span>Showing <strong>{result.data.length}</strong> of <strong>{result.total}</strong></span></footer>
      </section>
      {selected&&<aside className="evidence-drawer" aria-label={`Evidence for ${selected.id}`}><header className="evidence-header"><div><span className="mono">{selected.id}</span><h2>{titleFor(selected)}</h2></div></header><div className="evidence-verdict"><div>{severityFor(selected)&&<StatusBadge label={severityFor(selected)!} kind="severity"/>}<StatusBadge label={selected.action} kind="state"/></div><strong>{assessmentStatusFor(selected)}</strong><p>{selected.assessments[0]?.evidenceSummary??"The control plane stored sanitized sensor evidence."}</p></div><section className="evidence-section"><h3>Normalized sensor evidence</h3><dl className="evidence-grid"><div><dt>Method</dt><dd className="mono">{selected.method}</dd></div><div><dt>Protocol</dt><dd className="mono">{selected.protocol??"HTTP"}</dd></div><div className="wide"><dt>Route or service</dt><dd className="mono">{selected.path}</dd></div><div className="wide"><dt>Sanitized payload</dt><dd><code>{selected.payload??"No payload retained"}</code></dd></div></dl></section><section className="evidence-section"><h3>Detection context</h3><div className="evidence-facts"><div><Fingerprint size={14}/><span><small>Idempotency key</small><strong className="mono">{selected.idempotencyKey}</strong></span></div><div><ShieldAlert size={14}/><span><small>Sensor</small><strong>{selected.honeypotKey??"Firewall policy"}</strong></span></div><div><LockKeyhole size={14}/><span><small>Evidence handling</small><strong>Sanitized before ingestion</strong></span><CheckCircle2 size={13} className="success-icon"/></div></div></section></aside>}
    </div>}
  </>;
}
