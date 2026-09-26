"use client";

import { useState } from "react";
import { Boxes, Copy, FlaskConical, Plus, ShieldCheck } from "lucide-react";
import { PageHeader, StatusBadge } from "./dashboard-ui";
import type { NetworkSensor, Site } from "@/lib/control-plane-types";
import { formatMalaysiaDateTime } from "@/lib/date-time";

export function CloudSensorsClient({initialSensors,sites,canManage}:{initialSensors:NetworkSensor[];sites:Site[];canManage:boolean}){
  const [sensors,setSensors]=useState(initialSensors);
  const [siteId,setSiteId]=useState(sites.find(site=>site.deploymentType==="DOCKER")?.id??sites[0]?.id??"");
  const [name,setName]=useState("");
  const [token,setToken]=useState("");
  const [testRun,setTestRun]=useState<{runId:string;token:string}|null>(null);
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const selectedSite=sites.find(site=>site.id===siteId);

  async function createSensor(event:React.FormEvent){
    event.preventDefault();setBusy(true);setError("");setToken("");
    try{
      const isDocker=selectedSite?.deploymentType==="DOCKER";
      const response=await fetch(isDocker?`/v1/sites/${siteId}/network-sensor`:"/v1/network-sensors",{method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify(isDocker?{name:name||undefined}:{name:name||`${selectedSite?.name??"WordPress"} local demo sensor`,wordpressSiteId:siteId,localSelfTest:true})});
      const body=await response.json();
      if(!response.ok)throw new Error(body.message??"Could not create sensor module");
      const linked=sites.find(site=>site.id===siteId);
      setSensors(current=>[{...body.sensor,connectionStatus:"PENDING",latestHeartbeat:null,sourceAttribution:linked?.deploymentType==="DOCKER"?"OBSERVED":"DEMO_OVERRIDE",pairedWordpressSite:linked?{id:linked.id,name:linked.name,domain:linked.domain,deploymentType:linked.deploymentType??"NORMAL_HOSTING"}:null},...current]);setToken(body.enrollmentToken);setName("");
    }catch(reason){setError(reason instanceof Error?reason.message:"Could not create sensor module");}finally{setBusy(false);}
  }

  async function createSelfTest(sensor:NetworkSensor){
    if(!sensor.pairedWordpressSite)return;
    setBusy(true);setError("");setTestRun(null);
    const response=await fetch("/v1/self-tests",{method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({siteId:sensor.pairedWordpressSite.id,sensorId:sensor.id})});
    const body=await response.json().catch(()=>({}));setBusy(false);
    if(!response.ok){setError(body.message??"Could not create self-test run");return;}
    setTestRun({runId:body.run.id,token:body.token});
  }

  function downloadSelfTestToken(){
    if(!testRun)return;
    const link=document.createElement("a");link.href=URL.createObjectURL(new Blob([`${JSON.stringify(testRun,null,2)}\n`],{type:"application/json"}));link.download="smarthoneyai-self-test-token.json";link.click();URL.revokeObjectURL(link.href);
  }

  return <>
    <PageHeader title="Sensor modules" description="Optional network detection packaged beside Docker WordPress clients—not on the SmartHoneyAI control-plane VPS."/>
    <div className="notice" style={{marginBottom:16}}><ShieldCheck size={16}/><span><strong>Detection only.</strong> OpenCanary records SSH, MySQL and Redis decoy activity. Blocking is still performed inside the linked WordPress plugin and protects that WordPress site only.</span></div>
    {token&&<div className="notice warning" role="status"><ShieldCheck size={16}/><span><strong>One-time sensor enrollment token:</strong> <code>{token}</code> <button className="button button-ghost button-sm" onClick={()=>navigator.clipboard.writeText(token)}><Copy size={13}/> Copy</button><br/>Place it in the client sensor module once, confirm heartbeat, then remove it from the client environment.</span></div>}
    {testRun&&<div className="notice warning" role="status"><FlaskConical size={16}/><span><strong>15-minute self-test credential:</strong> <code>{testRun.runId}</code> <button className="button button-ghost button-sm" onClick={downloadSelfTestToken}><Copy size={13}/> Download token file</button><br/>Run <code>pnpm self-test:sensors -- hybrid --execute --token-file ./smarthoneyai-self-test-token.json --confirm AUTHORIZED-HYBRID-TEST</code>. The credential is shown once.</span></div>}
    {canManage&&<section className="panel" style={{marginBottom:16}}><div className="panel-body"><form className="form-grid" onSubmit={createSensor}><div className="form-row"><div className="field"><label htmlFor="sensor-site">Linked WordPress site</label><select id="sensor-site" value={siteId} onChange={event=>setSiteId(event.target.value)} required><option value="">Select a site</option>{sites.map(site=><option key={site.id} value={site.id}>{site.name} · {site.deploymentType==="DOCKER"?"Docker client":"normal hosting demo"}</option>)}</select></div><div className="field"><label htmlFor="sensor-name">Module name</label><input id="sensor-name" value={name} onChange={event=>setName(event.target.value)} minLength={2} maxLength={120} placeholder="Optional friendly name"/></div></div>{selectedSite?.deploymentType!=="DOCKER"&&<div className="notice warning"><FlaskConical size={15}/><span>This creates a presentation-only local sensor using <strong>DEMO_OVERRIDE</strong>. Normal hosting still receives WordPress detection and application-level blocking only.</span></div>}<button className="button button-primary" disabled={busy||!siteId}><Plus size={15}/>{busy?"Creating…":selectedSite?.deploymentType==="DOCKER"?"Create paired client sensor":"Create local self-test sensor"}</button></form>{sites.length===0&&<p className="muted">Create a WordPress site first.</p>}{error&&<p className="form-error">{error}</p>}</div></section>}
    <section className="panel"><div className="panel-body"><div className="data-table-wrap"><table className="data-table"><thead><tr><th>Module</th><th>Linked WordPress</th><th>Status</th><th>Attribution</th><th>Services</th><th>Version / queue</th><th>Heartbeat</th><th>Test</th></tr></thead><tbody>{sensors.map(sensor=><tr key={sensor.id}><td><strong><Boxes size={14}/> {sensor.name}</strong><span className="table-subtext mono">{sensor.id}</span></td><td>{sensor.pairedWordpressSite?<><strong>{sensor.pairedWordpressSite.name}</strong><span className="table-subtext">{sensor.pairedWordpressSite.domain}</span></>:<span className="muted">Legacy unpaired sensor</span>}</td><td><StatusBadge label={sensor.connectionStatus} kind="health"/></td><td><StatusBadge label={sensor.sourceAttribution??"OBSERVED"}/></td><td>{sensor.latestHeartbeat?.enabledServices.join(", ")??"Awaiting enrollment"}</td><td><span className="mono">{sensor.latestHeartbeat?.agentVersion??sensor.pluginVersion??"—"}</span><span className="table-subtext">Queue {sensor.latestHeartbeat?.queueDepth??"—"} · Dropped {sensor.latestHeartbeat?.droppedEvents??"—"}</span></td><td>{sensor.latestHeartbeat?.createdAt?formatMalaysiaDateTime(sensor.latestHeartbeat.createdAt):"Never"}</td><td>{canManage&&sensor.pairedWordpressSite?<button className="button button-secondary button-sm" disabled={busy} onClick={()=>createSelfTest(sensor)}><FlaskConical size={13}/> Create token</button>:"—"}</td></tr>)}</tbody></table>{sensors.length===0&&<p className="muted">No client sensor modules are registered.</p>}</div></div></section>
  </>;
}
