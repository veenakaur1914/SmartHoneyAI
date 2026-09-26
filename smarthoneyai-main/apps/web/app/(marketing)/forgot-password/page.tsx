import type { Metadata } from "next";
import Link from "next/link";
import { ForgotPasswordForm } from "@/components/account-recovery-forms";
import { Brand } from "@/components/brand";

export const metadata: Metadata = {
  title: "Forgot password",
  robots: { index: false, follow: false }
};

export default function ForgotPasswordPage() {
  return <main id="main-content" className="auth-page">
    <div className="auth-card">
      <Brand/>
      <h1>Reset your password</h1>
      <p>Enter your account email and we will send a time-limited reset link.</p>
      <ForgotPasswordForm/>
      <div className="form-footer" style={{ marginTop: 18 }}><Link href="/login">Back to login</Link></div>
    </div>
  </main>;
}
