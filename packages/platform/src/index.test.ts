import { describe, expect, it } from "vitest";
import { planWindowsImport } from "./index.js";

describe("planWindowsImport", () => {
  it.each([
    ["C:\\Users\\海洋研究\\温度 数据.nc", "/mnt/c/Users/%E6%B5%B7%E6%B4%8B%E7%A0%94%E7%A9%B6/%E6%B8%A9%E5%BA%A6%20%E6%95%B0%E6%8D%AE.nc"],
    ["D:\\Argo\\profile.nc", "/mnt/d/Argo/profile.nc"],
  ])("plans a read-only NTFS source and content-addressed WSL snapshot", (source, expected) => {
    const result = planWindowsImport(source);
    expect(result.wslReadOnlyPath).toBe(expected);
    expect(result.importedArtifactUri).toMatch(/^artifact:\/\/[a-f0-9]{64}$/);
  });

  it.each([
    "\\\\server\\share\\data.nc",
    "C:\\data\\CON.nc",
    "C:\\data\\bad. ",
    "relative\\data.nc",
  ])("rejects unsupported or ambiguous source %s", (source) => {
    expect(() => planWindowsImport(source)).toThrow();
  });
});
