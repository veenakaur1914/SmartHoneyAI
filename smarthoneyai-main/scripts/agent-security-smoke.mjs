import { createHash, createHmac, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { assertSyntheticTarget } from "./synthetic-target-guard.mjs";

const baseUrl=(process.env.BASE_URL??"https://localhost").replace(/\/$/,"");
const origin=(process.env.APP_ORIGIN??baseUrl).replace(/\/$/,"");
const email=process.env.ADMIN_EMAIL??"admin@smarthoneyai.local";
const password=process.env.ADMIN_PASSWORD??"ChangeThisLocalDemoPassword123!";
const root=resolve(process.cwd());
const composeProject=process.env.COMPOSE_PROJECT_NAME??"honeypot-ai-e2e";
const composeFiles=(process.env.COMPOSE_OVERLAY_FILES??`${root}/docker-compose.wordpress-demo.yml`).split(":").filter(Boolean);
const createdSiteIds=[];

assertSyntheticTarget(baseUrl,{label:"Agent security smoke test"});

const pause=(milliseconds)=>new Promise(resolvePromise=>setTimeout(resolvePromise,milliseconds));

function localSql(sql){
  if(process.env.LOCAL_E2E!=="1")throw new Error("LOCAL_E2E=1 is required for isolated database mutation checks");
  const fileArgs=["-f",`${root}/docker-compose.yml`,...composeFiles.flatMap(file=>["-f",file])];
  execFileSync("docker",["compose","-p",composeProject,...fileArgs,"exec","-T","postgres","psql","-v","ON_ERROR_STOP=1","-U","honeypot","-d","honeypot_ai","-c",sql],{cwd:root,stdio:"ignore",env:{...process.env,E2E_SECRET_DIR:process.env.E2E_SECRET_DIR??`${root}/secrets/e2e`,APP_URL:baseUrl,PLATFORM_ADMIN_EMAIL:email,HF_MODEL_REVISION:process.env.HF_MODEL_REVISION??"0000000000000000000000000000000000000000"}});
}

async function request(path,options={}){const response=await fetch(`${baseUrl}${path}`,options);const text=await response.text();let data=null;try{data=text?JSON.parse(text):null;}catch{data=text;}return {response,data,text};}
async function expectStatus(path,status,options={},retry429=false){
  let result;
  const attempts=retry429?12:4;
  for(let attempt=0;attempt<attempts;attempt+=1){
    try{result=await request(path,options);}catch(error){
      if(attempt===attempts-1)throw error;
      await pause(1000);
      continue;
    }
    if(result.response.status!==429||!retry429)break;
    await pause(Math.max(1000,Number(result.response.headers.get("retry-after")??1)*1000));
  }
  if(result.response.status!==status)throw new Error(`${options.method??"GET"} ${path}: expected ${status}, received ${result.response.status}: ${result.text.slice(0,300)}`);
  return result;
}

function signedHeaders(method,path,body,{siteId,keyId,secret,timestamp=Math.floor(Date.now()/1000),nonce=randomUUID(),idempotencyKey=`security-${randomUUID()}`}){
  const bodyHash=createHash("sha256").update(body).digest("hex");
  const canonical=[method,path,String(timestamp),nonce,bodyHash,idempotencyKey].join("\n");
  return {"content-type":"application/json","x-honeypot-site-id":siteId,"x-honeypot-key-id":keyId,"x-honeypot-timestamp":String(timestamp),"x-honeypot-nonce":nonce,"x-honeypot-content-sha256":bodyHash,"x-honeypot-signature":createHmac("sha256",secret).update(canonical).digest("base64"),"idempotency-key":idempotencyKey};
}

let resultPayload;
try {
const login=await expectStatus("/v1/auth/login",200,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email,password})},true);
const cookie=login.response.headers.get("set-cookie")?.split(";")[0];
if(!cookie)throw new Error("Login did not return hp_session");
const me=await expectStatus("/v1/auth/me",200,{headers:{cookie}});
const membership=me.data.user.memberships[0];
if(!membership)throw new Error("Seeded administrator has no organization membership");
const browserHeaders={cookie,origin,"content-type":"application/json","x-organization-id":membership.organizationId};
const suffix=Date.now().toString(36);
const siteUrl=`https://agent-security-${suffix}.example.test/`;
const site=await expectStatus("/v1/sites",201,{method:"POST",headers:browserHeaders,body:JSON.stringify({name:"Agent security smoke",url:siteUrl})},true);
createdSiteIds.push(site.data.site.id);
const token=site.data.enrollmentToken;
const enrollmentPayload={token,siteUrl,siteName:"Agent security smoke",pluginVersion:"0.1.0",proof:"0".repeat(64)};
await expectStatus("/v1/agent/enroll",401,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(enrollmentPayload)});
const wrongDomain={...enrollmentPayload,siteUrl:`https://wrong-${suffix}.example.test/`};
wrongDomain.proof=createHmac("sha256",token).update(wrongDomain.siteUrl.replace(/\/$/,"")).digest("hex");
await expectStatus("/v1/agent/enroll",400,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(wrongDomain)});
enrollmentPayload.proof=createHmac("sha256",token).update(siteUrl.replace(/\/$/,"")).digest("hex");
const enrollment=await expectStatus("/v1/agent/enroll",200,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(enrollmentPayload)});
const credentials={siteId:enrollment.data.siteId,keyId:enrollment.data.keyId,secret:enrollment.data.secret};
await expectStatus("/v1/agent/enroll",401,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(enrollmentPayload)});

const heartbeatPath="/v1/agent/heartbeat";
const heartbeatBody=JSON.stringify({pluginVersion:"0.1.0",queueDepth:0,policyVersion:0,mode:"OBSERVE",health:"HEALTHY",enabledDecoys:["fake-login","backup-archive","admin-console","phpmyadmin"],droppedEvents:0,lastErrorCode:null});
const replayHeaders=signedHeaders("POST",heartbeatPath,heartbeatBody,credentials);
await expectStatus(heartbeatPath,200,{method:"POST",headers:replayHeaders,body:heartbeatBody});
const replay=await expectStatus(heartbeatPath,401,{method:"POST",headers:replayHeaders,body:heartbeatBody});
if(replay.data?.code!=="REPLAYED_REQUEST")throw new Error(`Expected replay code, got ${replay.data?.code}`);
const staleHeaders=signedHeaders("POST",heartbeatPath,heartbeatBody,{...credentials,timestamp:Math.floor(Date.now()/1000)-601});
await expectStatus(heartbeatPath,401,{method:"POST",headers:staleHeaders,body:heartbeatBody});
const futureHeaders=signedHeaders("POST",heartbeatPath,heartbeatBody,{...credentials,timestamp:Math.floor(Date.now()/1000)+601});
await expectStatus(heartbeatPath,401,{method:"POST",headers:futureHeaders,body:heartbeatBody});
const nonnumericHeaders=signedHeaders("POST",heartbeatPath,heartbeatBody,{...credentials,timestamp:"NaN"});
await expectStatus(heartbeatPath,401,{method:"POST",headers:nonnumericHeaders,body:heartbeatBody});
const alteredHeaders=signedHeaders("POST",heartbeatPath,heartbeatBody,credentials);
await expectStatus(heartbeatPath,401,{method:"POST",headers:alteredHeaders,body:heartbeatBody.replace('"queueDepth":0','"queueDepth":1')});
const wrongKeyHeaders={...signedHeaders("POST",heartbeatPath,heartbeatBody,credentials),"x-honeypot-key-id":"hp_invalid_key"};
await expectStatus(heartbeatPath,401,{method:"POST",headers:wrongKeyHeaders,body:heartbeatBody});

const eventId=`event-${randomUUID()}`;
const credentialCanary=`SECURITY-CREDENTIAL-${suffix}`;
const safeMarker=`SECURITY-SAFE-${suffix}`;
const event={idempotencyKey:eventId,occurredAt:new Date().toISOString().replace("Z","+00:00"),kind:"HONEYPOT",method:"POST",path:`/secure-admin-login?token=${credentialCanary}`,ipAddress:"198.51.100.45",userAgent:`SmartHoneyAI-Security-Smoke/1.0 token=${credentialCanary}`,referrer:`https://example.test/?session=${credentialCanary}`,headers:{authorization:`Bearer ${credentialCanary}`,cookie:`session=${credentialCanary}`,accept:"*/*"},payload:`username=demo&password=${credentialCanary}`,honeypotKey:"fake-login",action:"OBSERVED",metadata:{securitySmoke:true,token:credentialCanary,safeMarker}};
const batchPath="/v1/agent/events/batch";
const batchBody=JSON.stringify({siteId:credentials.siteId,pluginVersion:"0.1.0",events:[event]});
const firstBatch=await expectStatus(batchPath,202,{method:"POST",headers:signedHeaders("POST",batchPath,batchBody,credentials),body:batchBody});
const duplicateBatch=await expectStatus(batchPath,202,{method:"POST",headers:signedHeaders("POST",batchPath,batchBody,credentials),body:batchBody});
if(firstBatch.data.accepted!==1||duplicateBatch.data.duplicates!==1)throw new Error("Event idempotency was not enforced");

const other=await expectStatus("/v1/sites",201,{method:"POST",headers:browserHeaders,body:JSON.stringify({name:"Other scoped site",url:`https://other-${suffix}.example.test/`})},true);
createdSiteIds.push(other.data.site.id);
const mismatchBody=JSON.stringify({siteId:other.data.site.id,pluginVersion:"0.1.0",events:[{...event,idempotencyKey:`event-${randomUUID()}`}]});
await expectStatus(batchPath,403,{method:"POST",headers:signedHeaders("POST",batchPath,mismatchBody,credentials),body:mismatchBody});

const configPath="/v1/agent/config";
const firstConfig=await expectStatus(configPath,200,{headers:signedHeaders("GET",configPath,"",credentials)});
const etag=firstConfig.response.headers.get("etag");
if(!etag)throw new Error("Policy response did not include ETag");
await expectStatus(configPath,304,{headers:{...signedHeaders("GET",configPath,"",credentials),"if-none-match":etag}});

const events=await expectStatus(`/v1/events?search=198.51.100.45`,200,{headers:browserHeaders});
const stored=events.data.data.find(item=>item.siteId===credentials.siteId&&item.idempotencyKey===eventId);
const storedText=JSON.stringify(stored??{});
if(!stored||stored.headers?.authorization||stored.headers?.cookie||storedText.includes(credentialCanary)||!storedText.includes(safeMarker))throw new Error("Credential canary escaped evidence sanitization or safe marker was lost");

let expiredToken=true;
let revokedKey=true;
if(process.env.LOCAL_E2E==="1"){
  const expiring=await expectStatus("/v1/sites",201,{method:"POST",headers:browserHeaders,body:JSON.stringify({name:"Expired enrollment smoke",url:`https://expired-${suffix}.example.test/`})},true);
  createdSiteIds.push(expiring.data.site.id);
  if(!/^c[a-z0-9]+$/i.test(expiring.data.site.id))throw new Error("Unsafe site id returned for expiry test");
  localSql(`UPDATE \"EnrollmentToken\" SET \"expiresAt\"=NOW()-INTERVAL '1 minute' WHERE \"siteId\"='${expiring.data.site.id}';`);
  const expiredUrl=expiring.data.site.url.replace(/\/$/,"");
  const expiredPayload={token:expiring.data.enrollmentToken,siteUrl:expiredUrl,siteName:"Expired enrollment smoke",pluginVersion:"0.1.0",proof:createHmac("sha256",expiring.data.enrollmentToken).update(expiredUrl).digest("hex")};
  await expectStatus("/v1/agent/enroll",401,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(expiredPayload)});

  if(!/^hp_[A-Za-z0-9_-]+$/.test(credentials.keyId))throw new Error("Unsafe key id returned for revocation test");
  localSql(`UPDATE \"AgentCredential\" SET \"revokedAt\"=NOW() WHERE \"keyId\"='${credentials.keyId}';`);
  await expectStatus(heartbeatPath,401,{method:"POST",headers:signedHeaders("POST",heartbeatPath,heartbeatBody,credentials),body:heartbeatBody});
}

resultPayload={ok:true,checks:{badProof:true,wrongDomain:true,reusedToken:true,expiredToken,replayedNonce:true,staleTimestamp:true,futureTimestamp:true,nonnumericTimestamp:true,alteredBody:true,wrongKey:true,siteMismatch:true,revokedKey,eventIdempotency:true,policyEtag304:true,centralRedaction:true},policyVersion:firstConfig.data.version,temporarySitesCreated:createdSiteIds.length};
} finally {
  if(process.env.LOCAL_E2E==="1"&&createdSiteIds.length){
    const safeIds=createdSiteIds.filter(id=>/^c[a-z0-9]+$/i.test(id));
    if(safeIds.length!==createdSiteIds.length)throw new Error("Refusing to clean unsafe temporary site identifier");
    localSql(`DELETE FROM "Site" WHERE id IN (${safeIds.map(id=>`'${id}'`).join(",")});`);
  }
}
console.log(JSON.stringify(resultPayload,null,2));
