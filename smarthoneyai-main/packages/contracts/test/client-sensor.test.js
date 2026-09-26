import assert from "node:assert/strict";
import test from "node:test";
import { EventBatchSchema, NetworkSensorCreateSchema, SelfTestCreateSchema, WordpressSiteCreateSchema } from "../dist/index.js";

test("existing WordPress site creation defaults to normal hosting", () => {
  const value=WordpressSiteCreateSchema.parse({name:"Existing site",url:"https://example.com"});
  assert.equal(value.deploymentType,"NORMAL_HOSTING");
});

test("paired local sensor mode is explicit", () => {
  const value=NetworkSensorCreateSchema.parse({name:"Presenter laptop",wordpressSiteId:"cm12345678901234567890123",localSelfTest:true});
  assert.equal(value.localSelfTest,true);
});

test("network demo attribution is preserved for API scope verification", () => {
  const parsed=EventBatchSchema.safeParse({sensorId:"cm12345678901234567890123",agentVersion:"1.1.0",events:[{idempotencyKey:"event-123456789",occurredAt:"2026-09-03T00:00:00Z",kind:"HONEYPOT",method:"CONNECT",path:"ssh://sensor:2222",ipAddress:"198.51.100.10",protocol:"SSH",sourceAttribution:"DEMO_OVERRIDE"}]});
  assert.equal(parsed.success,true);
  assert.equal(parsed.data.events[0].sourceAttribution,"DEMO_OVERRIDE");
  assert.equal(SelfTestCreateSchema.safeParse({siteId:"wrong",sensorId:"wrong"}).success,false);
});
