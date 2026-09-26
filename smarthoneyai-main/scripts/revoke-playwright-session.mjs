import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertSyntheticTarget } from "./synthetic-target-guard.mjs";

const statePath = resolve(process.argv[2] ?? "");
const baseUrl = (process.env.BASE_URL ?? "https://localhost").replace(/\/$/, "");
const origin = (process.env.APP_ORIGIN ?? baseUrl).replace(/\/$/, "");
const output = { status: "PASS", stateFound: false, sessionCookieFound: false, logoutStatus: null, verificationStatus: null, stateDeleted: false };

assertSyntheticTarget(baseUrl, { label: "Playwright session revocation" });

if (statePath && existsSync(statePath)) {
  output.stateFound = true;
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  const session = (state.cookies ?? []).find((cookie) => cookie.name === "hp_session");
  if (session?.value) {
    output.sessionCookieFound = true;
    const response = await fetch(`${baseUrl}/v1/auth/logout`, {
      method: "POST",
      headers: { cookie: `hp_session=${session.value}`, origin }
    });
    output.logoutStatus = response.status;
    const verification = await fetch(`${baseUrl}/v1/auth/me`, { headers: { cookie: `hp_session=${session.value}` } });
    output.verificationStatus = verification.status;
    // 401 from logout means the final UI flow already revoked this exact
    // session. Either way, the subsequent authenticated probe must be denied.
    if (![204, 401].includes(response.status) || verification.status !== 401) output.status = "FAIL";
  }
  // Minimize the recovery window even if unlinking fails unexpectedly.
  writeFileSync(statePath, `${JSON.stringify({ cookies: [], origins: [] })}\n`, { mode: 0o600 });
  rmSync(statePath, { force: true });
  output.stateDeleted = !existsSync(statePath);
  if (!output.stateDeleted) output.status = "FAIL";
}

process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
if (output.status !== "PASS") process.exitCode = 1;
