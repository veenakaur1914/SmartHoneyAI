import { Queue } from "bullmq";
import IORedis from "ioredis";
import { env } from "./env.js";

let connection: IORedis | undefined;
let replayConnection: IORedis | undefined;
let analysisQueue: Queue | undefined;
let alertQueue: Queue | undefined;
export function getRedis() {
  connection ??= new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true });
  return connection;
}
export function getAnalysisQueue() {
  analysisQueue ??= new Queue("threat-analysis", { connection: getRedis() });
  return analysisQueue;
}
export function getAlertQueue() {
  alertQueue ??= new Queue("alert-delivery", { connection: getRedis() });
  return alertQueue;
}

function newReplayConnection() {
  return new IORedis(env.REDIS_URL, {
    lazyConnect: true,
    enableOfflineQueue: false,
    connectTimeout: 1_000,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null
  });
}

export async function reserveAgentNonce(key: string, ttlSeconds: number): Promise<"accepted" | "replay" | "unavailable"> {
  if (!replayConnection || ["end", "close"].includes(replayConnection.status)) {
    replayConnection?.disconnect();
    replayConnection = newReplayConnection();
  }
  try {
    if (replayConnection.status === "wait") await replayConnection.connect();
    const accepted = await replayConnection.set(key, "1", "EX", ttlSeconds, "NX");
    return accepted === "OK" ? "accepted" : "replay";
  } catch {
    replayConnection.disconnect();
    replayConnection = undefined;
    return "unavailable";
  }
}

export async function replayProtectionReady() {
  if (!replayConnection || ["end", "close"].includes(replayConnection.status)) {
    replayConnection?.disconnect();
    replayConnection = newReplayConnection();
  }
  try {
    if (replayConnection.status === "wait") await replayConnection.connect();
    return await replayConnection.ping() === "PONG";
  } catch {
    replayConnection.disconnect();
    replayConnection = undefined;
    return false;
  }
}

export async function closeQueues() {
  await analysisQueue?.close();
  await alertQueue?.close();
  if (connection?.status === "ready") await connection.quit();
  else connection?.disconnect();
  if (replayConnection?.status === "ready") await replayConnection.quit();
  else replayConnection?.disconnect();
}
