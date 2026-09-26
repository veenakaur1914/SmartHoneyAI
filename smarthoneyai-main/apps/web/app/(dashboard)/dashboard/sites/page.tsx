import type { Metadata } from "next";
import { SitesClient } from "@/components/sites-client";
import { apiGet } from "@/lib/api";
import type { Site } from "@/lib/control-plane-types";

export const metadata:Metadata={title:"Sites"};
export default async function SitesPage(){
  const [{data},auth]=await Promise.all([
    apiGet<{data:Site[]}>("/v1/sites"),
    apiGet<{user:{isPlatformAdmin:boolean;memberships:Array<{role:string}>}}>("/v1/auth/me")
  ]);
  const role=auth.user.memberships[0]?.role;
  const canManage=auth.user.isPlatformAdmin||role==="OWNER"||role==="ADMIN";
  return <SitesClient sites={data} canManage={canManage}/>;
}
