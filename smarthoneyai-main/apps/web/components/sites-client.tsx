"use client";

import { useState } from "react";
import { Check, Copy, Plus, RadioTower, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { PageHeader, StatusBadge } from "@/components/dashboard-ui";
import type { Site } from "@/lib/control-plane-types";
import { formatMalaysiaDateTime } from "@/lib/date-time";

export function SitesClient({sites,canManage}:{sites:Site[];canManage:boolean}) {
  const router=useRouter();
  const [showForm,setShowForm]=useState(false);
  const [busy,setBusy]=useState<string|null>(null);
  const [message,setMessage]=useState("");
  const [token,setToken]=useState("");
  const [deploymentType,setDeploymentType]=useState<"NORMAL_HOSTING"|"DOCKER">("NORMAL_HOSTING");

  async function createSite(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault(); setBusy("create"); setMessage(""); setToken("");
    const form=new FormData(event.currentTarget);
    const response=await fetch("/v1/sites",{method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({name:form.get("name"),url:form.get("url"),deploymentType})});
    const body=await response.json().catch(()=>({}));
    if(!response.ok){setMessage(body.message??"Unable to create the site.");setBusy(null);return;}
    setToken(body.enrollmentToken); setMessage("Site created. Copy this single-use token into WordPress within one hour."); setBusy(null); router.refresh();
  }

  async function setMode(site:Site,mode:"OBSERVE"|"ENFORCE"){
    setBusy(site.id); setMessage("");
    const response=await fetch(`/v1/sites/${site.id}/enforcement-mode`,{method:"PATCH",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({mode,reason:"Local operator mode change"})});
    const body=await response.json().catch(()=>({}));
    setBusy(null);
    if(!response.ok){setMessage(body.message??"Unable to update enforcement mode.");return;}
    router.refresh();
  }

  return <>
    <PageHeader title="Sites" description="Live WordPress agent connection, policy, and queue state." actions={canManage?<button className="button button-primary button-sm" onClick={()=>setShowForm(!showForm)}><Plus size={15}/> Add WordPress site</button>:undefined}/>
    {message&&<div className={`notice ${token?"":"warning"}`} role="status"><RadioTower size={15}/><span>{message}</span></div>}
    {token&&<div className="code-block" style={{display:"flex",justifyContent:"space-between",gap:16,alignItems:"center"}}><code data-testid="enrollment-token">{token}</code><button className="button button-secondary button-sm" onClick={()=>navigator.clipboard.writeText(token)}><Copy size={14}/> Copy</button></div>}
    {canManage&&showForm&&<section className="panel" style={{marginBottom:16}}><div className="panel-body"><form className="form-grid" onSubmit={createSite}><fieldset className="field"><legend>Deployment package</legend><div className="form-row"><label className={`notice ${deploymentType==="NORMAL_HOSTING"?"success":""}`}><input type="radio" name="deploymentType" checked={deploymentType==="NORMAL_HOSTING"} onChange={()=>setDeploymentType("NORMAL_HOSTING")}/><span><strong>Normal WordPress Hosting</strong><br/><small>Plugin ZIP for Hostinger or shared hosting. WordPress detection and WordPress-level blocking.</small></span></label><label className={`notice ${deploymentType==="DOCKER"?"success":""}`}><input type="radio" name="deploymentType" checked={deploymentType==="DOCKER"} onChange={()=>setDeploymentType("DOCKER")}/><span><strong>Docker WordPress + Network Sensor</strong><br/><small>Same plugin plus isolated OpenCanary detection module. Blocking still stays in WordPress.</small></span></label></div></fieldset><div className="form-row"><div className="field"><label htmlFor="site-name">Site name</label><input id="site-name" name="name" required maxLength={120} placeholder="Company WordPress site"/></div><div className="field"><label htmlFor="site-url">Exact WordPress URL</label><input id="site-url" name="url" required type="url" placeholder="https://your-wordpress-site.com"/></div></div><div className="notice"><Copy size={15}/><span>{deploymentType==="DOCKER"?<>Download <a href="/downloads/smarthoneyai-wordpress-docker-1.1.0.tar.gz">smarthoneyai-wordpress-docker-1.1.0.tar.gz</a>. Enroll WordPress first, then create the paired sensor module.</>:<>Download <a href="/downloads/smarthoneyai-wordpress-1.1.0.zip">smarthoneyai-wordpress-1.1.0.zip</a>. Upload it in WordPress → Plugins → Add New.</>}</span></div><small><a href="/downloads/SHA256SUMS">Verify SHA-256 checksums</a> before installation.</small><button className="button button-primary" disabled={busy==="create"}>{busy==="create"?"Creating…":"Create site and token"}</button></form></div></section>}
    {sites.length===0?<div className="empty-state panel-body"><ShieldCheck size={24}/><h2>No WordPress sites yet</h2><p>Create an authorized WordPress site to generate its one-time enrollment token.</p></div>:<div className="site-grid">{sites.map(site=>{
      const connection=site.connectionStatus??site.status;
      const heartbeat=site.latestHeartbeat;
      return <article className="site-card" key={site.id} data-testid={`site-${site.id}`}><div className="site-card-top"><div className="site-ident"><span className="site-favicon">{site.name[0]?.toUpperCase()}</span><div><h3>{site.name}</h3><p>{site.domain}</p></div></div><StatusBadge label={connection} kind="health"/></div><div style={{display:"flex",gap:8,marginTop:14,flexWrap:"wrap"}}><StatusBadge label={site.deploymentType??"NORMAL_HOSTING"}/><StatusBadge label={site.enforcementMode}/>{site.latestPolicy?.acknowledgement&&<StatusBadge label={site.latestPolicy.acknowledgement.status}/>}</div><div className="site-stats"><div className="site-stat"><span>Queue</span><strong>{heartbeat?heartbeat.queueDepth:"—"}</strong></div><div className="site-stat"><span>Dropped</span><strong>{heartbeat?(heartbeat.droppedEvents??"—"):"—"}</strong></div><div className="site-stat"><span>Agent policy</span><strong>{heartbeat?`v${heartbeat.policyVersion}`:"—"}</strong></div></div>{site.deploymentType==="DOCKER"&&<div className="notice" style={{marginTop:12}}><RadioTower size={14}/><span>Network module: {site.pairedNetworkSensors?.[0]?.name??"not paired"}</span></div>}<div className="site-card-footer"><span>Plugin {heartbeat?.pluginVersion??site.pluginVersion??"not connected"}</span><span>{site.lastSeenAt?`Seen ${formatMalaysiaDateTime(site.lastSeenAt)}`:"No heartbeat"}</span></div>{canManage&&<div className="mode-selector" style={{marginTop:14}}><button disabled={busy===site.id} className={site.enforcementMode==="OBSERVE"?"active":""} onClick={()=>setMode(site,"OBSERVE")}>Observe</button><button disabled={busy===site.id} className={site.enforcementMode==="ENFORCE"?"active":""} onClick={()=>setMode(site,"ENFORCE")}>Enforce</button></div>}</article>})}</div>}
    <section className="panel" style={{marginTop:16}}><div className="panel-body"><div className="process-grid">{[[ShieldCheck,"Create site","Register the exact production WordPress URL."],[Copy,"Install and enroll","Activate the plugin and enter the one-time token."],[RadioTower,"Verify heartbeat","Confirm policy version, queue depth, and connection status."],[Check,"Test safely","Use harmless markers on an authorized test site."]].map(([Icon,title,copy])=>{const StepIcon=Icon as typeof ShieldCheck;return <div className="process-card" key={String(title)}><div className="process-number"><StepIcon size={17}/></div><h3>{String(title)}</h3><p>{String(copy)}</p></div>})}</div></div></section>
  </>;
}
