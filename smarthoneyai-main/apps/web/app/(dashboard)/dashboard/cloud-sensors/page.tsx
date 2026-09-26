import type { Metadata } from "next";
import { CloudSensorsClient } from "@/components/cloud-sensors-client";
import { apiGet } from "@/lib/api";
import type { NetworkSensor, Site } from "@/lib/control-plane-types";

export const metadata:Metadata={title:"Sensor modules"};
export default async function CloudSensorsPage(){
  const [{data},sites,auth]=await Promise.all([apiGet<{data:NetworkSensor[]}>("/v1/network-sensors"),apiGet<{data:Site[]}>("/v1/sites"),apiGet<{user:{isPlatformAdmin:boolean;memberships:Array<{role:string}>}}>("/v1/auth/me")]);
  const role=auth.user.memberships[0]?.role;
  return <CloudSensorsClient initialSensors={data} sites={sites.data} canManage={auth.user.isPlatformAdmin||role==="OWNER"||role==="ADMIN"}/>;
}
