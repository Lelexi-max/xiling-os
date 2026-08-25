import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { McpSettingsService } from "./mcp-service.js";

const nameSchema = z.string().min(1).max(80).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/);
const paramsSchema = z.object({ name: nameSchema });
const inputSchema = z.object({
  name: nameSchema,
  description: z.string().min(1).max(500),
  keywords: z.array(z.string().min(1).max(80)).max(30).default([]),
  transport: z.enum(["stdio", "http"]),
  command: z.string().min(1).max(500).optional(),
  args: z.array(z.string().max(2_000)).max(60).optional(),
  url: z.url().refine((value) => ["http:", "https:"].includes(new URL(value).protocol), "MCP URL must use HTTP or HTTPS").optional(),
  authentication: z.enum(["none", "bearer", "oauth"]),
  bearerToken: z.string().max(20_000).optional(),
  access: z.enum(["approval-required", "trusted"]),
  enabled: z.boolean(),
}).superRefine((value, context) => {
  if (value.transport === "stdio" && !value.command) context.addIssue({ code: "custom", path: ["command"], message: "stdio transport requires command" });
  if (value.transport === "http" && !value.url) context.addIssue({ code: "custom", path: ["url"], message: "HTTP transport requires URL" });
  if (value.transport === "stdio" && value.authentication !== "none") context.addIssue({ code: "custom", path: ["authentication"], message: "stdio authentication is passed by server-specific args/env, not HTTP auth" });
});

export function registerMcpSettingsRoutes(app: FastifyInstance, service: McpSettingsService, ready: Promise<unknown>): void {
  app.get("/api/settings/mcp", async () => { await ready; return service.list(); });
  app.put("/api/settings/mcp/servers/:name", async (request, reply) => {
    await ready;
    const params = paramsSchema.safeParse(request.params);
    const body = inputSchema.safeParse(request.body);
    if (!params.success || !body.success || params.data.name !== body.data.name) return reply.code(400).send({ error: "invalid MCP server configuration" });
    try {
      return await service.upsert({
        name: body.data.name,
        description: body.data.description,
        keywords: body.data.keywords,
        transport: body.data.transport,
        authentication: body.data.authentication,
        access: body.data.access,
        enabled: body.data.enabled,
        ...(body.data.command ? { command: body.data.command } : {}),
        ...(body.data.args ? { args: body.data.args } : {}),
        ...(body.data.url ? { url: body.data.url } : {}),
        ...(body.data.bearerToken ? { bearerToken: body.data.bearerToken } : {}),
      });
    }
    catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) }); }
  });
  app.delete("/api/settings/mcp/servers/:name", async (request, reply) => {
    await ready;
    const params = paramsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid MCP server name" });
    try { return await service.remove(params.data.name); }
    catch (error) { return reply.code(404).send({ error: error instanceof Error ? error.message : String(error) }); }
  });
  app.post("/api/settings/mcp/servers/:name/test", async (request, reply) => {
    await ready;
    const params = paramsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "invalid MCP server name" });
    try {
      const result = await service.test(params.data.name);
      return reply.code(result.ok ? 200 : 422).send(result);
    } catch (error) { return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) }); }
  });
}
