"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, Menu, ShieldCheck } from "lucide-react";
import { Brand } from "./brand";

const links = [
  ["Features", "/features"],
  ["How it works", "/how-it-works"],
  ["Security", "/security"],
  ["WordPress", "/wordpress"],
  ["Docs", "/docs"]
] as const;

export function MarketingHeader() {
  const [open,setOpen]=useState(false);
  return (
    <header className="marketing-header">
      <nav className="container marketing-nav" aria-label="Main navigation">
        <Brand />
        <div className="marketing-links">
          {links.map(([label, href]) => <Link key={href} href={href}>{label}</Link>)}
        </div>
        <div className="nav-actions">
          <Link className="button button-ghost" href="/login">Log in</Link>
          <Link className="button button-primary button-sm" href="/request-access">Request access <ArrowRight size={15} /></Link>
          <button className="icon-button mobile-menu" type="button" aria-expanded={open} aria-controls="mobile-marketing-menu" aria-label={open?"Close navigation menu":"Open navigation menu"} onClick={()=>setOpen(!open)}><Menu size={19} /></button>
        </div>
      </nav>
      {open&&<nav id="mobile-marketing-menu" className="mobile-marketing-menu" aria-label="Mobile navigation">{links.map(([label,href])=><Link key={href} href={href} onClick={()=>setOpen(false)}>{label}</Link>)}<Link href="/login" onClick={()=>setOpen(false)}>Customer login</Link></nav>}
    </header>
  );
}

export function MarketingFooter() {
  return (
    <footer className="marketing-footer">
      <div className="container">
        <div className="footer-grid">
          <div className="footer-brand">
            <Brand />
            <p>A secure control plane that helps WordPress teams detect, understand, and safely respond to malicious traffic.</p>
          </div>
          <div className="footer-col"><strong>Product</strong><Link href="/features">Features</Link><Link href="/how-it-works">How it works</Link><Link href="/security">Security</Link></div>
          <div className="footer-col"><strong>Resources</strong><Link href="/docs">Documentation</Link><Link href="/wordpress">WordPress plugin</Link><Link href="/request-access">Request access</Link></div>
          <div className="footer-col"><strong>Company</strong><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><Link href="/login">Customer login</Link></div>
        </div>
        <div className="footer-bottom"><span>© {new Date().getFullYear()} SmartHoneyAI. All rights reserved.</span><span>Built with privacy, resilience, and safe defaults.</span></div>
      </div>
    </footer>
  );
}

export function MarketingShell({ children }: { children: React.ReactNode }) {
  return <div className="marketing-shell"><MarketingHeader />{children}<MarketingFooter /></div>;
}

export function PageHero({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <section className="page-hero"><div className="container"><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div></section>;
}

export function FinalCta() {
  return (
    <section className="marketing-section">
      <div className="container cta-panel">
        <div><h2>Make every WordPress site a smarter sensor.</h2><p>Join the controlled pilot and see coordinated threat intelligence across your portfolio.</p></div>
        <Link className="button button-primary" href="/request-access">Request pilot access <ArrowRight size={17} /></Link>
      </div>
    </section>
  );
}

export function SecurityPoint({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="security-list-item"><ShieldCheck size={19} aria-hidden="true" /><div><strong>{title}</strong><span>{children}</span></div></div>;
}
