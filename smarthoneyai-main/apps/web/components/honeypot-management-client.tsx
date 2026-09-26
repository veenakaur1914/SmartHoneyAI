"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FileUp, Pencil, Plus, Power, Radar, Trash2, X } from "lucide-react";
import { Panel, StatusBadge } from "./dashboard-ui";
import type { HoneypotDeployment, Site } from "@/lib/control-plane-types";

const templates = [
  ["DIAGNOSTIC", "Diagnostic response"], ["FAKE_LOGIN", "Fake administration login"], ["DATABASE_LOGIN", "Database login"], ["ARCHIVE", "Archive response"], ["JSON_ERROR", "JSON error"]
] as const;

type ImportRoute = { name:string; path:string; template:string; enabled:boolean; error?:string };

function parseCsvLine(line:string) {
  const values:string[]=[]; let value=""; let quoted=false;
  for(let index=0;index<line.length;index+=1){const char=line[index];if(char==='"'){if(quoted&&line[index+1]==='"'){value+='"';index+=1;}else quoted=!quoted;}else if(char===","&&!quoted){values.push(value.trim());value="";}else value+=char;}
  values.push(value.trim()); return values;
}

function labelFromPath(path:string){const part=path.split("/").filter(Boolean).at(-1)??"Custom route";return part.replace(/[-_.]+/g," ").replace(/^./,letter=>letter.toUpperCase()).slice(0,120);}

function validateImportRoute(route:ImportRoute,index:number,seen:Set<string>){
  let path=route.path.trim().replace(/\/{2,}/g,"/");if(path.length>1)path=path.replace(/\/$/,"");
  const lower=path.toLowerCase();const protectedPaths=["/","/wp-login.php","/xmlrpc.php","/wp-cron.php"];const protectedPrefixes=["/wp-admin","/wp-json"];
  let error="";
  if(index>=100)error="Only the first 100 routes can be imported at once.";
  else if(!path.startsWith("/"))error="Path must start with /.";
  else if(path.length>190)error="Path exceeds 190 characters.";
  else if(/[\s\\?#\u0000-\u001f\u007f]/.test(path))error="Path contains whitespace, query data, a fragment, or control characters.";
  else if(path.split("/").some(part=>part==="."||part===".."))error="Path cannot contain relative segments.";
  else if(protectedPaths.includes(lower)||protectedPrefixes.some(prefix=>lower===prefix||lower.startsWith(`${prefix}/`)))error="Path is reserved by WordPress.";
  else if(route.name.trim().length<2||route.name.trim().length>120)error="Name must contain 2–120 characters.";
  else if(!templates.some(([value])=>value===route.template))error="Unknown template.";
  else if(seen.has(lower))error="Duplicate path in import.";
  seen.add(lower);
  return {...route,name:route.name.trim(),path,error:error||undefined};
}

function parseImport(text:string, csv:boolean):ImportRoute[]{
  const lines=text.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
  let routes:ImportRoute[];
  if(csv){
    if(!lines.length)return [];
    const headers=parseCsvLine(lines[0]!).map(value=>value.toLowerCase());
    const required=["name","path","template","enabled"];const missing=required.filter(header=>!headers.includes(header));
    if(missing.length)return [{name:"CSV header",path:"",template:"DIAGNOSTIC",enabled:true,error:`CSV is missing: ${missing.join(", ")}.`}];
    routes=lines.slice(1).map(line=>{const values=parseCsvLine(line);const get=(name:string)=>values[headers.indexOf(name)]??"";const path=get("path");return {name:get("name")||labelFromPath(path),path,template:(get("template")||"DIAGNOSTIC").toUpperCase(),enabled:!['false','0','no'].includes(get("enabled").toLowerCase())};});
  }else routes=lines.map(path=>({name:labelFromPath(path),path,template:"DIAGNOSTIC",enabled:true}));
  const seen=new Set<string>();
  return routes.map((route,index)=>validateImportRoute(route,index,seen));
}

export function HoneypotManagementClient({routes,sites,canManage}:{routes:HoneypotDeployment[];sites:Site[];canManage:boolean}){
  const router=useRouter(); const [editorOpen,setEditorOpen]=useState(false); const [importOpen,setImportOpen]=useState(false); const [editing,setEditing]=useState<HoneypotDeployment|null>(null); const [busy,setBusy]=useState<string|null>(null); const [message,setMessage]=useState(""); const [importText,setImportText]=useState(""); const [csvMode,setCsvMode]=useState(false); const [importSite,setImportSite]=useState(sites[0]?.id??"");
  const preview=useMemo(()=>parseImport(importText,csvMode),[importText,csvMode]);
  const active=routes.filter(route=>route.enabled).length; const totalTriggers=routes.reduce((sum,route)=>sum+route.triggerCount,0);

  async function saveRoute(event:React.FormEvent<HTMLFormElement>){event.preventDefault();setBusy("save");setMessage("");const form=new FormData(event.currentTarget);const body={siteId:String(form.get("siteId")??""),name:String(form.get("name")??""),path:String(form.get("path")??""),template:String(form.get("template")??"DIAGNOSTIC"),enabled:true};const response=await fetch(editing?`/v1/honeypots/${editing.id}`:"/v1/honeypots",{method:editing?"PATCH":"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify(editing?{name:body.name,path:body.path,template:body.template}:body)});const data=await response.json().catch(()=>({})) as {message?:string};setBusy(null);if(!response.ok){setMessage(data.message??"Unable to save the honeypot route.");return;}setEditorOpen(false);setEditing(null);router.refresh();}
  async function toggle(route:HoneypotDeployment){setBusy(route.id);setMessage("");const response=await fetch(`/v1/honeypots/${route.id}`,{method:"PATCH",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({enabled:!route.enabled})});const data=await response.json().catch(()=>({})) as {message?:string};setBusy(null);if(!response.ok){setMessage(data.message??"Unable to update the route.");return;}router.refresh();}
  async function remove(route:HoneypotDeployment){if(!window.confirm(`Delete ${route.name}? The route will be removed after the WordPress agent synchronizes.`))return;setBusy(route.id);const response=await fetch(`/v1/honeypots/${route.id}`,{method:"DELETE",credentials:"include"});const data=await response.json().catch(()=>({})) as {message?:string};setBusy(null);if(!response.ok){setMessage(data.message??"Unable to delete the route.");return;}router.refresh();}
  async function importRoutes(){if(!importSite||!preview.length||preview.some(route=>route.error))return;setBusy("import");setMessage("");const response=await fetch("/v1/honeypots/import",{method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({siteId:importSite,routes:preview.map(route=>({name:route.name,path:route.path,template:route.template,enabled:route.enabled}))})});const data=await response.json().catch(()=>({})) as {message?:string;imported?:number};setBusy(null);if(!response.ok){setMessage(data.message??"Unable to import routes.");return;}setMessage(`${data.imported??preview.length} routes imported. They will activate after agent synchronization.`);setImportText("");setImportOpen(false);router.refresh();}
  function openEditor(route?:HoneypotDeployment){setEditing(route??null);setEditorOpen(true);setImportOpen(false);setMessage("");}

  return <>
    {message&&<div className="notice warning" role="status" style={{marginBottom:16}}>{message}</div>}
    <div className="metric-grid compact-metrics"><div className="metric-card"><span>Configured routes</span><strong>{routes.length}</strong><small>{active} enabled</small></div><div className="metric-card"><span>Recorded triggers</span><strong>{totalTriggers}</strong><small>Sanitized events</small></div><div className="metric-card"><span>Protected sites</span><strong>{new Set(routes.map(route=>route.siteId)).size}</strong><small>Per-site configuration</small></div></div>
    {canManage&&<div className="collection-actions"><button className="button button-primary button-sm" onClick={()=>openEditor()} disabled={!sites.length}><Plus size={14}/> Add custom route</button><button className="button button-secondary button-sm" onClick={()=>{setImportOpen(value=>!value);setEditorOpen(false);setMessage("");}} disabled={!sites.length}><FileUp size={14}/> Bulk import</button></div>}
    {canManage&&editorOpen&&<Panel title={editing?"Edit custom route":"Add custom route"} description="Custom routes are scoped to one enrolled WordPress site."><form className="panel-body form-grid" onSubmit={saveRoute}><div className="form-row"><div className="field"><label htmlFor="honeypot-site">Site</label><select id="honeypot-site" name="siteId" defaultValue={editing?.siteId??sites[0]?.id} disabled={Boolean(editing)}>{sites.map(site=><option key={site.id} value={site.id}>{site.name}</option>)}</select></div><div className="field"><label htmlFor="honeypot-name">Display name</label><input id="honeypot-name" name="name" required minLength={2} maxLength={120} defaultValue={editing?.name} placeholder="Legacy administrator portal"/></div></div><div className="form-row"><div className="field"><label htmlFor="honeypot-path">Absolute route</label><input id="honeypot-path" name="path" className="mono" required maxLength={190} defaultValue={editing?.path} placeholder="/legacy-admin"/><small>Do not reuse a real page, file, WordPress admin, API, or login path.</small></div><div className="field"><label htmlFor="honeypot-template">Inert response</label><select id="honeypot-template" name="template" defaultValue={editing?.template??"DIAGNOSTIC"}>{templates.map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></div></div><div className="inline-actions"><button className="button button-primary" disabled={busy==="save"}>{busy==="save"?"Saving…":editing?"Save route":"Add route"}</button><button className="button button-secondary" type="button" onClick={()=>{setEditorOpen(false);setEditing(null);}}><X size={14}/> Cancel</button></div></form></Panel>}
    {canManage&&importOpen&&<Panel title="Bulk import" description="Preview and validate up to 100 routes before committing them atomically."><div className="panel-body form-grid"><div className="form-row"><div className="field"><label htmlFor="import-site">Site</label><select id="import-site" value={importSite} onChange={event=>setImportSite(event.target.value)}>{sites.map(site=><option value={site.id} key={site.id}>{site.name}</option>)}</select></div><div className="field"><label>Import format</label><div className="mode-selector"><button type="button" className={!csvMode?"active":""} onClick={()=>setCsvMode(false)}>One path per line</button><button type="button" className={csvMode?"active":""} onClick={()=>setCsvMode(true)}>CSV</button></div></div></div><div className="field"><label htmlFor="route-import">Routes</label><textarea id="route-import" className="mono import-textarea" value={importText} onChange={event=>setImportText(event.target.value)} placeholder={csvMode?"name,path,template,enabled\nAdmin portal,/old-admin,FAKE_LOGIN,true":"/old-admin\n/legacy-api/status"}/><input type="file" accept=".csv,text/csv" onChange={async event=>{const file=event.target.files?.[0];if(file){setCsvMode(true);setImportText(await file.text());}}}/></div>{preview.length>0&&<div className="import-preview"><strong>{preview.length} routes in preview</strong>{preview.map((route,index)=><div key={`${route.path}-${index}`} className={route.error?"invalid":""}><code>{route.path||"Missing path"}</code><span>{route.error??`${route.template} · ${route.enabled?"enabled":"disabled"}`}</span></div>)}</div>}<div className="inline-actions"><button className="button button-primary" type="button" disabled={busy==="import"||!preview.length||preview.length>100||preview.some(route=>route.error)} onClick={importRoutes}>{busy==="import"?"Importing…":`Import ${preview.length||""} routes`}</button><button className="button button-secondary" type="button" onClick={()=>setImportOpen(false)}>Cancel</button></div></div></Panel>}
    <Panel title="Deployed decoys" description={`${routes.length} desired configurations · agent acknowledgement shown per route`}><div className="data-table-wrap"><table className="data-table"><thead><tr><th>Decoy</th><th>Route</th><th>Site</th><th>Triggers</th><th>Source</th><th>Sync</th>{canManage&&<th>Actions</th>}</tr></thead><tbody>{routes.map(route=><tr key={route.id}><td><div className="table-primary"><span className="table-icon"><Radar size={15}/></span><strong>{route.name}</strong></div></td><td><code>{route.path}</code></td><td>{route.site?.name??route.siteId}</td><td>{route.triggerCount}</td><td><StatusBadge label={route.source==="BUILT_IN"?"Built in":"Custom"}/></td><td><StatusBadge label={route.enabled?route.syncStatus??"Pending":"Disabled"}/></td>{canManage&&<td><div className="row-actions"><button className="icon-button" aria-label={`${route.enabled?"Disable":"Enable"} ${route.name}`} title={route.enabled?"Disable":"Enable"} disabled={busy===route.id} onClick={()=>toggle(route)}><Power size={14}/></button>{route.source==="CUSTOM"&&<><button className="icon-button" aria-label={`Edit ${route.name}`} title="Edit" onClick={()=>openEditor(route)}><Pencil size={14}/></button><button className="icon-button danger-button" aria-label={`Delete ${route.name}`} title="Delete" disabled={busy===route.id} onClick={()=>remove(route)}><Trash2 size={14}/></button></>}</div></td>}</tr>)}</tbody></table></div>{routes.length===0&&<div className="panel-body"><h3>No honeypot routes</h3><p className="muted">Create a site or wait for an enrolled WordPress agent to publish its built-in routes.</p></div>}<div className="mobile-card-list">{routes.map(route=><article className="mobile-data-card" key={route.id}><div className="mobile-data-top"><h3>{route.name}</h3><StatusBadge label={route.enabled?"Active":"Disabled"}/></div><p><code>{route.path}</code></p><div className="mobile-data-meta"><span>{route.site?.name}</span><span>{route.triggerCount} triggers</span><span>{route.source==="BUILT_IN"?"Built in":"Custom"}</span><span>{route.syncStatus??"Pending"}</span></div>{canManage&&<div className="inline-actions mobile-route-actions"><button className="button button-secondary button-sm" disabled={busy===route.id} onClick={()=>toggle(route)}>{route.enabled?"Disable":"Enable"}</button>{route.source==="CUSTOM"&&<><button className="button button-secondary button-sm" onClick={()=>openEditor(route)}>Edit</button><button className="button button-secondary button-sm danger-text" disabled={busy===route.id} onClick={()=>remove(route)}>Delete</button></>}</div>}</article>)}</div></Panel>
  </>;
}
