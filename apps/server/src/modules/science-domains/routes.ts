import type { FastifyInstance } from "fastify";
import type { ScienceDomainRegistry } from "@xiling/science-domains";

export function registerScienceDomainRoutes(app: FastifyInstance, registry: ScienceDomainRegistry): void {
  app.get("/api/science/domains", async () => ({
    domains: registry.list().map(({ promptFragments: _prompts, agentRoles, ...manifest }) => ({
      ...manifest,
      agentRoles: agentRoles.map(({ systemPrompt: _systemPrompt, ...role }) => role),
    })),
  }));
}
