import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ResearchGraphProposalStore } from "./proposal-store.js";

describe("ResearchGraphProposalStore", () => {
  it("persists explicit proposal decisions and prevents a second decision", () => {
    const path = join(mkdtempSync(join(tmpdir(), "xiling-rg-proposal-")), "proposals.sqlite");
    const store = new ResearchGraphProposalStore(path);
    const proposal = store.create("project-1", { type: "create_claim", title: "海表增暖持续", summary: "在弱风条件下持续。" });
    expect(store.list("project-1")).toMatchObject([{ id: proposal.id, status: "pending" }]);
    expect(store.decide("project-1", proposal.id, "accepted", ["claim:1"])).toMatchObject({ status: "accepted", appliedEntityIds: ["claim:1"] });
    expect(store.decide("project-1", proposal.id, "rejected")).toBeUndefined();
    store.close();
    const restored = new ResearchGraphProposalStore(path);
    expect(restored.get("project-1", proposal.id)).toMatchObject({ status: "accepted" });
    restored.close();
  });
});
