import type { Metadata } from "next";
import { IncidentsClient } from "@/components/incidents-client";
import { apiGet } from "@/lib/api";
import type { Incident } from "@/lib/control-plane-types";

export const metadata:Metadata={title:"Incidents"};
export default async function IncidentsPage(){
  const [{data},auth]=await Promise.all([apiGet<{data:Incident[]}>("/v1/incidents"),apiGet<{user:{isPlatformAdmin:boolean;memberships:Array<{role:string}>}}>("/v1/auth/me")]);
  const role=auth.user.memberships[0]?.role;
  return <IncidentsClient incidents={data} canContain={auth.user.isPlatformAdmin||role==="OWNER"||role==="ADMIN"}/>;
}
