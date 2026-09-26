import { cookies } from "next/headers";
import { cache } from "react";

const apiBase = (process.env.API_URL || "http://localhost:4000").replace(/\/$/, "");

const apiGetForRequest = cache(async (path: string): Promise<unknown> => {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore.getAll().map(({ name, value }) => `${name}=${value}`).join("; ");
  const response = await fetch(`${apiBase}${path}`, {
    cache: "no-store",
    headers: cookieHeader ? { cookie: cookieHeader } : undefined
  });
  if (!response.ok) {
    const error = new Error(`Control plane request failed with ${response.status}`) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return response.json() as Promise<unknown>;
});

export async function apiGet<T>(path: string): Promise<T> {
  // React's request-scoped cache keeps the HTML render and its RSC payload on
  // one authenticated live-data snapshot. `cache: "no-store"` still ensures
  // that the next browser request receives current control-plane state.
  return apiGetForRequest(path) as Promise<T>;
}
