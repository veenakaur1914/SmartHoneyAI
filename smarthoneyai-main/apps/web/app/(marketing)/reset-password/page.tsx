import type { Metadata } from "next";
import { ResetPasswordForm } from "@/components/account-recovery-forms";
import { Brand } from "@/components/brand";

export const metadata: Metadata = {
  title: "Choose a new password",
  robots: { index: false, follow: false }
};

export default function ResetPasswordPage() {
  return <main id="main-content" className="auth-page">
    <div className="auth-card">
      <Brand/>
      <h1>Choose a new password</h1>
      <p>A successful reset signs out any other sessions for this account.</p>
      <ResetPasswordForm/>
    </div>
  </main>;
}
