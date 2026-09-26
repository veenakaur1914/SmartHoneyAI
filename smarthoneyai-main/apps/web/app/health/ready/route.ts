import { NextResponse } from "next/server";

const apiBase = (process.env.API_URL || "http://localhost:4000").replace(/\/$/, "");

export async function GET() {
  try {
    const response = await fetch(`${apiBase}/health/ready`, { cache: "no-store", signal: AbortSignal.timeout(2500) });
    if (!response.ok) throw new Error(`Control plane returned ${response.status}`);
    return NextResponse.json({ status: "ready", service: "smarthoneyai-web", controlPlane: "ready" });
  } catch {
    return NextResponse.json({ status: "not-ready", service: "smarthoneyai-web", controlPlane: "unavailable" }, { status: 503 });
  }
}
