import type { LucideIcon } from "lucide-react";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, CheckCircle2, Circle, Eye, Info, ShieldAlert, ShieldCheck } from "lucide-react";

export function PageHeader({ title, description, actions }: { title:string; description:string; actions?:React.ReactNode }) {
  return <div className="page-header"><div><h1>{title}</h1><p>{description}</p></div>{actions&&<div className="page-actions">{actions}</div>}</div>;
}

export function StatusBadge({ label, kind="auto" }: { label:string; kind?:"auto"|"severity"|"state"|"health" }) {
  const key=label.toLowerCase();
  const severity=key.includes("critical")?"critical":key.includes("high")?"high":key.includes("medium")?"medium":"low";
  const state=key.includes("block")||key.includes("contain")||key.includes("resolve")?"contained":key.includes("investigat")?"investigating":key.includes("new")?"new":"observed";
  const health=key.includes("offline")||key.includes("failed")||key.includes("revoked")||key.includes("unavailable")||key.includes("rejected")||key.includes("expired")?"offline":key.includes("attention")||key.includes("pending")||key.includes("stale")||key.includes("retrying")||key.includes("degraded")||key.includes("awaiting")?"degraded":key.includes("online")||key.includes("healthy")||key.includes("sent")||key.includes("deliver")||key.includes("complete")||key.includes("applied")||key.includes("synchron")||key.includes("ready")?"healthy":"neutral";
  const auto=key.includes("critical")?"critical":key.includes("high")||key.includes("attention")||key.includes("pending")?"high":key.includes("medium")||key.includes("monitor")||key.includes("review")?"medium":key.includes("low")||key.includes("active")||key.includes("protected")||key.includes("online")||key.includes("deliver")||key.includes("propagat")||key.includes("contained")||key.includes("resolved")?"success":"neutral";
  const cls=kind==="severity"?severity:kind==="state"?state:kind==="health"?health:auto;
  const Icon=cls==="critical"?ShieldAlert:cls==="high"||cls==="degraded"?AlertTriangle:cls==="medium"?Info:cls==="contained"||cls==="healthy"||cls==="success"?ShieldCheck:cls==="observed"?Eye:cls==="new"?Circle:CheckCircle2;
  return <span className={`status-badge status-${cls} status-kind-${kind}`}><Icon/>{label}</span>;
}

export function MetricCard({ label,value,note,trend="up",change,icon:Icon }: {label:string;value:string;note:string;trend?:"up"|"down"|"flat";change?:string;icon:LucideIcon}) {
  return <article className="metric-card"><div className="metric-top"><span>{label}</span><span className="metric-icon"><Icon size={16}/></span></div><div className="metric-value"><strong>{value}</strong>{change&&<span className="metric-trend" style={trend==="down"?{color:"var(--danger)"}:undefined}>{trend==="up"?<ArrowUpRight size={12}/>:trend==="down"?<ArrowDownRight size={12}/>:null}{change}</span>}</div><div className="metric-note">{note}</div></article>;
}

export function Panel({title,description,action,children,className=""}:{title:string;description?:string;action?:React.ReactNode;children:React.ReactNode;className?:string}){return <section className={`panel ${className}`}><header className="panel-header"><div><h2>{title}</h2>{description&&<p>{description}</p>}</div>{action}</header>{children}</section>}
