import type {
  CanvasEdge,
  CanvasNode,
  ContextCapsule,
  ContextAssemblyTrace,
  ContextProjection,
  ContextProjectionRequest,
  ResourceUri,
} from "@xiling/contracts";
import { createHash } from "node:crypto";

export interface CapabilityDescriptor {
  id: string;
  description: string;
  keywords: string[];
}

export interface ProjectionStore {
  nodes: Map<string, CanvasNode>;
  capsules: Map<string, ContextCapsule>;
  edges?: CanvasEdge[];
}

function traceActiveBranch(activeNodeId: string, nodes: Map<string, CanvasNode>, edges?: CanvasEdge[]): string[] {
  if (edges) {
    if (!nodes.has(activeNodeId)) throw new Error(`Unknown canvas node: ${activeNodeId}`);
    const incoming = new Map<string, string[]>();
    for (const edge of edges) {
      if (edge.kind === "quote") continue;
      if (!nodes.has(edge.source) || !nodes.has(edge.target)) continue;
      incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge.source]);
    }
    const ordered: string[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const visit = (id: string) => {
      if (visiting.has(id)) throw new Error(`Canvas parent cycle detected at ${id}`);
      if (visited.has(id)) return;
      visiting.add(id);
      for (const parent of incoming.get(id) ?? []) visit(parent);
      visiting.delete(id);
      visited.add(id);
      ordered.push(id);
    };
    visit(activeNodeId);
    return ordered;
  }
  const branch: string[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined = activeNodeId;

  while (cursor) {
    if (seen.has(cursor)) throw new Error(`Canvas parent cycle detected at ${cursor}`);
    seen.add(cursor);
    const node = nodes.get(cursor);
    if (!node) throw new Error(`Unknown canvas node: ${cursor}`);
    branch.unshift(node.id);
    cursor = node.parentId;
  }

  return branch;
}

function discoverCapabilities(query: string, catalog: CapabilityDescriptor[]): string[] {
  const normalized = query.toLocaleLowerCase();
  return catalog
    .filter((item) => item.keywords.some((keyword) => normalized.includes(keyword.toLocaleLowerCase())))
    .map((item) => item.id);
}

export function projectContext(
  request: ContextProjectionRequest,
  store: ProjectionStore,
  catalog: CapabilityDescriptor[] = [],
): ContextProjection {
  const activeBranchNodeIds = traceActiveBranch(request.activeNodeId, store.nodes, store.edges);
  const quotedNodeIds = [...new Set(request.quotedNodeIds)].filter(
    (id) => !activeBranchNodeIds.includes(id),
  );

  for (const id of quotedNodeIds) {
    if (!store.nodes.has(id)) throw new Error(`Unknown quoted canvas node: ${id}`);
  }

  const selectedIds = [...activeBranchNodeIds, ...quotedNodeIds];
  const capsules = selectedIds
    .map((id) => store.capsules.get(id))
    .filter((capsule): capsule is ContextCapsule => capsule !== undefined);
  const artifactUris = new Set<ResourceUri>();
  let artifactReferences = 0;

  for (const id of selectedIds) {
    const uri = store.nodes.get(id)?.artifactUri;
    if (uri) { artifactUris.add(uri); artifactReferences += 1; }
  }
  for (const capsule of capsules) {
    for (const uri of capsule.artifactUris) { artifactUris.add(uri); artifactReferences += 1; }
  }

  const activatedCapabilities = request.activatedCapabilityIds
    ? [...new Set(request.activatedCapabilityIds)]
    : request.capabilityQuery
      ? discoverCapabilities(request.capabilityQuery, catalog)
      : [];

  const projectionIdentity = { activeBranchNodeIds, quotedNodeIds, capsuleRevisions: capsules.map((item) => [item.id, item.sourceRevision]), artifactUris: [...artifactUris].sort(), activatedCapabilities };
  const projectionHash = createHash("sha256").update(JSON.stringify(projectionIdentity)).digest("hex");
  return {
    activeBranchNodeIds,
    quotedNodeIds,
    capsules,
    artifactUris: [...artifactUris],
    activatedCapabilities,
    projectionHash,
    economy: { uniqueArtifactCount: artifactUris.size, reusedArtifactReferences: Math.max(0, artifactReferences - artifactUris.size), selectedNodeCount: selectedIds.length, capsuleReuseCount: capsules.length },
    explanation: [
      `活动分支 ${activeBranchNodeIds.length} 个节点`,
      `显式引用 ${quotedNodeIds.length} 个跨分支节点`,
      `复用 ${capsules.length} 个增量胶囊`,
      `按需激活 ${activatedCapabilities.length} 项能力`,
    ],
  };
}

const normalizeText = (value: string) => value.replace(/\s+/g, " ").trim();
const contentHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function meaningfulSentences(body: string): string[] {
  return normalizeText(body).split(/(?<=[。！？.!?])\s*/u).map((item) => item.trim()).filter(Boolean);
}

export function createNodeContextCapsule(input: { projectId: string; nodeId: string; title: string; body: string; artifactUris: ResourceUri[]; updatedAt?: string }): ContextCapsule {
  const sentences = meaningfulSentences(input.body);
  const summarySentences = sentences.length > 3 ? [sentences[0]!, sentences[Math.floor(sentences.length / 2)]!, sentences.at(-1)!] : sentences;
  const claimPattern = /显示|表明|支持|不支持|相关|导致|发现|结果|结论|suggest|show|indicat|result|conclu|correlat|cause/i;
  const claims = [...new Set(sentences.filter((sentence) => claimPattern.test(sentence)))].slice(0, 6);
  return {
    id: `node:${input.projectId}:${input.nodeId}`,
    sourceNodeId: input.nodeId,
    sourceRevision: contentHash([input.title, normalizeText(input.body), input.artifactUris]),
    summary: summarySentences.join(" ") || input.title,
    claims,
    artifactUris: [...new Set(input.artifactUris)],
    layer: "node",
    coveredNodeIds: [input.nodeId],
    ...(input.updatedAt ? { updatedAt: input.updatedAt } : {}),
  };
}

export interface ContextNodeContent {
  id: string;
  title: string;
  body: string;
}

export interface ContextHistoryMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  timestamp: number;
}

export interface ContextAssemblyInput {
  projection: ContextProjection;
  nodes: Map<string, ContextNodeContent>;
  history: ContextHistoryMessage[];
  modelContextWindow: number;
  maxOutputTokens: number;
  fixedPromptTokens: number;
  toolSchemaTokens: number;
  skillTokens: number;
  activatedSkillNames: string[];
  cache?: "hit" | "miss";
}

export interface ContextAssemblyResult {
  canvasText: string;
  history: ContextHistoryMessage[];
  trace: ContextAssemblyTrace;
}

export class ContextCapacityError extends Error {
  constructor(readonly requiredTokens: number, readonly availableTokens: number) {
    super(`本轮必需输入约需 ${requiredTokens} tokens，但当前模型可用输入空间约为 ${availableTokens} tokens；请缩短问题、移除部分引用或换用更长上下文模型。`);
  }
}

export function estimateContextTokens(text: string): number {
  const ascii = [...text].filter((character) => character.codePointAt(0)! < 128).length;
  const nonAscii = [...text].length - ascii;
  return Math.ceil(ascii / 4 + nonAscii / 1.7);
}

export function assembleContext(input: ContextAssemblyInput): ContextAssemblyResult {
  const safetyReserve = Math.max(2_048, Math.ceil(input.modelContextWindow * 0.08));
  const availableInputTokens = Math.max(0, input.modelContextWindow - input.maxOutputTokens - safetyReserve);
  const fixedTokens = input.fixedPromptTokens + input.toolSchemaTokens + input.skillTokens;
  if (fixedTokens > availableInputTokens) throw new ContextCapacityError(fixedTokens, availableInputTokens);
  const availableDynamicTokens = availableInputTokens - fixedTokens;
  const activeIds = input.projection.activeBranchNodeIds;
  const quoteIds = input.projection.quotedNodeIds;
  const exactIds = new Set([...activeIds.slice(-2), ...quoteIds]);
  const capsuleByNode = new Map(input.projection.capsules.map((capsule) => [capsule.sourceNodeId, capsule]));
  const capsuleIds: string[] = [];
  const lines: string[] = [];
  const oldBranchIds = activeIds.filter((id) => !exactIds.has(id));

  for (const id of oldBranchIds) {
    const capsule = capsuleByNode.get(id);
    const node = input.nodes.get(id);
    if (!capsule && !node) continue;
    lines.push(`[活动分支胶囊 · ${id}] ${node?.title ?? id}：${capsule?.summary ?? node?.body ?? ""}`);
    capsuleIds.push(id);
  }
  for (const id of [...activeIds.filter((candidate) => exactIds.has(candidate)), ...quoteIds]) {
    const node = input.nodes.get(id);
    if (!node) continue;
    lines.push(`[${quoteIds.includes(id) ? "显式引用原文" : "近期活动节点原文"} · ${id}] ${node.title}：${normalizeText(node.body)}`);
  }

  const canvasText = lines.map((line) => `- ${line}`).join("\n");
  const essentialTokens = estimateContextTokens(canvasText);
  if (essentialTokens > availableDynamicTokens) throw new ContextCapacityError(fixedTokens + essentialTokens, availableInputTokens);

  let remaining = availableDynamicTokens - essentialTokens;
  const history: ContextHistoryMessage[] = [];
  const normalized = normalizeContextHistoryWithStats(input.history);
  const normalizedHistory = normalized.messages;
  let omittedHistoryCount = normalized.droppedCount;
  const turns: ContextHistoryMessage[][] = [];
  for (let index = 0; index < normalizedHistory.length; index += 2) turns.push(normalizedHistory.slice(index, index + 2));
  for (const turn of [...turns].reverse()) {
    const tokens = turn.reduce((total, message) => total + estimateContextTokens(message.text) + 8, 0);
    if (tokens > remaining) {
      omittedHistoryCount += turns.slice(0, turns.indexOf(turn) + 1).reduce((total, item) => total + item.length, 0);
      break;
    }
    history.unshift(...turn);
    remaining -= tokens;
  }
  const degradations = [
    ...(capsuleIds.length ? [`${capsuleIds.length} 个较早画布节点使用持久化 Capsule，近期节点与显式引用保留原文。`] : []),
    ...(omittedHistoryCount ? [`模型窗口不足以容纳 ${omittedHistoryCount} 条较早的补充会话记录；这些记录未被静默裁切，可通过切换分支或更长上下文模型重新装载。`] : []),
  ];
  const historyTokens = history.reduce((total, message) => total + estimateContextTokens(message.text) + 8, 0);
  return {
    canvasText,
    history,
    trace: {
      projectionHash: input.projection.projectionHash,
      includedNodeIds: [...activeIds, ...quoteIds],
      exactNodeIds: [...exactIds],
      capsuleNodeIds: capsuleIds,
      omittedHistoryCount,
      activatedCapabilityIds: input.projection.activatedCapabilities,
      activatedSkillNames: input.activatedSkillNames,
      estimatedInputTokens: fixedTokens + essentialTokens + historyTokens,
      availableInputTokens,
      cache: input.cache ?? "miss",
      degradations,
    },
  };
}

/** Produces valid user/assistant turns before the current user prompt is appended. */
export function normalizeContextHistory(history: ContextHistoryMessage[]): ContextHistoryMessage[] {
  return normalizeContextHistoryWithStats(history).messages;
}

function normalizeContextHistoryWithStats(history: ContextHistoryMessage[]): { messages: ContextHistoryMessage[]; droppedCount: number } {
  const merged: Array<{ message: ContextHistoryMessage; sourceCount: number }> = [];
  let droppedCount = 0;
  for (const message of history) {
    if (!message.text.trim()) { droppedCount += 1; continue; }
    const previous = merged.at(-1);
    if (previous?.message.role === message.role) {
      merged[merged.length - 1] = { message: { ...message, id: `${previous.message.id}+${message.id}`, text: `${previous.message.text}\n\n${message.text}`, timestamp: Math.max(previous.message.timestamp, message.timestamp) }, sourceCount: previous.sourceCount + 1 };
    } else merged.push({ message, sourceCount: 1 });
  }
  while (merged[0]?.message.role === "assistant") droppedCount += merged.shift()!.sourceCount;
  while (merged.at(-1)?.message.role === "user") droppedCount += merged.pop()!.sourceCount;
  if (merged.length % 2 !== 0) droppedCount += merged.pop()!.sourceCount;
  return { messages: merged.map((item) => item.message), droppedCount };
}

export class ContextAssemblyCache {
  private readonly values = new Map<string, { value: ContextAssemblyResult; weight: number }>();
  private totalWeight = 0;
  constructor(private readonly maxEntries = 128, private readonly maxEstimatedTokens = 500_000) {}
  get(key: string): ContextAssemblyResult | undefined {
    const entry = this.values.get(key);
    if (!entry) return undefined;
    this.values.delete(key);
    this.values.set(key, entry);
    return structuredClone(entry.value);
  }
  set(key: string, value: ContextAssemblyResult): void {
    const weight = Math.max(1, value.trace.estimatedInputTokens);
    if (weight > this.maxEstimatedTokens) return;
    const previous = this.values.get(key);
    if (previous) this.totalWeight -= previous.weight;
    this.values.delete(key);
    this.values.set(key, { value: structuredClone(value), weight });
    this.totalWeight += weight;
    while (this.values.size > this.maxEntries || this.totalWeight > this.maxEstimatedTokens) {
      const oldestKey = this.values.keys().next().value;
      if (!oldestKey) break;
      const oldest = this.values.get(oldestKey)!;
      this.totalWeight -= oldest.weight;
      this.values.delete(oldestKey);
    }
  }
  key(value: unknown): string { return contentHash(value); }
  stats(): { entries: number; estimatedTokens: number } { return { entries: this.values.size, estimatedTokens: this.totalWeight }; }
}
