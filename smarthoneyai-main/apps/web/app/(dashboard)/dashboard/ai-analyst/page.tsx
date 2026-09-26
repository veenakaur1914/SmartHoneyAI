import type { Metadata } from "next";
import { BrainCircuit } from "lucide-react";
import { PageHeader } from "@/components/dashboard-ui";
import { AiAnalystClient } from "@/components/ai-analyst-client";
import { apiGet } from "@/lib/api";
import type { Site } from "@/lib/control-plane-types";

export const metadata:Metadata={title:"AI analyst"};

export default async function AiAnalystPage(){
  const sites=await apiGet<{data:Site[]}>("/v1/sites");
  return <><PageHeader title="AI analyst" description="Ask read-only questions about sanitized security evidence."/><div className="notice warning" style={{marginBottom:16}}><BrainCircuit size={16}/><span><strong>AI output is advisory.</strong> Verify findings against the linked event records before changing any security policy.</span></div><AiAnalystClient sites={sites.data}/></>;
}
