import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertSyntheticTarget } from "./synthetic-target-guard.mjs";

const root=resolve(process.cwd());
const baseUrl=(process.env.BASE_URL??"https://localhost").replace(/\/$/,"");
assertSyntheticTarget(baseUrl,{label:"Connection-state smoke test"});
const email=process.env.ADMIN_EMAIL??"admin@smarthoneyai.local";
const password=process.env.ADMIN_PASSWORD??readFileSync(`${root}/secrets/e2e/platform_admin_password`,"utf8").trim();
const composeBase=["compose","-p","honeypot-ai-e2e","-f",`${root}/docker-compose.yml`,"-f",`${root}/docker-compose.wordpress-demo.yml`];
const composeEnv={...process.env,E2E_SECRET_DIR:process.env.E2E_SECRET_DIR??`${root}/secrets/e2e`,APP_URL:baseUrl,E2E_APP_URL:baseUrl,PLATFORM_ADMIN_EMAIL:email,HF_MODEL_REVISION:process.env.HF_MODEL_REVISION??"0000000000000000000000000000000000000000"};

function compose(args,stdio="ignore"){
  return execFileSync("docker",[...composeBase,...args],{cwd:root,encoding:"utf8",stdio,env:composeEnv})?.trim();
}
function sql(statement){compose(["exec","-T","postgres","psql","-v","ON_ERROR_STOP=1","-U","honeypot","-d","honeypot_ai","-c",statement]);}
async function call(path,options={}){const response=await fetch(`${baseUrl}${path}`,options);const text=await response.text();const data=text?JSON.parse(text):null;if(!response.ok)throw new Error(`${path} returned ${response.status}: ${text.slice(0,300)}`);return{response,data};}

const login=await call("/v1/auth/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email,password})});
const cookie=login.response.headers.get("set-cookie")?.split(";")[0];
if(!cookie)throw new Error("Login did not return a session cookie");
const me=await call("/v1/auth/me",{headers:{cookie}});
const organizationId=me.data.user.memberships[0]?.organizationId;
if(!organizationId)throw new Error("Administrator has no organization");
const headers={cookie,"x-organization-id":organizationId};
const getSite=async()=>{
  const sites=await call("/v1/sites",{headers});
  const site=sites.data.data.find((item)=>item.domain==="localhost");
  if(!site)throw new Error("Enrolled localhost site was not found");
  return site;
};
const initial=await getSite();
if(!/^c[a-z0-9]+$/i.test(initial.id))throw new Error("Unsafe site id refused");
const id=initial.id;

sql(`UPDATE \"Site\" SET \"lastSeenAt\"=NOW()-INTERVAL '11 minutes', status='ONLINE' WHERE id='${id}';`);
const degradedByAge=await getSite();
if(degradedByAge.connectionStatus!=="DEGRADED")throw new Error(`Expected DEGRADED at 11 minutes, got ${degradedByAge.connectionStatus}`);

sql(`UPDATE \"Site\" SET \"lastSeenAt\"=NOW()-INTERVAL '16 minutes', status='ONLINE' WHERE id='${id}';`);
const offline=await getSite();
if(offline.connectionStatus!=="OFFLINE")throw new Error(`Expected OFFLINE at 16 minutes, got ${offline.connectionStatus}`);

sql(`UPDATE \"Site\" SET \"lastSeenAt\"=NOW(), status='ONLINE' WHERE id='${id}'; UPDATE \"AgentHeartbeat\" SET health='DEGRADED' WHERE id=(SELECT id FROM \"AgentHeartbeat\" WHERE \"siteId\"='${id}' ORDER BY \"createdAt\" DESC LIMIT 1);`);
const degradedByHealth=await getSite();
if(degradedByHealth.connectionStatus!=="DEGRADED")throw new Error(`Expected unhealthy heartbeat DEGRADED, got ${degradedByHealth.connectionStatus}`);

compose(["exec","-T","wordpress-cron","wp","eval-file","/demo/sync-wordpress.php","--path=/var/www/html"]);
const online=await getSite();
if(online.connectionStatus!=="ONLINE")throw new Error(`Expected sync recovery ONLINE, got ${online.connectionStatus}`);

console.log(JSON.stringify({ok:true,siteId:id,checks:{healthyUnderTenMinutes:initial.connectionStatus==="ONLINE",degradedAtElevenMinutes:true,offlineAtSixteenMinutes:true,unhealthyHeartbeatDegraded:true,syncRecoveryOnline:true}},null,2));
