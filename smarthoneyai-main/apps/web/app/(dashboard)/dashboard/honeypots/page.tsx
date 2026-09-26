import type { Metadata } from "next";
import { ShieldQuestion } from "lucide-react";
import { PageHeader } from "@/components/dashboard-ui";
import { apiGet } from "@/lib/api";
import type { HoneypotDeployment, Site } from "@/lib/control-plane-types";
import { HoneypotManagementClient } from "@/components/honeypot-management-client";

export const metadata:Metadata={title:"Honeypots"};

export default async function HoneypotsPage(){
  const [honeypotResult,siteResult]=await Promise.all([apiGet<{data:HoneypotDeployment[];canManage:boolean}>("/v1/honeypots"),apiGet<{data:Site[]}>("/v1/sites")]);
  return <><PageHeader title="Honeypots" description="Manage inert decoy routes and synchronized WordPress deployment."/><div className="notice" style={{marginBottom:16}}><ShieldQuestion size={16}/><span><strong>Safe application-layer decoys only.</strong> Routes return inert content, sanitize captured evidence, and never expose a real shell, database, archive, or authentication service.</span></div><HoneypotManagementClient routes={honeypotResult.data} sites={siteResult.data} canManage={honeypotResult.canManage}/></>;
}
