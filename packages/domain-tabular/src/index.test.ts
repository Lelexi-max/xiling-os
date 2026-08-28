import { describe, expect, it } from "vitest";
import { TABULAR_EXPERIMENT_DOMAIN, TABULAR_VIEWERS, describeNumericColumns, importDelimitedText } from "./index.js";

describe("tabular experiment reference domain", () => {
  it("imports a CSV shape unlike ocean arrays and executes a deterministic statistics recipe", () => {
    const dataset = importDelimitedText("sample,batch,value\na,A,1\nb,A,2\nc,B,\nd,B,4\n");
    expect(describeNumericColumns(dataset, ["value"])[0]).toMatchObject({ count: 3, missing: 1, mean: 7 / 3, minimum: 1, maximum: 4 });
    expect(TABULAR_EXPERIMENT_DOMAIN).toMatchObject({ id: "tabular-experiment", connectorKinds: ["local-csv", "local-tsv"] });
    expect(TABULAR_VIEWERS.map((viewer) => viewer.id)).toContain("tabular-grid");
  });
  it("rejects malformed rows and non-numeric measurements", () => {
    expect(() => importDelimitedText("a,b\n1\n")).toThrow("expected 2");
    expect(() => describeNumericColumns(importDelimitedText("x\nnot-a-number\n"), ["x"])).toThrow("non-numeric");
  });
});
