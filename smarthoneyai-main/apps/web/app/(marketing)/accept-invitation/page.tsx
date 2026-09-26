import type { Metadata } from "next";
import { AcceptInvitationForm } from "@/components/account-recovery-forms";
import { Brand } from "@/components/brand";

export const metadata: Metadata = {
  title: "Accept invitation",
  robots: { index: false, follow: false }
};

export default function AcceptInvitationPage() {
  return <main id="main-content" className="auth-page">
    <div className="auth-card">
      <Brand/>
      <h1>Join your security team</h1>
      <p>Complete your profile to accept this time-limited SmartHoneyAI invitation.</p>
      <AcceptInvitationForm/>
    </div>
  </main>;
}
