export type Heartbeat = {
  pluginVersion:string;
  queueDepth:number;
  policyVersion:number;
  mode:string;
  health:string;
  droppedEvents?:number;
  lastErrorCode?:string|null;
  createdAt?:string;
};

export type Site = {
  id:string;
  name:string;
  kind?:"WORDPRESS"|"NETWORK_SENSOR";
  deploymentType?:"NORMAL_HOSTING"|"DOCKER";
  url:string|null;
  domain:string|null;
  status:string;
  connectionStatus?:string;
  enforcementMode:string;
  observeUntil?:string|null;
  pluginVersion?:string|null;
  currentPolicyVersion:number;
  lastSeenAt?:string|null;
  latestHeartbeat?:Heartbeat|null;
  policyState?:string;
  latestPolicy?:{version:number;sourceHash:string;expiresAt:string;createdAt:string;acknowledgement?:{status:string;createdAt:string}|null}|null;
  honeypots?:HoneypotDeployment[];
  pairedNetworkSensors?:Array<{id:string;name:string;status:string;lastSeenAt?:string|null;pluginVersion?:string|null}>;
};

export type Assessment = {
  status:string;
  threatType?:string|null;
  severity?:string|null;
  confidence?:number|null;
  recommendation?:string|null;
  evidenceSummary?:string|null;
};

export type SecurityEvent = {
  id:string;
  idempotencyKey:string;
  occurredAt:string;
  receivedAt:string;
  kind:string;
  action:string;
  method:string;
  path:string;
  ipAddress:string;
  userAgent?:string|null;
  payload?:string|null;
  honeypotKey?:string|null;
  protocol?:"HTTP"|"SSH"|"MYSQL"|"REDIS"|null;
  activity?:string|null;
  sourcePort?:number|null;
  destinationPort?:number|null;
  sessionId?:string|null;
  sourceAttribution?:"OBSERVED"|"DEMO_OVERRIDE";
  site:{name:string;kind?:"WORDPRESS"|"NETWORK_SENSOR"};
  assessments:Assessment[];
};

export type NetworkSensor = {
  id:string;
  name:string;
  status:string;
  connectionStatus:string;
  pluginVersion?:string|null;
  lastSeenAt?:string|null;
  sourceIpVerifiedAt?:string|null;
  sourceAttribution?:"OBSERVED"|"DEMO_OVERRIDE";
  pairedWordpressSite?:{id:string;name:string;domain:string|null;deploymentType:"NORMAL_HOSTING"|"DOCKER"}|null;
  latestHeartbeat?:{agentVersion:string;queueDepth:number;health:string;enabledServices:string[];droppedEvents:number;lastErrorCode?:string|null;createdAt:string}|null;
};

export type Incident = {
  id:string;
  title:string;
  summary:string;
  severity:string;
  threatType:string;
  status:string;
  sourceIpHash:string|null;
  firstSeenAt:string;
  lastSeenAt:string;
  site:{name:string;kind?:string};
  events:Array<{event:{siteId:string;protocol?:string|null;activity?:string|null;path:string;occurredAt:string;sourceAttribution?:"OBSERVED"|"DEMO_OVERRIDE";site:{name:string;kind:string}}}>;
  _count:{events:number};
};

export type FirewallRule = {
  id:string;
  siteId?:string|null;
  type:string;
  value:string;
  reason:string;
  priority:number;
  enabled:boolean;
  expiresAt?:string|null;
  createdAt:string;
};

export type HoneypotDeployment = {
  id:string;
  siteId:string;
  key:string;
  name:string;
  path:string;
  template:string;
  source:"BUILT_IN"|"CUSTOM";
  enabled:boolean;
  syncStatus?:string;
  triggerCount:number;
  site?:{name:string};
};

export type DashboardSummary = {
  sites:number;
  sensors:number;
  events24h:number;
  criticalOpen:number;
  blocked24h:number;
  recentEvents:SecurityEvent[];
};
