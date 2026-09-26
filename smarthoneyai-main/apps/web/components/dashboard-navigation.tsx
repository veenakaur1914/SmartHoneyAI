"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Activity, BrainCircuit, Building2, CircleGauge, CloudCog, FileBarChart, Flame, LogOut, Menu, MoreHorizontal, Radar, Settings, Siren, Users, Waypoints, X } from "lucide-react";
import { Brand } from "./brand";

const nav = [
  { label:"Monitor", items:[
    {label:"Overview",href:"/dashboard",icon:CircleGauge},
    {label:"Sites",href:"/dashboard/sites",icon:Waypoints},
    {label:"Sensor modules",href:"/dashboard/cloud-sensors",icon:CloudCog},
    {label:"Live events",href:"/dashboard/events",icon:Activity},
  ]},
  { label:"Investigate", items:[
    {label:"Incidents",href:"/dashboard/incidents",icon:Siren},
    {label:"Analytics",href:"/dashboard/analytics",icon:FileBarChart},
    {label:"AI analyst",href:"/dashboard/ai-analyst",icon:BrainCircuit}
  ]},
  { label:"Respond", items:[
    {label:"Firewall",href:"/dashboard/firewall",icon:Flame},
    {label:"Honeypots",href:"/dashboard/honeypots",icon:Radar}
  ]},
  { label:"Manage", items:[
    {label:"Team",href:"/dashboard/team",icon:Users},
    {label:"Settings",href:"/dashboard/settings",icon:Settings},
    {label:"Organizations",href:"/dashboard/platform/organizations",icon:Building2}
  ]}
];

const mobileNav = [
  {label:"Overview",href:"/dashboard",icon:CircleGauge},
  {label:"Events",href:"/dashboard/events",icon:Activity},
  {label:"Sites",href:"/dashboard/sites",icon:Waypoints},
  {label:"More",href:"/dashboard/settings",icon:MoreHorizontal}
];

export function DashboardNavigation({user,organizationName,role,connectedSiteCount}:{user:{name:string;email:string;avatarEmoji:string;isPlatformAdmin:boolean};organizationName:string;role:string;connectedSiteCount:number}) {
  const pathname=usePathname();
  const [mobileOpen,setMobileOpen]=useState(false);
  const active=(href:string)=>href==="/dashboard"?pathname===href:pathname.startsWith(href);
  const visibleNav=nav.map(group=>({...group,items:group.items.filter(item=>item.href!=="/dashboard/platform/organizations"||user.isPlatformAdmin)}));
  async function logout(){await fetch("/v1/auth/logout",{method:"POST",credentials:"include"});window.location.assign("/login");}
  return <div className={`dashboard-navigation ${mobileOpen?"mobile-open":""}`}>
    <button className="scrim" aria-label="Close navigation" onClick={()=>setMobileOpen(false)}/>
    <button className="icon-button mobile-menu-button dashboard-mobile-trigger" aria-label="Open navigation" onClick={()=>setMobileOpen(true)}><Menu size={18}/></button>
    <aside className="sidebar" aria-label="Product navigation">
      <div className="sidebar-brand"><div className="product-identity"><Brand href="/dashboard"/><span>Control plane</span></div><button className="icon-button mobile-menu" aria-label="Close navigation" onClick={()=>setMobileOpen(false)}><X size={18}/></button></div>
      <div className="sidebar-context"><span className="org-avatar" aria-hidden="true">🛡️</span><div><strong>{organizationName}</strong><span>{connectedSiteCount} {connectedSiteCount===1?"asset":"assets"} online</span></div></div>
      <nav className="sidebar-nav">{visibleNav.map(group=><div key={group.label}><div className="nav-group-label">{group.label}</div>{group.items.map(({label,href,icon:Icon})=><Link key={href} href={href} className={`sidebar-link ${active(href)?"active":""}`} onClick={()=>setMobileOpen(false)}><Icon size={17}/><span>{label}</span></Link>)}</div>)}</nav>
      <div className="sidebar-footer"><div className="user-block"><span className="user-avatar emoji-avatar" aria-label={`${user.name} profile emoji`}>{user.avatarEmoji}</span><span className="user-meta"><strong>{user.name}</strong><span>{role.replaceAll("_"," ").toLowerCase()}</span></span><button className="icon-button" type="button" aria-label="Log out" onClick={logout}><LogOut size={15}/></button></div></div>
    </aside>
    <nav className="mobile-bottom-nav" aria-label="Mobile navigation">{mobileNav.map(({label,href,icon:Icon})=><Link key={href} className={`mobile-bottom-link ${active(href)?"active":""}`} href={href}><Icon size={19}/><span>{label}</span></Link>)}</nav>
  </div>;
}
