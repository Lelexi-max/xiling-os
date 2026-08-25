import {
  EventStream,
  type AssistantMessage,
  type AssistantMessageEvent,
} from "@earendil-works/pi-ai/compat";
import type { StreamFn } from "@earendil-works/pi-agent-core";

class MockAssistantStream extends EventStream<AssistantMessageEvent, AssistantMessage> {
  constructor() {
    super(
      (event) => event.type === "done" || event.type === "error",
      (event) => {
        if (event.type === "done") return event.message;
        if (event.type === "error") return event.error;
        throw new Error("Unexpected mock stream event");
      },
    );
  }
}

function message(text: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "openai-responses",
    provider: "xiling-offline",
    model: "fixture",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

export function createOfflineStream(chunks = ["已建立研究分支。", "下一步将检查数据元信息。"]): StreamFn {
  return (_model, _context, options) => {
    const stream = new MockAssistantStream();
    queueMicrotask(async () => {
      let fullText = "";
      stream.push({ type: "start", partial: message("") });
      stream.push({ type: "text_start", contentIndex: 0, partial: message("") });
      for (const delta of chunks) {
        if (options?.signal?.aborted) {
          stream.push({ type: "error", reason: "aborted", error: message(fullText) });
          return;
        }
        fullText += delta;
        const partial = message(fullText);
        stream.push({ type: "text_delta", contentIndex: 0, delta, partial });
        await Promise.resolve();
      }
      stream.push({ type: "text_end", contentIndex: 0, content: fullText, partial: message(fullText) });
      stream.push({ type: "done", reason: "stop", message: message(fullText) });
    });
    return stream;
  };
}

export function createErrorStream(errorMessage = "fixture provider rejected the model"): StreamFn {
  return () => {
    const stream = new MockAssistantStream();
    queueMicrotask(() => {
      const error = { ...message(""), stopReason: "error" as const, errorMessage };
      stream.push({ type: "start", partial: message("") });
      stream.push({ type: "error", reason: "error", error });
    });
    return stream;
  };
}
