import { createServerFn } from "@tanstack/react-start";
import {
  callChatModel,
  hasChatKey,
  quotaIdentity,
  quotaLimit,
  quotaPeek,
  quotaStore,
  quotaTake,
} from "./client.server.ts";
import { drawChatBudget, giveBackChatBudget, type ChatDraw } from "./quota.ts";
import { excerpt, AI_MAX_INPUT_CHARS } from "./models.ts";
import type { JevFailureReason } from "../jev/protocol.ts";

/**
 * The AI-call service's server surface: what the free trial has left, the
 * games' claim on a round, and one chat call.
 *
 * All three share one counter (see `quota.ts`), because "2 free calls a day"
 * is one budget however it is spent — a visitor who played two rounds has used
 * today's trial, and the panel and the demos show the same number.
 */

/** What the panel and the demos display as the remaining free calls. */
export type AiQuotaView = { left: number; limit: number; exempt: boolean };

/** A demo's claim on today's free round. `no_key` still lets the round start. */
export type AiRoundClaim = {
  ok: boolean;
  left: number;
  limit: number;
  /**
   * Why a claim came back not-ok. `no_key` is the server saying there is
   * nothing to count — the demo degrades to its local policy and no trial is
   * spent. `quota` is the server saying today's rounds are gone. `network` is
   * the caller's own failure to reach the server at all: the claim never
   * happened, so a round may not start on it either.
   */
  reason: "no_key" | "quota" | "network" | null;
};

export type AiChatResult =
  | {
      ok: true;
      reply: string;
      /** The model that answered — the chain may have failed over. */
      model: string;
      /** The answer stopped on the token cap. */
      truncated: boolean;
      latencyMs: number;
      left: number;
      limit: number;
    }
  | {
      ok: false;
      reason: JevFailureReason;
      message: string;
      left: number;
      limit: number;
    };

/** Read the trial counter (non-mutating; remembers the visitor cookie). */
export const readAiQuota = createServerFn({ method: "POST" }).handler(
  async (): Promise<AiQuotaView> => {
    const { key, exempt } = quotaIdentity();
    const limit = quotaLimit();
    if (exempt) return { left: limit, limit, exempt: true };
    const view = quotaPeek(key);
    return { left: view.left, limit: view.limit, exempt: false };
  },
);

/**
 * A demo round costs one free call, claimed *before* it starts: a round is
 * dozens of decisions, so counting per decision would spend the whole day in
 * one lap. Without a key nothing is claimed — the demo degrades to its local
 * policy and must not burn a trial the visitor never used.
 */
export const claimAiRound = createServerFn({ method: "POST" }).handler(
  async (): Promise<AiRoundClaim> => {
    const { key, exempt } = quotaIdentity();
    const limit = quotaLimit();
    if (!hasChatKey()) return { ok: false, left: quotaPeek(key).left, limit, reason: "no_key" };
    if (exempt) return { ok: true, left: limit, limit, reason: null };
    const took = quotaTake(key);
    if (!took.ok) return { ok: false, left: 0, limit, reason: "quota" };
    return { ok: true, left: took.left, limit, reason: null };
  },
);

/**
 * One chat call. The key stays in this process; the visitor's text is cut to
 * the service's own limit first, and a call that fails upstream gives the
 * trial unit back (a provider outage is not a spent free call).
 *
 * `paid` is the caller's own ledger talking: it says this call comes out of
 * the visitor's wallet rather than the day's trial, which is the continuation
 * the panel's line promises when the trial is spent. The server cannot check a
 * wallet the browser holds — this playground settles in the browser, as a
 * demo — so the flag is taken at its word; what still bounds a forged one is
 * the instance's own rate limit in `client.server.ts`, not the trial counter.
 */
export const runAiChat = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const input = data as { text?: unknown; paid?: unknown } | null;
    return {
      text: excerpt(String(input?.text ?? ""), AI_MAX_INPUT_CHARS),
      paid: input?.paid === true,
    };
  })
  .handler(async ({ data }): Promise<AiChatResult> => {
    const { key, exempt } = quotaIdentity();
    const limit = quotaLimit();
    if (!data.text) {
      return {
        ok: false,
        reason: "invalid_request",
        message: "",
        left: quotaPeek(key).left,
        limit,
      };
    }
    if (!hasChatKey()) {
      return { ok: false, reason: "no_key", message: "", left: quotaPeek(key).left, limit };
    }
    // What pays for this call: the trial, unless the visitor is buying it. An
    // exempt visitor has no counter at all, so nothing is drawn either way.
    const draw: ChatDraw = exempt
      ? { ok: true, budget: { source: "trial", left: limit, limit } }
      : drawChatBudget(quotaStore(), key, data.paid);
    if (!draw.ok) return { ok: false, reason: "quota", message: "", left: 0, limit };
    const call = await callChatModel(data.text);
    if (!call.ok) {
      const given = giveBackChatBudget(quotaStore(), key, draw.budget, exempt);
      return { ok: false, reason: call.reason, message: call.message, left: given, limit };
    }
    return {
      ok: true,
      reply: call.reply.reply,
      model: call.reply.model,
      truncated: call.reply.truncated,
      latencyMs: call.latencyMs,
      left: draw.budget.left,
      limit,
    };
  });
