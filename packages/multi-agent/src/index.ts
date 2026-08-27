import { createHash } from "node:crypto";

export type AgentIsolation = "scoped" | "blind" | "execution";
export type DelegationMode = "single" | "parallel" | "chain";
export type DelegationStatus = "queued" | "running" | "completed" | "failed" | "cancelled" | "suspended";

export interface AgentRoleSpec {
  id: string;
  title: string;
  description: string;
  systemPrompt: string;
  allowedCapabilities: string[];
  defaultIsolation: AgentIsolation;
  canDelegate: false;
  dynamic?: boolean;
}

export interface ContextManifest {
  projectId: string;
  projectBriefRevision: string;
  researchEntityIds: string[];
  sourceUris: string[];
  projectionHash: string;
}

export interface AgentTaskBudget {
  maxDurationMs: number;
  maxToolCalls: number;
  maxCost?: number;
}

export interface AgentTaskRequest {
  roleId: string;
  objective: string;
  isolation?: AgentIsolation;
  dependsOn?: number[];
}

export interface AgentTaskResult {
  delegationId: string;
  roleId: string;
  status: "completed" | "failed" | "cancelled";
  summary: string;
  sourceUris: string[];
  artifactUris: string[];
  limitations: string[];
  childSessionId: string;
  childRunId?: string;
  usage?: { totalTokens: number; cost: number };
  error?: string;
}

export interface StoredDelegation {
  id: string;
  projectId: string;
  rootRunId: string;
  parentRunId: string;
  childSessionId: string;
  childRunId?: string;
  roleId: string;
  objective: string;
  isolation: AgentIsolation;
  contextManifestHash: string;
  contextManifest: unknown;
  budget: unknown;
  status: DelegationStatus;
  result?: unknown;
  error?: string;
  createdAt?: string;
}

export interface DelegationStore {
  getDelegation?(id: string): StoredDelegation | undefined;
  createDelegation(input: Omit<StoredDelegation, "createdAt" | "status"> & { status?: DelegationStatus }): StoredDelegation;
  updateDelegation(id: string, input: { status: DelegationStatus; childRunId?: string; result?: unknown; error?: string }): StoredDelegation;
}

export interface AgentTaskExecutor {
  createChildSession(projectId: string): string;
  execute(input: {
    delegationId: string;
    projectId: string;
    rootRunId: string;
    parentRunId: string;
    childSessionId: string;
    role: AgentRoleSpec;
    objective: string;
    isolation: AgentIsolation;
    contextManifest: ContextManifest;
    budget: AgentTaskBudget;
    signal?: AbortSignal;
    onRunStarted(runId: string): void;
  }): Promise<Omit<AgentTaskResult, "delegationId" | "roleId" | "childSessionId">>;
}

const commonContract = "只完成声明的子任务；区分事实、推断和未知；提供稳定来源 URI；不得修改 Research Graph、Wiki 或项目状态；结果简洁并明确局限。";

export const PRESET_RESEARCH_AGENT_ROLES: readonly AgentRoleSpec[] = [
  {
    id: "literature-scout", title: "文献检索员", description: "设计检索式、覆盖不同数据库并返回去重候选文献。",
    systemPrompt: `你是汐灵 OS 的文献检索子智能体。优先扩大检索覆盖并保留 DOI、URL 和来源，不把候选论文冒充已核验证据。${commonContract}`,
    allowedCapabilities: ["project.read", "literature.search"], defaultIsolation: "scoped", canDelegate: false,
  },
  {
    id: "evidence-curator", title: "证据审查员", description: "核对来源片段并提出支持、反驳、限定或证据不足判断。",
    systemPrompt: `你是汐灵 OS 的证据审查子智能体。每项判断必须回链来源片段，明确适用范围、置信度和证据缺口。${commonContract}`,
    allowedCapabilities: ["project.read", "literature.search", "artifact.read"], defaultIsolation: "blind", canDelegate: false,
  },
  {
    id: "reproducibility-auditor", title: "复现审计员", description: "审计输入、代码、环境、哈希、RO-Crate 与重跑条件。",
    systemPrompt: `你是汐灵 OS 的复现审计子智能体。核对输入快照、环境、代码、参数、随机性、Artifact 哈希与缺失溯源，不替执行者修饰结果。${commonContract}`,
    allowedCapabilities: ["project.read", "artifact.read"], defaultIsolation: "blind", canDelegate: false,
  },
  {
    id: "skeptical-reviewer", title: "反方审稿员", description: "盲审结论、方法、统计假设和过度推断。",
    systemPrompt: `你是汐灵 OS 的反方审稿子智能体。主动寻找替代解释、选择偏差、统计误用、证据断裂和不可复现环节；不知道主智能体偏好的结论。${commonContract}`,
    allowedCapabilities: ["project.read", "artifact.read", "literature.search"], defaultIsolation: "blind", canDelegate: false,
  },
] as const;

export class AgentRoleRegistry {
  private readonly roles = new Map<string, AgentRoleSpec>();
  constructor(roles: readonly AgentRoleSpec[] = PRESET_RESEARCH_AGENT_ROLES) {
    for (const role of roles) this.register(role);
  }
  register(role: AgentRoleSpec): void {
    if (!/^[a-z0-9-]{2,64}$/.test(role.id)) throw new Error(`Invalid Agent role id: ${role.id}`);
    if (role.canDelegate !== false) throw new Error("Subagent role recursion is disabled");
    this.roles.set(role.id, structuredClone(role));
  }
  get(id: string): AgentRoleSpec | undefined { const role = this.roles.get(id); return role ? structuredClone(role) : undefined; }
  list(): AgentRoleSpec[] { return [...this.roles.values()].map((role) => structuredClone(role)); }
  createDynamic(input: { id: string; title: string; description: string; domainInstructions: string; allowedCapabilities: string[]; isolation?: AgentIsolation }): AgentRoleSpec {
    const role: AgentRoleSpec = {
      id: input.id, title: input.title, description: input.description,
      systemPrompt: `你是汐灵 OS 的一次性领域子智能体。领域任务约束：${input.domainInstructions}\n${commonContract}`,
      allowedCapabilities: [...new Set(input.allowedCapabilities)], defaultIsolation: input.isolation ?? "scoped", canDelegate: false, dynamic: true,
    };
    this.register(role);
    return role;
  }
}

export interface DelegationDecision {
  delegate: boolean;
  reasons: string[];
}

export function evaluateDelegationNeed(input: { independentTracks?: number; requiresBlindReview?: boolean; capabilityBoundaries?: number; contextPressure?: boolean; hasOutputContract?: boolean; unresolvedApproval?: boolean }): DelegationDecision {
  const reasons: string[] = [];
  if ((input.independentTracks ?? 0) >= 2) reasons.push("存在可并行的独立任务前沿");
  if (input.requiresBlindReview) reasons.push("需要独立盲审以降低锚定偏差");
  if ((input.capabilityBoundaries ?? 0) >= 2) reasons.push("任务跨越不同工具或权限边界");
  if (input.contextPressure) reasons.push("主上下文可拆为有界 TaskPacket");
  if (input.unresolvedApproval) return { delegate: false, reasons: ["存在尚未解决的用户审批"] };
  if (input.hasOutputContract === false) return { delegate: false, reasons: ["缺少可验收的结构化输出契约"] };
  return { delegate: reasons.length > 0, reasons };
}

export class MultiAgentOrchestrator {
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  constructor(
    private readonly store: DelegationStore,
    private readonly executor: AgentTaskExecutor,
    readonly roles = new AgentRoleRegistry(),
    private readonly options: { maxConcurrency?: number; maxTasksPerDelegation?: number; defaultBudget?: AgentTaskBudget } = {},
  ) {}

  async delegate(input: { projectId: string; rootRunId?: string; parentRunId: string; mode: DelegationMode; tasks: AgentTaskRequest[]; contextManifest: ContextManifest; budget?: Partial<AgentTaskBudget>; signal?: AbortSignal }): Promise<AgentTaskResult[]> {
    const maxTasks = this.options.maxTasksPerDelegation ?? 6;
    if (!input.tasks.length || input.tasks.length > maxTasks) throw new Error(`Delegation requires 1-${maxTasks} tasks`);
    if (input.mode === "single" && input.tasks.length !== 1) throw new Error("Single delegation accepts exactly one task");
    if (input.mode === "chain" && input.tasks.some((task, index) => index > 0 && !(task.dependsOn?.length))) throw new Error("Chain tasks after the first require dependsOn");
    const maxCost = input.budget?.maxCost ?? this.options.defaultBudget?.maxCost;
    const budget: AgentTaskBudget = {
      maxDurationMs: input.budget?.maxDurationMs ?? this.options.defaultBudget?.maxDurationMs ?? 180_000,
      maxToolCalls: input.budget?.maxToolCalls ?? this.options.defaultBudget?.maxToolCalls ?? 12,
      ...(maxCost !== undefined ? { maxCost } : {}),
    };
    const runTask = (task: AgentTaskRequest, index: number) => this.runOne({ ...input, rootRunId: input.rootRunId ?? input.parentRunId, task, index, budget });
    if (input.mode === "chain") {
      const results: AgentTaskResult[] = [];
      for (const [index, task] of input.tasks.entries()) {
        if (results.some((result) => result.status !== "completed")) break;
        results.push(await runTask({ ...task, objective: `${task.objective}${results.length ? `\n前序结构化摘要：\n${results.map((item) => item.summary).join("\n")}` : ""}` }, index));
      }
      return results;
    }
    return Promise.all(input.tasks.map(runTask));
  }

  private async runOne(input: { projectId: string; rootRunId: string; parentRunId: string; task: AgentTaskRequest; index: number; contextManifest: ContextManifest; budget: AgentTaskBudget; signal?: AbortSignal }): Promise<AgentTaskResult> {
    const role = this.roles.get(input.task.roleId);
    if (!role) throw new Error(`Unknown Agent role: ${input.task.roleId}`);
    const isolation = input.task.isolation ?? role.defaultIsolation;
    const manifestHash = createHash("sha256").update(JSON.stringify(input.contextManifest)).digest("hex");
    const delegationId = createHash("sha256").update(JSON.stringify([input.parentRunId, input.index, role.id, input.task.objective, isolation, manifestHash])).digest("hex").slice(0, 40);
    const existing = this.store.getDelegation?.(delegationId);
    if (existing?.status === "completed" && existing.result) return structuredClone(existing.result as AgentTaskResult);
    const childSessionId = existing?.childSessionId ?? this.executor.createChildSession(input.projectId);
    if (!existing) this.store.createDelegation({ id: delegationId, projectId: input.projectId, rootRunId: input.rootRunId, parentRunId: input.parentRunId, childSessionId, roleId: role.id, objective: input.task.objective, isolation, contextManifestHash: manifestHash, contextManifest: input.contextManifest, budget: input.budget });
    else this.store.updateDelegation(delegationId, { status: "queued" });
    let childRunId: string | undefined;
    let acquired = false;
    try {
      await this.acquire(input.signal);
      acquired = true;
      const execution = await this.executor.execute({ delegationId, projectId: input.projectId, rootRunId: input.rootRunId, parentRunId: input.parentRunId, childSessionId, role, objective: input.task.objective, isolation, contextManifest: input.contextManifest, budget: input.budget, ...(input.signal ? { signal: input.signal } : {}), onRunStarted: (runId) => { childRunId = runId; this.store.updateDelegation(delegationId, { status: "running", childRunId: runId }); } });
      const result: AgentTaskResult = { delegationId, roleId: role.id, childSessionId, ...(childRunId ? { childRunId } : {}), ...execution };
      this.store.updateDelegation(delegationId, { status: result.status, ...(childRunId ? { childRunId } : {}), result, ...(result.error ? { error: result.error } : {}) });
      return result;
    } catch (error) {
      const cancelled = input.signal?.aborted === true;
      const message = error instanceof Error ? error.message : String(error);
      const result: AgentTaskResult = { delegationId, roleId: role.id, childSessionId, ...(childRunId ? { childRunId } : {}), status: cancelled ? "cancelled" : "failed", summary: "", sourceUris: [], artifactUris: [], limitations: [], error: message };
      this.store.updateDelegation(delegationId, { status: result.status, ...(childRunId ? { childRunId } : {}), result, error: message });
      return result;
    } finally { if (acquired) this.release(); }
  }

  private async acquire(signal?: AbortSignal): Promise<void> {
    const limit = Math.max(1, this.options.maxConcurrency ?? 3);
    if (signal?.aborted) throw new Error("Delegation cancelled");
    if (this.active < limit) { this.active += 1; return; }
    await new Promise<void>((resolve, reject) => {
      const next = () => { signal?.removeEventListener("abort", onAbort); this.active += 1; resolve(); };
      const onAbort = () => { const index = this.waiters.indexOf(next); if (index >= 0) this.waiters.splice(index, 1); reject(new Error("Delegation cancelled")); };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.waiters.push(next);
    });
  }
  private release(): void { if (this.active > 0) this.active -= 1; this.waiters.shift()?.(); }
}

export function extractTaskResultText(text: string): Pick<AgentTaskResult, "summary" | "sourceUris" | "artifactUris" | "limitations"> {
  const sourceUris = [...new Set(text.match(/(?:https?:\/\/|project:\/\/|dataset:\/\/|artifact:\/\/|doi:)[^\s,;，。)\]]+/giu) ?? [])];
  return {
    summary: text.trim(),
    sourceUris,
    artifactUris: sourceUris.filter((uri) => uri.startsWith("artifact://")),
    limitations: text.split(/\r?\n/u).filter((line) => /局限|限制|不确定|缺少|unknown|limitation|uncertain/iu.test(line)).slice(0, 8),
  };
}
