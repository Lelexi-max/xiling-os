import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../apps/server/dist/app.js";
import { KnowledgeService } from "../packages/knowledge/dist/index.js";

const root = await mkdtemp(join(tmpdir(), "xiling-gate-4.5-c-smoke-"));
try {
  const first = createApp({ dataRoot: root });
  const session = await first.inject({ method: "POST", url: "/api/gate4/chat-sessions", payload: { projectId: "ocean-heatwave", title: "migration smoke" } });
  const sessionId = session.json().id;
  const legacyKnowledge = new KnowledgeService(join(root, "gate4", "knowledge.sqlite"));
  const legacy = legacyKnowledge.appendChatMessage(sessionId, { role: "user", text: "legacy prompt", status: "complete" });
  legacyKnowledge.close();
  await first.close();

  const restored = createApp({ dataRoot: root });
  const migrated = await restored.inject({ method: "GET", url: `/api/gate4/chat-sessions/${sessionId}/messages` });
  if (migrated.statusCode !== 200 || migrated.json()[0]?.id === legacy.id) throw new Error("Legacy transcript was not imported into Agent entries");
  const started = await restored.inject({ method: "POST", url: "/api/agent-center/runs", payload: { sessionId, projectId: "ocean-heatwave", prompt: "continue", clientCommandId: "formal-smoke", context: { activeNodeId: "research-question:ocean-heatwave", quotedNodeIds: [] } } });
  const runId = started.json().run?.id;
  if (started.statusCode !== 202 || !runId) throw new Error("Formal Agent command was not accepted");
  let snapshot;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    snapshot = (await restored.inject({ method: "GET", url: `/api/agent-center/runs/${runId}?projectId=ocean-heatwave` })).json();
    if (snapshot.run?.status === "completed") break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  if (snapshot?.run?.status !== "completed" || !snapshot.entries.some((entry) => entry.kind === "assistant")) throw new Error("Formal migrated turn did not settle durably");
  await restored.close();
  console.log("Gate 4.5-C migration and primary Chat smoke: ok");
} finally {
  await rm(root, { recursive: true, force: true });
}
