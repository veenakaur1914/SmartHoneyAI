#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtimeTargets = [
  "apps/api/src",
  "apps/worker/src",
  "apps/web/app",
  "apps/web/components",
  "packages/database/prisma/seed.ts",
  "docker-compose.dokploy.yml",
  "Dockerfile",
  "nginx"
];
const allowedExtensions = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".yml", ".yaml", ".conf", ".sh", ""]);
const forbidden = [
  ["runtime demo-seeding switch", /SEED_DEMO_DATA/],
  ["legacy demo workspace", /Demo Security Operations|demo-security/i],
  ["seeded demo WordPress site", /Demo WordPress Store|demo\.wordpress\.local/i],
  ["fabricated tenant identity", /Honeydemo Digital|Meridian Group|North Coast Agency|Sentinel Pilot/i],
  ["fabricated user identity", /Aisha Rahman|Daniel Lee|Mei Tan|Faris Ahmad|Siti Amira|Jason Lim|Nur Fazila/i],
  ["fabricated dashboard metric", /18,409|11,409|4,182|2,814/]
];

function filesAt(path) {
  const absolute = resolve(root, path);
  if (!existsSync(absolute)) return [];
  if (!statSync(absolute).isDirectory()) return [absolute];
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => filesAt(`${path}/${entry.name}`));
}

const failures = [];
for (const file of runtimeTargets.flatMap(filesAt)) {
  if (!allowedExtensions.has(extname(file))) continue;
  const content = readFileSync(file, "utf8");
  for (const [label, pattern] of forbidden) {
    if (pattern.test(content)) failures.push(`${file.slice(root.length + 1)}: ${label}`);
  }
}

for (const disabledRoute of [
  "apps/web/app/(dashboard)/dashboard/alerts/page.tsx",
  "apps/web/app/(dashboard)/dashboard/reports/page.tsx"
]) {
  if (existsSync(resolve(root, disabledRoute))) failures.push(`${disabledRoute}: unfinished dashboard route must remain unavailable`);
}

if (failures.length) {
  console.error("Production fixture guard failed:\n" + failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}
console.log("Production fixture guard passed: deployable runtime contains no known demo fixtures or unfinished dashboard routes.");
