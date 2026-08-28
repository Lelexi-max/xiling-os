export type ScienceDomainId = string;

export interface ScienceDomainCapabilityContribution {
  id: string;
  toolName: string;
  description: string;
  keywords: string[];
  skillNames: string[];
}

export interface ScienceDomainAgentRoleContribution {
  id: string;
  title: string;
  description: string;
  systemPrompt: string;
  allowedCapabilities: string[];
  includeDomainCapabilities?: boolean;
  defaultIsolation: "scoped" | "blind" | "execution";
  canDelegate: false;
}

export interface ScienceDomainManifest {
  id: ScienceDomainId;
  version: string;
  title: string;
  description: string;
  disciplines: string[];
  promptFragments: string[];
  capabilities: ScienceDomainCapabilityContribution[];
  agentRoles: ScienceDomainAgentRoleContribution[];
  connectorKinds: string[];
  artifactKinds: string[];
  schemaNamespaces: string[];
}

export interface ResolvedScienceDomain {
  domainIds: string[];
  promptFragments: string[];
  capabilities: ScienceDomainCapabilityContribution[];
  agentRoles: ScienceDomainAgentRoleContribution[];
  connectorKinds: string[];
  artifactKinds: string[];
  schemaNamespaces: string[];
}

export const DOMAIN_AGENT_HANDOFF_CONTRACT = "只完成声明的子任务；区分事实、推断和未知；不得修改 Research Graph、Wiki 或项目状态。最终响应必须是只含 summary、sourceUris、artifactUris、limitations 的 JSON 对象。";

export const GENERAL_SCIENCE_DOMAIN: ScienceDomainManifest = {
  id: "general-science",
  version: "1.0.0",
  title: "通用科学研究",
  description: "跨学科研究问题、文献证据、计算溯源、复现与同行审查的公共内核。",
  disciplines: ["interdisciplinary"],
  promptFragments: ["你服务于一个科学研究项目。遵守可证伪性、来源可追踪、方法透明、计算可复现和不确定性披露原则；不得把模型生成内容冒充实验证据。"],
  capabilities: [],
  agentRoles: [
    { id: "research-explorer", title: "研究探索员", description: "对文献、数据源或竞争假说进行可独立验收的并行探索。", systemPrompt: `你是汐灵 OS 的研究探索子智能体。扩大检索覆盖、保留 DOI/URL/数据来源，区分候选材料与已核验证据，不替 Research Director 综合定论。${DOMAIN_AGENT_HANDOFF_CONTRACT}`, allowedCapabilities: ["project.read", "literature.search", "artifact.read"], defaultIsolation: "scoped", canDelegate: false },
    { id: "domain-executor", title: "领域执行员", description: "在执行隔离中按当前项目领域约束规划或核验计算。", systemPrompt: `你是汐灵 OS 的领域执行子智能体。严格遵守当前项目领域提示，核对输入、单位、方法、参数、环境和输出溯源；有副作用的动作必须停在审批边界。${DOMAIN_AGENT_HANDOFF_CONTRACT}`, allowedCapabilities: ["project.read", "artifact.read"], includeDomainCapabilities: true, defaultIsolation: "execution", canDelegate: false },
    { id: "independent-reviewer", title: "独立审查员", description: "按证据、复现、方法或反方清单进行隔离审查。", systemPrompt: `你是汐灵 OS 的独立审查子智能体。只依据声明来源执行指定审查清单，主动报告证据断裂、不确定性和替代解释，不接触主智能体偏好。${DOMAIN_AGENT_HANDOFF_CONTRACT}`, allowedCapabilities: ["artifact.read", "literature.search"], defaultIsolation: "blind", canDelegate: false },
  ],
  connectorKinds: ["literature"],
  artifactKinds: ["document", "table", "figure", "code", "dataset", "provenance", "review"],
  schemaNamespaces: ["core", "evidence", "provenance"],
};

export const BUILTIN_SCIENCE_DOMAINS = [GENERAL_SCIENCE_DOMAIN] as const;

export class ScienceDomainRegistry {
  private readonly manifests = new Map<string, ScienceDomainManifest>();
  constructor(manifests: readonly ScienceDomainManifest[] = BUILTIN_SCIENCE_DOMAINS) { for (const manifest of manifests) this.register(manifest); }
  register(manifest: ScienceDomainManifest): void {
    if (!/^[a-z0-9-]{2,80}$/.test(manifest.id)) throw new Error(`Invalid science domain id: ${manifest.id}`);
    if (this.manifests.has(manifest.id)) throw new Error(`Duplicate science domain: ${manifest.id}`);
    this.manifests.set(manifest.id, structuredClone(manifest));
  }
  get(id: string): ScienceDomainManifest | undefined { const value = this.manifests.get(id); return value ? structuredClone(value) : undefined; }
  list(): ScienceDomainManifest[] { return [...this.manifests.values()].map((item) => structuredClone(item)); }
  validate(ids: readonly string[]): string[] {
    const unique = [...new Set([GENERAL_SCIENCE_DOMAIN.id, ...ids])];
    const unknown = unique.filter((id) => !this.manifests.has(id));
    if (unknown.length) throw new Error(`Unknown science domains: ${unknown.join(", ")}`);
    return unique;
  }
  resolve(ids: readonly string[]): ResolvedScienceDomain {
    const domainIds = this.validate(ids);
    const manifests = domainIds.map((id) => this.manifests.get(id)!);
    const uniqueById = <T extends { id: string }>(items: T[]) => [...new Map(items.map((item) => [item.id, item])).values()];
    return {
      domainIds,
      promptFragments: [...new Set(manifests.flatMap((item) => item.promptFragments))],
      capabilities: uniqueById(manifests.flatMap((item) => item.capabilities)),
      agentRoles: uniqueById(manifests.flatMap((item) => item.agentRoles)),
      connectorKinds: [...new Set(manifests.flatMap((item) => item.connectorKinds))],
      artifactKinds: [...new Set(manifests.flatMap((item) => item.artifactKinds))],
      schemaNamespaces: [...new Set(manifests.flatMap((item) => item.schemaNamespaces))],
    };
  }
}
