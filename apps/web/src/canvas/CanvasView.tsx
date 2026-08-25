import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
  type NodeMouseHandler,
  type NodeProps,
  type NodeTypes,
  type OnNodeDrag,
  type ReactFlowInstance,
} from "@xyflow/react";
import type { CanvasEdge, CanvasEdgeKind, CanvasGraphDocument, CanvasLayoutNodeData, Gate4Project, ModelRuntimeStatus } from "@xiling/contracts";
import { RecordDetailModal } from "../components/RecordDetailModal.js";
import { useConversations } from "../workspace/ConversationContext.js";
import { runResearchTurn } from "../lib/research-session-client.js";
import { formatAttachmentSize, nativeImageUpload, NATIVE_IMAGE_ACCEPT, readNativeImages, type PendingNativeImage } from "../lib/native-image-input.js";

type ResearchData = CanvasLayoutNodeData;
type ResearchNode = Node<ResearchData, "research">;
type ResearchEdge = Edge<{ kind: CanvasEdgeKind }>;

type CanvasInteraction = {
  activeNodeId: string;
  quotedNodeIds: Set<string>;
  follow: (id: string) => void;
  quote: (id: string) => void;
  duplicate: (id: string) => void;
  openSource: (id: string) => void;
};

const CanvasInteractionContext = createContext<CanvasInteraction | null>(null);

function ResearchCard({ id, data, selected }: NodeProps<ResearchNode>) {
  const [expanded, setExpanded] = useState(false);
  const interaction = useContext(CanvasInteractionContext);
  const active = interaction?.activeNodeId === id;
  const quoted = interaction?.quotedNodeIds.has(id);
  return (
    <article className={`research-card ${data.tone} ${active ? "active-context" : ""} ${quoted ? "quoted-context" : ""} ${selected ? "canvas-selected" : ""}`}>
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <div className="node-drag-strip"><span /><span /><span /></div>
      <small><i />{data.eyebrow}</small><h3>{data.title}</h3><p className="record-preview">{data.body}</p>
      {data.body.length > 220 ? <button className="record-expand nodrag" onClick={(event) => { event.stopPropagation(); setExpanded(true); }}>查看全文 <span>↗</span></button> : null}
      <footer className="nodrag"><span>Pi · 刚刚</span><button aria-label="更多">•••</button></footer>
      <div className="node-actions nodrag" aria-label="节点操作">
        <button title="从这里继续，自动携带上游上下文" onClick={(event) => { event.stopPropagation(); interaction?.follow(id); }}>↳ <span>继续</span></button>
        <button className={quoted ? "active" : ""} title="加入下一条提示的显式引用" onClick={(event) => { event.stopPropagation(); interaction?.quote(id); }}>“” <span>{quoted ? "已引用" : "引用"}</span></button>
        <button title="复制为同一上游下的新分支" onClick={(event) => { event.stopPropagation(); interaction?.duplicate(id); }}>＋ <span>分支</span></button>
        <button title="打开节点来源" onClick={(event) => { event.stopPropagation(); interaction?.openSource(id); }}>↗ <span>来源</span></button>
      </div>
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
      {expanded ? <RecordDetailModal eyebrow={data.eyebrow} title={data.title} onClose={() => setExpanded(false)}><div className="record-full-text">{data.body}</div></RecordDetailModal> : null}
    </article>
  );
}

const nodeTypes: NodeTypes = { research: ResearchCard };
const projectNodes = (project: Gate4Project): ResearchNode[] => [
  { id: "question", type: "research", position: { x: 400, y: 90 }, data: { eyebrow: "RESEARCH QUESTION", title: project.name, body: project.researchQuestion, tone: "prompt", source: { kind: "project" }, createdAt: project.createdAt } },
  { id: "decompose", type: "research", position: { x: 400, y: 315 }, data: { eyebrow: "PI RESPONSE", title: "等待研究拆解", body: "从 Chat 或画布提交任务后，Pi 会在当前项目中建立证据与数据分支。", tone: "answer", source: { kind: "project" }, createdAt: project.createdAt } },
  { id: "literature", type: "research", position: { x: 160, y: 540 }, data: { eyebrow: "PAPER BRANCH", title: "文献证据", body: "当前项目尚未固定论文。", tone: "paper", source: { kind: "project" }, createdAt: project.createdAt } },
  { id: "dataset", type: "research", position: { x: 640, y: 540 }, data: { eyebrow: "DATA BRANCH", title: "数据计划", body: "当前项目尚未确认数据范围。", tone: "data", source: { kind: "project" }, createdAt: project.createdAt } },
];
const initialCanvasEdges: CanvasEdge[] = [
  { id: "edge-question-decompose", source: "question", target: "decompose", kind: "follow-up" },
  { id: "edge-decompose-literature", source: "decompose", target: "literature", kind: "follow-up" },
  { id: "edge-decompose-dataset", source: "decompose", target: "dataset", kind: "follow-up" },
];
const edgeColor: Record<CanvasEdgeKind, string> = { "follow-up": "#8190a0", quote: "#8175aa", produced: "#347f7b", checkpoint: "#a47b52" };
const researchEdge = (edge: CanvasEdge): ResearchEdge => ({
  ...edge,
  type: "default",
  data: { kind: edge.kind },
  style: { stroke: edgeColor[edge.kind], strokeWidth: 1.25, ...(edge.kind === "quote" || edge.kind === "checkpoint" ? { strokeDasharray: "4 5" } : {}) },
  markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12, color: edgeColor[edge.kind] },
  ariaLabel: `${edge.kind}: ${edge.source} → ${edge.target}`,
});
const serializeEdges = (edges: ResearchEdge[]): CanvasEdge[] => edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, kind: edge.data?.kind ?? "follow-up" }));
const initialEdges = initialCanvasEdges.map(researchEdge);

const traceBranch = (activeNodeId: string, edges: ResearchEdge[]): string[] => {
  const incoming = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.data?.kind === "quote") continue;
    incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge.source]);
  }
  const ordered: string[] = []; const visited = new Set<string>(); const visiting = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id) || visited.has(id)) return;
    visiting.add(id);
    for (const parent of incoming.get(id) ?? []) visit(parent);
    visiting.delete(id); visited.add(id); ordered.push(id);
  };
  visit(activeNodeId);
  return ordered;
};

const arrangeGraph = (nodes: ResearchNode[], edges: ResearchEdge[]): ResearchNode[] => {
  const ids = new Set(nodes.map((node) => node.id));
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  const children = new Map(nodes.map((node) => [node.id, [] as string[]]));
  const parents = new Map(nodes.map((node) => [node.id, [] as string[]]));
  for (const edge of edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target) || edge.source === edge.target) continue;
    children.get(edge.source)!.push(edge.target);
    parents.get(edge.target)!.push(edge.source);
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
  }
  const level = new Map(nodes.map((node) => [node.id, 0]));
  const byPosition = (a: string, b: string) => (nodes.find((node) => node.id === a)?.position.x ?? 0) - (nodes.find((node) => node.id === b)?.position.x ?? 0);
  const queue = nodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id).sort(byPosition);
  const visited = new Set<string>();
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    for (const child of children.get(id) ?? []) {
      level.set(child, Math.max(level.get(child) ?? 0, (level.get(id) ?? 0) + 1));
      indegree.set(child, (indegree.get(child) ?? 1) - 1);
      if (indegree.get(child) === 0) queue.push(child);
    }
    queue.sort(byPosition);
  }
  for (const node of nodes) if (!visited.has(node.id)) level.set(node.id, 0);
  const levels = new Map<number, ResearchNode[]>();
  for (const node of nodes) {
    const depth = level.get(node.id) ?? 0;
    levels.set(depth, [...(levels.get(depth) ?? []), node]);
  }
  const spacing = 240;
  const positions = new Map<string, { x: number; y: number }>();
  for (const [depth, siblings] of [...levels.entries()].sort(([a], [b]) => a - b)) {
    const desired = siblings.map((node) => {
      const parentXs = (parents.get(node.id) ?? []).map((id) => positions.get(id)?.x).filter((x): x is number => x !== undefined);
      return { node, x: parentXs.length > 0 ? parentXs.reduce((sum, x) => sum + x, 0) / parentXs.length : 400 };
    });
    const grouped = new Map<number, typeof desired>();
    for (const item of desired) grouped.set(item.x, [...(grouped.get(item.x) ?? []), item]);
    const row = [...grouped.entries()].flatMap(([center, group]) => {
      const ordered = [...group].sort((a, b) => a.node.position.x - b.node.position.x);
      const startX = center - ((ordered.length - 1) * spacing) / 2;
      return ordered.map((item, index) => ({ ...item, x: startX + index * spacing }));
    }).sort((a, b) => a.x - b.x);
    for (let index = 1; index < row.length; index += 1) row[index]!.x = Math.max(row[index]!.x, row[index - 1]!.x + spacing);
    for (const item of row) positions.set(item.node.id, { x: item.x, y: 90 + depth * 225 });
  }
  return nodes.map((node) => ({ ...node, position: positions.get(node.id) ?? node.position }));
};

export function CanvasView({ project, onNavigate }: { project: Gate4Project; onNavigate?: (view: "chat" | "papers" | "project") => void }) {
  const { sessions, activeSessionId, createConversation, selectSession, refreshSessions } = useConversations();
  const flow = useRef<ReactFlowInstance<ResearchNode, ResearchEdge> | null>(null);
  const shell = useRef<HTMLDivElement | null>(null);
  const runAbort = useRef<AbortController | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const [mode, setMode] = useState<"follow" | "quote">(() => localStorage.getItem("xiling.canvas.interactionMode") === "quote" ? "quote" : "follow");
  const [quoted, setQuoted] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState("decompose");
  const [prompt, setPrompt] = useState("");
  const [pendingImages, setPendingImages] = useState<PendingNativeImage[]>([]);
  const [attachmentError, setAttachmentError] = useState("");
  const [modelRuntime, setModelRuntime] = useState<ModelRuntimeStatus>();
  const [runState, setRunState] = useState<{ status: "idle" | "running" | "error"; detail: string }>({ status: "idle", detail: "" });
  const [searchOpen, setSearchOpen] = useState(false);
  const [graphReady, setGraphReady] = useState(false);
  const [nodes, setNodes, onNodesChange] = useNodesState<ResearchNode>(projectNodes(project));
  const [edges, setEdges, onEdgesChange] = useEdgesState<ResearchEdge>(initialEdges);
  const nodesRef = useRef(nodes); const edgesRef = useRef(edges);
  const graphRevision = useRef(0);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  nodesRef.current = nodes; edgesRef.current = edges;
  useEffect(() => { localStorage.setItem("xiling.canvas.interactionMode", mode); }, [mode]);
  useEffect(() => { void fetch("/api/settings/models").then((response) => response.json()).then((body: { runtime: ModelRuntimeStatus }) => setModelRuntime(body.runtime)); }, []);
  const fitGraph = useCallback(() => {
    const instance = flow.current; const container = shell.current;
    if (!instance || !container) return;
    const visibleNodes = instance.getNodes();
    if (visibleNodes.length === 0) return;
    const bounds = instance.getNodesBounds(visibleNodes); const viewport = container.getBoundingClientRect();
    const horizontalPadding = 72; const topPadding = 60; const bottomPadding = 150;
    const zoom = Math.max(0.18, Math.min(1.15, (viewport.width - horizontalPadding * 2) / Math.max(bounds.width, 1), (viewport.height - topPadding - bottomPadding) / Math.max(bounds.height, 1)));
    const x = (viewport.width - bounds.width * zoom) / 2 - bounds.x * zoom;
    const y = topPadding + (viewport.height - topPadding - bottomPadding - bounds.height * zoom) / 2 - bounds.y * zoom;
    void instance.setViewport({ x, y, zoom }, { duration: 260 });
  }, []);
  const scheduleFit = useCallback(() => window.setTimeout(fitGraph, 80), [fitGraph]);

  useEffect(() => {
    setGraphReady(false);
    graphRevision.current = 0;
    const baseNodes = projectNodes(project); const baseEdges = initialEdges;
    setNodes(baseNodes); setEdges(baseEdges); nodesRef.current = baseNodes; edgesRef.current = baseEdges;
    void fetch(`/api/gate4/canvas/layout?projectId=${encodeURIComponent(project.id)}`).then((response) => response.json()).then((graph: CanvasGraphDocument) => {
      graphRevision.current = graph.revision ?? 0;
      if (graph.nodes.length > 0) {
        const restored = baseNodes.map((node) => {
          const saved = graph.nodes.find((position) => position.id === node.id);
          return saved ? { ...node, position: { x: saved.x, y: saved.y }, data: saved.data ?? node.data } : node;
        });
        const known = new Set(restored.map((node) => node.id));
        const added = graph.nodes.filter((item) => !known.has(item.id) && item.data).map((item): ResearchNode => ({
          id: item.id,
          type: "research",
          position: { x: item.x, y: item.y },
          data: item.data!,
        }));
        const nextNodes = [...restored, ...added]; setNodes(nextNodes); nodesRef.current = nextNodes;
      }
      const nextEdges = graph.edges.map(researchEdge); setEdges(nextEdges); edgesRef.current = nextEdges;
      setGraphReady(true);
    }).catch(() => setGraphReady(true));
  }, [project.id, project.name, project.researchQuestion, setEdges, setNodes]);

  useEffect(() => {
    if (!graphReady || !activeSessionId) return;
    const context = sessions.find((session) => session.id === activeSessionId)?.canvasContext;
    if (!context || !nodesRef.current.some((node) => node.id === context.activeNodeId)) return;
    setSelectedId(context.activeNodeId);
    setQuoted(context.quotedNodeIds.filter((id) => id !== context.activeNodeId && nodesRef.current.some((node) => node.id === id)));
  }, [activeSessionId, graphReady, sessions]);

  const persistGraph = useCallback(async (nextNodes: ResearchNode[], nextEdges: ResearchEdge[]) => {
    const operation = saveQueue.current.then(async () => {
      const response = await fetch("/api/gate4/canvas/layout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          revision: graphRevision.current,
          nodes: nextNodes.map((node) => ({ id: node.id, x: node.position.x, y: node.position.y, data: node.data })),
          edges: serializeEdges(nextEdges),
        }),
      });
      const result = await response.json().catch(() => ({})) as { revision?: number; error?: string };
      if (!response.ok) throw new Error(result.error === "canvas_revision_conflict" ? "画布已被其他操作更新，请重新加载后再保存。" : `画布保存失败：${response.status}`);
      if (result.revision !== undefined) graphRevision.current = result.revision;
    });
    saveQueue.current = operation.catch(() => undefined);
    await operation;
  }, [project.id]);
  const saveGraph = useCallback((nextNodes: ResearchNode[], nextEdges: ResearchEdge[]) => { void persistGraph(nextNodes, nextEdges).catch((error) => setRunState({ status: "error", detail: error instanceof Error ? error.message : String(error) })); }, [persistGraph]);
  const commitGraph = useCallback(async (nextNodes: ResearchNode[], nextEdges: ResearchEdge[]) => {
    nodesRef.current = nextNodes; edgesRef.current = nextEdges; setNodes(nextNodes); setEdges(nextEdges);
    await persistGraph(nextNodes, nextEdges);
  }, [persistGraph, setEdges, setNodes]);
  const persistSessionContext = useCallback(async (activeNodeId: string, quotedNodeIds: string[]) => {
    const activeNode = nodesRef.current.find((node) => node.id === activeNodeId);
    const sessionId = activeNode?.data.source?.sessionId ?? activeSessionId;
    if (!sessionId || !sessions.some((session) => session.id === sessionId)) return;
    selectSession(sessionId);
    const response = await fetch(`/api/gate4/chat-sessions/${encodeURIComponent(sessionId)}/context`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ activeNodeId, quotedNodeIds }) });
    if (response.ok) await refreshSessions(sessionId);
  }, [activeSessionId, refreshSessions, selectSession, sessions]);
  const followNode = useCallback((id: string) => {
    setSelectedId(id);
    setRunState((current) => current.status === "running" ? current : { status: "idle", detail: "已设为下一轮起点；只加载这条分支的上游上下文" });
    void persistSessionContext(id, quoted);
  }, [persistSessionContext, quoted]);
  const toggleQuote = useCallback((id: string) => {
    if (id === selectedId) return;
    setQuoted((current) => {
      const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
      void persistSessionContext(selectedId, next);
      return next;
    });
  }, [persistSessionContext, selectedId]);
  const duplicateNode = useCallback((id: string) => {
    const original = nodesRef.current.find((node) => node.id === id); if (!original) return;
    const cloneId = `branch-${crypto.randomUUID()}`;
    const clone: ResearchNode = { ...original, id: cloneId, selected: false, position: { x: original.position.x + 260, y: original.position.y }, data: { ...original.data, title: `${original.data.title} · 分支副本`, createdAt: new Date().toISOString() } };
    const incoming = edgesRef.current.filter((edge) => edge.target === id).map((edge) => researchEdge({ id: `edge-${crypto.randomUUID()}`, source: edge.source, target: cloneId, kind: edge.data?.kind ?? "follow-up" }));
    const nextNodes = [...nodesRef.current, clone]; const nextEdges = [...edgesRef.current, ...incoming];
    void commitGraph(nextNodes, nextEdges).then(() => { setSelectedId(cloneId); setRunState({ status: "idle", detail: "已复制为独立分支；原节点和历史没有被修改" }); });
  }, [commitGraph]);
  const openNodeSource = useCallback((id: string) => {
    const node = nodesRef.current.find((item) => item.id === id); const source = node?.data.source;
    if (!source) return;
    if (source.sessionId) { selectSession(source.sessionId); onNavigate?.("chat"); return; }
    if (source.kind === "paper") { onNavigate?.("papers"); return; }
    if (source.kind === "project" || source.kind === "workflow") { onNavigate?.("project"); return; }
    setRunState({ status: "idle", detail: "这是画布内自由节点，没有外部来源" });
  }, [onNavigate, selectSession]);
  const onNodeClick = useCallback<NodeMouseHandler<ResearchNode>>((_event, node) => {
    if (mode === "quote") toggleQuote(node.id);
    else followNode(node.id);
  }, [followNode, mode, toggleQuote]);
  const addNote = () => {
    const noteIndex = nodes.filter((node) => node.data.tone === "note").length;
    const node: ResearchNode = { id: `note-${crypto.randomUUID()}`, type: "research", position: { x: 760 + (noteIndex % 2) * 320, y: 90 + Math.floor(noteIndex / 2) * 230 }, data: { eyebrow: "FREE NOTE", title: "未命名科研笔记", body: "双击或在后续 Wiki 编辑器中补充内容。", tone: "note", source: { kind: "note" }, createdAt: new Date().toISOString() } };
    const edge = researchEdge({ id: `edge-${crypto.randomUUID()}`, source: selectedId || "decompose", target: node.id, kind: "follow-up" });
    const nextNodes = [...nodes, node]; const nextEdges = [...edges, edge];
    setNodes(nextNodes); setEdges(nextEdges); saveGraph(nextNodes, nextEdges);
    scheduleFit();
  };
  const submitCanvasPrompt = async () => {
    const text = prompt.trim(); const active = nodesRef.current.find((node) => node.id === selectedId);
    if (!text || !active || runState.status === "running") return;
    const quotedNodeIds = [...new Set(quoted)].filter((id) => id !== active.id && nodesRef.current.some((node) => node.id === id));
    const images = pendingImages;
    const existingSessionId = active.data.source?.sessionId;
    const session = (existingSessionId ? sessions.find((item) => item.id === existingSessionId) : undefined) ?? await createConversation(text);
    selectSession(session.id);
    setRunState({ status: "running", detail: `沿“${active.data.title}”继续研究` });
    const controller = new AbortController(); runAbort.current = controller;
    try {
      const childCount = edgesRef.current.filter((edge) => edge.source === active.id && edge.data?.kind !== "quote").length;
      let answer = "";
      let promptNode: ResearchNode | undefined;
      let runId = ""; let assistantEntryId = ""; let assistantCreatedAt = new Date().toISOString();
      for await (const event of runResearchTurn({ projectId: project.id, sessionId: session.id, prompt: text, ...(images.length ? { attachments: images.map(nativeImageUpload) } : {}), context: { activeNodeId: active.id, quotedNodeIds }, signal: controller.signal })) {
          if (event.type === "run.accepted") {
            setPendingImages([]); setAttachmentError("");
            runId = event.runId;
            const body = images.length ? `${text}\n\n原生图像：${images.map((image) => image.name).join("、")}` : text;
            promptNode = { id: `prompt-${event.userEntryId}`, type: "research", position: { x: active.position.x + childCount * 36, y: active.position.y + 225 }, data: { eyebrow: "RESEARCH PROMPT", title: text.length > 48 ? `${text.slice(0, 48)}…` : text, body: body.slice(0, 2_000), tone: "prompt", source: { kind: "chat-message", sessionId: session.id, sourceEntryId: event.userEntryId, runId: event.runId }, createdAt: new Date().toISOString() } };
            const promptEdges = [researchEdge({ id: `edge-${active.id}-${promptNode.id}`, source: active.id, target: promptNode.id, kind: "follow-up" }), ...quotedNodeIds.map((id) => researchEdge({ id: `edge-quote-${id}-${promptNode!.id}`, source: id, target: promptNode!.id, kind: "quote" as const }))];
            await commitGraph([...nodesRef.current, promptNode], [...edgesRef.current, ...promptEdges]);
            setSelectedId(promptNode.id);
          }
          if (event.type === "entry.persisted" && event.kind === "assistant") { assistantEntryId = event.entryId; assistantCreatedAt = event.createdAt; }
          if (event.type === "message.delta") answer += event.delta;
          if (event.type === "tool.started") setRunState({ status: "running", detail: `正在调用 ${event.toolName}` });
          if (event.type === "tool.finished") {
            setRunState({ status: "running", detail: `${event.toolName} 已完成` });
          }
          if (event.type === "workflow.projected") setRunState({ status: "running", detail: "数据工作流审批草稿已创建" });
          if (event.type === "workflow.projection.failed") setRunState({ status: "error", detail: event.message });
          if (event.type === "tool.failed") setRunState({ status: "error", detail: `${event.toolName} 失败：${event.message}` });
          if (event.type === "session.error") throw new Error(event.message);
      }
      if (!answer.trim()) throw new Error("模型没有返回文本");
      if (!promptNode || !assistantEntryId || !runId) throw new Error("Agent 运行缺少耐久来源记录");
      const responseNode: ResearchNode = { id: `response-${assistantEntryId}`, type: "research", position: { x: promptNode.position.x, y: promptNode.position.y + 225 }, data: { eyebrow: "PI RESPONSE", title: `研究回答 · ${new Date(assistantCreatedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })}`, body: answer.slice(0, 2_000), tone: "answer", source: { kind: "chat-message", sessionId: session.id, sourceEntryId: assistantEntryId, runId }, createdAt: assistantCreatedAt } };
      const responseEdge = researchEdge({ id: `edge-${promptNode.id}-${responseNode.id}`, source: promptNode.id, target: responseNode.id, kind: "follow-up" });
      await commitGraph([...nodesRef.current, responseNode], [...edgesRef.current, responseEdge]);
      await fetch(`/api/gate4/chat-sessions/${encodeURIComponent(session.id)}/context`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ activeNodeId: responseNode.id, quotedNodeIds }) });
      await refreshSessions(session.id);
      setSelectedId(responseNode.id); setQuoted([]); setPrompt(""); setRunState({ status: "idle", detail: "回答已写入当前分支，Chat 可继续同一上下文" }); scheduleFit();
    } catch (error) {
      const cancelled = error instanceof DOMException && error.name === "AbortError";
      setRunState({ status: cancelled ? "idle" : "error", detail: cancelled ? "已取消本次画布研究" : (error instanceof Error ? error.message : String(error)) });
    } finally { runAbort.current = null; }
  };
  const autoArrange = () => {
    const arranged = arrangeGraph(nodes, edges);
    setNodes(arranged); saveGraph(arranged, edges);
    scheduleFit();
  };
  const onNodeDragStop = useCallback<OnNodeDrag<ResearchNode>>((_event, moved) => {
    setNodes((current) => {
      const next = current.map((node) => node.id === moved.id ? { ...node, position: moved.position } : node);
      saveGraph(next, edges);
      return next;
    });
  }, [edges, saveGraph, setNodes]);
  const selected = nodes.find((node) => node.id === selectedId);
  const activeBranchIds = useMemo(() => traceBranch(selectedId, edges), [edges, selectedId]);
  const activeBranch = useMemo(() => new Set(activeBranchIds), [activeBranchIds]);
  const displayedEdges = useMemo(() => edges.map((edge) => {
    const kind = edge.data?.kind ?? "follow-up";
    const onActiveBranch = kind !== "quote" && activeBranch.has(edge.source) && activeBranch.has(edge.target);
    const quotedEdgeActive = kind === "quote" && (quoted.includes(edge.source) || quoted.includes(edge.target));
    return { ...edge, animated: false, selectable: false, focusable: false, style: { ...edge.style, opacity: onActiveBranch ? .92 : quotedEdgeActive ? .72 : kind === "quote" ? .13 : .28, strokeWidth: onActiveBranch ? 1.7 : 1.1 } };
  }), [activeBranch, edges, quoted]);
  const interaction = useMemo<CanvasInteraction>(() => ({ activeNodeId: selectedId, quotedNodeIds: new Set(quoted), follow: followNode, quote: toggleQuote, duplicate: duplicateNode, openSource: openNodeSource }), [duplicateNode, followNode, openNodeSource, quoted, selectedId, toggleQuote]);
  const focusNode = (id: string) => {
    const node = nodesRef.current.find((item) => item.id === id); if (!node || !flow.current) return;
    void flow.current.setCenter(node.position.x + 108, node.position.y + 80, { zoom: Math.max(flow.current.getZoom(), .75), duration: 260 });
  };
  const nativeImageEnabled = Boolean(modelRuntime?.ready && modelRuntime.selectedModel?.inputModalities.includes("image"));
  const attachmentTitle = nativeImageEnabled ? "添加模型原生图像输入" : modelRuntime?.mode === "offline" ? "离线演示模型仅支持文字" : modelRuntime?.ready ? "当前模型未声明原生图像输入" : "请先在设置中选择并连接模型";
  const addImages = async (files: FileList | null) => {
    if (!files?.length || !nativeImageEnabled) return;
    try { setPendingImages(await readNativeImages(files, pendingImages)); setAttachmentError(""); }
    catch (error) { setAttachmentError(error instanceof Error ? error.message : String(error)); }
  };

  return (
    <div className="canvas-shell" ref={shell}>
      <div className="canvas-titlebar"><div><b>{project.name}</b><span>探索画布</span></div><div><button>↗ 导出</button><button>评论</button><span className="zoom-label">20%</span></div></div>
      <div className="canvas-toolbar">
        <button title="添加节点" aria-label="添加节点" onClick={addNote}>＋</button><button title="搜索" aria-label="搜索" onClick={() => setSearchOpen((value) => !value)}>⌕</button><i /><button title="自动整理" aria-label="自动整理" onClick={autoArrange}>⌘</button><button title="回到全景" aria-label="回到全景" onClick={fitGraph}>◎</button>
        {searchOpen ? <input autoFocus aria-label="搜索画布节点" placeholder="搜索标题…" onChange={(event) => {
          const match = nodes.find((node) => node.data.title.toLowerCase().includes(event.target.value.toLowerCase()));
          if (match && event.target.value) setSelectedId(match.id);
        }} /> : null}
      </div>
      <div className={`canvas-status ${runState.status}`}><span className="canvas-status-dot" /><div><b>{selected?.data.title ?? "未选择"}</b><span>{runState.detail || "已选中 · 可自由拖动"}</span></div></div>
      {graphReady ? <CanvasInteractionContext.Provider value={interaction}><ReactFlow<ResearchNode, ResearchEdge>
        nodes={nodes}
        edges={displayedEdges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onNodeDragStop={onNodeDragStop}
        onInit={(instance) => {
          flow.current = instance;
          window.setTimeout(fitGraph, 40);
        }}
        minZoom={0.18}
        maxZoom={2.2}
        panOnScroll
        panOnScrollSpeed={0.8}
        zoomOnScroll={false}
        nodesDraggable={runState.status !== "running"}
        nodesConnectable={false}
        edgesFocusable={false}
        edgesReconnectable={false}
        snapToGrid={false}
        deleteKeyCode={null}
      >
        <Background color="#d9dcdf" gap={32} size={1} /><Controls position="bottom-right" />
      </ReactFlow></CanvasInteractionContext.Provider> : <div className="view-loading">正在恢复完整研究图…</div>}
      <div className="composer">
        <div className="mode-switch"><button className={mode === "follow" ? "active" : ""} onClick={() => setMode("follow")}>继续分支</button><button className={mode === "quote" ? "active" : ""} onClick={() => setMode("quote")}>多选引用</button><span>上下文按分支加载</span></div>
        <div className="canvas-context-row">
          <button className="active-context-chip" title={`包含 ${activeBranchIds.length} 个上游节点`} onClick={() => focusNode(selectedId)}><span>↳ 从这里继续</span><b>{selected?.data.title ?? "未选择"}</b><small>{activeBranchIds.length} 节点</small></button>
          {quoted.map((id) => <button className="quote-context-chip" key={id} title="点击移除引用" onClick={() => toggleQuote(id)}><span>引用</span>{nodes.find((node) => node.id === id)?.data.title ?? id}<i>×</i></button>)}
        </div>
        {pendingImages.length ? <div className="native-attachment-tray canvas-native-attachments">{pendingImages.map((image) => <div key={image.localId}><img src={image.previewUrl} alt="" /><span><b>{image.name}</b><small>{formatAttachmentSize(image.size)} · 原生图像</small></span><button type="button" aria-label={`移除 ${image.name}`} onClick={() => setPendingImages((current) => current.filter((item) => item.localId !== image.localId))}>×</button></div>)}</div> : null}
        {attachmentError ? <div className="native-attachment-error">{attachmentError}</div> : null}
        <div><input ref={imageInputRef} className="native-file-input" type="file" accept={NATIVE_IMAGE_ACCEPT} multiple onChange={(event) => { void addImages(event.currentTarget.files); event.currentTarget.value = ""; }} /><button className="attach-button" aria-label="添加图像" disabled={!nativeImageEnabled || runState.status === "running"} title={attachmentTitle} onClick={() => imageInputRef.current?.click()}>＋</button><input aria-label="科研提示" value={prompt} disabled={runState.status === "running"} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submitCanvasPrompt(); } }} placeholder="描述一个复杂的研究任务，交给 Agent 处理…" /><button className="send" aria-label={runState.status === "running" ? "取消" : "生成"} disabled={!prompt.trim() && runState.status !== "running"} onClick={() => runState.status === "running" ? runAbort.current?.abort() : void submitCanvasPrompt()}>{runState.status === "running" ? "■" : "↑"}</button></div>
      </div>
    </div>
  );
}
