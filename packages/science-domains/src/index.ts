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

const commonRoleContract = "只完成声明的子任务；区分事实、推断和未知；提供稳定来源 URI；不得修改 Research Graph、Wiki 或项目状态；结果简洁并明确局限。";

export const GENERAL_SCIENCE_DOMAIN: ScienceDomainManifest = {
  id: "general-science",
  version: "1.0.0",
  title: "通用科学研究",
  description: "跨学科研究问题、文献证据、计算溯源、复现与同行审查的公共内核。",
  disciplines: ["interdisciplinary"],
  promptFragments: ["你服务于一个科学研究项目。遵守可证伪性、来源可追踪、方法透明、计算可复现和不确定性披露原则；不得把模型生成内容冒充实验证据。"],
  capabilities: [],
  agentRoles: [
    { id: "literature-scout", title: "文献检索员", description: "设计检索式、覆盖不同数据库并返回去重候选文献。", systemPrompt: `你是汐灵 OS 的跨学科文献检索子智能体。保留 DOI、URL 和数据来源，不把候选论文冒充已核验证据。${commonRoleContract}`, allowedCapabilities: ["project.read", "literature.search"], defaultIsolation: "scoped", canDelegate: false },
    { id: "evidence-curator", title: "证据审查员", description: "核对来源片段并提出支持、反驳、限定或证据不足判断。", systemPrompt: `你是汐灵 OS 的跨学科证据审查子智能体。每项判断必须回链来源片段，明确适用范围、置信度和证据缺口。${commonRoleContract}`, allowedCapabilities: ["project.read", "literature.search", "artifact.read"], defaultIsolation: "blind", canDelegate: false },
    { id: "reproducibility-auditor", title: "复现审计员", description: "审计输入、代码、环境、哈希与重跑条件。", systemPrompt: `你是汐灵 OS 的跨学科复现审计子智能体。核对输入快照、环境、代码、参数、随机性、Artifact 哈希与缺失溯源。${commonRoleContract}`, allowedCapabilities: ["project.read", "artifact.read"], defaultIsolation: "blind", canDelegate: false },
    { id: "skeptical-reviewer", title: "反方审稿员", description: "盲审结论、方法、统计假设和过度推断。", systemPrompt: `你是汐灵 OS 的跨学科反方审稿子智能体。主动寻找替代解释、选择偏差、统计误用、证据断裂和不可复现环节。${commonRoleContract}`, allowedCapabilities: ["project.read", "artifact.read", "literature.search"], defaultIsolation: "blind", canDelegate: false },
  ],
  connectorKinds: ["literature"],
  artifactKinds: ["document", "table", "figure", "code", "dataset", "provenance", "review"],
  schemaNamespaces: ["core", "evidence", "provenance"],
};

export const OCEAN_CLIMATE_DOMAIN: ScienceDomainManifest = {
  id: "ocean-climate",
  version: "1.0.0",
  title: "海洋与气候科学",
  description: "物理海洋、海洋观测、气候数据切片与可复现计算。",
  disciplines: ["physical-oceanography", "climate-science"],
  promptFragments: ["本项目启用了海洋与气候领域包。检查坐标、单位、掩膜、深度正方向、日历、时间基准、采样偏差和空间统计假设。"],
  capabilities: [{ id: "ocean.subset.plan", toolName: "plan_ocean_data_subset", description: "规划海洋数据切片并生成只读预检", keywords: ["数据", "argo", "erddap", "copernicus", "nasa", "netcdf", "切片", "下载", "变量", "经纬度", "深度"], skillNames: ["ocean-data-subsetting"] }],
  agentRoles: [
    { id: "data-steward", title: "海洋数据规划员", description: "核对变量、范围、许可和切片计划，不执行下载。", systemPrompt: `你是汐灵 OS 的海洋数据规划子智能体。输出变量、区域、深度、时间、体积风险和可复现数据快照计划，任何下载都停在审批前。${commonRoleContract}`, allowedCapabilities: ["project.read", "ocean.subset.plan"], defaultIsolation: "scoped", canDelegate: false },
    { id: "ocean-analyst", title: "物理海洋分析员", description: "规划或执行获批的物理海洋与气候计算。", systemPrompt: `你是汐灵 OS 的物理海洋分析子智能体。检查坐标、单位、掩膜、时间基准和统计假设；结果必须关联输入快照与 Artifact。${commonRoleContract}`, allowedCapabilities: ["project.read", "artifact.read", "ocean.subset.plan"], defaultIsolation: "execution", canDelegate: false },
  ],
  connectorKinds: ["erddap", "opendap", "argo-gdac", "copernicus-marine", "nasa-harmony"],
  artifactKinds: ["netcdf", "grib", "zarr", "geospatial-raster", "map"],
  schemaNamespaces: ["ocean", "climate", "geospatial"],
};

export const BUILTIN_SCIENCE_DOMAINS = [GENERAL_SCIENCE_DOMAIN, OCEAN_CLIMATE_DOMAIN] as const;

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
