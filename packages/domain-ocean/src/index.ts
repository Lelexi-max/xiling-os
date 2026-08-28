import type { ApprovalRisk, ResearchRun, ResourceUri, ReviewerReport } from "@xiling/contracts";
import { DOMAIN_AGENT_HANDOFF_CONTRACT, type ScienceDomainManifest } from "@xiling/science-domains";

export const OCEAN_CLIMATE_DOMAIN: ScienceDomainManifest = {
  id: "ocean-climate", version: "1.0.0", title: "海洋与气候科学", description: "物理海洋、海洋观测、气候数据切片与可复现计算。", disciplines: ["physical-oceanography", "climate-science"],
  promptFragments: ["本项目启用了海洋与气候领域包。检查坐标、单位、掩膜、深度正方向、日历、时间基准、采样偏差和空间统计假设。"],
  capabilities: [{ id: "ocean.subset.plan", toolName: "plan_ocean_data_subset", description: "规划海洋数据切片并生成只读预检", keywords: ["数据", "argo", "erddap", "copernicus", "nasa", "netcdf", "切片", "下载", "变量", "经纬度", "深度"], skillNames: ["ocean-data-subsetting"] }],
  agentRoles: [
    { id: "data-steward", title: "海洋数据规划员", description: "核对变量、范围、许可和切片计划，不执行下载。", systemPrompt: `你是海洋数据规划子智能体。输出变量、区域、深度、时间、体积风险和数据快照计划，任何下载停在审批前。${DOMAIN_AGENT_HANDOFF_CONTRACT}`, allowedCapabilities: ["project.read", "ocean.subset.plan"], defaultIsolation: "scoped", canDelegate: false },
    { id: "ocean-analyst", title: "物理海洋分析员", description: "规划或执行获批的物理海洋与气候计算。", systemPrompt: `你是物理海洋分析子智能体。检查坐标、单位、掩膜、时间基准和统计假设；结果关联输入快照与 Artifact。${DOMAIN_AGENT_HANDOFF_CONTRACT}`, allowedCapabilities: ["project.read", "artifact.read", "ocean.subset.plan"], defaultIsolation: "execution", canDelegate: false },
  ],
  connectorKinds: ["erddap", "opendap", "argo-gdac", "copernicus-marine", "nasa-harmony"], artifactKinds: ["netcdf", "grib", "zarr", "geospatial-raster", "map"], schemaNamespaces: ["ocean", "climate", "geospatial"],
};

export interface DatasetMetadata {
  uri: ResourceUri; title: string; format: "NetCDF" | "GRIB" | "Zarr" | "CSV";
  variables: Array<{ name: string; units: string; dimensions: string[] }>;
  bounds: { west: number; east: number; south: number; north: number; minDepth: number; maxDepth: number; start: string; end: string };
  byteSize: number; sha256: string;
}
export interface DatasetSlicePlan { id: string; datasetUri: ResourceUri; variables: string[]; region: { west: number; east: number; south: number; north: number }; depth: { min: number; max: number }; time: { start: string; end: string }; estimatedBytes: number; targetUri: ResourceUri; planHash: string; }
export type OceanConnectorId = "erddap" | "argo-gdac" | "copernicus-marine" | "nasa-harmony";
export interface OceanSubsetRequest { connectorId: OceanConnectorId; datasetId: string; variables: string[]; region: { west: number; east: number; south: number; north: number }; depth?: { min: number; max: number }; time: { start: string; end: string }; outputFormat: "NetCDF" | "Zarr" | "CSV"; expectedShape?: number[]; bytesPerValue?: number; }
export interface ConnectorDescriptor { id: OceanConnectorId; title: string; officialClient: string; authentication: "none" | "account" | "earthdata"; capabilities: string[]; documentationUrl: string; }
export interface ConfiguredConnectorDescriptor extends ConnectorDescriptor { credentialConfigured: boolean; credentialSource: "environment" | "local" | "none"; }
export interface ConnectorPreflight { requestHash: string; connector: ConnectorDescriptor; status: "ready" | "metadata_required" | "credentials_required"; metadataProbe: { method: "GET" | "POST" | "CLI"; endpoint: string; argv?: string[] }; estimatedBytes?: number; targetUri: ResourceUri; approvalRisks: ApprovalRisk[]; disclosure: string[]; }
export interface ConnectorMetadataSummary { selectedShape: number[]; bytesPerValue: number; variables: Array<{ name: string; units: string }>; estimateKind: "exact" | "estimated" | "upper_bound" | "unknown"; estimatedBytes?: number; estimationMethod: string; sourceHash: string; fetchedAt: string; source: "live" | "cache" | "fixture"; provider: OceanConnectorId; }
export interface ConnectorDownloadJob { id: string; request: OceanSubsetRequest; preflight: ConnectorPreflight; status: "pending_approval" | "approved" | "rejected" | "downloading" | "completed" | "failed" | "cancelled"; createdAt: string; decidedAt?: string; failure?: string; artifact?: { uri: ResourceUri; bytes: number; sha256: string }; executionMode: "fixture" | "live"; }
export type ProjectWorkflowStatus = "draft" | "probing" | "pending_approval" | "approved" | "downloading" | "analyzing" | "completed" | "rejected" | "failed" | "cancelled";
export interface ProjectResearchWorkflow { id: string; projectId: string; sessionId: string; sourceCallId: string; sourceRunId?: string; sourceProjectionKey?: string; sourceEventSequence?: number; sourceOperationId?: string; sourceRequestHash?: string; requestHash?: string; approvedRequestHash?: string; request: OceanSubsetRequest; preflight: ConnectorPreflight; status: ProjectWorkflowStatus; metadata?: ConnectorMetadataSummary; connectorJobId?: string; datasetArtifact?: { uri: ResourceUri; bytes: number; sha256: string }; run?: ResearchRun; review?: ReviewerReport; error?: string; settledAt?: string; createdAt: string; updatedAt: string; }
