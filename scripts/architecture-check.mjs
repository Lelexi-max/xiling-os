import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, relative, sep } from "node:path";

const root = resolve(import.meta.dirname, "..");
const packageRoot = resolve(root, "packages");
const allowedInternalDependencies = new Map([
  ["contracts", new Set()],
  ["agent-harness", new Set(["contracts"])],
  ["api-contracts", new Set(["contracts"])],
  ["connectors", new Set(["contracts"])],
  ["context", new Set(["contracts"])],
  ["credentials", new Set(["contracts"])],
  ["knowledge", new Set(["contracts"])],
  ["literature", new Set(["contracts"])],
  ["multi-agent", new Set(["contracts"])],
  ["pi-runtime", new Set(["contracts"])],
  ["platform", new Set(["contracts"])],
  ["research-graph", new Set(["contracts"])],
  ["science-domains", new Set(["contracts"])],
]);

function files(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = resolve(directory, name);
    if (statSync(path).isDirectory()) return ["node_modules", "dist"].includes(name) ? [] : files(path);
    return /\.(?:ts|tsx)$/.test(name) ? [path] : [];
  });
}

const failures = [];
for (const [name, allowed] of allowedInternalDependencies) {
  const directory = resolve(packageRoot, name, "src");
  for (const file of files(directory)) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/(?:from\s+|import\s*\()["']@xiling\/([^/"']+)/g)) {
      const dependency = match[1];
      if (dependency !== name && !allowed.has(dependency)) failures.push(`${relative(root, file)} imports forbidden @xiling/${dependency}`);
    }
    if (/from\s+["'](?:\.\.\/)+\.\.\/apps\//.test(source)) failures.push(`${relative(root, file)} imports an app implementation`);
  }
}

for (const app of ["server", "web"]) {
  const sourceRoot = resolve(root, "apps", app, "src");
  for (const file of files(sourceRoot)) {
    const source = readFileSync(file, "utf8");
    if (source.includes(`${sep}packages${sep}`) || /from\s+["'](?:\.\.\/){3,}packages\//.test(source)) failures.push(`${relative(root, file)} deep-imports a package instead of its public export`);
  }
}

for (const scope of [resolve(root, "apps"), resolve(root, "packages")]) {
  for (const file of files(scope)) {
    const source = readFileSync(file, "utf8");
    if (!source.includes("@earendil-works/pi")) continue;
    const local = relative(root, file);
    if (!local.startsWith(`packages${sep}pi-runtime${sep}`)) failures.push(`${local} bypasses the Pi compatibility boundary`);
    if (/[@/]earendil-works\/pi[^"']*\/dist\//.test(source)) failures.push(`${local} imports a private Pi dist path`);
  }
}

for (const file of files(resolve(root, "apps"))) {
  const source = readFileSync(file, "utf8");
  const local = relative(root, file);
  if (/legacy-gate3|\/api\/gate3\//.test(source)) failures.push(`${local} references the retired Gate 3 product surface`);
  if (local.startsWith(`apps${sep}web${sep}`) && /research\/ResearchView/.test(source)) failures.push(`${local} imports the retired legacy research dashboard`);
}

// The orchestration kernel must remain discipline-neutral. Domain vocabulary
// belongs in science-domain manifests and explicit Server adapters.
const multiAgentCore = readFileSync(resolve(packageRoot, "multi-agent", "src", "index.ts"), "utf8");
if (/\bocean\b|\bargo\b|海洋|气候/iu.test(multiAgentCore)) failures.push("packages/multi-agent/src/index.ts hard-codes a science discipline; move it to a ScienceDomainManifest");

if (failures.length) {
  console.error(`Architecture boundary check failed:\n${failures.map((item) => `- ${item}`).join("\n")}`);
  process.exit(1);
}
console.log(`Architecture boundaries: ok (${allowedInternalDependencies.size} domain packages)`);
