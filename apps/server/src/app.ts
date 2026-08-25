import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { open } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { z } from "zod";
import { ResearchAgentHarness, SqliteAgentSessionStore, type RuntimeUsageInput } from "@xiling/agent-harness";
import { projectionSchema } from "@xiling/api-contracts";
import { ContextAssemblyCache, assembleContext, createNodeContextCapsule, estimateContextTokens, projectContext } from "@xiling/context";
import type { AgentStreamEvent, CanvasGraphDocument, CanvasNode, ConnectorMetadataSummary, ContextCapsule, ModelProviderId, OceanSubsetRequest, ResourceUri } from "@xiling/contracts";
import { LazySkillCatalog, PiMcpGatewayManager, PiRuntimeAdapter, ModelRuntimeStore, TokenLedger, createLiveRoute } from "@xiling/pi-runtime";
import { Gate3ResearchService, JsonProjectRepository } from "@xiling/research";
import { DockerArgoResearchRunner, DockerProjectAnalysisRunner } from "./research-runner.js";
import { ConnectorWorkflowService, FixtureConnectorAdapter, JsonConnectorJobRepository, type ConnectorDownloader, type ConnectorMetadataProbe } from "@xiling/connectors";
import { FileLiteratureCache, LiteratureSearchService, OpenAlexProvider, SemanticScholarProvider } from "@xiling/literature";
import { KnowledgeService } from "@xiling/knowledge";
import { CredentialStore } from "@xiling/credentials";
import { DockerConnectorProbe, DockerConnectorRunner } from "./connector-runner.js";
import { agentEntryReaderTool, agentHistorySearchTool, researchCapabilityCatalog, selectResearchCapabilities, selectResearchTools } from "./agent-tools.js";
import { reconcileCanvasSourceCoverage } from "./context-source-coverage.js";
import { FixtureProjectAnalysisRunner, JsonProjectWorkflowRepository, ProjectWorkflowService, type ProjectAnalysisRunner } from "./project-workflow.js";
import { FileCanvasRepository } from "./modules/canvas/canvas-repository.js";
import { registerCanvasRoutes } from "./modules/canvas/routes.js";
import { registerLiteratureRoutes } from "./modules/literature/routes.js";
import { registerWorkspaceRoutes } from "./modules/workspace/routes.js";
import { registerLegacyGate3Routes } from "./modules/legacy-gate3/routes.js";
import { ModelSettingsService, humanizeModelFailure, registerSettingsRoutes } from "./modules/settings/routes.js";
import { registerConnectorRoutes } from "./modules/connectors/routes.js";
import { registerWorkflowRoutes } from "./modules/workflows/routes.js";
import { registerAgentCenterRoutes } from "./modules/agent-center/routes.js";
import { createGate45CMigrationBackup, type Gate45CMigrationBackupManifest } from "./migration-backup.js";
import { projectAgentWorkflowDraft, reconcileAgentWorkflowDrafts } from "./agent-workflow-projector.js";
import { McpSettingsService } from "./modules/mcp/mcp-service.js";
import { registerMcpSettingsRoutes } from "./modules/mcp/routes.js";

export function createApp(options: { research?: Gate3ResearchService; dataRoot?: string; webRoot?: string; literatureFetch?: typeof fetch; literatureSleep?: (ms: number, signal?: AbortSignal) => Promise<void>; connectorProbe?: ConnectorMetadataProbe; connectorDownloader?: ConnectorDownloader; connectorMode?: "fixture" | "live"; projectAnalysisRunner?: ProjectAnalysisRunner } = {}) {
  const app = Fastify({ logger: false });
  void app.register(cors, { origin: /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/ });
  const webRoot = options.webRoot ?? resolve(dirname(fileURLToPath(import.meta.url)), "../../web/dist");
  void app.register(fastifyStatic, { root: webRoot, wildcard: false });
  const dataRoot = options.dataRoot ?? resolve(dirname(fileURLToPath(import.meta.url)), "../../../data");
  const gate3Root = resolve(dataRoot, "gate3");
  const gate4Root = resolve(dataRoot, "gate4");
  const readManagedArtifact = async (uri: string, offsetBytes: number, maxBytes: number) => {
    const match = /^artifact:\/\/(workflow|gate3)\/([a-zA-Z0-9-]+)\/(.+)$/.exec(uri);
    if (!match) throw new Error("Only workflow and gate3 text Artifacts can be read through this tool");
    const relative = match[3]!;
    if (relative.includes("\\") || relative.split("/").includes("..") || !/\.(json|csv|md|txt|log)$/i.test(relative)) throw new Error("Artifact type or path is not safe for text inspection");
    const root = match[1] === "workflow" ? resolve(gate4Root, "project-runs", match[2]!, "artifacts") : resolve(gate3Root, "runs", match[2]!, "artifacts");
    const path = resolve(root, relative);
    if (!path.startsWith(`${root}${sep}`)) throw new Error("Artifact path escapes its managed root");
    const handle = await open(path, "r");
    try {
      const stat = await handle.stat();
      const length = Math.min(maxBytes, Math.max(0, stat.size - offsetBytes));
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, offsetBytes);
      return { uri, offsetBytes, text: buffer.subarray(0, bytesRead).toString("utf8"), truncated: offsetBytes + bytesRead < stat.size };
    } finally { await handle.close(); }
  };
  const knowledgePath = resolve(gate4Root, "knowledge.sqlite");
  const agentCenterPath = resolve(gate4Root, "agent-center.sqlite");
  const migrationReportPath = resolve(gate4Root, "agent-migration-report.json");
  let priorMigrationBackup: Gate45CMigrationBackupManifest | undefined;
  if (existsSync(migrationReportPath)) {
    try {
      const candidate = (JSON.parse(readFileSync(migrationReportPath, "utf8")) as { backup?: Gate45CMigrationBackupManifest }).backup;
      if (candidate?.gate === "4.5-C" && candidate.backupId.startsWith("gate-4.5-c-") && existsSync(resolve(candidate.directory, "manifest.json"))) priorMigrationBackup = candidate;
    } catch { /* an unreadable legacy report must not suppress a fresh backup */ }
  }
  const migrationBackup = priorMigrationBackup ?? ((existsSync(knowledgePath) || existsSync(agentCenterPath)) ? createGate45CMigrationBackup({ gate4Root }) : undefined);
  const knowledge = new KnowledgeService(knowledgePath);
  const agentSessionStore = new SqliteAgentSessionStore(agentCenterPath);
  const credentials = new CredentialStore(resolve(dataRoot, "credentials"));
  const credentialsReady = credentials.initialize();
  const modelRuntime = new ModelRuntimeStore(resolve(gate4Root, "model-runtime.json"));
  const tokenLedger = new TokenLedger(resolve(gate4Root, "token-ledger.jsonl"));
  const skillCatalog = new LazySkillCatalog(resolve(dirname(fileURLToPath(import.meta.url)), "../../../skills"));
  const skillCatalogReady = skillCatalog.initialize().then(() => {
    const knownSkills = new Set(skillCatalog.list().map((skill) => skill.name));
    for (const capability of researchCapabilityCatalog) for (const skillName of capability.skillNames) if (!knownSkills.has(skillName)) throw new Error(`Capability ${capability.id} references unknown Skill ${skillName}`);
  });
  const contextAssemblyCache = new ContextAssemblyCache();
  const modelRuntimeReady = modelRuntime.initialize();
  const modelSettings = new ModelSettingsService(credentials, modelRuntime, credentialsReady, modelRuntimeReady);
  registerSettingsRoutes(app, modelSettings, credentialsReady, { ready: skillCatalogReady, list: () => skillCatalog.list(), capabilities: researchCapabilityCatalog });
  const mcpGateway = new PiMcpGatewayManager(resolve(gate4Root, "mcp", "host"));
  const mcpSettings = new McpSettingsService(resolve(gate4Root, "mcp"), credentials, mcpGateway);
  const mcpReady = credentialsReady.then(() => mcpSettings.initialize());
  registerMcpSettingsRoutes(app, mcpSettings, mcpReady);
  const modelStatus = () => modelSettings.status();
  const customRouteConfig = () => modelSettings.customRouteConfig();
  const literatureCache = new FileLiteratureCache(resolve(gate4Root, "literature-cache"));
  const literature = new LiteratureSearchService(
    new SemanticScholarProvider(options.literatureFetch ?? fetch, () => credentials.get("semantic-scholar", "apiKey")),
    new OpenAlexProvider(options.literatureFetch ?? fetch, () => credentials.get("openalex", "apiKey")),
    literatureCache,
    { retry: { ...(options.literatureSleep ? { sleep: options.literatureSleep } : {}) } },
  );
  const fixtureConnector = new FixtureConnectorAdapter(resolve(gate4Root, "connector-artifacts"));
  const connectorMode = options.connectorMode ?? (process.env.XILING_CONNECTOR_MODE === "live" ? "live" : "fixture");
  const connectorCredentials = (connectorId: OceanSubsetRequest["connectorId"]): Record<string, unknown> => {
    const network = Object.fromEntries(["HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "REQUESTS_CA_BUNDLE", "SSL_CERT_FILE"].flatMap((name) => process.env[name] ? [[name, process.env[name]!]] : []));
    const base = Object.keys(network).length ? { _network: network } : {};
    if (connectorId === "copernicus-marine") return { ...base, ...Object.fromEntries(["username", "password"].flatMap((field) => { const value = credentials.get("copernicus-marine", field); return value ? [[field, value]] : []; })) };
    if (connectorId === "nasa-harmony") return { ...base, ...Object.fromEntries(["token", "username", "password"].flatMap((field) => { const value = credentials.get("nasa-earthdata", field); return value ? [[field, value]] : []; })) };
    return base;
  };
  const liveConnectorProbe = new DockerConnectorProbe(resolve(gate4Root, "connector-metadata"), connectorCredentials);
  const liveConnectorRunner = new DockerConnectorRunner(resolve(gate4Root, "connector-runs"), connectorCredentials);
  const connectorProbe = options.connectorProbe ?? (connectorMode === "live" ? liveConnectorProbe : fixtureConnector);
  const connectorWorkflow = new ConnectorWorkflowService(
    new JsonConnectorJobRepository(resolve(gate4Root, "connector-jobs.json")),
    options.connectorDownloader ?? (connectorMode === "live" ? liveConnectorRunner : fixtureConnector),
  );
  const connectorReady = connectorWorkflow.initialize();
  const connectorCredentialsAvailable = (request: OceanSubsetRequest) => {
    const credentialId = request.connectorId === "copernicus-marine" ? "copernicus-marine" : request.connectorId === "nasa-harmony" ? "nasa-earthdata" : undefined;
    return !credentialId || credentials.status(credentialId).configured;
  };
  const projectWorkflow = new ProjectWorkflowService(
    new JsonProjectWorkflowRepository(resolve(gate4Root, "project-workflows.json")),
    connectorWorkflow,
    connectorProbe,
    options.projectAnalysisRunner ?? (connectorMode === "live" ? new DockerProjectAnalysisRunner(gate4Root) : new FixtureProjectAnalysisRunner(resolve(gate4Root, "project-runs"))),
    connectorCredentialsAvailable,
  );
  const projectWorkflowReady = Promise.all([connectorReady, credentialsReady]).then(() => projectWorkflow.initialize());
  const connectorMetadata = new Map<string, { requestHash: string; metadata: ConnectorMetadataSummary }>();
  const activeConnectorRuns = new Map<string, AbortController>();
  app.addHook("onClose", async () => knowledge.close());
  app.addHook("onClose", async () => { for (const controller of activeConnectorRuns.values()) controller.abort("server closing"); });
  const research = options.research ?? new Gate3ResearchService(
    new JsonProjectRepository(resolve(gate3Root, "project.json")),
    new DockerArgoResearchRunner(resolve(gate3Root, "runs")),
  );
  const researchReady = research.initialize();
  registerLegacyGate3Routes(app, { research, ready: researchReady, runsRoot: resolve(gate3Root, "runs") });
  const baseCanvasNodes = (projectId: string): CanvasGraphDocument["nodes"] => {
    const project = knowledge.getProject(projectId);
    if (!project) return [];
    const createdAt = project.createdAt;
    return [
      { id: "question", x: 400, y: 90, data: { eyebrow: "RESEARCH QUESTION", title: project.name, body: project.researchQuestion, tone: "prompt", source: { kind: "project" }, createdAt } },
      { id: "decompose", x: 400, y: 315, data: { eyebrow: "PI RESPONSE", title: "等待研究拆解", body: "从 Chat 或画布提交任务后，Pi 会在当前项目中建立证据与数据分支。", tone: "answer", source: { kind: "project" }, createdAt } },
      { id: "literature", x: 160, y: 540, data: { eyebrow: "PAPER BRANCH", title: "文献证据", body: "当前项目尚未固定论文。", tone: "paper", source: { kind: "project" }, createdAt } },
      { id: "dataset", x: 640, y: 540, data: { eyebrow: "DATA BRANCH", title: "数据计划", body: "当前项目尚未确认数据范围。", tone: "data", source: { kind: "project" }, createdAt } },
    ];
  };
  const canvasRepository = new FileCanvasRepository({ root: resolve(gate4Root, "canvas-layout"), legacyPath: resolve(gate4Root, "canvas-layout.json"), defaultProjectId: "ocean-heatwave", baseNodes: baseCanvasNodes });
  const readCanvasGraph = (projectId: string) => canvasRepository.read(projectId);
  registerCanvasRoutes(app, canvasRepository);
  registerLiteratureRoutes(app, { literature, credentialsReady, evidence: knowledge, canvas: canvasRepository });
  const contextNodeKind = (node: CanvasGraphDocument["nodes"][number]): CanvasNode["kind"] => {
    const sourceKind = node.data?.source?.kind;
    if (sourceKind === "paper") return "paper";
    if (sourceKind === "workflow") return "tool-result";
    if (node.data?.tone === "prompt") return "prompt";
    if (node.data?.tone === "paper") return "paper";
    if (node.data?.tone === "data") return "dataset";
    if (node.data?.tone === "note") return "note";
    return node.data?.eyebrow === "AGENT CHECKPOINT" ? "checkpoint" : "response";
  };
  const projectCanvasContext = async (projectId: string, request: { activeNodeId: string; quotedNodeIds: string[]; capabilityQuery?: string; activatedCapabilityIds?: string[] }) => {
    const graph = await readCanvasGraph(projectId);
    knowledge.pruneContextCapsules(projectId, graph.nodes.map((node) => node.id));
    const persisted = new Map(knowledge.listContextCapsules(projectId).map((capsule) => [capsule.id, capsule]));
    const nodeMap = new Map<string, CanvasNode>();
    const capsuleMap = new Map<string, ContextCapsule>();
    for (const node of graph.nodes) {
      if (!node.data) continue;
      const artifactUris = (node.data.artifactUris ?? []) as ContextCapsule["artifactUris"];
      const createdAt = node.data.createdAt ?? knowledge.getProject(projectId)?.createdAt ?? new Date(0).toISOString();
      const candidate = createNodeContextCapsule({ projectId, nodeId: node.id, title: node.data.title, body: node.data.body, artifactUris });
      const existing = persisted.get(candidate.id);
      const capsule = existing?.sourceRevision === candidate.sourceRevision ? existing : knowledge.upsertContextCapsule(projectId, candidate);
      nodeMap.set(node.id, { id: node.id, projectId, kind: contextNodeKind(node), title: node.data.title, summary: capsule.summary, ...(artifactUris[0] ? { artifactUri: artifactUris[0] } : {}), createdAt });
      capsuleMap.set(node.id, capsule);
    }
    const resolvedCapabilities = request.activatedCapabilityIds ?? (request.capabilityQuery ? selectResearchCapabilities(request.capabilityQuery).map((capability) => capability.id) : []);
    const projectionRequest = { activeNodeId: request.activeNodeId, quotedNodeIds: request.quotedNodeIds, activatedCapabilityIds: resolvedCapabilities };
    const projection = projectContext(projectionRequest, { nodes: nodeMap, capsules: capsuleMap, edges: graph.edges }, researchCapabilityCatalog);
    return { graph, projection };
  };
  const agentHarness = new ResearchAgentHarness(agentSessionStore, {
    create: async ({ sessionId, runId, prompt, attachments, commandContext, history, onUsage }) => {
      const command = z.object({ projectId: z.string().min(1).max(120), context: z.object({ activeNodeId: z.string().min(1).max(120), quotedNodeIds: z.array(z.string().min(1).max(120)).max(12) }).optional() }).parse(commandContext);
      const activeProject = knowledge.getProject(command.projectId);
      if (!activeProject || activeProject.status === "archived") throw new Error("Project not found or archived");
      const session = agentSessionStore.getSession(sessionId);
      if (!session || session.projectId !== activeProject.id) throw new Error("Agent session project mismatch");
      const activeCapabilities = selectResearchCapabilities(prompt);
      let activeTools = selectResearchTools(prompt, { project: activeProject, knowledge, literature, readArtifact: readManagedArtifact });
      await skillCatalogReady;
      const activatedSkills = await skillCatalog.activate(prompt, activeCapabilities.map((capability) => capability.id));
      await mcpReady;
      if (mcpGateway.matches(prompt)) activeTools = [...activeTools, mcpGateway.tool()];
      const persistedContext = knowledge.getChatSessionContext(sessionId);
      const requestedContext = command.context ?? (persistedContext ? { activeNodeId: persistedContext.activeNodeId, quotedNodeIds: persistedContext.quotedNodeIds } : { activeNodeId: "decompose", quotedNodeIds: [] });
      let resolvedContext = requestedContext;
      let canvasProjection: Awaited<ReturnType<typeof projectCanvasContext>>;
      try { canvasProjection = await projectCanvasContext(activeProject.id, { ...requestedContext, activatedCapabilityIds: activeCapabilities.map((capability) => capability.id) }); }
      catch {
        resolvedContext = { activeNodeId: "decompose", quotedNodeIds: [] };
        canvasProjection = await projectCanvasContext(activeProject.id, { ...resolvedContext, activatedCapabilityIds: activeCapabilities.map((capability) => capability.id) });
      }
      if (knowledge.getChatSession(sessionId)) knowledge.setChatSessionContext(sessionId, { projectId: activeProject.id, ...resolvedContext });
      const routeStatus = await modelStatus();
      if (routeStatus.mode === "live" && !routeStatus.ready) throw new Error(routeStatus.reason);
      let liveRoute: ReturnType<typeof createLiveRoute> | undefined;
      if (routeStatus.mode === "live" && routeStatus.providerId && routeStatus.modelId) {
        const apiKey = credentials.get(routeStatus.providerId as ModelProviderId, "apiKey") ?? (routeStatus.providerId === "custom" ? "xiling-local" : undefined);
        if (!apiKey) throw new Error("credential_required");
        liveRoute = createLiveRoute(routeStatus.providerId, routeStatus.modelId, apiKey, routeStatus.providerId === "custom" ? customRouteConfig() : undefined, routeStatus.selectedModel?.inputModalities.filter((item): item is "text" | "image" => item === "text" || item === "image"));
      }
      const resolveImages = (items: typeof attachments) => items.map((attachment) => {
        const stored = agentSessionStore.getAttachment(attachment.id);
        if (!stored || stored.projectId !== activeProject.id || stored.sha256 !== attachment.sha256) throw new Error("Agent image attachment is missing or failed integrity validation");
        return { type: "image" as const, data: Buffer.from(stored.data).toString("base64"), mimeType: stored.mimeType };
      });
      const currentImages = resolveImages(attachments);
      const historyAttachments = new Map(history.map((message) => [message.id, message.attachments ?? []] as const));
      const coreRules = [
        "你是汐灵 OS 的海洋科学研究 Agent。",
        "只处理当前项目；需要项目细节时先调用 read_project_context。",
        "只在用户问题确实需要时调用其余已激活工具；不得假装工具已经运行。",
        "MCP 只允许先搜索/描述后调用；若工具返回需要审批，必须停止并请用户在设置中显式信任对应服务器后重试，不得规避审批。",
        "任何下载、计算、外部写入或结论沉淀都必须停在计划/建议阶段，等待用户确认。",
        "引用工具结果时说明数据源；缺少证据时明确说明。",
      ].join("\n");
      const projectPrompt = `当前项目：${activeProject.name}\n研究问题：${activeProject.researchQuestion}\n当前画布活动节点：${resolvedContext.activeNodeId}\n当前画布显式引用：${resolvedContext.quotedNodeIds.join(", ") || "无"}`;
      const projectedNodeIds = new Set([...canvasProjection.projection.activeBranchNodeIds, ...canvasProjection.projection.quotedNodeIds]);
      const sourceCoverage = reconcileCanvasSourceCoverage({
        history,
        nodes: canvasProjection.graph.nodes.flatMap((node) => projectedNodeIds.has(node.id) && node.data
          ? [{ id: node.id, body: node.data.body, ...(node.data.source?.sourceEntryId ? { sourceEntryId: node.data.source.sourceEntryId } : {}) }]
          : []),
        getDurableEntry: (entryId) => agentSessionStore.getEntry(entryId),
      });
      const historyRecords = sourceCoverage.history;
      const allowedSourceEntries = new Set(sourceCoverage.incompleteSources.map(({ sourceEntryId }) => sourceEntryId));
      const latestCompaction = agentSessionStore.latestCompaction(sessionId);
      const compactedEntries = latestCompaction
        ? agentSessionStore.listSessionEntries(sessionId).filter((entry) => entry.sequence <= latestCompaction.coveredThroughSequence && entry.kind !== "compaction")
        : [];
      for (const entry of compactedEntries) allowedSourceEntries.add(entry.id);
      const sourceLookupPrompt = sourceCoverage.incompleteSources.length
        ? `以下画布节点只是截断预览；需要全文时调用 read_agent_entry：\n${sourceCoverage.incompleteSources.map(({ nodeId, sourceEntryId }) => `- ${nodeId} -> ${sourceEntryId}`).join("\n")}`
        : "";
      const historyLookupPrompt = latestCompaction
        ? "较早研究对话已压缩为结构化索引。遇到摘要无法回答的旧决策、证据或产物时，先调用 search_agent_history，再按返回的 Entry ID 调用 read_agent_entry；不要猜测被压缩内容。"
        : "";
      if (allowedSourceEntries.size) activeTools = [...activeTools, agentEntryReaderTool({
        project: activeProject,
        knowledge,
        literature,
        readAgentEntry: async (entryId, offsetChars, maxChars) => {
          if (!allowedSourceEntries.has(entryId)) throw new Error("Agent entry is not declared by the active Canvas projection");
          const entry = agentSessionStore.getEntry(entryId);
          const sourceSession = entry ? agentSessionStore.getSession(entry.sessionId) : undefined;
          if (!entry || sourceSession?.projectId !== activeProject.id) throw new Error("Agent entry is outside the active project");
          const text = entry.text.slice(offsetChars, offsetChars + maxChars);
          return { entryId, text, offsetChars, truncated: offsetChars + text.length < entry.text.length };
        },
      })];
      if (latestCompaction) activeTools = [...activeTools, agentHistorySearchTool({
        project: activeProject,
        knowledge,
        literature,
        searchAgentHistory: async (query, limit) => {
          const normalized = query.toLocaleLowerCase().trim();
          const terms = [...new Set([normalized, ...normalized.split(/\s+/u).filter((term) => term.length > 1)])];
          return compactedEntries
            .map((entry) => ({ entry, score: terms.reduce((score, term) => score + (entry.text.toLocaleLowerCase().includes(term) ? term.length : 0), 0) }))
            .filter(({ score }) => score > 0)
            .sort((left, right) => right.score - left.score || right.entry.sequence - left.entry.sequence)
            .slice(0, limit)
            .map(({ entry }) => ({ entryId: entry.id, kind: entry.kind, excerpt: entry.text.replace(/\s+/gu, " ").slice(0, 700), createdAt: entry.createdAt }));
        },
      })];
      const modelContextWindow = liveRoute?.contextWindow ?? 128_000;
      const maxOutputTokens = liveRoute?.maxOutputTokens ?? 8_192;
      const projectionHash = canvasProjection.projection.projectionHash;
      const cacheKey = contextAssemblyCache.key({ projectId: activeProject.id, sessionId, projectionHash, prompt, history: historyRecords.map(({ id, role, text }) => [id, role, text]), modelContextWindow, maxOutputTokens, skills: activatedSkills.entries.map(({ name, version }) => [name, version]), tools: activeTools.map((tool) => tool.name) });
      let contextAssembly = contextAssemblyCache.get(cacheKey);
      if (contextAssembly) contextAssembly.trace.cache = "hit";
      else {
        contextAssembly = assembleContext({ projection: canvasProjection.projection, nodes: new Map(canvasProjection.graph.nodes.flatMap((node) => node.data ? [[node.id, { id: node.id, title: node.data.title, body: node.data.body }] as const] : [])), history: historyRecords, modelContextWindow, maxOutputTokens, fixedPromptTokens: estimateContextTokens(`${coreRules}\n${projectPrompt}\n当前用户问题：${prompt}`), toolSchemaTokens: estimateContextTokens(JSON.stringify(activeTools.map(({ name, description, parameters }) => ({ name, description, parameters })))), skillTokens: estimateContextTokens(activatedSkills.prompt), activatedSkillNames: activatedSkills.skills.map((skill) => skill.name) });
        contextAssemblyCache.set(cacheKey, contextAssembly);
      }
      // Binary visual context is deliberately lazy: the current turn is always
      // native, while historical bytes are restored only when the user refers
      // to an earlier image. Descriptors remain in durable history either way.
      const explicitPriorImageReference = /上(?:一)?张|前(?:一)?张|先前|此前|之前|刚才|历史图片|previous\s+(?:image|figure)|earlier\s+(?:image|figure)|last\s+(?:image|figure)/iu.test(prompt);
      const implicitImageReference = currentImages.length === 0 && /(?:这|那|该)?(?:张)?(?:图像|图片|截图|照片|图中)|(?:它|其中|这个).*(?:显示|表明|说明|异常)|(?:image|figure).*(?:show|indicate|compare)/iu.test(prompt);
      const historicalImageMessageId = explicitPriorImageReference || implicitImageReference
        ? [...contextAssembly.history].reverse().find((message) => (historyAttachments.get(message.id)?.length ?? 0) > 0)?.id
        : undefined;
      const runtime = new PiRuntimeAdapter({
        sessionId,
        systemPrompt: liveRoute ? [coreRules, projectPrompt, contextAssembly.canvasText ? `画布上下文投影：\n${contextAssembly.canvasText}` : "当前画布分支没有可用上下文。", sourceLookupPrompt, historyLookupPrompt, activatedSkills.prompt ? `本轮按需加载的 Skill：\n${activatedSkills.prompt}` : "本轮没有命中额外 Skill。"].filter(Boolean).join("\n") : `你是汐灵 OS 的离线演示 Agent。当前项目：${activeProject.name}。`,
        ...(liveRoute ? { route: liveRoute } : {}),
        initialMessages: contextAssembly.history.map((message) => {
          const descriptors = historyAttachments.get(message.id) ?? [];
          const images = message.id === historicalImageMessageId ? resolveImages(descriptors) : [];
          const attachmentNote = descriptors.length ? `\n[原生图像附件：${descriptors.map(({ name }) => name).join("、")}；${images.length ? "本轮已按需载入" : "本轮未重复载入"}]` : "";
          return { role: message.role, text: `${message.text}${attachmentNote}`, timestamp: message.timestamp, ...(images.length ? { images } : {}) };
        }),
        contextPolicy: "deduplicate-adjacent",
        ...(liveRoute ? { reasoning: routeStatus.reasoning } : {}),
        onUsage: async (usage) => {
          const normalized = { providerId: routeStatus.providerId ?? "xiling-offline", modelId: routeStatus.modelId ?? "fixture", inputTokens: usage.input, outputTokens: usage.output, cacheReadTokens: usage.cacheRead, cacheWriteTokens: usage.cacheWrite, reasoningTokens: usage.reasoning ?? 0, totalTokens: usage.totalTokens, cost: usage.cost.total } satisfies RuntimeUsageInput;
          await onUsage(normalized);
          await tokenLedger.record({ sessionId, providerId: normalized.providerId, modelId: normalized.modelId, inputTokens: normalized.inputTokens, outputTokens: normalized.outputTokens, cacheReadTokens: normalized.cacheReadTokens, cacheWriteTokens: normalized.cacheWriteTokens, reasoningTokens: normalized.reasoningTokens, totalTokens: normalized.totalTokens, cost: normalized.cost, projectionHash, contextEstimatedTokens: contextAssembly.trace.estimatedInputTokens, contextAvailableTokens: contextAssembly.trace.availableInputTokens, contextCacheHit: contextAssembly.trace.cache === "hit", activatedCapabilityCount: contextAssembly.trace.activatedCapabilityIds.length, activatedSkillCount: contextAssembly.trace.activatedSkillNames.length, omittedHistoryCount: contextAssembly.trace.omittedHistoryCount });
        },
      });
      runtime.setActiveTools(activeTools);
      return {
        subscribe(listener: (event: AgentStreamEvent) => void | Promise<void>) {
          let contextDelivered = false;
          return runtime.subscribe(async (event) => {
            if (!contextDelivered) {
              contextDelivered = true;
              await listener({ type: "context.ready", trace: contextAssembly.trace });
            }
            const deliveredEvent = event.type === "session.error" ? { ...event, message: humanizeModelFailure(event.message) } : event;
            await listener(deliveredEvent);
            if (event.type !== "tool.finished") return;
            const sourceEvent = agentSessionStore.listEvents(runId).at(-1);
            if (!sourceEvent || sourceEvent.type !== "tool.finished") return;
            const operation = agentSessionStore.snapshot(runId).operations.find((item) => item.callId === event.callId);
            const projectionEvent = await projectAgentWorkflowDraft({
              event,
              projectId: activeProject.id,
              sessionId,
              runId,
              sourceEventSequence: sourceEvent.sequence,
              ...(operation ? { sourceOperationId: operation.id } : {}),
              ready: projectWorkflowReady,
              workflows: projectWorkflow,
            });
            if (projectionEvent) await listener(projectionEvent);
          });
        },
        prompt: (text: string) => runtime.prompt(text, currentImages),
        abort: () => runtime.abort(),
      };
    },
  }, {
    compaction: {
      maxEntries: 24,
      retainEntries: 10,
      maxEstimatedTokens: 18_000,
      maxEstimatedChars: 72_000,
      async summarize(entries) {
        const indexed = entries.map((entry) => {
          const normalized = entry.text.replace(/\s+/gu, " ").trim();
          const references = [...new Set(normalized.match(/(?:artifact|dataset|project):\/\/[^\s,;，。)\]]+|https?:\/\/[^\s,;，。)\]]+|10\.\d{4,9}\/[-._;()/:A-Z0-9]+/giu) ?? [])].slice(0, 8);
          const tags = [
            /假设|hypothes/iu.test(normalized) ? "假设" : "",
            /决定|采用|选择|decision/iu.test(normalized) ? "决策" : "",
            /证据|结果|发现|evidence|result/iu.test(normalized) ? "证据" : "",
            /局限|风险|不确定|limitation|uncertain/iu.test(normalized) ? "局限" : "",
          ].filter(Boolean);
          return `- [entry:${entry.id}] ${entry.role ?? entry.kind}${tags.length ? ` · ${tags.join("/")}` : ""}：${normalized.slice(0, 360)}${normalized.length > 360 ? "…" : ""}${references.length ? `\n  来源指针：${references.join("；")}` : ""}`;
        });
        return {
          summary: ["前序研究记录增量索引（每项保留耐久 Entry 指针，可按需检索全文）：", ...indexed].join("\n"),
          model: "xiling-structured-compactor-v2",
          usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, totalTokens: 0, cost: 0 },
        };
      },
    },
  });
  const migrationReady = (async () => {
    let importedMessages = 0; let linkedCanvasNodes = 0;
    for (const project of knowledge.listProjects()) {
      const legacyToEntry = new Map<string, string>();
      for (const session of knowledge.listChatSessions(project.id)) {
        const messages = knowledge.listChatMessages(session.id);
        const mapping = agentSessionStore.importLegacyTranscript({ sessionId: session.id, projectId: project.id, messages });
        importedMessages += mapping.size;
        for (const pair of mapping) legacyToEntry.set(pair[0], pair[1]);
      }
      await canvasRepository.update(project.id, (graph) => ({ ...graph, nodes: graph.nodes.map((node) => {
        const legacyId = node.data?.source?.messageId;
        const sourceEntryId = legacyId ? legacyToEntry.get(legacyId) : undefined;
        if (!sourceEntryId || !node.data?.source || node.data.source.sourceEntryId === sourceEntryId) return node;
        linkedCanvasNodes += 1;
        return { ...node, data: { ...node.data, source: { ...node.data.source, sourceEntryId } } };
      }) }));
    }
    const report = { version: 2, status: "completed", importedMessages, linkedCanvasNodes, completedAt: new Date().toISOString(), destructiveRewrite: false, ...(migrationBackup ? { backup: migrationBackup } : {}) };
    await writeFile(migrationReportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    return report;
  })();
  const workflowProjectionReady = migrationReady.then(() => reconcileAgentWorkflowDrafts({ store: agentSessionStore, ready: projectWorkflowReady, workflows: projectWorkflow }));
  app.addHook("onClose", async () => { await agentHarness.shutdown(); try { await mcpReady; } catch { /* initialization error is surfaced by settings and Agent routes */ } await mcpGateway.close(); try { await workflowProjectionReady; } finally { agentSessionStore.close(); } });
  registerWorkspaceRoutes(app, { knowledge, agentSessions: agentSessionStore, agentMigrationReady: migrationReady, onChatSessionCreated: (session) => agentHarness.createSession({ id: session.id, projectId: session.projectId }), onChatSessionArchived: (session) => agentHarness.archiveSession(session.id), validateCanvasContext: async (projectId, context) => projectCanvasContext(projectId, context) });
  registerAgentCenterRoutes(app, { harness: agentHarness, store: agentSessionStore, ready: Promise.all([migrationReady, workflowProjectionReady]), projectExists: (projectId) => Boolean(knowledge.getProject(projectId)), projectActive: (projectId) => { const project = knowledge.getProject(projectId); return Boolean(project && project.status !== "archived"); }, sessionExists: (sessionId, projectId) => knowledge.getChatSession(sessionId)?.projectId === projectId, acceptedInputModalities: async () => {
    const status = await modelStatus();
    if (!status.ready || !status.selectedModel) return ["text"];
    return status.selectedModel.inputModalities.filter((modality) => modality === "text" || modality === "image");
  } });
  app.addHook("onClose", async () => { try { await projectWorkflowReady; } catch { /* initialization failure is already surfaced by routes */ } });
  const settleProjectWorkflow = async (workflow: NonNullable<ReturnType<typeof projectWorkflow.get>>) => {
    if (workflow.settledAt || workflow.status !== "completed" || !workflow.run || !workflow.review) return workflow;
    const run = workflow.run;
    const review = workflow.review;
    const title = `科研闭环 · ${workflow.request.datasetId} · ${workflow.id.slice(-8)}`;
    const notes = [
      `数据源：${workflow.request.connectorId} / ${workflow.request.datasetId}`,
      `变量：${workflow.request.variables.join(", ")}`,
      `时间：${workflow.request.time.start} — ${workflow.request.time.end}`,
      `Reviewer：${review.verdict}`,
      ...review.checks.map((check) => `${check.passed ? "✓" : "✕"} ${check.id}：${check.detail}`),
      ...review.limitations.map((item) => `局限：${item}`),
      ...run.artifactUris.map((uri) => `Artifact：${uri}`),
    ].join("\n");
    const item = knowledge.listItems(workflow.projectId).find((candidate) => candidate.kind === "experiment" && candidate.title === title)
      ?? knowledge.createItem(workflow.projectId, { kind: "experiment", title, notes });
    if (review.verdict === "accepted") knowledge.updateItem(item.id, { status: "done" });
    if (!knowledge.listWikiPages(workflow.projectId).some((page) => page.title === title)) {
      knowledge.createWikiPage({ projectId: workflow.projectId, title, markdown: `# ${title}\n\n${notes}`, artifactUris: run.artifactUris });
    }
    const nodeId = `workflow-${workflow.id}`;
    await canvasRepository.update(workflow.projectId, (graph) => {
      if (graph.nodes.some((node) => node.id === nodeId)) return graph;
      const node = { id: nodeId, x: 520, y: 160 + graph.nodes.length * 42, data: { eyebrow: "RESEARCH WORKFLOW", title, body: `数据下载与分析完成。Reviewer：${review.verdict}。${review.limitations[0] ?? ""}`, tone: "data" as const, source: { kind: "workflow" as const, sessionId: workflow.sessionId, workflowId: workflow.id, sourceCallId: workflow.sourceCallId }, artifactUris: run.artifactUris, createdAt: workflow.updatedAt } };
      const edge = { id: `edge-dataset-${nodeId}`, source: "dataset", target: nodeId, kind: "produced" as const };
      return { ...graph, nodes: [...graph.nodes, node], edges: [...graph.edges, edge] };
    });
    return projectWorkflow.markSettled(workflow.id);
  };

  registerConnectorRoutes(app, { root: gate4Root, mode: connectorMode, credentials, credentialsReady, probe: connectorProbe, workflow: connectorWorkflow, workflowReady: connectorReady, metadata: connectorMetadata, activeRuns: activeConnectorRuns });
  registerWorkflowRoutes(app, { root: gate4Root, workflow: projectWorkflow, ready: projectWorkflowReady, projects: knowledge, conversations: knowledge, settle: settleProjectWorkflow });

  app.get("/health", async () => ({
    status: "ok",
    service: "xiling-server",
    pi: "0.84.2",
    runner: "external-health-check",
  }));

  app.post("/api/context/project", async (request, reply) => {
    const parsed = projectionSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues });
    if (!knowledge.getProject(parsed.data.projectId)) return reply.code(404).send({ error: "Project not found" });
    try {
      const { projection } = await projectCanvasContext(parsed.data.projectId, { activeNodeId: parsed.data.activeNodeId, quotedNodeIds: parsed.data.quotedNodeIds, ...(parsed.data.capabilityQuery ? { capabilityQuery: parsed.data.capabilityQuery } : {}) });
      return projection;
    } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) }); }
  });

  app.get("/api/metrics/tokens", async (request, reply) => {
    const parsed = z.object({ limit: z.coerce.number().int().min(1).max(1000).default(100) }).safeParse(request.query);
    return parsed.success ? tokenLedger.list(parsed.data.limit) : reply.code(400).send({ error: parsed.error.issues });
  });

  app.get("/api/metrics/context", async () => {
    await skillCatalogReady;
    return {
      ...(await tokenLedger.summarize()),
      assemblyCache: contextAssemblyCache.stats(),
      skills: skillCatalog.list().map(({ name, description, version, capabilityIds }) => ({ name, description, version, capabilityIds })),
      capabilities: researchCapabilityCatalog.map(({ id, description, toolName, skillNames }) => ({ id, description, toolName, skillNames })),
    };
  });

  app.post("/api/system/stop", async (_request, reply) => {
    await reply.send({ status: "stopping" });
    setImmediate(() => void app.close());
  });

  return app;
}
