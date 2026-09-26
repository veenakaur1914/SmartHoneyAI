import Link from "next/link";
import { Activity, ArrowRight, BellRing, Bot, Check, FileLock2, Gauge, Network, PlugZap, Radar, ShieldCheck, Waypoints } from "lucide-react";
import { FinalCta, SecurityPoint } from "@/components/marketing-shell";
import { ProductPreview } from "@/components/product-preview";

const features = [
  { icon: Radar, title: "Purpose-built decoys", copy: "Detect scanners and automated attacks on inert WordPress routes without exposing real services." },
  { icon: Bot, title: "Explainable AI triage", copy: "Turn noisy request evidence into a threat class, confidence, severity, and clear recommendation." },
  { icon: Network, title: "One portfolio view", copy: "See site health, incidents, policy versions, and live activity across every connected WordPress site." },
  { icon: ShieldCheck, title: "Safe enforcement", copy: "Time-limit, sign, propagate, and acknowledge declarative firewall rules with allowlist priority." },
  { icon: BellRing, title: "Incident visibility", copy: "Review incident records created from high- and critical-severity classified events." },
  { icon: Gauge, title: "Resilient by design", copy: "Sites enforce locally from a signed cache, remain available during outages, and fail open after policy expiry." }
];

export default function HomePage() {
  return <main id="main-content">
    <section className="hero">
      <div className="container hero-grid">
        <div>
          <span className="eyebrow">WordPress threat intelligence</span>
          <h1>Turn hostile traffic into <span className="highlight">clear action.</span></h1>
          <p className="hero-copy">SmartHoneyAI connects lightweight WordPress sensors to a secure central brain—detecting malicious behavior, explaining risk, and coordinating safe protection across every site.</p>
          <div className="hero-actions"><Link className="button button-primary" href="/request-access">Request pilot access <ArrowRight size={17}/></Link><Link className="button button-secondary" href="/how-it-works">See how it works</Link></div>
          <div className="hero-proof"><span><Check size={14}/> No visitor data sold</span><span><Check size={14}/> Fail-open site protection</span><span><Check size={14}/> Tenant-isolated control plane</span></div>
        </div>
        <ProductPreview />
      </div>
    </section>

    <div className="logo-strip"><div className="container logo-strip-inner"><span className="trust-item"><PlugZap size={17}/> WordPress native</span><span className="trust-item"><FileLock2 size={17}/> Signed policies</span><span className="trust-item"><Activity size={17}/> Asynchronous analysis</span><span className="trust-item"><Waypoints size={17}/> Multi-site coordination</span></div></div>

    <section className="marketing-section" id="features"><div className="container">
      <div className="section-head"><div><span className="section-kicker">Focused protection</span><h2 className="section-title">Security operations without the noise.</h2></div><p className="section-copy">From first signal to verified action, every workflow is designed for fast understanding and cautious enforcement.</p></div>
      <div className="feature-grid">{features.map(({icon:Icon,title,copy}) => <article className="feature-card" key={title}><span className="feature-icon"><Icon size={21}/></span><h3>{title}</h3><p>{copy}</p><Link className="feature-link" href="/features">Explore capability <ArrowRight size={14}/></Link></article>)}</div>
    </div></section>

    <section className="marketing-section security-band"><div className="container"><div className="section-head"><div><span className="section-kicker">How it works</span><h2 className="section-title">From signal to protection in three steps.</h2></div></div><div className="process-grid">
      <div className="process-card"><div className="process-number">01</div><h3>Observe locally</h3><p>The plugin captures suspicious requests from inert decoys and local firewall matches—never normal browsing traffic.</p></div>
      <div className="process-card"><div className="process-number">02</div><h3>Understand centrally</h3><p>Redacted event evidence is durably ingested and classified asynchronously by the SmartHoneyAI control plane.</p></div>
      <div className="process-card"><div className="process-number">03</div><h3>Respond safely</h3><p>Authorized operators create bounded rules that are distributed as signed policies with protected ranges and automatic expiry.</p></div>
    </div></div></section>

    <section className="marketing-section"><div className="container security-layout"><div><span className="section-kicker">Secure by default</span><h2 className="section-title">The website always stays in control.</h2><p className="section-copy">The central platform guides WordPress. It never becomes a fragile dependency in the visitor request path.</p></div><div className="security-list"><SecurityPoint title="No synchronous control-plane calls">Normal WordPress requests evaluate locally cached rules without waiting for the control plane.</SecurityPoint><SecurityPoint title="Sensitive data is removed">Credentials, cookies, tokens, and authorization headers are stripped before storage or inference.</SecurityPoint><SecurityPoint title="Rules expire safely">Temporary blocks have explicit TTLs, allowlist precedence, signed versions, and agent acknowledgements.</SecurityPoint></div></div></section>
    <FinalCta />
  </main>;
}
