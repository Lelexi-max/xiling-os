import type { ScienceDomainManifest } from "@xiling/science-domains";

export const TABULAR_EXPERIMENT_DOMAIN: ScienceDomainManifest = {
  id: "tabular-experiment", version: "1.0.0", title: "表格实验科学", description: "面向实验室 CSV/TSV 测量、分组统计、质量控制与复现报告。", disciplines: ["experimental-science", "statistics"],
  promptFragments: ["本项目启用了表格实验领域包。检查单位、缺失值、重复测量、批次效应、异常值规则、样本量与统计假设。"],
  capabilities: [{ id: "tabular.inspect", toolName: "read_artifact_excerpt", description: "按需读取实验表格片段并规划描述统计", keywords: ["csv", "tsv", "表格", "实验", "均值", "标准差", "批次"], skillNames: [] }],
  agentRoles: [],
  connectorKinds: ["local-csv", "local-tsv"], artifactKinds: ["tabular-dataset", "statistical-summary", "quality-report"], schemaNamespaces: ["tabular", "experimental"],
};

export interface TabularDataset { delimiter: "," | "\t"; columns: string[]; rows: Array<Record<string, string>>; }
export interface NumericSummary { column: string; count: number; missing: number; mean: number; standardDeviation: number; minimum: number; maximum: number; }
export const TABULAR_VIEWERS = [{ id: "tabular-grid", mimeTypes: ["text/csv", "text/tab-separated-values"], mode: "virtualized-table" }, { id: "statistical-summary", mimeTypes: ["application/vnd.xiling.statistical-summary+json"], mode: "summary-table" }] as const;

function splitLine(line: string, delimiter: "," | "\t"): string[] {
  const cells: string[] = []; let current = ""; let quoted = false;
  for (let index = 0; index < line.length; index += 1) { const char = line[index]!; if (char === '"') { if (quoted && line[index + 1] === '"') { current += '"'; index += 1; } else quoted = !quoted; } else if (char === delimiter && !quoted) { cells.push(current); current = ""; } else current += char; }
  if (quoted) throw new Error("Unclosed quoted field"); cells.push(current); return cells;
}
export function importDelimitedText(text: string, delimiter: "," | "\t" = ","): TabularDataset {
  const lines = text.replace(/^\uFEFF/u, "").split(/\r?\n/u).filter((line) => line.length > 0); if (lines.length < 2) throw new Error("Tabular dataset requires a header and at least one row");
  const columns = splitLine(lines[0]!, delimiter).map((value) => value.trim()); if (columns.some((value) => !value) || new Set(columns).size !== columns.length) throw new Error("Tabular headers must be non-empty and unique");
  const rows = lines.slice(1).map((line, rowIndex) => { const cells = splitLine(line, delimiter); if (cells.length !== columns.length) throw new Error(`Row ${rowIndex + 2} has ${cells.length} cells; expected ${columns.length}`); return Object.fromEntries(columns.map((column, index) => [column, cells[index]!.trim()])); });
  return { delimiter, columns, rows };
}
export function describeNumericColumns(dataset: TabularDataset, columns: string[]): NumericSummary[] {
  return columns.map((column) => {
    if (!dataset.columns.includes(column)) throw new Error(`Unknown numeric column: ${column}`);
    const raw = dataset.rows.map((row) => row[column] ?? ""); const values = raw.filter(Boolean).map(Number); if (values.some((value) => !Number.isFinite(value))) throw new Error(`Column ${column} contains a non-numeric value`);
    const mean = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length); const variance = values.length > 1 ? values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1) : 0;
    return { column, count: values.length, missing: raw.length - values.length, mean, standardDeviation: Math.sqrt(variance), minimum: values.length ? Math.min(...values) : Number.NaN, maximum: values.length ? Math.max(...values) : Number.NaN };
  });
}
