import { Activity, ShieldCheck, Waypoints } from "lucide-react";
import { DashboardNavigation } from "./dashboard-navigation";

export function DashboardShell({children,user,organizationName,role,connectedSiteCount}:{children:React.ReactNode;user:{name:string;email:string;avatarEmoji:string;isPlatformAdmin:boolean};organizationName:string;role:string;connectedSiteCount:number}) {
  return <div className="dashboard-shell">
    <DashboardNavigation user={user} organizationName={organizationName} role={role} connectedSiteCount={connectedSiteCount}/>
    <div className="dashboard-main">
      <header className="topbar"><div className="site-selector"><ShieldCheck size={16} color="var(--success)"/><span>{organizationName}</span><strong> / All sensors</strong></div><div className="health-pill"><ShieldCheck size={13}/> Authenticated workspace</div></header>
      <div className="operations-bar" aria-label="Control plane capabilities">
        <span className="operations-live"><ShieldCheck size={12}/><strong>CONTROL PLANE</strong></span>
        <span><Activity size={13}/><em>Sessions</em><strong className="mono">Server-side</strong></span>
        <span><Waypoints size={13}/><em>Online assets</em><strong className="mono">{connectedSiteCount}</strong></span>
        <span><ShieldCheck size={13}/><em>Policies</em><strong className="mono">Versioned signatures</strong></span>
      </div>
      <main id="main-content" className="dashboard-content">{children}</main>
    </div>
  </div>;
}
