import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const forbidden = /\b(?:AGPL|SSPL)\b|Commons Clause/i;
const roots = [resolve("node_modules/.pnpm")];
const packages = new Map();

function visit(directory, depth = 0) {
  if (depth > 4) return;
  for (const name of readdirSync(directory, { withFileTypes: true })) {
    if (!name.isDirectory() || name.name === ".bin") continue;
    const child = resolve(directory, name.name);
    const manifest = resolve(child, "package.json");
    try {
      const data = JSON.parse(readFileSync(manifest, "utf8"));
      if (data.name && data.version) packages.set(`${data.name}@${data.version}`, { name: data.name, version: data.version, license: typeof data.license === "string" ? data.license : "NOASSERTION" });
    } catch {}
    if (name.name === "node_modules" || depth < 2) visit(child, depth + 1);
  }
}

for (const root of roots) { try { if (statSync(root).isDirectory()) visit(root); } catch {} }
const entries = [...packages.values()].sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));
const violations = entries.filter((item) => forbidden.test(item.license));
if (violations.length) throw new Error(`Forbidden dependency licenses: ${violations.map((item) => `${item.name}@${item.version} (${item.license})`).join(", ")}`);
if (entries.length < 20) throw new Error("Dependency inventory is unexpectedly incomplete; run pnpm install first");

if (process.argv.includes("--write-sbom")) {
  const namespaceHash = createHash("sha256").update(entries.map((item) => `${item.name}@${item.version}:${item.license}`).join("\n")).digest("hex");
  const document = {
    spdxVersion: "SPDX-2.3", dataLicense: "CC0-1.0", SPDXID: "SPDXRef-DOCUMENT", name: "XiLing-OS-dependencies",
    documentNamespace: `https://xiling.local/spdx/${namespaceHash}`,
    creationInfo: { created: new Date().toISOString(), creators: ["Tool: xiling-compliance-1"] },
    packages: entries.map((item, index) => ({ SPDXID: `SPDXRef-Package-${index + 1}`, name: item.name, versionInfo: item.version, downloadLocation: "NOASSERTION", filesAnalyzed: false, licenseConcluded: item.license, licenseDeclared: item.license, copyrightText: "NOASSERTION" })),
  };
  mkdirSync(resolve("build"), { recursive: true });
  writeFileSync(resolve("build/sbom.spdx.json"), `${JSON.stringify(document, null, 2)}\n`, "utf8");
}
console.log(`Dependency compliance: ok (${entries.length} packages, no AGPL/SSPL/Commons-Clause dependency)`);
