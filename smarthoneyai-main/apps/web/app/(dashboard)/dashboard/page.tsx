"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Activity, ArrowRight, Flame, Radio, ShieldAlert, ShieldCheck, Waypoints } from "lucide-react";
import { MetricCard, PageHeader, Panel, StatusBadge } from "@/components/dashboard-ui";
import type { DashboardSummary, Site } from "@/lib/control-plane-types";
import { formatMalaysiaDateTime } from "@/lib/date-time";

async function liveGet<T>(path:string):Promise<T>{
  const response=await fetch(path,{credentials:"include",cache:"no-store"});
  if(!response.ok)throw new Error(`Live control-plane request failed with ${response.status}`);
  return response.json() as Promise<T>;
}

export default function OverviewPage(){
  const [summary,setSummary]=useState<DashboardSummary|null>(null);
  const [sites,setSites]=useState<Site[]>([]);
  const [error,setError]=useState("");
  useEffect(()=>{
    let active=true;
    let loading=false;
    const load=async()=>{
      if(loading)return;
      loading=true;
      try{
        const [nextSummary,nextSites]=await Promise.all([liveGet<DashboardSummary>("/v1/dashboard/summary"),liveGet<{data:Site[]}>("/v1/sites")]);
        if(active){setSummary(nextSummary);setSites(nextSites.data);setError("");}
      }catch(reason){if(active)setError(reason instanceof Error?reason.message:"Live control-plane request failed");}
      finally{loading=false;}
    };
    void load();
    const refresh=()=>{if(document.visibilityState==="visible")void load();};
    const timer=window.setInterval(refresh,15000);
    document.addEventListener("visibilitychange",refresh);
    return()=>{active=false;window.clearInterval(timer);document.removeEventListener("visibilitychange",refresh);};
  },[]);

  if(!summary)return <><PageHeader title="Security operations" description="Live control-plane posture from all enrolled sensors."/><section className="panel"><div className="panel-body"><h2>{error?"Live overview unavailable":"Loading live security state…"}</h2><p className="muted">{error||"Reading current heartbeats, policy state, and sanitized detections."}</p></div></section></>;

  const enforcing=sites.filter(site=>site.enforcementMode==="ENFORCE").length;
  return <>
    <PageHeader title="Security operations" description="Live control-plane posture from WordPress and optional client sensor modules." actions={<Link className="button button-primary button-sm" href="/dashboard/events">Open live events <ArrowRight size={14}/></Link>}/>
    {error&&<div className="notice warning" role="status"><ShieldAlert size={15}/><span>{error}; retaining the last verified view.</span></div>}
    <div className="metric-grid"><MetricCard label="Protected assets" value={String(summary.sites+summary.sensors)} note={`${summary.sites} WordPress · ${summary.sensors} sensor modules`} icon={Waypoints}/><MetricCard label="Events in 24 hours" value={String(summary.events24h)} note="Sanitized sensor telemetry" icon={Activity}/><MetricCard label="Blocked in 24 hours" value={String(summary.blocked24h)} note={`${enforcing} sites enforcing`} icon={Flame}/><MetricCard label="Critical incidents" value={String(summary.criticalOpen)} note="Open and investigating" icon={ShieldAlert}/></div>
    <div className="dashboard-grid"><Panel title="Agent connection" description="Heartbeat-derived state, not enrollment state"><div className="panel-body chart-list">{sites.length===0?<p className="muted">No WordPress sites registered.</p>:sites.map(site=><div className="check-row" key={site.id}><span><Radio size={13}/><strong>{site.name}</strong><small style={{display:"block"}}>Policy v{site.latestHeartbeat?.policyVersion??site.currentPolicyVersion} · Queue {site.latestHeartbeat?site.latestHeartbeat.queueDepth:"Unavailable"}</small></span><StatusBadge label={site.connectionStatus??site.status} kind="health"/></div>)}</div></Panel><Panel title="Protection mode" description="Observe-first application firewall"><div className="panel-body"><div className="coverage-score"><div><span>Enforcing sites</span><strong className="mono">{enforcing}<span>/{summary.sites}</span></strong></div><StatusBadge label={enforcing>0?"Active":"Observing"}/></div><div className="notice"><ShieldCheck size={15}/><span>Policies are signed and applied locally. Private and reserved sources remain protected from blocking.</span></div></div></Panel></div>
    <Panel title="Latest detections" description="Newest sanitized evidence · Malaysia Time (UTC+8)" action={<Link className="button button-ghost button-sm" href="/dashboard/events">View all <ArrowRight size={13}/></Link>}><div className="data-table-wrap"><table className="data-table"><thead><tr><th>Kind</th><th>Request</th><th>Site</th><th>Action</th><th>Received</th></tr></thead><tbody>{summary.recentEvents.map(event=><tr key={event.id}><td><StatusBadge label={event.kind}/></td><td><code>{event.method} {event.path}</code></td><td>{event.site.name}</td><td><StatusBadge label={event.action} kind="state"/></td><td className="mono">{formatMalaysiaDateTime(event.receivedAt)}</td></tr>)}</tbody></table>{summary.recentEvents.length===0&&<div className="panel-body muted">No events received in the selected organization.</div>}</div></Panel>
  </>;
}
