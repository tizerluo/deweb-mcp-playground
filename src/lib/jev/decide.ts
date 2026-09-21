import { createServerFn } from "@tanstack/react-start";
import { callSystemOne } from "./client.server.ts";
import { sanitizeJevRequest, type JevAnswer, type JevFailureReason } from "./protocol.ts";

export type JevDecideResult =
  | {
      ok: true;
      backend: "gateway" | "direct";
      model: string;
      latencyMs: number;
      cached: boolean;
      answers: Record<string, JevAnswer>;
      usage: { inputTokens: number | null; outputTokens: number | null };
    }
  | { ok: false; reason: JevFailureReason; message: string };

/**
 * The only way a client reaches JEV. Input is `{ kind, state, questions }`
 * (TypeSafe's own shapes); it is validated and truncated server-side, and the
 * key never leaves this process.
 */
export const runJevDecide = createServerFn({ method: "POST" })
  .validator((data: unknown) => data)
  .handler(async ({ data }): Promise<JevDecideResult> => {
    const parsed = sanitizeJevRequest(data);
    if (!parsed.ok) {
      return { ok: false, reason: parsed.reason, message: parsed.message };
    }
    const call = await callSystemOne(parsed.request);
    if (!call.ok) {
      return { ok: false, reason: call.reason, message: call.message };
    }
    return {
      ok: true,
      backend: call.backend,
      model: call.model,
      latencyMs: call.latencyMs,
      cached: call.cached,
      answers: call.response.answers,
      usage: {
        inputTokens: call.response.inputTokens,
        outputTokens: call.response.outputTokens,
      },
    };
  });
