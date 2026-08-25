import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const designPath = resolve(root, "DESIGN.md");
const readmePath = resolve(root, "README.md");

if (!existsSync(designPath)) throw new Error("DESIGN.md is required at the repository root");
const design = readFileSync(designPath, "utf8");
const readme = readFileSync(readmePath, "utf8");
if (!readme.includes("[活设计文档](DESIGN.md)")) throw new Error("README.md must link to DESIGN.md as the living design entrypoint");

const requiredSections = [
  "## 1. 产品目标",
  "## 3. 总体架构",
  "## 4. 仓库结构与所有权",
  "## 5. 核心领域对象与数据所有权",
  "## 6. 关键运行流程",
  "## 11. 持久化、一致性与恢复",
  "## 14. 已知风险与后续边界",
  "## 15. 文档维护规则",
  "## 17. 变更记录",
];
for (const section of requiredSections) if (!design.includes(section)) throw new Error(`DESIGN.md is missing required section: ${section}`);

const markdownLinks = [...design.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((match) => match[1]);
for (const target of markdownLinks) {
  if (!target || target.startsWith("http://") || target.startsWith("https://") || target.startsWith("#")) continue;
  const path = target.split("#", 1)[0];
  if (path && !existsSync(resolve(dirname(designPath), decodeURIComponent(path)))) throw new Error(`DESIGN.md contains a broken local link: ${target}`);
}

console.log(`Living design document: ok (${requiredSections.length} required sections, ${markdownLinks.length} links)`);
