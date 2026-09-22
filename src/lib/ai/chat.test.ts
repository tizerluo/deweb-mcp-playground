/**
 * The AI-call page's own layer: which models answer, what the request body
 * carries, and how the free trial is counted.
 *
 * No key and no network here: the chain names are pinned against the live
 * OpenRouter catalogue by hand (they are strings a typo would silently turn
 * into a 404 at call time), the body and the reply parser are pure, and the
 * quota is clock-injected so a day rollover can be driven without a server.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  AI_MAX_INPUT_CHARS,
  AI_MAX_TOKENS,
  AI_SYSTEM_PROMPT,
  FALLBACK_MODELS,
  MODEL_CHAIN,
  PRIMARY_MODEL,
  buildChatRequest,
  excerpt,
  parseChatReply,
} from "./models.ts";
import {
  DailyQuota,
  FREE_DAILY_LIMIT,
  drawChatBudget,
  giveBackChatBudget,
  quotaExempt,
  quotaKey,
  utcDay,
} from "./quota.ts";
import { assertAiServerOnly } from "./server-only.ts";

describe("the model chain", () => {
  it("answers with the primary model and falls back in order, at most three", () => {
    // The four ids the card fixes, in that order: the primary answers unless it
    // fails, and OpenRouter walks the rest of `models` itself.
    assert.deepEqual(MODEL_CHAIN, [
      "inclusionai/ling-3.0-flash-sante:free",
      "nvidia/nemotron-3-super-120b-a12b:free",
      "nex-agi/nex-n2.5-pro:free",
      "dots-studio/dots-3-note-preview:free",
    ]);
    assert.equal(MODEL_CHAIN[0], PRIMARY_MODEL);
    assert.equal(MODEL_CHAIN.length, 1 + FALLBACK_MODELS.length);
    assert.ok(FALLBACK_MODELS.length <= 3, "a long chain is a slow failure");
    // Provider-qualified ids: OpenRouter resolves nothing without the vendor.
    for (const model of MODEL_CHAIN) assert.match(model, /^[a-z0-9-]+\/[a-z0-9.:-]+$/i);
  });

  it("counts each call's own model, never a cached one", () => {
    const body = buildChatRequest("hello");
    assert.equal(body.model, PRIMARY_MODEL);
    // The primary answers; the failover list is the three backups and nothing
    // else — OpenRouter rejects a `models` array longer than three, and a
    // repeated primary would waste one of those slots.
    assert.deepEqual(body.models, FALLBACK_MODELS);
    assert.ok(body.models.length <= 3, "the API caps `models` at three");
    assert.ok(!body.models.includes(body.model), "the primary is not repeated");
    assert.deepEqual([body.model, ...body.models], MODEL_CHAIN);
  });

  it("asks without reasoning and with an answer cap", () => {
    const body = buildChatRequest("hello");
    assert.equal(body.reasoning.effort, "none");
    assert.equal(body.max_tokens, AI_MAX_TOKENS);
    assert.equal(body.messages[0].content, AI_SYSTEM_PROMPT);
    assert.equal(body.messages[1].content, "hello");
  });

  it("cuts a visitor's text to the size the service accepts", () => {
    const long = "x".repeat(AI_MAX_INPUT_CHARS + 50);
    assert.equal(excerpt(long).length, AI_MAX_INPUT_CHARS);
    assert.equal(excerpt("  hi  "), "hi");
  });
});

describe("reading a chat completion", () => {
  it("takes the answer, the model that gave it and the token counts", () => {
    const parsed = parseChatReply({
      model: "google/gemini-2.5-flash",
      choices: [{ message: { role: "assistant", content: "  Fine. " }, finish_reason: "stop" }],
      usage: { prompt_tokens: 12, completion_tokens: 3 },
    });
    assert.deepEqual(parsed, {
      reply: "Fine.",
      model: "google/gemini-2.5-flash",
      inputTokens: 12,
      outputTokens: 3,
      truncated: false,
    });
  });

  it("marks an answer the provider cut off at the cap", () => {
    const parsed = parseChatReply({
      choices: [{ message: { content: "half a sen" }, finish_reason: "length" }],
    });
    assert.equal(parsed?.truncated, true);
  });

  it("refuses to read an empty or shapeless answer as a success", () => {
    assert.equal(parseChatReply({ choices: [{ message: { content: "   " } }] }), null);
    assert.equal(parseChatReply({ choices: [] }), null);
    assert.equal(parseChatReply({ error: { message: "no key" } }), null);
    assert.equal(parseChatReply(null), null);
    assert.equal(parseChatReply({ choices: [{ message: { content: 42 } }] }), null);
  });
});

describe("the free trial counter", () => {
  const DAY1 = Date.UTC(2026, 8, 22, 9, 0, 0);
  const DAY2 = Date.UTC(2026, 8, 23, 0, 30, 0);

  it("says who a call is counted against", () => {
    assert.equal(quotaKey("203.0.113.7", "abc-123"), "203.0.113.7|abc-123");
    assert.equal(quotaKey(null, null), "unknown|anon", "never an empty key");
  });

  it("spends the day's calls, then refuses", () => {
    const quota = new DailyQuota(FREE_DAILY_LIMIT, () => DAY1);
    assert.equal(quota.peek("k").left, FREE_DAILY_LIMIT);
    for (let i = 0; i < FREE_DAILY_LIMIT; i += 1) {
      const take = quota.take("k");
      assert.equal(take.ok, true);
      assert.equal(take.left, FREE_DAILY_LIMIT - i - 1);
    }
    const refused = quota.take("k");
    assert.equal(refused.ok, false);
    assert.equal(refused.left, 0);
    assert.equal(quota.peek("k").left, 0, "a refusal spends nothing");
  });

  it("counts each visitor separately", () => {
    const quota = new DailyQuota(FREE_DAILY_LIMIT, () => DAY1);
    quota.take("a");
    quota.take("a");
    assert.equal(quota.peek("a").left, 0);
    assert.equal(quota.peek("b").left, FREE_DAILY_LIMIT);
  });

  it("starts a new day without a timer", () => {
    let now = DAY1;
    const quota = new DailyQuota(FREE_DAILY_LIMIT, () => now);
    quota.take("k");
    quota.take("k");
    assert.equal(quota.peek("k").left, 0);
    now = DAY2;
    assert.equal(utcDay(now), "2026-09-23");
    assert.equal(quota.peek("k").left, FREE_DAILY_LIMIT, "yesterday's bucket is gone");
  });

  it("hands a unit back when the call never happened", () => {
    const quota = new DailyQuota(FREE_DAILY_LIMIT, () => DAY1);
    quota.take("k");
    assert.equal(quota.give("k").left, FREE_DAILY_LIMIT);
    assert.equal(quota.give("k").left, FREE_DAILY_LIMIT, "never below zero spent");
  });

  it("keeps the map bounded when a client rotates identities", () => {
    const quota = new DailyQuota(FREE_DAILY_LIMIT, () => DAY1);
    for (let i = 0; i < 6_000; i += 1) quota.take(`visitor-${i}`);
    // The oldest buckets are evicted first, so the newest visitor still counts.
    assert.equal(quota.peek("visitor-5999").left, FREE_DAILY_LIMIT - 1);
  });

  it("is lifted by the bypass switch or by a whitelisted address", () => {
    assert.equal(quotaExempt({ bypass: "1", ip: "203.0.113.7" }), true);
    assert.equal(quotaExempt({ bypass: "0", whitelist: "203.0.113.7", ip: "203.0.113.7" }), true);
    assert.equal(quotaExempt({ whitelist: "198.51.100.9", ip: "203.0.113.7" }), false);
    assert.equal(quotaExempt({ bypass: "1", ip: null }), true, "the switch needs no address");
    assert.equal(
      quotaExempt({ whitelist: "203.0.113.7", ip: null }),
      false,
      "an unknown address cannot match a whitelist",
    );
  });
});

describe("what pays for a chat call", () => {
  const DAY1 = Date.UTC(2026, 8, 22, 9, 0, 0);

  it("spends a trial unit while the trial has one", () => {
    const quota = new DailyQuota(FREE_DAILY_LIMIT, () => DAY1);
    assert.deepEqual(drawChatBudget(quota, "k", false), {
      ok: true,
      budget: { source: "trial", left: FREE_DAILY_LIMIT - 1, limit: FREE_DAILY_LIMIT },
    });
  });

  it("refuses a free call once the day's trial is gone, spending nothing", () => {
    const quota = new DailyQuota(FREE_DAILY_LIMIT, () => DAY1);
    quota.take("k");
    quota.take("k");
    assert.deepEqual(drawChatBudget(quota, "k", false), { ok: false, reason: "quota" });
    assert.equal(quota.peek("k").left, 0);
  });

  it("serves a paid call without touching the trial, spent or not", () => {
    const quota = new DailyQuota(FREE_DAILY_LIMIT, () => DAY1);
    // A paid call on an unspent trial leaves both free calls where they were:
    // the visitor is buying this one, not spending a unit they did not use.
    assert.deepEqual(drawChatBudget(quota, "k", true), {
      ok: true,
      budget: { source: "paid", left: FREE_DAILY_LIMIT, limit: FREE_DAILY_LIMIT },
    });
    assert.equal(quota.peek("k").left, FREE_DAILY_LIMIT);
    // And with the trial spent, it is exactly the continuation the panel's
    // line promises: the call is served, the counter stays at zero.
    quota.take("k");
    quota.take("k");
    const paid = drawChatBudget(quota, "k", true);
    assert.ok(paid.ok);
    assert.equal(paid.budget.source, "paid");
    assert.equal(paid.budget.left, 0);
    assert.equal(drawChatBudget(quota, "k", true).ok, true, "the wallet keeps a call up");
    assert.equal(quota.peek("k").left, 0, "and the trial is not refilled by it");
  });

  it("gives a failed free call's unit back and leaves a paid counter alone", () => {
    const quota = new DailyQuota(FREE_DAILY_LIMIT, () => DAY1);
    const trial = drawChatBudget(quota, "k", false);
    assert.ok(trial.ok);
    assert.equal(giveBackChatBudget(quota, "k", trial.budget, false), FREE_DAILY_LIMIT);
    const paid = drawChatBudget(quota, "k", true);
    assert.ok(paid.ok);
    assert.equal(giveBackChatBudget(quota, "k", paid.budget, false), paid.budget.left);
    assert.equal(
      giveBackChatBudget(quota, "k", paid.budget, true),
      paid.budget.left,
      "an exempt visitor has no counter to correct",
    );
  });
});

describe("assertAiServerOnly", () => {
  it("passes on the server and trips as soon as a browser global exists", () => {
    assert.equal(typeof globalThis.window, "undefined");
    assert.doesNotThrow(() => assertAiServerOnly());
    const scope = globalThis as { window?: unknown };
    scope.window = {};
    try {
      assert.throws(() => assertAiServerOnly(), /server-only/);
      assert.throws(() => assertAiServerOnly("@/lib/ai/client.server"), /server-only/);
    } finally {
      delete scope.window;
    }
  });
});
