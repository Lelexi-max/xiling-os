import { createInterface } from "node:readline";

const lines = createInterface({ input: process.stdin });
const send = (id, result) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);

lines.on("line", (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  if (message.id === undefined) return;
  if (message.method === "initialize") {
    send(message.id, { protocolVersion: message.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "xiling-echo-fixture", version: "1.0.0" } });
    return;
  }
  if (message.method === "ping") { send(message.id, {}); return; }
  if (message.method === "tools/list") {
    send(message.id, { tools: [{ name: "echo", description: "Return the supplied text without side effects", inputSchema: { type: "object", properties: { text: { type: "string" }, delayMs: { type: "integer", minimum: 0, maximum: 10_000 } }, required: ["text"], additionalProperties: false }, annotations: { readOnlyHint: true } }] });
    return;
  }
  if (message.method === "tools/call") {
    const reply = () => send(message.id, { content: [{ type: "text", text: `echo:${String(message.params?.arguments?.text ?? "")}` }], structuredContent: { echoed: String(message.params?.arguments?.text ?? "") }, isError: false });
    const delayMs = Number(message.params?.arguments?.delayMs ?? 0);
    if (delayMs > 0) setTimeout(reply, delayMs);
    else reply();
    return;
  }
  send(message.id, {});
});
