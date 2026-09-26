import { createHash } from "node:crypto";
import { setDefaultResultOrder } from "node:dns";
import { connect } from "node:net";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";

const EXPECTED_TARGET = "https://demo.finalyearproject.my";
const EXPECTED_CONTROL_PLANE = "https://smarthoneyai.xyz";
const CONFIRMATION = "AUTHORIZED-HYBRID-TEST";
const args = process.argv.slice(2);
const mode = args.find(value=>!value.startsWith("--")) ?? "dry-run";
const valueFor = flag => { const index=args.indexOf(flag); return index>=0 ? args[index+1] : undefined; };
const execute = args.includes("--execute");
const tokenFile = valueFor("--token-file");
const target = valueFor("--target") ?? EXPECTED_TARGET;
const controlPlane = valueFor("--control-plane") ?? EXPECTED_CONTROL_PLANE;
const confirmation = valueFor("--confirm");
const evidencePath = resolve(valueFor("--evidence") ?? "output/self-test/sensor-self-test.json");

// The authorized WordPress target is IPv4-only. Keep the control-plane start
// request on the same presenter address family so correlation uses the source
// that Hostinger actually observes instead of a parallel IPv6 egress address.
setDefaultResultOrder("ipv4first");

const plan = {
  mode,
  dryRun: !execute,
  controlPlane,
  target,
  safety: ["exact authorized target only","15-minute scoped token","one WordPress decoy","loopback-only local listeners","cleanup owns one run-created rule"]
};
if (!execute) {
  process.stdout.write(`${JSON.stringify(plan,null,2)}\nDry run only. No network request, container, probe, containment, or cleanup was performed.\n`);
  process.exit(0);
}
if (mode === "local") {
  const result=spawnSync("sh",["scripts/run-local-sensor-test.sh"],{cwd:process.cwd(),stdio:"inherit"});
  if(result.status!==0)throw new Error("LOCAL_SENSOR_TEST_FAILED");
  process.exit(0);
}
if (mode !== "hybrid") throw new Error("Use local or hybrid mode with --execute.");
if (target !== EXPECTED_TARGET || controlPlane !== EXPECTED_CONTROL_PLANE) throw new Error("LIVE_TARGET_REJECTED: arbitrary target or control-plane URLs are not accepted.");
if (confirmation !== CONFIRMATION) throw new Error(`CONFIRMATION_REQUIRED: pass --confirm ${CONFIRMATION}`);
if (!tokenFile) throw new Error("TOKEN_FILE_REQUIRED: pass --token-file with JSON containing runId and token.");
const tokenDocument = JSON.parse(await readFile(resolve(tokenFile),"utf8"));
if (!tokenDocument.runId || !tokenDocument.token) throw new Error("TOKEN_FILE_INVALID");
const authorization = {authorization:`Bearer ${tokenDocument.token}`,"content-type":"application/json"};
const api = async (path,options={}) => {
  const attempts=options.method ? 1 : 4;
  let lastError;
  for(let attempt=0;attempt<attempts;attempt+=1){
    try {
      const response=await fetch(`${controlPlane}${path}`,{...options,headers:{...authorization,...options.headers},signal:AbortSignal.timeout(20000)});
      const body=await response.json().catch(()=>({}));
      if(response.ok)return body;
      lastError=new Error(`${path} returned ${response.status}: ${body.message??"request failed"}`);
      if(response.status!==404&&response.status<500)throw lastError;
    } catch(error) { lastError=error; }
    if(attempt+1<attempts)await new Promise(resolveWait=>setTimeout(resolveWait,3000));
  }
  throw lastError;
};
const probe = port => new Promise((resolveProbe,reject)=>{const socket=connect({host:"127.0.0.1",port},()=>{socket.write(port===16379?"*1\r\n$4\r\nPING\r\n":"\r\n");setTimeout(()=>{socket.destroy();resolveProbe();},500);});socket.setTimeout(3000,()=>{socket.destroy();reject(new Error(`PROBE_${port}_TIMEOUT`));});socket.on("error",reject);});
const composeArgs=["compose","--env-file","client-sensor/.env","-f","client-sensor/docker-compose.yml","-f","client-sensor/docker-compose.local.yml","--profile","sensor"];
const evidence={...plan,startedAt:new Date().toISOString(),steps:[],sourceIpHash:null,incidentId:null,containmentRuleId:null,cleanup:false};
let contained=false;
let composeEnvironment={...process.env,SENSOR_RUNTIME_PROFILE:"local-self-test",SENSOR_BIND_ADDRESS:"127.0.0.1",SENSOR_DEMO_SOURCE_IP:"192.0.2.1",SENSOR_DEMO_RUN_ID:tokenDocument.runId,PROVIDER_FIREWALL_ALLOWLIST_CONFIRMED:"LOCAL_ONLY"};
try {
  const live=await fetch(`${controlPlane}/health/live`,{signal:AbortSignal.timeout(10000)}); if(!live.ok)throw new Error("CONTROL_PLANE_UNHEALTHY");
  const start=await api(`/v1/self-tests/${tokenDocument.runId}/start`,{method:"POST",body:JSON.stringify({confirmation:CONFIRMATION})});
  evidence.sourceIpHash=createHash("sha256").update(start.sourceIp).digest("hex");evidence.steps.push("control-plane-ready","self-test-started");
  composeEnvironment={...process.env,SENSOR_RUNTIME_PROFILE:"local-self-test",SENSOR_BIND_ADDRESS:"127.0.0.1",SENSOR_DEMO_SOURCE_IP:start.sourceIp,SENSOR_DEMO_RUN_ID:start.runId,PROVIDER_FIREWALL_ALLOWLIST_CONFIRMED:"LOCAL_ONLY"};
  const demoBuild=spawnSync("corepack",["pnpm","--filter","@honeypot/network-sensor-agent","build:demo"],{cwd:process.cwd(),env:{...process.env,CI:"true"},stdio:"inherit"});if(demoBuild.status!==0)throw new Error("LOCAL_SENSOR_DEMO_BUILD_FAILED");
  await copyFile(resolve("apps/network-sensor-agent/dist/index.js"),resolve("client-sensor/agent/index.js"));
  const up=spawnSync("docker",[...composeArgs,"up","--build","-d"],{cwd:process.cwd(),env:composeEnvironment,stdio:"inherit"});if(up.status!==0)throw new Error("LOCAL_SENSOR_START_FAILED");
  evidence.steps.push("local-sensor-started");
  await new Promise(resolveWait=>setTimeout(resolveWait,10_000));
  await Promise.all([probe(2222),probe(13306),probe(16379)]);evidence.steps.push("three-harmless-network-probes");
  const decoy=await fetch(`${target}/database/query?smarthoneyai-self-test=${encodeURIComponent(start.runId)}`,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:"query=SELECT+demo_probe",redirect:"manual",signal:AbortSignal.timeout(20000)});evidence.steps.push(`single-wordpress-decoy-${decoy.status}`);
  let status;
  for(let attempt=0;attempt<36;attempt+=1){status=await api(`/v1/self-tests/${start.runId}`);if(status.run.incident?.severity==="CRITICAL"&&status.run.hybridReady)break;await new Promise(resolveWait=>setTimeout(resolveWait,5000));}
  if(status?.run.incident?.severity!=="CRITICAL"||!status.run.hybridReady)throw new Error("HYBRID_CRITICAL_CORRELATION_TIMEOUT");
  evidence.incidentId=status.run.incident.id;evidence.steps.push("critical-correlation-confirmed");
  const containment=await api(`/v1/self-tests/${start.runId}/contain`,{method:"POST",body:JSON.stringify({confirmation:CONFIRMATION})});contained=true;evidence.containmentRuleId=containment.rule.id;evidence.steps.push("containment-applied");
  let blocked=false;for(let attempt=0;attempt<36;attempt+=1){const response=await fetch(target,{redirect:"manual",signal:AbortSignal.timeout(20000)});if(response.status===403){blocked=true;break;}await new Promise(resolveWait=>setTimeout(resolveWait,5000));}if(!blocked)throw new Error("WORDPRESS_403_TIMEOUT");evidence.steps.push("wordpress-403-confirmed");
  await api(`/v1/self-tests/${start.runId}/cleanup`,{method:"POST",body:"{}"});contained=false;evidence.cleanup=true;evidence.steps.push("owned-rule-cleaned");
  let restored=false;for(let attempt=0;attempt<36;attempt+=1){const response=await fetch(target,{redirect:"manual",signal:AbortSignal.timeout(20000)});if(response.status>=200&&response.status<400){restored=true;break;}await new Promise(resolveWait=>setTimeout(resolveWait,5000));}if(!restored)throw new Error("WORDPRESS_RECOVERY_TIMEOUT");evidence.steps.push("wordpress-access-restored");
} finally {
  if(!evidence.cleanup) { try { await api(`/v1/self-tests/${tokenDocument.runId}/cleanup`,{method:"POST",body:"{}"}); contained=false; evidence.cleanup=true; evidence.steps.push("scoped-run-cleaned"); } catch { evidence.steps.push("cleanup-needs-operator-review"); } }
  spawnSync("docker",[...composeArgs,"down"],{cwd:process.cwd(),env:composeEnvironment,stdio:"inherit"});
  await rm(resolve("client-sensor/agent/index.js"),{force:true});
  evidence.completedAt=new Date().toISOString();await mkdir(dirname(evidencePath),{recursive:true});await writeFile(evidencePath,`${JSON.stringify(evidence,null,2)}\n`,{mode:0o600});
  const markdown=evidencePath.replace(/\.json$/,".md");await writeFile(markdown,`# SmartHoneyAI Hybrid Sensor Self-Test\n\n- Started: ${evidence.startedAt}\n- Completed: ${evidence.completedAt}\n- Attribution: DEMO_OVERRIDE\n- Source hash: ${evidence.sourceIpHash}\n- Incident: ${evidence.incidentId}\n- Rule: ${evidence.containmentRuleId}\n- Cleanup: ${evidence.cleanup}\n\n## Steps\n\n${evidence.steps.map(step=>`- ${step}`).join("\n")}\n`,{mode:0o600});
}
process.stdout.write(`Self-test completed. Evidence: ${evidencePath}\n`);
