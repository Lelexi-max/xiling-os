import { useEffect, useRef, useState, type FC } from "react";
import type { AgentInputAttachment, ChatMessageRecord, ContextAssemblyTrace, Gate4Project, ModelRuntimeStatus, ProjectItem, ProjectResearchWorkflow, WikiPageDetail } from "@xiling/contracts";
import { useConversations } from "../workspace/ConversationContext.js";
import { ResearchWorkflowCard } from "./ResearchWorkflowCard.js";
import { runResearchTurn } from "../lib/research-session-client.js";
import { formatAttachmentSize, nativeImageUpload, NATIVE_IMAGE_ACCEPT, readNativeImages, type PendingNativeImage } from "../lib/native-image-input.js";
import { AgentExecutionGraphView } from "./AgentExecutionGraphView.js";
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePartPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useExternalStoreRuntime,
  type ThreadMessageLike,
} from "@assistant-ui/react";

type UiMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  status?: "running" | "complete" | "cancelled";
  sourceEntryId?: string;
  runId?: string;
  attachments?: Array<AgentInputAttachment & { url: string }>;
};
const welcomeMessage = (project: Gate4Project): UiMessage => ({ id: `welcome-${project.id}`, role: "assistant", text: `已进入项目“${project.name}”。当前研究问题：${project.researchQuestion}`, status: "complete" });
type ToolActivity = { callId: string; name: string; status: "running" | "complete" | "failed" };

const convertMessage = (message: UiMessage): ThreadMessageLike => ({
  id: message.id,
  role: message.role,
  content: [{ type: "text", text: message.text }, ...(message.attachments ?? []).map((attachment) => ({ type: "image" as const, image: attachment.url, filename: attachment.name }))],
  ...(message.role === "assistant"
    ? {
        status:
          message.status === "running"
            ? ({ type: "running" } as const)
            : message.status === "cancelled"
              ? ({ type: "incomplete", reason: "cancelled" } as const)
              : ({ type: "complete", reason: "stop" } as const),
      }
    : {}),
});

const TextPart: FC = () => <MessagePartPrimitive.Text />;
const ImagePart: FC = () => <MessagePartPrimitive.Image className="chat-message-image" />;
const UserMessage: FC = () => (
  <MessagePrimitive.Root className="aui-message user">
    <small>你</small><MessagePrimitive.Parts components={{ Text: TextPart, Image: ImagePart }} />
  </MessagePrimitive.Root>
);
const AssistantMessage: FC = () => (
  <MessagePrimitive.Root className="aui-message assistant">
    <small>汐灵</small><MessagePrimitive.Parts components={{ Text: TextPart }} />
  </MessagePrimitive.Root>
);

function extractText(content: readonly { type: string; text?: string }[]): string {
  return content.filter((part) => part.type === "text").map((part) => part.text ?? "").join("\n");
}

export function ChatView({ project }: { project: Gate4Project }) {
  const { sessions, activeSessionId, ensureSession, refreshSessions } = useConversations();
  const visibleSessionRef = useRef(activeSessionId);
  visibleSessionRef.current = activeSessionId;
  const runAbortRef = useRef<AbortController | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const activeSession = sessions.find((session) => session.id === activeSessionId);
  const [messages, setMessages] = useState<UiMessage[]>(() => [welcomeMessage(project)]);
  const [running, setRunning] = useState(false);
  const [tools, setTools] = useState<ToolActivity[]>([]);
  const [workflows, setWorkflows] = useState<ProjectResearchWorkflow[]>([]);
  const [saveStatus, setSaveStatus] = useState("");
  const [modelRuntime, setModelRuntime] = useState<ModelRuntimeStatus>();
  const [pendingImages, setPendingImages] = useState<PendingNativeImage[]>([]);
  const [attachmentError, setAttachmentError] = useState("");
  const [contextTrace, setContextTrace] = useState<ContextAssemblyTrace>();
  const [artifactWidth, setArtifactWidth] = useState(560);
  const [artifactOpen, setArtifactOpen] = useState(true);
  const [artifactExpanded, setArtifactExpanded] = useState(false);
  const [primaryMode, setPrimaryMode] = useState<"conversation" | "execution">("conversation");
  const [graphRefreshKey, setGraphRefreshKey] = useState(0);
  const artifactBeforeGraphRef = useRef(true);
  const workbenchRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cancelled = false;
    runAbortRef.current = null;
    setRunning(false);
    if (activeSessionId) {
      setMessages([welcomeMessage(project)]);
      void fetch(`/api/gate4/chat-sessions/${encodeURIComponent(activeSessionId)}/messages`).then(async (response) => {
        if (!response.ok) throw new Error(`会话消息加载失败：${response.status}`);
        const records = await response.json() as ChatMessageRecord[];
        const restored: UiMessage[] = [welcomeMessage(project), ...records.map((record) => ({ id: record.id, role: record.role, text: record.text, status: record.status, sourceEntryId: record.id, ...(record.attachments?.length ? { attachments: record.attachments.map((attachment) => ({ ...attachment, url: `/api/agent-center/attachments/${encodeURIComponent(attachment.id)}?projectId=${encodeURIComponent(project.id)}` })) } : {}) }))];
        if (!cancelled && visibleSessionRef.current === activeSessionId) setMessages(restored);
      }).catch(() => { if (!cancelled) setMessages([welcomeMessage(project), { id: `restore-error-${activeSessionId}`, role: "assistant", text: "这段对话暂时无法恢复，请稍后重试。", status: "cancelled" }]); });
    } else {
      setMessages([welcomeMessage(project)]);
    }
    setTools([]); setContextTrace(undefined); setSaveStatus(""); setPendingImages([]); setAttachmentError(""); setArtifactExpanded(false); setArtifactOpen(project.id === "ocean-heatwave");
    return () => { cancelled = true; };
  }, [project.id, activeSessionId]);
  useEffect(() => {
    if (!activeSessionId) { setWorkflows([]); return; }
    void fetch(`/api/gate4/research-workflows?projectId=${encodeURIComponent(project.id)}&sessionId=${encodeURIComponent(activeSessionId)}`).then((response) => response.ok ? response.json() : []).then((items) => setWorkflows(items as ProjectResearchWorkflow[]));
  }, [project.id, activeSessionId]);
  useEffect(() => { void fetch("/api/settings/models").then((response) => response.json()).then((body: { runtime: ModelRuntimeStatus }) => setModelRuntime(body.runtime)); }, []);
  useEffect(() => {
    const clampWidth = () => {
      const width = workbenchRef.current?.getBoundingClientRect().width;
      if (width) setArtifactWidth((current) => Math.max(360, Math.min(current, width - 390)));
    };
    clampWidth();
    window.addEventListener("resize", clampWidth);
    return () => window.removeEventListener("resize", clampWidth);
  }, []);

  const runtime = useExternalStoreRuntime({
    messages,
    isRunning: running,
    convertMessage,
    onNew: async (message) => {
      const prompt = extractText(message.content);
      const images = pendingImages;
      const userId = crypto.randomUUID();
      const assistantId = crypto.randomUUID();
      const session = await ensureSession(prompt);
      visibleSessionRef.current = session.id;
      setMessages((current) => [
        ...current,
        { id: userId, role: "user", text: prompt, ...(images.length ? { attachments: images.map((image) => ({ id: image.localId, name: image.name, modality: "image", mimeType: image.mimeType, size: image.size, sha256: "pending", url: image.previewUrl })) } : {}) },
        { id: assistantId, role: "assistant", text: "", status: "running" },
      ]);
      setRunning(true);
      setAttachmentError("");
      const controller = new AbortController();
      runAbortRef.current = controller;
      let streamedText = "";
      const updateVisibleMessages = (updater: (current: UiMessage[]) => UiMessage[]) => {
        if (visibleSessionRef.current === session.id) setMessages(updater);
      };

      try {
        for await (const event of runResearchTurn({ projectId: project.id, sessionId: session.id, prompt, ...(images.length ? { attachments: images.map(nativeImageUpload) } : {}), signal: controller.signal })) {
            if (visibleSessionRef.current !== session.id) continue;
            if (event.type === "run.accepted") {
              setPendingImages([]);
              updateVisibleMessages((current) => current.map((item) => item.id === userId ? { ...item, sourceEntryId: event.userEntryId, runId: event.runId, ...(event.attachments?.length ? { attachments: event.attachments.map((attachment) => ({ ...attachment, url: `/api/agent-center/attachments/${encodeURIComponent(attachment.id)}?projectId=${encodeURIComponent(project.id)}` })) } : {}) } : item.id === assistantId ? { ...item, runId: event.runId } : item));
            }
            if (event.type === "entry.persisted" && event.kind === "assistant") updateVisibleMessages((current) => current.map((item) => item.id === assistantId ? { ...item, sourceEntryId: event.entryId, runId: event.runId } : item));
            if (event.type === "context.ready") setContextTrace(event.trace);
            if (event.type === "message.delta" && event.delta) {
              streamedText += event.delta;
              updateVisibleMessages((current) => current.map((item) => item.id === assistantId ? { ...item, text: item.text + event.delta } : item));
            }
            if (event.type === "tool.started") setTools((current) => [...current.filter((item) => item.callId !== event.callId), { callId: event.callId, name: event.toolName, status: "running" }]);
            if (event.type === "tool.finished") {
              setTools((current) => current.map((item) => item.callId === event.callId ? { ...item, status: "complete" } : item));
            }
            if (event.type === "workflow.projected") {
              const response = await fetch(`/api/gate4/research-workflows?projectId=${encodeURIComponent(project.id)}&sessionId=${encodeURIComponent(session.id)}`);
              if (response.ok) setWorkflows(await response.json() as ProjectResearchWorkflow[]);
            }
            if (event.type === "tool.failed") setTools((current) => current.map((item) => item.callId === event.callId ? { ...item, status: "failed" } : item));
            if (event.type === "session.error") throw new Error(event.message || "模型调用失败");
        }
        if (!streamedText.trim()) throw new Error("模型没有返回文本，请检查模型 ID 或使用“测试连接”诊断。 ");
        updateVisibleMessages((current) => current.map((item) => item.id === assistantId ? { ...item, status: "complete" } : item));
      } catch (error) {
        const cancelled = error instanceof DOMException && error.name === "AbortError";
        const reason = error instanceof Error ? error.message : "请求失败";
        updateVisibleMessages((current) => current.map((item) => item.id === assistantId ? { ...item, text: item.text || (cancelled ? "已取消" : `连接失败：${reason}`), status: "cancelled" } : item));
      } finally {
        if (runAbortRef.current === controller) runAbortRef.current = null;
        if (visibleSessionRef.current === session.id) setRunning(false);
        await refreshSessions(session.id);
        setGraphRefreshKey((value) => value + 1);
        if (visibleSessionRef.current === session.id) {
          try {
            const response = await fetch(`/api/gate4/chat-sessions/${encodeURIComponent(session.id)}/messages`);
            if (response.ok) {
              const records = await response.json() as ChatMessageRecord[];
              setMessages([welcomeMessage(project), ...records.map((record) => ({ id: record.id, role: record.role, text: record.text, status: record.status, sourceEntryId: record.id, ...(record.attachments?.length ? { attachments: record.attachments.map((attachment) => ({ ...attachment, url: `/api/agent-center/attachments/${encodeURIComponent(attachment.id)}?projectId=${encodeURIComponent(project.id)}` })) } : {}) }))]);
            }
          } catch {
            // The streamed transcript remains visible; the next session load retries the durable read.
          }
        }
      }
    },
    onCancel: async () => runAbortRef.current?.abort(),
  });

  const nativeImageEnabled = Boolean(modelRuntime?.ready && modelRuntime.selectedModel?.inputModalities.includes("image"));
  const attachmentTitle = nativeImageEnabled ? "添加模型原生图像输入" : modelRuntime?.mode === "offline" ? "离线演示模型仅支持文字" : modelRuntime?.ready ? "当前模型未声明原生图像输入" : "请先在设置中选择并连接模型";
  const addImages = async (files: FileList | null) => {
    if (!files?.length || !nativeImageEnabled) return;
    try { setPendingImages(await readNativeImages(files, pendingImages)); setAttachmentError(""); }
    catch (error) { setAttachmentError(error instanceof Error ? error.message : String(error)); }
  };

  const lastAssistant = [...messages].reverse().find((message) => message.role === "assistant" && message.id !== `welcome-${project.id}` && message.status === "complete" && message.text.trim());
  const persistResponse = async (target: "task" | "wiki") => {
    if (!lastAssistant) return;
    setSaveStatus("正在保存…");
    const title = `Agent 研究记录 · ${new Date().toLocaleString("zh-CN", { hour12: false })}`;
    try {
      if (target === "task") {
        const response = await fetch("/api/gate4/project-items", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: project.id, kind: "task", title, notes: lastAssistant.text.slice(0, 1_900) }) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        await response.json() as ProjectItem;
      } else if (target === "wiki") {
        const response = await fetch("/api/gate4/wiki/pages", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: project.id, title, markdown: `# ${title}\n\n${lastAssistant.text}` }) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        await response.json() as WikiPageDetail;
      }
      setSaveStatus(target === "task" ? "已保存到项目任务" : "已创建 Wiki 页面");
    } catch (cause) { setSaveStatus(`保存失败：${cause instanceof Error ? cause.message : String(cause)}`); }
  };

  const beginResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const workbench = workbenchRef.current;
    if (!workbench) return;
    const move = (pointer: PointerEvent) => {
      const bounds = workbench.getBoundingClientRect();
      setArtifactWidth(Math.max(360, Math.min(bounds.width - 390, bounds.right - pointer.clientX)));
    };
    const stop = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", stop);
      document.body.classList.remove("resizing-split");
    };
    document.body.classList.add("resizing-split");
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", stop);
  };

  const switchPrimaryMode = (next: "conversation" | "execution") => {
    if (next === primaryMode) return;
    if (next === "execution") {
      artifactBeforeGraphRef.current = artifactOpen;
      setArtifactOpen(false);
      setArtifactExpanded(false);
    } else if (artifactBeforeGraphRef.current) {
      setArtifactOpen(true);
    }
    setPrimaryMode(next);
  };

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className={`chat-workbench ${artifactExpanded ? "artifact-expanded" : ""}`} ref={workbenchRef} style={{ gridTemplateColumns: artifactExpanded || !artifactOpen ? "minmax(0, 1fr)" : `minmax(390px, 1fr) 7px ${artifactWidth}px` }}>
        <ThreadPrimitive.Root className="chat-view">
          <div className="chat-heading"><div><small>{project.name} · {primaryMode === "conversation" ? "研究对话" : "Agent 可观测性"}</small><h1>{primaryMode === "conversation" ? activeSession?.title ?? "新对话" : "Agent 运行图"}</h1></div><div className="chat-heading-actions"><div className="chat-primary-switch"><button className={primaryMode === "conversation" ? "active" : ""} onClick={() => switchPrimaryMode("conversation")}>对话</button><button className={primaryMode === "execution" ? "active" : ""} onClick={() => switchPrimaryMode("execution")}>运行图</button></div><div className={`chat-model-state ${modelRuntime?.mode ?? "offline"}`}><i />{modelRuntime?.mode === "live" ? modelRuntime.ready ? `${modelRuntime.selectedModel?.name ?? modelRuntime.modelId}` : "路由待检查" : "离线演示"}</div>{!artifactOpen && primaryMode === "conversation" ? <button onClick={() => setArtifactOpen(true)}>打开产物面板</button> : null}</div></div>
          {primaryMode === "execution" ? <AgentExecutionGraphView projectId={project.id} activeSessionId={activeSessionId} refreshKey={graphRefreshKey} /> : <>
            <ThreadPrimitive.Viewport className="aui-thread">
              <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
              {workflows.length ? <div className="chat-workflows">{workflows.map((workflow) => <ResearchWorkflowCard key={workflow.id} workflow={workflow} onChange={(updated) => setWorkflows((current) => current.map((item) => item.id === updated.id ? updated : item))} />)}</div> : null}
            </ThreadPrimitive.Viewport>
            <div className="agent-activity"><span>⌁ {project.name}</span>{activeSession?.canvasContext ? <span title={`活动科研实体：${activeSession.canvasContext.activeNodeId}`}>科研图上下文 · {activeSession.canvasContext.activeNodeId}{activeSession.canvasContext.quotedNodeIds.length ? ` · 显式引用 ${activeSession.canvasContext.quotedNodeIds.length}` : ""}</span> : <span>项目研究问题上下文</span>}{contextTrace ? <span title={`精确实体：${contextTrace.exactNodeIds.join(", ") || "无"}\nCapsule 实体：${contextTrace.capsuleNodeIds.join(", ") || "无"}\n能力：${contextTrace.activatedCapabilityIds.join(", ") || "无"}\nSkill：${contextTrace.activatedSkillNames.join(", ") || "无"}`}>{contextTrace.exactNodeIds.length} 精确实体 · {contextTrace.capsuleNodeIds.length} 胶囊 · {contextTrace.activatedSkillNames.length} Skill · {contextTrace.cache === "hit" ? "组装缓存" : "新投影"}</span> : null}<span>{tools.length ? `${tools.filter((item) => item.status === "complete").length}/${tools.length} 个工具完成` : "按需工具未激活"}</span><span>{running ? "Pi 正在执行" : "Pi 已就绪"}</span></div>
            {contextTrace?.degradations.length ? <div className="chat-context-notice">{contextTrace.degradations.map((item) => <span key={item}>{item}</span>)}</div> : null}
            {tools.length ? <div className="chat-tool-trace">{tools.map((tool) => <span className={tool.status} key={tool.callId}>{tool.status === "complete" ? "✓" : tool.status === "failed" ? "×" : "↻"} {tool.name}</span>)}</div> : null}
            {lastAssistant ? <div className="chat-save-actions"><span>确认后沉淀</span><button onClick={() => void persistResponse("task")}>保存为任务</button><button onClick={() => void persistResponse("wiki")}>写入 Wiki</button>{saveStatus ? <small>{saveStatus}</small> : null}</div> : null}
            <ComposerPrimitive.Root className="chat-composer">
            {pendingImages.length ? <div className="native-attachment-tray">{pendingImages.map((image) => <div key={image.localId}><img src={image.previewUrl} alt="" /><span><b>{image.name}</b><small>{formatAttachmentSize(image.size)} · 原生图像</small></span><button type="button" aria-label={`移除 ${image.name}`} onClick={() => setPendingImages((current) => current.filter((item) => item.localId !== image.localId))}>×</button></div>)}</div> : null}
            {attachmentError ? <div className="native-attachment-error">{attachmentError}</div> : null}
            <ComposerPrimitive.Input placeholder="询问数据、文献或当前科研图选择…" />
            <input ref={imageInputRef} className="native-file-input" type="file" accept={NATIVE_IMAGE_ACCEPT} multiple onChange={(event) => { void addImages(event.currentTarget.files); event.currentTarget.value = ""; }} />
            <div className="composer-tools"><button type="button" aria-label="添加图像" disabled={!nativeImageEnabled || running} title={attachmentTitle} onClick={() => imageInputRef.current?.click()}>＋</button><span>{nativeImageEnabled ? "原生图像可用" : "仅原生模态"}</span></div>
            <ComposerPrimitive.Send aria-label="发送">↑</ComposerPrimitive.Send>
            <ComposerPrimitive.Cancel aria-label="取消">■</ComposerPrimitive.Cancel>
            </ComposerPrimitive.Root>
            <p className="adapter-note">回答可能有误，请核对数据来源与科研结论</p>
          </>}
        </ThreadPrimitive.Root>
        {artifactOpen && !artifactExpanded ? <div className="split-resizer" role="separator" aria-label="调整 Artifact 面板宽度" aria-orientation="vertical" onPointerDown={beginResize}><i /></div> : null}
        {artifactOpen ? <aside className="artifact-panel">
          <div className="artifact-panel-head"><div><b>mhw_mld_anomaly.png</b><small>图表 · v2</small></div><div className="artifact-window-actions"><button aria-label="下载产物">↓</button><button aria-label={artifactExpanded ? "还原产物面板" : "全屏查看产物"} onClick={() => setArtifactExpanded((value) => !value)}>{artifactExpanded ? "⊙" : "↗"}</button><button aria-label="关闭产物面板" onClick={() => { setArtifactOpen(false); setArtifactExpanded(false); }}>×</button></div></div>
          <div className="artifact-tabs"><button className="active">预览</button><button>代码</button><button>运行日志</button><button>审阅</button></div>
          <div className="artifact-preview">
            <div className="figure-title"><b>西北太平洋混合层深度异常</b><small>Argo · 2023-06—2023-09</small></div>
            <svg viewBox="0 0 560 330" role="img" aria-label="混合层深度异常示意图">
              <defs><linearGradient id="ocean-map" x1="0" x2="1"><stop stopColor="#dff8fb"/><stop offset=".5" stopColor="#8dddf1"/><stop offset="1" stopColor="#899af4"/></linearGradient></defs>
              <rect x="54" y="34" width="472" height="238" rx="2" fill="#f8f7f3" stroke="#d8d6cf"/>
              {[0,1,2,3,4].map((i) => <line key={`h-${i}`} x1="54" y1={62+i*46} x2="526" y2={62+i*46} stroke="#e8e5df"/>)}
              {[0,1,2,3,4,5].map((i) => <line key={`v-${i}`} x1={92+i*78} y1="34" x2={92+i*78} y2="272" stroke="#ece9e3"/>)}
              <path d="M55 222 C100 206 128 152 168 164 S230 224 271 183 333 99 382 126 452 190 526 105 L526 272 55 272Z" fill="url(#ocean-map)" opacity=".88"/>
              <path d="M55 222 C100 206 128 152 168 164 S230 224 271 183 333 99 382 126 452 190 526 105" fill="none" stroke="#3f74d8" strokeWidth="3"/>
              <line x1="54" y1="190" x2="526" y2="190" stroke="#2f7f85" strokeDasharray="6 5"/>
              <text x="54" y="300" fill="#72706b" fontSize="12">140°E</text><text x="480" y="300" fill="#72706b" fontSize="12">170°W</text>
            </svg>
            <div className="artifact-caption"><span>图 1</span><p>热浪核心区的混合层显著变浅，与上层海洋层结增强的机制假设一致。阴影表示 95% 置信区间。</p></div>
          </div>
          <div className="review-note"><b>审阅通过</b><span>数据来源、变量与时间范围可追溯</span></div>
        </aside> : null}
      </div>
    </AssistantRuntimeProvider>
  );
}
