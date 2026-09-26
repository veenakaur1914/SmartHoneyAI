import { createServer } from "node:http";

let ingestAttempts=0;
const accepted=new Map();
const readBody=request=>new Promise(resolve=>{let body="";request.setEncoding("utf8");request.on("data",chunk=>body+=chunk);request.on("end",()=>resolve(body));});
createServer(async(request,response)=>{
  if(request.method==="POST"&&request.url==="/v1/network-sensors/enroll")return response.writeHead(200,{"content-type":"application/json"}).end(JSON.stringify({sensorId:"cm12345678901234567890123",keyId:"ns_local",secret:"s".repeat(48)}));
  if(request.method==="POST"&&request.url==="/v1/agent/events/batch"){
    ingestAttempts+=1;const raw=await readBody(request);if(ingestAttempts===1)return response.writeHead(503).end();
    const batch=JSON.parse(raw);for(const event of batch.events??[])accepted.set(event.idempotencyKey,event);return response.writeHead(202,{"content-type":"application/json"}).end(JSON.stringify({accepted:batch.events?.length??0}));
  }
  if(request.method==="POST"&&request.url==="/v1/network-sensors/heartbeat")return response.writeHead(200,{"content-type":"application/json"}).end(JSON.stringify({status:"ok"}));
  if(request.url==="/evidence")return response.writeHead(200,{"content-type":"application/json"}).end(JSON.stringify({ingestAttempts,events:[...accepted.values()]}));
  response.writeHead(404).end();
}).listen(4088,"0.0.0.0");
