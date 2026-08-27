import { describe, expect, it } from "vitest";
import { ScienceDomainRegistry } from "./index.js";

describe("science domain registry", () => {
  it("always composes the general research kernel with selected domains", () => {
    const resolved = new ScienceDomainRegistry().resolve(["ocean-climate"]);
    expect(resolved.domainIds).toEqual(["general-science", "ocean-climate"]);
    expect(resolved.capabilities.map((item) => item.id)).toContain("ocean.subset.plan");
    expect(resolved.agentRoles.map((item) => item.id)).toEqual(expect.arrayContaining(["literature-scout", "ocean-analyst"]));
    expect(new Set(resolved.agentRoles.map((item) => item.id)).size).toBe(resolved.agentRoles.length);
  });

  it("rejects unknown and duplicate domain manifests", () => {
    const registry = new ScienceDomainRegistry();
    expect(() => registry.resolve(["untrusted-domain"])).toThrow("Unknown science domains");
    expect(() => registry.register(registry.get("general-science")!)).toThrow("Duplicate science domain");
  });
});
