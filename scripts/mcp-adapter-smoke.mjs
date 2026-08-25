import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { PiMcpGatewayManager } from "../packages/pi-runtime/dist/index.js";

const root = await mkdtemp(resolve(tmpdir(), "xiling-mcp-smoke-"));
const gateway = new PiMcpGatewayManager(resolve(root, "host"));
try {
  const fixture = resolve("packages/pi-runtime/test-fixtures/mcp-echo-server.mjs");
  await gateway.configure({ servers: [{
    name: "echo-lab",
    description: "离线 MCP 冒烟服务器",
    keywords: ["echo", "回声"],
    definition: { command: process.execPath, args: [fixture], lifecycle: "lazy", approveTools: false },
  }] });
  if (!gateway.matches("请调用 echo 工具") || gateway.matches("普通海温问题")) throw new Error("MCP host metadata routing failed");
  const proxy = gateway.tool();
  if (proxy.name !== "mcp") throw new Error("MCP proxy tool is missing");
  await proxy.execute("connect", { connect: "echo-lab" });
  const search = await proxy.execute("search", { search: "echo", server: "echo-lab" });
  if (!search.content.some((item) => item.type === "text" && item.text.includes("echo"))) throw new Error("MCP lazy catalog search failed");
  const called = await proxy.execute("call", { tool: "echo_lab_echo", server: "echo-lab", args: { text: "argo" } });
  if (!called.content.some((item) => item.type === "text" && item.text.includes("echo:argo"))) throw new Error("MCP tool call failed");
  console.log("pi-mcp-adapter isolated lazy gateway smoke: ok");
} finally {
  await gateway.close();
  await rm(root, { recursive: true, force: true });
}
