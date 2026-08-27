import type { EvidenceRecord, ProjectResearchWorkflow, ResearchGraphEntity, WikiPageDetail } from "@xiling/contracts";
import type { ContextNodeContent } from "@xiling/context";

export interface SourceContentResolverDependencies {
  getWikiPage(id: string): WikiPageDetail | undefined;
  listEvidence(projectId: string): EvidenceRecord[];
  getAgentRun(runId: string): { projectId: string; prompt: string; entries: Array<{ role: string; text: string }> } | undefined;
  getWorkflow(id: string): ProjectResearchWorkflow | undefined;
  readArtifact(uri: string, offsetBytes: number, maxBytes: number): Promise<{ text: string; truncated: boolean }>;
}

function resolved(body: string, label: string, locator?: string): { body: string; label: string; locator?: string } {
  return { body, label, ...(locator ? { locator } : {}) };
}

export class SourceContentResolver {
  constructor(private readonly dependencies: SourceContentResolverDependencies) {}

  async resolve(projectId: string, entity: ResearchGraphEntity, maxChars = 16_000): Promise<ContextNodeContent> {
    const result = await this.resolveContent(projectId, entity, maxChars);
    return { id: entity.id, title: entity.title, body: result.body.slice(0, maxChars), sourceLabel: result.label, ...(result.locator ? { sourceLocator: result.locator } : {}) };
  }

  private async resolveContent(projectId: string, entity: ResearchGraphEntity, maxChars: number): Promise<{ body: string; label: string; locator?: string }> {
    if (entity.kind === "SourceFragment") {
      const evidenceId = typeof entity.properties.evidenceRecordId === "string" ? entity.properties.evidenceRecordId : undefined;
      const evidence = evidenceId ? this.dependencies.listEvidence(projectId).find((record) => record.id === evidenceId) : undefined;
      if (evidence?.sourceQuote) return resolved(evidence.sourceQuote, "证据原文摘录", evidence.sourceLocator ?? entity.sourceLocator);
      if (evidence) return resolved(evidence.note, "阅读标注（非原文）", evidence.sourceLocator ?? entity.sourceLocator);
    }
    if (entity.kind === "Paper") {
      const paperId = typeof entity.properties.paperId === "string" ? entity.properties.paperId : undefined;
      const paper = paperId ? this.dependencies.listEvidence(projectId).find((record) => record.paper.id === paperId)?.paper : undefined;
      if (paper?.abstract) return resolved(paper.abstract, "数据源返回的论文摘要", paper.url ?? entity.sourceLocator);
    }
    if (entity.kind === "WikiRevisionRef" && entity.sourceLocator?.startsWith("wiki://")) {
      const match = /^wiki:\/\/([^/]+)\/revisions\/(\d+)$/.exec(entity.sourceLocator);
      const page = match ? this.dependencies.getWikiPage(match[1]!) : undefined;
      const revision = page && match ? page.revisions.find((candidate) => candidate.version === Number(match[2])) : undefined;
      if (page?.projectId === projectId && revision) return resolved(revision.markdown, `Wiki 已发布版本 v${revision.version}`, entity.sourceLocator);
    }
    if (entity.kind === "Actor" && entity.sourceLocator?.startsWith("agent-run://")) {
      const run = this.dependencies.getAgentRun(entity.sourceLocator.slice("agent-run://".length));
      if (run?.projectId === projectId) return resolved([`用户任务：${run.prompt}`, ...run.entries.map((entry) => `${entry.role}：${entry.text}`)].join("\n\n"), "耐久 Agent Run", entity.sourceLocator);
    }
    const workflowId = typeof entity.properties.workflowId === "string" ? entity.properties.workflowId : undefined;
    if (workflowId) {
      const workflow = this.dependencies.getWorkflow(workflowId);
      if (workflow?.projectId === projectId) return resolved(JSON.stringify({ request: workflow.request, status: workflow.status, metadata: workflow.metadata, run: workflow.run, review: workflow.review }, null, 2), "科研 Workflow 记录", `workflow://${workflow.id}`);
    }
    if (entity.kind === "ArtifactVersion" && entity.uri?.startsWith("artifact://")) {
      try {
        const artifact = await this.dependencies.readArtifact(entity.uri, 0, maxChars);
        if (artifact.text.trim()) return resolved(artifact.text, artifact.truncated ? "Artifact 文本片段" : "Artifact 文本", entity.uri);
      } catch { /* binary and unsupported Artifacts remain metadata-only */ }
    }
    const label = entity.kind === "Claim" || entity.kind === "ClaimRevision" ? "已确认科研主张" : "科研图结构化摘要（非原文）";
    return resolved(entity.summary, label, entity.sourceLocator ?? entity.uri);
  }
}
