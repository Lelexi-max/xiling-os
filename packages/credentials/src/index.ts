import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { CredentialFieldDescriptor, CredentialProviderId, CredentialProviderStatus, ModelProviderCapabilities } from "@xiling/contracts";

type ProviderDefinition = Omit<CredentialProviderStatus, "configuredFields" | "configured" | "source"> & { env: Record<string, string>; valid: (fields: Set<string>) => boolean };

const all = (...ids: string[]) => (fields: Set<string>) => ids.every((id) => fields.has(id));
const any = (...ids: string[]) => (fields: Set<string>) => ids.some((id) => fields.has(id));
const field = (id: string, label: string, secret: boolean, placeholder: string): CredentialFieldDescriptor => ({ id, label, secret, placeholder });
const capability = (input: ModelProviderCapabilities["input"], output: ModelProviderCapabilities["output"], note: string, modelDependent = true): ModelProviderCapabilities => ({ input, output, note, modelDependent });

const definitions: Record<string, ProviderDefinition> = {
  openai: { id: "openai", category: "model", title: "OpenAI", description: "Responses、语音与图像生成 API", documentationUrl: "https://platform.openai.com/api-keys", fields: [field("apiKey", "API Key", true, "sk-…")], env: { apiKey: "OPENAI_API_KEY" }, valid: all("apiKey"), capabilities: capability(["text", "image", "audio"], ["text", "image"], "视频与语音使用独立端点；具体能力取决于模型") },
  anthropic: { id: "anthropic", category: "model", title: "Anthropic", description: "Claude Messages API", documentationUrl: "https://console.anthropic.com/settings/keys", fields: [field("apiKey", "API Key", true, "sk-ant-…")], env: { apiKey: "ANTHROPIC_API_KEY" }, valid: all("apiKey"), capabilities: capability(["text", "image"], ["text"], "支持视觉与文档理解；当前主要输出文本") },
  google: { id: "google", category: "model", title: "Google Gemini", description: "原生多模态理解与生成", documentationUrl: "https://aistudio.google.com/app/apikey", fields: [field("apiKey", "API Key", true, "AIza…")], env: { apiKey: "GEMINI_API_KEY" }, valid: all("apiKey"), capabilities: capability(["text", "image", "audio", "video"], ["text", "image"], "不同 Gemini 模型的输出模态不同") },
  openrouter: { id: "openrouter", category: "model", title: "OpenRouter", description: "统一访问多家文本与多模态模型", documentationUrl: "https://openrouter.ai/settings/keys", fields: [field("apiKey", "API Key", true, "sk-or-…")], env: { apiKey: "OPENROUTER_API_KEY" }, valid: all("apiKey"), capabilities: capability(["text", "image", "audio", "video"], ["text", "image"], "能力按所选模型和下游 Provider 动态变化") },
  deepseek: { id: "deepseek", category: "model", title: "DeepSeek", description: "DeepSeek 官方 OpenAI-compatible API", documentationUrl: "https://api-docs.deepseek.com/", fields: [field("apiKey", "API Key", true, "sk-…")], env: { apiKey: "DEEPSEEK_API_KEY" }, valid: all("apiKey"), capabilities: capability(["text"], ["text"], "官方模型目录与能力以实时探测为准") },
  xai: { id: "xai", category: "model", title: "xAI", description: "Grok 文本、视觉与图像 API", documentationUrl: "https://docs.x.ai/developers/", fields: [field("apiKey", "API Key", true, "xai-…")], env: { apiKey: "XAI_API_KEY" }, valid: all("apiKey"), capabilities: capability(["text", "image", "video"], ["text", "image"], "图像与视频生成使用专用端点") },
  mistral: { id: "mistral", category: "model", title: "Mistral AI", description: "Mistral Conversations API", documentationUrl: "https://docs.mistral.ai/", fields: [field("apiKey", "API Key", true, "API key")], env: { apiKey: "MISTRAL_API_KEY" }, valid: all("apiKey"), capabilities: capability(["text", "image", "audio"], ["text"], "视觉和音频能力取决于模型") },
  moonshotai: { id: "moonshotai", category: "model", title: "Moonshot / Kimi", description: "Kimi 开放平台模型", documentationUrl: "https://platform.moonshot.ai/docs/", fields: [field("apiKey", "API Key", true, "sk-…")], env: { apiKey: "MOONSHOT_API_KEY" }, valid: all("apiKey"), capabilities: capability(["text", "image", "video"], ["text"], "多模态能力取决于 Kimi 模型") },
  zai: { id: "zai", category: "model", title: "智谱 z.ai", description: "GLM 系列模型 API", documentationUrl: "https://docs.z.ai/", fields: [field("apiKey", "API Key", true, "API key")], env: { apiKey: "ZAI_API_KEY" }, valid: all("apiKey"), capabilities: capability(["text", "image", "video"], ["text", "image"], "生成能力可能使用独立模型与端点") },
  groq: { id: "groq", category: "model", title: "Groq", description: "高速 OpenAI-compatible 推理", documentationUrl: "https://console.groq.com/docs", fields: [field("apiKey", "API Key", true, "gsk_…")], env: { apiKey: "GROQ_API_KEY" }, valid: all("apiKey"), capabilities: capability(["text", "image", "audio"], ["text"], "能力取决于托管模型") },
  custom: { id: "custom", category: "model", title: "自定义兼容 API", description: "连接 vLLM、Ollama、企业网关或其他兼容服务", documentationUrl: "https://platform.openai.com/docs/api-reference", fields: [field("displayName", "连接名称", false, "实验室模型网关"), field("baseUrl", "Base URL", false, "https://host.example/v1"), field("apiKey", "API Key", true, "可选或自定义密钥"), field("testModel", "测试模型 ID", false, "provider/model-name"), field("apiStyle", "API 风格", false, "openai-completions 或 openai-responses")], env: {}, valid: all("displayName", "baseUrl", "testModel", "apiStyle"), capabilities: capability(["text"], ["text"], "默认只开放原生文字；其他模态必须由模型元数据或原生探测确认") },
  "semantic-scholar": { id: "semantic-scholar", category: "literature", title: "Semantic Scholar", description: "文献图主数据源；密钥可提高配额", documentationUrl: "https://www.semanticscholar.org/product/api", fields: [field("apiKey", "API Key", true, "可选 API Key")], env: { apiKey: "SEMANTIC_SCHOLAR_API_KEY" }, valid: all("apiKey") },
  openalex: { id: "openalex", category: "literature", title: "OpenAlex", description: "文献图降级数据源；API Key 可提高预算", documentationUrl: "https://help.openalex.org/api/", fields: [field("apiKey", "API Key", true, "可选 API Key")], env: { apiKey: "OPENALEX_API_KEY" }, valid: all("apiKey") },
  "copernicus-marine": { id: "copernicus-marine", category: "data", title: "Copernicus Marine", description: "Marine Data Store 账户", documentationUrl: "https://toolbox-docs.marine.copernicus.eu/en/stable/usage/login-usage.html", fields: [field("username", "用户名或邮箱", false, "name@example.com"), field("password", "密码", true, "••••••••")], env: { username: "COPERNICUSMARINE_SERVICE_USERNAME", password: "COPERNICUSMARINE_SERVICE_PASSWORD" }, valid: all("username", "password") },
  "nasa-earthdata": { id: "nasa-earthdata", category: "data", title: "NASA Earthdata", description: "Harmony / Earthdata Login；Bearer Token 优先", documentationUrl: "https://harmony.earthdata.nasa.gov/docs", fields: [field("token", "Bearer Token", true, "EDL bearer token"), field("username", "EDL 用户名", false, "Earthdata username"), field("password", "EDL 密码", true, "••••••••")], env: { token: "EARTHDATA_TOKEN", username: "EARTHDATA_USERNAME", password: "EARTHDATA_PASSWORD" }, valid: (fields) => any("token")(fields) || all("username", "password")(fields) },
};

function requireDefinition(id: CredentialProviderId): ProviderDefinition {
  const definition = definitions[id];
  if (!definition) throw new Error(`Unknown credential provider: ${id}`);
  return definition;
}

type SecretData = Record<string, Record<string, string> | undefined>;
type EncryptedFile = { version: 1; iv: string; tag: string; ciphertext: string };

export class CredentialStore {
  private readonly keyPath: string;
  private readonly secretsPath: string;
  private data: SecretData = {};
  private key?: Buffer;

  constructor(private readonly root: string, private readonly environment: Record<string, string | undefined> = process.env) {
    this.keyPath = resolve(root, "master.key"); this.secretsPath = resolve(root, "credentials.enc.json");
  }

  async initialize(): Promise<void> { this.key = await this.loadOrCreateKey(); this.data = await this.loadEncrypted(); }

  listStatus(): CredentialProviderStatus[] { return Object.values(definitions).map((definition) => this.status(definition.id)); }

  status(id: CredentialProviderId): CredentialProviderStatus {
    const definition = requireDefinition(id);
    const environmentFields = new Set(Object.entries(definition.env).filter(([, name]) => Boolean(this.environment[name])).map(([fieldId]) => fieldId));
    const localFields = new Set(Object.entries(this.data[id] ?? {}).filter(([, value]) => Boolean(value)).map(([fieldId]) => fieldId));
    const configuredFields = [...new Set([...environmentFields, ...localFields])];
    const effectiveFields = new Set(configuredFields);
    return { id, category: definition.category, title: definition.title, description: definition.description, documentationUrl: definition.documentationUrl, fields: definition.fields, configuredFields, configured: definition.valid(effectiveFields), source: environmentFields.size > 0 ? "environment" : localFields.size > 0 ? "local" : "none", ...(definition.capabilities ? { capabilities: definition.capabilities } : {}) };
  }

  get(id: CredentialProviderId, fieldId: string): string | undefined {
    const envName = requireDefinition(id).env[fieldId]; return (envName ? this.environment[envName] : undefined) ?? this.data[id]?.[fieldId];
  }

  async set(id: CredentialProviderId, values: Record<string, string>): Promise<CredentialProviderStatus> {
    const definition = requireDefinition(id);
    const allowed = new Set(definition.fields.map((item) => item.id));
    const cleaned = Object.fromEntries(Object.entries(values).filter(([fieldId, value]) => allowed.has(fieldId) && value.length > 0).map(([fieldId, value]) => [fieldId, value]));
    if (Object.values(cleaned).some((value) => value.length > 20_000)) throw new Error("credential field is too large");
    const merged = { ...(this.data[id] ?? {}), ...cleaned };
    if (!definition.valid(new Set(Object.keys(merged)))) throw new Error("required credential fields are missing");
    this.data = { ...this.data, [id]: merged }; await this.persist(); return this.status(id);
  }

  async clear(id: CredentialProviderId): Promise<CredentialProviderStatus> { requireDefinition(id); const next = { ...this.data }; delete next[id]; this.data = next; await this.persist(); return this.status(id); }

  getSecret(namespace: string, fieldId: string): string | undefined {
    return this.data[namespace]?.[fieldId];
  }

  async setSecret(namespace: string, fieldId: string, value: string): Promise<void> {
    if (!/^[a-z0-9][a-z0-9:._-]{0,199}$/i.test(namespace) || !/^[a-z0-9][a-z0-9._-]{0,99}$/i.test(fieldId)) throw new Error("invalid secret namespace");
    if (!value || value.length > 20_000) throw new Error("secret value is invalid");
    this.data = { ...this.data, [namespace]: { ...(this.data[namespace] ?? {}), [fieldId]: value } };
    await this.persist();
  }

  async clearSecret(namespace: string, fieldId?: string): Promise<void> {
    const next = { ...this.data };
    if (!fieldId) delete next[namespace];
    else if (next[namespace]) {
      const fields = { ...next[namespace] };
      delete fields[fieldId];
      if (Object.keys(fields).length) next[namespace] = fields;
      else delete next[namespace];
    }
    this.data = next;
    await this.persist();
  }

  private async loadOrCreateKey(): Promise<Buffer> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    try { return Buffer.from((await readFile(this.keyPath, "utf8")).trim(), "base64"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const key = randomBytes(32); await writeFile(this.keyPath, `${key.toString("base64")}\n`, { encoding: "utf8", mode: 0o600 }); await chmod(this.keyPath, 0o600); return key;
    }
  }

  private async loadEncrypted(): Promise<SecretData> {
    try {
      const file = JSON.parse(await readFile(this.secretsPath, "utf8")) as EncryptedFile;
      const decipher = createDecipheriv("aes-256-gcm", this.requireKey(), Buffer.from(file.iv, "base64")); decipher.setAuthTag(Buffer.from(file.tag, "base64"));
      return JSON.parse(Buffer.concat([decipher.update(Buffer.from(file.ciphertext, "base64")), decipher.final()]).toString("utf8")) as SecretData;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return {}; throw error; }
  }

  private async persist(): Promise<void> {
    const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", this.requireKey(), iv); const ciphertext = Buffer.concat([cipher.update(JSON.stringify(this.data), "utf8"), cipher.final()]);
    const file: EncryptedFile = { version: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") };
    const temporary = `${this.secretsPath}.${randomUUID()}.tmp`; await writeFile(temporary, `${JSON.stringify(file)}\n`, { encoding: "utf8", mode: 0o600 }); await rename(temporary, this.secretsPath); await chmod(this.secretsPath, 0o600);
  }

  private requireKey(): Buffer { if (!this.key || this.key.length !== 32) throw new Error("credential store is not initialized"); return this.key; }
}

export const credentialProviderIds = Object.keys(definitions) as CredentialProviderId[];
