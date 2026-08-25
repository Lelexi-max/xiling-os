import { z } from "zod";
import type { OceanSubsetRequest, PaperRecord, ResourceUri } from "@xiling/contracts";

export const projectIdSchema = z.string().min(1).max(120);
export const sessionIdSchema = z.string().min(1).max(160);
export const idParamsSchema = z.object({ id: sessionIdSchema });
export const projectIdQuerySchema = z.object({ projectId: projectIdSchema.default("ocean-heatwave") });

export const branchContextSchema = z.object({
  activeNodeId: z.string().min(1).max(120),
  quotedNodeIds: z.array(z.string().min(1).max(120)).max(12).default([]),
});

export const projectionSchema = branchContextSchema.extend({
  projectId: projectIdSchema.default("ocean-heatwave"),
  capabilityQuery: z.string().max(10_000).optional(),
});

export const connectorRequestSchema = z.object({
  connectorId: z.enum(["erddap", "argo-gdac", "copernicus-marine", "nasa-harmony"]),
  datasetId: z.string().min(1).max(240),
  variables: z.array(z.string().min(1).max(120)).min(1).max(20),
  region: z.object({ west: z.number(), east: z.number(), south: z.number(), north: z.number() }),
  depth: z.object({ min: z.number(), max: z.number() }).optional(),
  time: z.object({ start: z.string().min(1).max(40), end: z.string().min(1).max(40) }),
  outputFormat: z.enum(["NetCDF", "Zarr", "CSV"]),
  expectedShape: z.array(z.number().int().positive()).max(16).optional(),
  bytesPerValue: z.number().positive().optional(),
});
export type ConnectorRequest = z.infer<typeof connectorRequestSchema>;
export function toOceanSubsetRequest(value: ConnectorRequest): OceanSubsetRequest {
  const { depth, expectedShape, bytesPerValue, ...required } = value;
  return { ...required, ...(depth ? { depth } : {}), ...(expectedShape ? { expectedShape } : {}), ...(bytesPerValue ? { bytesPerValue } : {}) };
}
export const connectorJobSchema = z.object({ request: connectorRequestSchema, sourceHash: z.string().regex(/^[a-f0-9]{64}$/) });
export const projectWorkflowCreateSchema = z.object({ projectId: projectIdSchema, sessionId: sessionIdSchema, sourceCallId: z.string().min(1).max(200), request: connectorRequestSchema });

export const canvasNodeDataSchema = z.object({
  eyebrow: z.string().min(1).max(80),
  title: z.string().min(1).max(240),
  body: z.string().max(2_000),
  tone: z.enum(["prompt", "answer", "paper", "data", "note"]),
  source: z.object({
    kind: z.enum(["project", "chat-message", "paper", "workflow", "note"]),
    sessionId: sessionIdSchema.optional(),
    messageId: sessionIdSchema.optional(),
    sourceEntryId: sessionIdSchema.optional(),
    runId: sessionIdSchema.optional(),
    paperId: z.string().min(1).max(240).optional(),
    workflowId: z.string().min(1).max(200).optional(),
    sourceCallId: z.string().min(1).max(200).optional(),
  }).optional(),
  artifactUris: z.array(z.string().regex(/^(artifact|dataset|project):\/\//).transform((value) => value as ResourceUri)).max(24).optional(),
  createdAt: z.string().datetime().optional(),
});
export const canvasLayoutSchema = z.array(z.object({ id: z.string().min(1).max(120), x: z.number().finite(), y: z.number().finite(), data: canvasNodeDataSchema.optional() })).max(100);
export const canvasEdgeSchema = z.object({ id: z.string().min(1).max(160), source: z.string().min(1).max(120), target: z.string().min(1).max(120), kind: z.enum(["follow-up", "quote", "produced", "checkpoint"]) });
export const canvasGraphSchema = z.object({ version: z.literal(2), revision: z.number().int().nonnegative().optional(), nodes: canvasLayoutSchema, edges: z.array(canvasEdgeSchema).max(240) });
export const canvasLayoutPayloadSchema = z.union([canvasLayoutSchema, z.object({ projectId: projectIdSchema, revision: z.number().int().nonnegative().optional(), nodes: canvasLayoutSchema, edges: z.array(canvasEdgeSchema).max(240).optional() })]);

export const projectCreateSchema = z.object({ name: z.string().min(1).max(160), description: z.string().max(1_000).default(""), researchQuestion: z.string().min(1).max(1_000) });
export const projectUpdateSchema = projectCreateSchema.partial().extend({ status: z.enum(["active", "paused", "archived"]).optional() });
export const itemCreateSchema = z.object({ projectId: projectIdSchema, kind: z.enum(["milestone", "task", "experiment"]), title: z.string().min(1).max(240), notes: z.string().max(2_000).default("") });
export const itemUpdateSchema = z.object({ title: z.string().min(1).max(240).optional(), notes: z.string().max(2_000).optional(), status: z.enum(["backlog", "ready", "running", "blocked", "done"]).optional() });
export const chatSessionCreateSchema = z.object({ projectId: projectIdSchema, title: z.string().trim().min(1).max(160) });

export const artifactUriSchema = z.string().startsWith("artifact://").transform((value) => value as `artifact://${string}`);
export const wikiCreateSchema = z.object({ projectId: projectIdSchema.optional(), title: z.string().min(1).max(240), markdown: z.string().max(100_000), artifactUris: z.array(artifactUriSchema).max(100).optional() });
export const wikiRevisionSchema = wikiCreateSchema.pick({ markdown: true, artifactUris: true }).extend({ title: z.string().min(1).max(240).optional() });
export const wikiSearchSchema = z.object({ projectId: projectIdSchema, q: z.string().trim().min(1).max(160), limit: z.coerce.number().int().min(1).max(50).default(20) });
export const wikiRevisionParamsSchema = idParamsSchema.extend({ version: z.coerce.number().int().positive() });

export const paperParamsSchema = z.object({ paperId: z.string().min(1).max(240) });
export const paperSchema = z.object({ id: z.string().min(1).max(240), title: z.string().min(1).max(1_000), year: z.number().int().min(0).max(3_000), authors: z.array(z.string().min(1).max(240)).max(200), citationCount: z.number().int().min(0), references: z.array(z.string().min(1).max(240)).max(10_000), source: z.enum(["semantic-scholar", "openalex", "fixture"]), url: z.string().url().optional() });
export const scopedPaperSchema = z.object({ projectId: projectIdSchema, paper: paperSchema });
export function toPaperRecord(paper: z.infer<typeof paperSchema>): PaperRecord { return { id: paper.id, title: paper.title, year: paper.year, authors: paper.authors, citationCount: paper.citationCount, references: paper.references, source: paper.source, ...(paper.url ? { url: paper.url } : {}) }; }
export const literatureQuerySchema = z.object({ q: z.string().trim().min(2).max(200), limit: z.coerce.number().int().min(5).max(40).default(20) });

export const credentialIdSchema = z.object({ id: z.enum(["openai", "anthropic", "google", "openrouter", "deepseek", "xai", "mistral", "moonshotai", "zai", "groq", "custom", "semantic-scholar", "openalex", "copernicus-marine", "nasa-earthdata"]) });
export const credentialValuesSchema = z.object({ values: z.record(z.string().min(1).max(80), z.string().min(1).max(20_000)) });
export const modelRuntimeSchema = z.object({ mode: z.enum(["offline", "live"]), providerId: z.enum(["openai", "anthropic", "google", "openrouter", "deepseek", "xai", "mistral", "moonshotai", "zai", "groq", "custom"]).optional(), modelId: z.string().min(1).max(240).optional(), inputModalities: z.array(z.enum(["text", "image"])).min(1).max(2).optional(), reasoning: z.enum(["off", "low", "medium", "high"]) }).refine((value) => value.mode === "offline" || Boolean(value.providerId && value.modelId), { message: "live mode requires a selected model" }).refine((value) => !value.inputModalities || value.inputModalities.includes("text"), { message: "text input must remain enabled" });
export const providerTestSchema = z.object({ modelId: z.string().trim().min(1).max(240).optional() });

export interface ApiErrorBody { error: unknown; }
