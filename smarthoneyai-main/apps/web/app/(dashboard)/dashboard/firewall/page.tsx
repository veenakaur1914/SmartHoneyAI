import { FirewallClient } from "@/components/firewall-client";
import { apiGet } from "@/lib/api";
import type { FirewallRule, Site } from "@/lib/control-plane-types";

export default async function FirewallPage(){
  const [ruleResult,siteResult,auth]=await Promise.all([
    apiGet<{data:FirewallRule[]}>("/v1/firewall/rules"),
    apiGet<{data:Site[]}>("/v1/sites"),
    apiGet<{user:{isPlatformAdmin:boolean;memberships:Array<{role:string}>}}>("/v1/auth/me")
  ]);
  const role=auth.user.memberships[0]?.role;
  const canManage=auth.user.isPlatformAdmin||role==="OWNER"||role==="ADMIN";
  return <FirewallClient rules={ruleResult.data} sites={siteResult.data} canManage={canManage}/>;
}
