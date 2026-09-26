import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "SmartHoneyAI — WordPress threat intelligence", template: "%s | SmartHoneyAI" },
  description: "AI-assisted honeypot monitoring and safe firewall control for WordPress teams.",
  applicationName: "SmartHoneyAI",
  robots: { index: true, follow: true }
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#07111F",
  width: "device-width",
  initialScale: 1
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main-content">Skip to main content</a>
        {children}
      </body>
    </html>
  );
}
