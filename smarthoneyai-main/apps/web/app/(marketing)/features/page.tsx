import type { Metadata } from "next";
import { Activity, BellRing, Bot, Boxes, FileBarChart, Flame, Globe2, ShieldCheck } from "lucide-react";
import { FinalCta, PageHero } from "@/components/marketing-shell";

export const metadata: Metadata = { title: "Features" };
const items = [
  [Activity,"Live security events","Follow suspicious requests as they move from durable ingestion through redaction and asynchronous classification."],
  [Bot,"AI-assisted investigation","Get threat class, confidence, severity, evidence summary, and a next-step recommendation—not an unexplained score."],
  [Boxes,"Multi-site operations","Manage health, plugin version, policy drift, and incidents across WordPress sites in one tenant-isolated workspace."],
  [Flame,"Application firewall control","Create bounded IP, route, user-agent, and rate-limit rules with explicit expiry, signed policy delivery, and agent acknowledgements."],
  [BellRing,"Incident visibility","Review incident records created from high- and critical-severity classified events."],
  [Globe2,"Minimized AI evidence","Classify bounded, sanitized request evidence without sending raw IP addresses, cookies, credentials, or authorization headers to the external AI provider."],
  [FileBarChart,"Auditable operations","Preserve incident context and an audit trail for sensitive firewall and enforcement changes."],
  [ShieldCheck,"Operational safeguards","Observe-only onboarding, fail-open policy expiry, revocable site keys, replay protection, and clear control-plane health."],
] as const;

export default function FeaturesPage(){return <main id="main-content"><PageHero eyebrow="Capabilities" title="Everything your team needs to turn attacks into decisions." description="SmartHoneyAI brings detection, investigation, coordinated policy, and resilient operations into one focused workspace."/><section className="marketing-section"><div className="container detail-grid">{items.map(([Icon,title,copy])=><article className="detail-card" key={title}><span className="feature-icon"><Icon size={21}/></span><h2>{title}</h2><p>{copy}</p></article>)}</div></section><FinalCta/></main>}
