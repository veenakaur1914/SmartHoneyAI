import type { Metadata } from "next";
import { RequestAccessForm } from "@/components/access-forms";
import { Brand } from "@/components/brand";

export const metadata: Metadata = { title: "Request access" };
export default function AccessPage(){return <main id="main-content" className="auth-page"><div className="auth-card auth-card-wide"><Brand/><h1>Request pilot access</h1><p>Tell us about your WordPress portfolio. We approve controlled pilot workspaces manually.</p><RequestAccessForm/></div></main>}
