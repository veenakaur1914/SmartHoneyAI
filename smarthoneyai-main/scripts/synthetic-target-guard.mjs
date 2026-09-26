const productionHosts = new Set(["smarthoneyai.xyz", "www.smarthoneyai.xyz"]);
const localHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function normalizeHostname(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\.$/, "");
}

function runtimeEnvironment(environment) {
  if (environment) return environment;
  return typeof process === "undefined" ? {} : process.env;
}

function explicitlyAllowedRemoteHosts(environment) {
  return new Set([
    environment.REMOTE_SYNTHETIC_HOST,
    ...(environment.REMOTE_SYNTHETIC_HOSTS ?? "").split(",")
  ].map(normalizeHostname).filter(Boolean));
}

export function assertSyntheticTarget(rawUrl, { label = "Synthetic-data script", environment: providedEnvironment } = {}) {
  let target;
  try {
    target = new URL(rawUrl);
  } catch {
    throw new Error(`${label} requires an absolute HTTP(S) target URL.`);
  }
  if (!new Set(["http:", "https:"]).has(target.protocol)) {
    throw new Error(`${label} refuses non-HTTP(S) target ${target.protocol}`);
  }

  const hostname = normalizeHostname(target.hostname);
  if (productionHosts.has(hostname)) {
    throw new Error(`${label} is permanently disabled for the SmartHoneyAI production domain.`);
  }
  if (localHosts.has(hostname)) return target;

  const environment = runtimeEnvironment(providedEnvironment);
  const remoteOptIn = environment.ALLOW_REMOTE_SYNTHETIC_DATA === "1";
  const allowedHosts = explicitlyAllowedRemoteHosts(environment);
  if (!remoteOptIn || !allowedHosts.has(hostname)) {
    throw new Error(`${label} refuses remote target ${target.origin}. Set ALLOW_REMOTE_SYNTHETIC_DATA=1 and explicitly list its hostname in REMOTE_SYNTHETIC_HOST or REMOTE_SYNTHETIC_HOSTS.`);
  }
  return target;
}

export function assertSyntheticTargets(targets) {
  for (const target of targets) {
    if (typeof target === "string") assertSyntheticTarget(target);
    else assertSyntheticTarget(target.url, { label: target.label });
  }
}

if (typeof process !== "undefined" && process.argv?.[1]?.endsWith("synthetic-target-guard.mjs")) {
  const targets = process.argv.slice(2);
  if (targets.length === 0) throw new Error("Pass at least one synthetic network target URL to validate.");
  targets.forEach((target, index) => assertSyntheticTarget(target, { label: `Synthetic target ${index + 1}` }));
}
