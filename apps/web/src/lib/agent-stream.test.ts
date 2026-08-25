import { describe, expect, it } from "vitest";
import { consumeSseChunk } from "./agent-stream.js";

describe("consumeSseChunk", () => {
  it("keeps split JSON until a complete SSE block arrives", () => {
    const first = consumeSseChunk("", 'data: {"type":"message.');
    expect(first.events).toEqual([]);
    const second = consumeSseChunk(first.buffer, 'delta","delta":"海洋"}\n\n');
    expect(second.events).toEqual([{ type: "message.delta", delta: "海洋" }]);
    expect(second.buffer).toBe("");
  });

  it("supports CRLF and flushes a final unterminated block", () => {
    const parsed = consumeSseChunk("", 'data: {"type":"session.finished","sessionId":"s","stopReason":"stop"}\r\n', true);
    expect(parsed.events).toEqual([{ type: "session.finished", sessionId: "s", stopReason: "stop" }]);
  });
});
