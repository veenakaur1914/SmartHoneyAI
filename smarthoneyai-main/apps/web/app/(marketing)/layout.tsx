import { MarketingShell } from "@/components/marketing-shell";

// Hostinger replaces Next.js build artifacts on deploy. Rendering marketing
// routes dynamically prevents CDN-cached HTML from referencing removed chunks.
export const dynamic = "force-dynamic";

export default function Layout({ children }: { children: React.ReactNode }) {
  return <MarketingShell>{children}</MarketingShell>;
}
