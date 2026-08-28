import { describe, expect, it } from "vitest";
import { GENERAL_SCIENCE_DOMAIN, ScienceDomainRegistry } from "./index.js";

describe("science domain registry", () => {
  it("always composes the general research kernel with selected domains", () => {
    const registry = new ScienceDomainRegistry();
    registry.register({ ...GENERAL_SCIENCE_DOMAIN, id: "test-domain", title: "测试领域", capabilities: [{ id: "test.plan", toolName: "plan_test", description: "test", keywords: ["test"], skillNames: [] }], agentRoles: [] });
    const resolved = registry.resolve(["test-domain"]);
    expect(resolved.domainIds).toEqual(["general-science", "test-domain"]);
    expect(resolved.capabilities.map((item) => item.id)).toContain("test.plan");
    expect(resolved.agentRoles.map((item) => item.id)).toEqual(["research-explorer", "domain-executor", "independent-reviewer"]);
    expect(new Set(resolved.agentRoles.map((item) => item.id)).size).toBe(resolved.agentRoles.length);
  });

  it("rejects unknown and duplicate domain manifests", () => {
    const registry = new ScienceDomainRegistry();
    expect(() => registry.resolve(["untrusted-domain"])).toThrow("Unknown science domains");
    expect(() => registry.register(registry.get("general-science")!)).toThrow("Duplicate science domain");
  });
});
