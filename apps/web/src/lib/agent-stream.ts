import type { AgentStreamEvent } from "@xiling/contracts";

export function consumeSseChunk(buffer: string, chunk: string, flush = false): { buffer: string; events: AgentStreamEvent[] } {
  const normalized = `${buffer}${chunk}`.replaceAll("\r\n", "\n");
  const blocks = normalized.split("\n\n");
  const tail = flush ? "" : blocks.pop() ?? "";
  const complete = flush && blocks.at(-1) !== "" ? blocks : blocks;
  const events: AgentStreamEvent[] = [];
  for (const block of complete) {
    const data = block.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
    if (!data) continue;
    events.push(JSON.parse(data) as AgentStreamEvent);
  }
  if (flush && tail.trim()) {
    const data = tail.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
    if (data) events.push(JSON.parse(data) as AgentStreamEvent);
  }
  return { buffer: tail, events };
}

export async function* streamAgentEvents(response: Response): AsyncGenerator<AgentStreamEvent> {
  if (!response.ok) {
    const body = await response.json().catch(() => undefined) as { error?: unknown } | undefined;
    throw new Error(body?.error ? String(body.error) : `Chat request failed: ${response.status}`);
  }
  if (!response.body) throw new Error("Chat response has no stream body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    const parsed = consumeSseChunk(buffer, decoder.decode(value, { stream: true }));
    buffer = parsed.buffer;
    for (const event of parsed.events) yield event;
  }
  const parsed = consumeSseChunk(buffer, decoder.decode(), true);
  for (const event of parsed.events) yield event;
}
