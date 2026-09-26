import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { apiGet } from "@/lib/api";

export const metadata: Metadata = { title: { default:"Dashboard", template:"%s | SmartHoneyAI" }, robots:{ index:false, follow:false } };
export default async function Layout({children}:{children:React.ReactNode}) {
  type AuthResponse = { user: { name:string; email:string; avatarEmoji:string; isPlatformAdmin:boolean; memberships:Array<{role:string;organization:{name:string}}> } };
  type SiteResponse = { data: Array<{ status:string; connectionStatus?:string }> };
  let auth: AuthResponse;
  let connectedSiteCount = 0;
  try {
    [auth, connectedSiteCount] = await Promise.all([
      apiGet<AuthResponse>("/v1/auth/me"),
      Promise.all([apiGet<SiteResponse>("/v1/sites"),apiGet<SiteResponse>("/v1/network-sensors")]).then((results) => results.flatMap((result)=>result.data).filter((site) => (site.connectionStatus ?? site.status) === "ONLINE").length)
    ]);
  } catch (error) {
    if ((error as Error & {status?:number}).status === 401) redirect("/login?next=/dashboard");
    throw error;
  }
  const membership = auth.user.memberships[0];
  return <DashboardShell user={auth.user} organizationName={membership?.organization.name ?? "Platform administration"} role={membership?.role ?? (auth.user.isPlatformAdmin ? "PLATFORM_ADMIN" : "VIEWER")} connectedSiteCount={connectedSiteCount}>{children}</DashboardShell>;
}
