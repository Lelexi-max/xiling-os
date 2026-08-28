import type { ResearchGraphChangeSet } from "./index.js";

export function createOceanResearchFixture(projectId = "ocean-heatwave-rg0"): ResearchGraphChangeSet {
  const nodes: ResearchGraphChangeSet["nodes"] = [
    { id: "project", projectId, kind: "Project", title: "西北太平洋海洋热浪研究", status: "active" },
    { id: "question", projectId, kind: "ResearchQuestion", title: "上层海洋层结是否放大 2023 年海洋热浪？", status: "accepted" },
    { id: "claim", projectId, kind: "ClaimRevision", title: "增强层结延长了表层暖异常持续时间", status: "accepted", revision: 1 },
    { id: "paper-support", projectId, kind: "Paper", title: "Upper-ocean stratification and marine heatwaves", uri: "project://papers/support" },
    { id: "fragment-support", projectId, kind: "SourceFragment", title: "Supporting result, Figure 4", sourceLocator: "paper-support#page=8&figure=4" },
    { id: "assertion-support", projectId, kind: "EvidenceAssertion", title: "观测结果支持层结延长暖异常", status: "accepted", stance: "supports", confidence: 0.86 },
    { id: "paper-refute", projectId, kind: "Paper", title: "Wind forcing dominates short marine heatwaves", uri: "project://papers/refute" },
    { id: "fragment-refute", projectId, kind: "SourceFragment", title: "Qualifying result, Section 3.2", sourceLocator: "paper-refute#page=5&section=3.2" },
    { id: "assertion-refute", projectId, kind: "EvidenceAssertion", title: "短时事件主要受风强迫控制", status: "accepted", stance: "refutes", confidence: 0.73 },
    { id: "dataset", projectId, kind: "DatasetSnapshot", title: "Argo 2023-07—08 温盐剖面快照", status: "verified", uri: "dataset://argo-rg0", properties: { variables: ["TEMP", "PSAL", "PRES"] } },
    { id: "code", projectId, kind: "ArtifactVersion", title: "混合层深度分析脚本 v1", status: "verified", uri: "artifact://rg0/code-v1" },
    { id: "run", projectId, kind: "ResearchRun", title: "Argo 层结与热含量计算", status: "succeeded", properties: { environment: "xiling-runner:research-os" } },
    { id: "artifact", projectId, kind: "Artifact", title: "层结—海洋热浪分析结果", status: "available", uri: "artifact://rg0/analysis" },
    { id: "artifact-v1", projectId, kind: "ArtifactVersion", title: "层结—海洋热浪分析结果 v1", status: "available", uri: "artifact://rg0/analysis/v1" },
    { id: "available-event", projectId, kind: "LifecycleEvent", title: "Artifact 校验通过并可用", status: "available" },
    { id: "review", projectId, kind: "ReviewReport", title: "自动 Reviewer：有条件接受", status: "accepted", summary: "数据和脚本可追溯；固定样例不能证明海盆尺度因果。" },
    { id: "wiki", projectId, kind: "WikiRevisionRef", title: "研究结论 Wiki v1", status: "accepted", revision: 1, uri: "project://wiki/findings/v1" },
    { id: "agent", projectId, kind: "Actor", title: "汐灵 Research Agent", status: "active" },
  ];

  const relation = (kind: ResearchGraphChangeSet["relations"][number]["kind"], sourceId: string, targetId: string) => ({ projectId, kind, sourceId, targetId });
  const relations: ResearchGraphChangeSet["relations"] = [
    relation("CONTAINS", "project", "question"),
    relation("CONTAINS", "project", "claim"),
    relation("CONTAINS", "project", "paper-support"),
    relation("CONTAINS", "project", "paper-refute"),
    relation("HAS_FRAGMENT", "paper-support", "fragment-support"),
    relation("HAS_FRAGMENT", "paper-refute", "fragment-refute"),
    relation("BASED_ON", "assertion-support", "fragment-support"),
    relation("ASSERTS", "assertion-support", "claim"),
    relation("BASED_ON", "assertion-refute", "fragment-refute"),
    relation("ASSERTS", "assertion-refute", "claim"),
    relation("CITES", "paper-refute", "paper-support"),
    relation("USED", "run", "dataset"),
    relation("USED", "run", "code"),
    relation("GENERATED", "run", "artifact-v1"),
    relation("DERIVED_FROM", "artifact-v1", "dataset"),
    relation("HAS_VERSION", "artifact", "artifact-v1"),
    relation("TRANSITIONED_BY", "artifact-v1", "available-event"),
    relation("EVALUATES", "review", "run"),
    relation("DOCUMENTS", "wiki", "claim"),
    relation("ASSOCIATED_WITH", "run", "agent"),
  ];
  return { projectId, nodes, relations };
}
