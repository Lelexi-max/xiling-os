import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { CredentialStore } from "@xiling/credentials";
import type { McpAccessMode, McpAuthenticationKind, McpConnectionTestResult, McpServerSettings, McpSettingsResponse, McpTransportKind } from "@xiling/contracts";
import { PiMcpGatewayManager, XILING_MCP_ADAPTER_VERSION, type PiMcpHostConfig } from "@xiling/pi-runtime";

export interface McpServerInput {
  name: string;
  description: string;
  keywords: string[];
  transport: McpTransportKind;
  command?: string;
  args?: string[];
  url?: string;
  authentication: McpAuthenticationKind;
  bearerToken?: string;
  access: McpAccessMode;
  enabled: boolean;
}

type StoredServer = Omit<McpServerInput, "bearerToken">;
type StoredDocument = { version: 1; servers: StoredServer[] };

const emptyDocument = (): StoredDocument => ({ version: 1, servers: [] });
const secretNamespace = (name: string) => `mcp:${name}`;

export class McpSettingsService {
  private document: StoredDocument = emptyDocument();
  private readonly path: string;

  constructor(root: string, private readonly credentials: CredentialStore, readonly gateway: PiMcpGatewayManager) {
    this.path = resolve(root, "servers.json");
  }

  async initialize(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    try {
      const parsed = JSON.parse(await readFile(this.path, "utf8")) as StoredDocument;
      if (parsed.version !== 1 || !Array.isArray(parsed.servers)) throw new Error("unsupported MCP settings version");
      this.document = parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await this.persist(this.document);
    }
    await this.gateway.configure(this.runtimeConfig(this.document));
  }

  list(): McpSettingsResponse {
    const runtime = new Map(this.gateway.status().servers.map((server) => [server.name, server]));
    return {
      adapter: { package: "pi-mcp-adapter", version: XILING_MCP_ADAPTER_VERSION, license: "MIT", installed: true },
      strategy: "proxy-lazy",
      isolation: "child-process",
      residentToolSchemas: 1,
      servers: this.document.servers.map((server): McpServerSettings => {
        const state = runtime.get(server.name);
        return {
          ...server,
          credentialConfigured: server.authentication === "bearer" ? Boolean(this.credentials.getSecret(secretNamespace(server.name), "bearerToken")) : server.authentication !== "none",
          runtimeState: server.enabled ? state?.status ?? "not-connected" : "disabled",
          toolCount: state?.toolCount ?? 0,
          resourceCount: state?.resourceCount ?? 0,
        };
      }),
    };
  }

  async upsert(input: McpServerInput): Promise<McpSettingsResponse> {
    const normalized: StoredServer = {
      name: input.name.trim(),
      description: input.description.trim(),
      keywords: [...new Set(input.keywords.map((item) => item.trim()).filter(Boolean))],
      transport: input.transport,
      ...(input.command ? { command: input.command.trim() } : {}),
      ...(input.args?.length ? { args: input.args } : {}),
      ...(input.url ? { url: input.url.trim() } : {}),
      authentication: input.authentication,
      access: input.access,
      enabled: input.enabled,
    };
    const previous = structuredClone(this.document);
    const previousToken = this.credentials.getSecret(secretNamespace(normalized.name), "bearerToken");
    const next: StoredDocument = { version: 1, servers: [...previous.servers.filter((server) => server.name !== normalized.name), normalized].sort((left, right) => left.name.localeCompare(right.name)) };
    if (input.authentication === "bearer" && input.bearerToken?.trim()) await this.credentials.setSecret(secretNamespace(normalized.name), "bearerToken", input.bearerToken.trim());
    if (input.authentication !== "bearer") await this.credentials.clearSecret(secretNamespace(normalized.name));
    try {
      await this.persist(next);
      await this.gateway.configure(this.runtimeConfig(next));
      this.document = next;
    } catch (error) {
      await this.persist(previous);
      if (previousToken) await this.credentials.setSecret(secretNamespace(normalized.name), "bearerToken", previousToken);
      else await this.credentials.clearSecret(secretNamespace(normalized.name));
      throw error;
    }
    return this.list();
  }

  async remove(name: string): Promise<McpSettingsResponse> {
    if (!this.document.servers.some((server) => server.name === name)) throw new Error("MCP server not found");
    const previous = structuredClone(this.document);
    const next: StoredDocument = { version: 1, servers: previous.servers.filter((server) => server.name !== name) };
    await this.persist(next);
    try { await this.gateway.configure(this.runtimeConfig(next)); }
    catch (error) { await this.persist(previous); throw error; }
    this.document = next;
    await this.credentials.clearSecret(secretNamespace(name));
    return this.list();
  }

  async test(name: string): Promise<McpConnectionTestResult> {
    const server = this.document.servers.find((candidate) => candidate.name === name);
    if (!server) throw new Error("MCP server not found");
    if (!server.enabled) throw new Error("MCP server is disabled");
    const started = Date.now();
    let ok = false;
    let message = "";
    try {
      const result = await this.gateway.tool().execute(`settings-test-${randomUUID()}`, { connect: name });
      const text = result.content.find((item) => item.type === "text")?.text ?? "MCP 服务器已响应";
      ok = !result.isError;
      message = text.slice(0, 500);
    } catch (error) { message = error instanceof Error ? error.message : String(error); }
    const runtime = this.gateway.status().servers.find((candidate) => candidate.name === name);
    return { ok, serverName: name, latencyMs: Date.now() - started, state: runtime?.status ?? (ok ? "connected" : "failed"), toolCount: runtime?.toolCount ?? 0, message, testedAt: new Date().toISOString() };
  }

  private runtimeConfig(document: StoredDocument): PiMcpHostConfig {
    return {
      servers: document.servers.map((server) => {
        const bearerToken = server.authentication === "bearer" ? this.credentials.getSecret(secretNamespace(server.name), "bearerToken") : undefined;
        return {
          name: server.name,
          description: server.description,
          keywords: server.keywords,
          definition: {
            ...(server.transport === "stdio"
              ? { ...(server.command ? { command: server.command } : {}), ...(server.args?.length ? { args: server.args } : {}) }
              : { ...(server.url ? { url: server.url } : {}), auth: server.authentication === "none" ? false as const : server.authentication, ...(bearerToken ? { bearerToken } : {}) }),
            lifecycle: "lazy" as const,
            requestTimeoutMs: 30_000,
            approveTools: server.access === "approval-required",
            disabled: !server.enabled,
          },
        };
      }),
    };
  }

  private async persist(document: StoredDocument): Promise<void> {
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, this.path);
  }
}
