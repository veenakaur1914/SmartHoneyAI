import type { Metadata } from "next";
import Link from "next/link";
import { LoginForm } from "@/components/access-forms";
import { Brand } from "@/components/brand";

export const metadata: Metadata = { title: "Log in" };
export default function LoginPage(){return <main id="main-content" className="auth-page"><div className="auth-card"><Brand/><h1>Welcome back</h1><p>Access your SmartHoneyAI security workspace.</p><LoginForm/><div className="form-footer" style={{marginTop:18}}><Link href="/request-access">Need access?</Link><Link href="/forgot-password">Forgot password?</Link></div></div></main>}
