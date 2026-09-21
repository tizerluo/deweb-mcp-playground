import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  JEV_BACKENDS,
  JEV_MAX_LABEL_CHARS,
  JEV_MAX_STATE_CHARS,
  JEV_RATE_BURST,
  JEV_RATE_PER_MINUTE,
  JEV_REQUEST_EXAMPLE,
  JevCooldown,
  JevResponseCache,
  TokenBucket,
  classifyJevStatus,
  isJevTransient,
  jevCacheKey,
  parseJevResponse,
  selectJevBackend,
  sanitizeJevRequest,
  type JevRequest,
} from "./protocol.ts";

const choiceRequest: JevRequest = {
  kind: "choice",
  state: "snake at 6,6",
  questions: {
    direction: {
      type: "choice",
      instructions: "Pick the next move.",
      criteria: { up: "3 cells to the food", down: "12 free cells reachable" },
    },
  },
};

describe("selectJevBackend", () => {
  it("prefers the AI Gateway key, then the official key, then nothing", () => {
    assert.equal(
      selectJevBackend({ AI_GATEWAY_API_KEY: "gw", TYPESAFE_API_KEY: "ts" })?.id,
      "gateway",
    );
    assert.equal(selectJevBackend({ TYPESAFE_API_KEY: "ts" })?.id, "direct");
    assert.equal(selectJevBackend({})?.id, undefined);
  });

  it("treats a blank or whitespace key as unconfigured", () => {
    assert.equal(selectJevBackend({ AI_GATEWAY_API_KEY: "   " }), null);
    assert.equal(selectJevBackend({ AI_GATEWAY_API_KEY: "" }), null);
    assert.equal(selectJevBackend({ TYPESAFE_API_KEY: "\n" }), null);
  });

  it("takes the key variable name from the backend, never a literal key", () => {
    assert.equal(JEV_BACKENDS.gateway.keyVar, "AI_GATEWAY_API_KEY");
    assert.equal(JEV_BACKENDS.direct.keyVar, "TYPESAFE_API_KEY");
    assert.equal(
      JSON.stringify(selectJevBackend({ AI_GATEWAY_API_KEY: "secret-value" })).includes(
        "secret-value",
      ),
      false,
    );
  });
});

describe("sanitizeJevRequest", () => {
  it("accepts a well-formed choice request and rebuilds it", () => {
    const parsed = sanitizeJevRequest(choiceRequest);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.deepEqual(parsed.request, choiceRequest);
  });

  it("truncates an oversized state instead of rejecting it", () => {
    const parsed = sanitizeJevRequest({
      ...choiceRequest,
      state: "x".repeat(JEV_MAX_STATE_CHARS + 500),
    });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.request.state.length, JEV_MAX_STATE_CHARS);
  });

  it("rejects a question whose type disagrees with the declared kind", () => {
    const parsed = sanitizeJevRequest({
      kind: "noul",
      state: "s",
      questions: { q: { type: "choice", instructions: "i", criteria: { a: "a", b: "b" } } },
    });
    assert.equal(parsed.ok, false);
    if (parsed.ok) return;
    assert.equal(parsed.reason, "invalid_request");
  });

  it("rejects a choice with fewer than two options (nothing to choose)", () => {
    const parsed = sanitizeJevRequest({
      kind: "choice",
      state: "s",
      questions: { q: { type: "choice", instructions: "i", criteria: { only: "one" } } },
    });
    assert.equal(parsed.ok, false);
  });

  it("rejects unknown kinds, empty questions, and non-objects", () => {
    assert.equal(sanitizeJevRequest(null).ok, false);
    assert.equal(sanitizeJevRequest([]).ok, false);
    assert.equal(sanitizeJevRequest({ kind: "chat", state: "s", questions: {} }).ok, false);
    assert.equal(sanitizeJevRequest({ kind: "choice", state: "   ", questions: {} }).ok, false);
    assert.equal(sanitizeJevRequest({ kind: "choice", state: "s", questions: {} }).ok, false);
  });

  it("caps the number of questions", () => {
    const questions = Object.fromEntries(
      Array.from({ length: 5 }, (_, i) => [`q${i}`, { type: "noul" as const, instructions: "i" }]),
    );
    assert.equal(sanitizeJevRequest({ kind: "noul", state: "s", questions }).ok, false);
  });

  it("accepts score levels and noul questions", () => {
    const score = sanitizeJevRequest({
      kind: "score",
      state: "s",
      questions: { risk: { type: "score", instructions: "How risky?", criteria: ["low", "high"] } },
    });
    assert.equal(score.ok, true);
    const noul = sanitizeJevRequest({
      kind: "noul",
      state: "s",
      questions: { human: { type: "noul", instructions: "Escalate?" } },
    });
    assert.equal(noul.ok, true);
  });

  it("rejects choice labels that collide once truncated", () => {
    // Two legal labels, identical in their first 48 characters: rebuilding the
    // request around the truncation point used to merge them into one option
    // and still answer `ok: true`.
    const shared = "d".repeat(JEV_MAX_LABEL_CHARS);
    const parsed = sanitizeJevRequest({
      kind: "choice",
      state: "s",
      questions: {
        q: {
          type: "choice",
          instructions: "i",
          criteria: { [`${shared}a`]: "first", [`${shared}b`]: "second" },
        },
      },
    });
    assert.equal(parsed.ok, false);
    if (parsed.ok) return;
    assert.equal(parsed.reason, "invalid_request");
    assert.match(parsed.message, /collide/);
  });

  it("rejects question names that collide once truncated", () => {
    const shared = "q".repeat(JEV_MAX_LABEL_CHARS);
    const parsed = sanitizeJevRequest({
      kind: "noul",
      state: "s",
      questions: {
        [`${shared}a`]: { type: "noul", instructions: "i" },
        [`${shared}b`]: { type: "noul", instructions: "i" },
      },
    });
    assert.equal(parsed.ok, false);
    if (parsed.ok) return;
    assert.equal(parsed.reason, "invalid_request");
    assert.match(parsed.message, /collide/);
  });

  it("keeps long labels that stay distinct after truncation", () => {
    const long = "x".repeat(60);
    const parsed = sanitizeJevRequest({
      kind: "choice",
      state: "s",
      questions: {
        q: {
          type: "choice",
          instructions: "i",
          criteria: { [`up-${long}`]: "a", [`down-${long}`]: "b" },
        },
      },
    });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const question = parsed.request.questions.q;
    assert.equal(question.type, "choice");
    if (question.type !== "choice") return;
    assert.deepEqual(
      Object.keys(question.criteria).sort(),
      [
        `down-${long}`.slice(0, JEV_MAX_LABEL_CHARS),
        `up-${long}`.slice(0, JEV_MAX_LABEL_CHARS),
      ].sort(),
    );
  });
});

describe("JEV_REQUEST_EXAMPLE", () => {
  it("is a request the server accepts, unchanged", () => {
    // The spec page renders this object: an example the sanitizer would reject
    // (no `instructions`, a single choice option) is a documentation bug.
    const parsed = sanitizeJevRequest(JEV_REQUEST_EXAMPLE);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.deepEqual(parsed.request, JEV_REQUEST_EXAMPLE);
    const question = parsed.request.questions.direction;
    assert.equal(question.type, "choice");
    if (question.type !== "choice") return;
    assert.ok(
      Object.keys(question.criteria).length >= 2,
      "a choice needs at least two options to be a choice",
    );
    assert.equal(question.instructions.length > 0, true);
  });
});

describe("parseJevResponse", () => {
  it("parses the provider shape (live sample from api.typesafe.ai)", () => {
    const parsed = parseJevResponse({
      model: "jev-1.13.0",
      answers: {
        direction: {
          type: "choice",
          choice: "up",
          confidence: 0.99,
          probabilities: { up: 0.99, down: 0.01, left: 0 },
        },
      },
      usage: { input_tokens: 490, output_tokens: 38 },
    });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.response.model, "jev-1.13.0");
    const answer = parsed.response.answers.direction;
    assert.equal(answer.type, "choice");
    if (answer.type !== "choice") return;
    assert.equal(answer.choice, "up");
    assert.equal(answer.confidence, 0.99);
    assert.equal(answer.probabilities?.up, 0.99);
    assert.equal(parsed.response.inputTokens, 490);
    assert.equal(parsed.response.outputTokens, 38);
  });

  it("keeps a noul probability and a score with its legend", () => {
    const parsed = parseJevResponse({
      model: "jev-1.13.0",
      answers: {
        human: { type: "noul", noul: 0.8 },
        severity: {
          type: "score",
          score: 1.3,
          legend: { 0: "low", 1: "high" },
          confidence: 0.54,
          probabilities: { 0: 0.7, 1: 0.3 },
        },
      },
    });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const human = parsed.response.answers.human;
    assert.equal(human.type === "noul" ? human.noul : null, 0.8);
    const severity = parsed.response.answers.severity;
    assert.equal(severity.type === "score" ? severity.score : null, 1.3);
    assert.equal(severity.type === "score" ? severity.legend?.["1"] : null, "high");
  });

  it("reports parse_error for every malformed body it could be handed", () => {
    for (const bad of [
      null,
      "text",
      [],
      {},
      { answers: {} },
      { answers: null },
      { answers: { q: { type: "choice" } } },
      { answers: { q: { type: "noul" } } },
      { answers: { q: { type: "unknown", value: 1 } } },
      { answers: { q: "up" } },
    ]) {
      const parsed = parseJevResponse(bad);
      assert.equal(parsed.ok, false, `expected ${JSON.stringify(bad)} to fail`);
      if (!parsed.ok) assert.equal(parsed.reason, "parse_error");
    }
  });
});

describe("classifyJevStatus", () => {
  it("maps the statuses the layer has to tell apart", () => {
    assert.equal(classifyJevStatus(401), "unauthorized");
    assert.equal(classifyJevStatus(403), "unauthorized");
    assert.equal(classifyJevStatus(429), "rate_limited");
    assert.equal(classifyJevStatus(402), "quota");
    assert.equal(classifyJevStatus(500), "upstream");
    assert.equal(classifyJevStatus(503), "upstream");
    assert.equal(classifyJevStatus(400, "invalid_request"), "invalid_request");
    assert.equal(classifyJevStatus(400), "bad_request");
    assert.equal(classifyJevStatus(408), "timeout");
  });

  it("marks only the retryable reasons as transient", () => {
    assert.equal(isJevTransient("rate_limited"), true);
    assert.equal(isJevTransient("timeout"), true);
    assert.equal(isJevTransient("no_key"), false);
    assert.equal(isJevTransient("invalid_request"), false);
  });
});

describe("TokenBucket", () => {
  it("allows a full burst of 30 calls and then holds", () => {
    const bucket = new TokenBucket({
      capacity: JEV_RATE_BURST,
      refillPerMinute: JEV_RATE_PER_MINUTE,
      now: 0,
    });
    let allowed = 0;
    for (let i = 0; i < 40; i += 1) {
      if (bucket.tryTake(0)) allowed += 1;
    }
    assert.equal(allowed, JEV_RATE_BURST);
  });

  it("refills at the configured rate and never above capacity", () => {
    const bucket = new TokenBucket({ capacity: 30, refillPerMinute: 30, now: 0 });
    for (let i = 0; i < 30; i += 1) bucket.tryTake(0);
    assert.equal(bucket.tryTake(1_000), false);
    assert.equal(bucket.tryTake(2_000), true);
    assert.equal(bucket.available(10 * 60_000), 30);
    assert.equal(bucket.available(10 * 60_000 + 60_000), 30);
  });

  it("never throttles a normal round at any shipped tick setting", () => {
    // One call per tick: 900 ms (default) and 350 ms ("fast") are both inside
    // the sustained budget, which is the point of the 240/min default.
    for (const tickMs of [900, 600, 350]) {
      const bucket = new TokenBucket({
        capacity: JEV_RATE_BURST,
        refillPerMinute: JEV_RATE_PER_MINUTE,
        now: 0,
      });
      let allowed = 0;
      const calls = 300;
      for (let tick = 0; tick < calls; tick += 1) {
        if (bucket.tryTake(tick * tickMs)) allowed += 1;
      }
      assert.equal(allowed, calls, `tick ${tickMs}ms was throttled`);
    }
  });
});

describe("JevCooldown", () => {
  it("backs off exponentially after 429s and caps the wait", () => {
    const cooldown = new JevCooldown({ baseMs: 2_000, maxMs: 30_000 });
    cooldown.noteThrottled(0);
    assert.equal(cooldown.remainingMs(0), 2_000);
    assert.equal(cooldown.remainingMs(1_000), 1_000);
    cooldown.noteThrottled(0);
    assert.equal(cooldown.remainingMs(0), 4_000);
    for (let i = 0; i < 10; i += 1) cooldown.noteThrottled(0);
    assert.equal(cooldown.remainingMs(0), 30_000);
  });

  it("clears the wait on the next success", () => {
    const cooldown = new JevCooldown({ baseMs: 2_000, maxMs: 30_000 });
    cooldown.noteThrottled(0);
    cooldown.noteSuccess();
    assert.equal(cooldown.remainingMs(0), 0);
  });
});

describe("JevResponseCache", () => {
  it("answers a repeat question inside the TTL and forgets it after", () => {
    const cache = new JevResponseCache({ ttlMs: 1_000, max: 4 });
    const parsed = parseJevResponse({ answers: { q: { type: "noul", noul: 0.5 } } });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    cache.set("k", parsed.response, 0);
    assert.equal(cache.get("k", 999)?.answers.q.type, "noul");
    assert.equal(cache.get("k", 1_001), null);
  });

  it("evicts the oldest entry past its capacity", () => {
    const cache = new JevResponseCache({ ttlMs: 60_000, max: 2 });
    const value = parseJevResponse({ answers: { q: { type: "noul", noul: 0.5 } } });
    assert.equal(value.ok, true);
    if (!value.ok) return;
    cache.set("a", value.response, 0);
    cache.set("b", value.response, 0);
    cache.set("c", value.response, 0);
    assert.equal(cache.get("a", 0), null);
    assert.equal(cache.get("c", 0)?.answers.q.type, "noul");
  });
});

describe("jevCacheKey", () => {
  it("is stable across object key order but changes with the state", () => {
    const a = jevCacheKey(choiceRequest);
    const b = jevCacheKey({
      ...choiceRequest,
      questions: {
        direction: {
          type: "choice",
          instructions: "Pick the next move.",
          criteria: { down: "12 free cells reachable", up: "3 cells to the food" },
        },
      },
    });
    assert.equal(a, b);
    assert.notEqual(a, jevCacheKey({ ...choiceRequest, state: "snake at 6,7" }));
  });
});

describe("rate limit vs. a real round", () => {
  // The review gate is "限流存在且正常局不被误伤": the limiter must exist and
  // a normal round must still get every tick answered. One snake round asks
  // once per tick, so the load is tick-count over round duration — 67/min at
  // the 900 ms default and 171/min at the 350 ms setting.
  const roundLoad = (tickMs: number, ticks: number) => {
    const bucket = new TokenBucket({
      capacity: JEV_RATE_BURST,
      refillPerMinute: JEV_RATE_PER_MINUTE,
      now: 0,
    });
    let throttled = 0;
    for (let tick = 0; tick < ticks; tick += 1) {
      if (!bucket.tryTake(tick * tickMs)) throttled += 1;
    }
    return throttled;
  };

  it("answers every tick of a full-length round at every offered speed", () => {
    // MAX_STEPS is 400: no round can ask more often than this.
    assert.equal(roundLoad(900, 400), 0);
    assert.equal(roundLoad(600, 400), 0);
    assert.equal(roundLoad(350, 400), 0);
  });

  it("still binds on a runaway loop", () => {
    const bucket = new TokenBucket({
      capacity: JEV_RATE_BURST,
      refillPerMinute: JEV_RATE_PER_MINUTE,
      now: 0,
    });
    let allowed = 0;
    // 1,000 calls inside one second: a retry loop, not a round. One burst plus
    // the second's refill is all that gets through.
    for (let call = 0; call < 1_000; call += 1) {
      if (bucket.tryTake(call)) allowed += 1;
    }
    assert.ok(allowed >= JEV_RATE_BURST, `allowed ${allowed}`);
    assert.ok(allowed < JEV_RATE_BURST + 10, `allowed ${allowed}`);
  });

  it("honors a 30/min override — the brief's number stays reachable", () => {
    const bucket = new TokenBucket({ capacity: 30, refillPerMinute: 30, now: 0 });
    let allowed = 0;
    const calls = 120;
    for (let call = 0; call < calls; call += 1) {
      if (bucket.tryTake(call * 1_000)) allowed += 1;
    }
    // 30 tokens up front plus one per 2s of refill over a 119s window: ~89.
    // Not the full 120 — the override throttles, which is the point of it.
    assert.ok(allowed >= 85 && allowed <= 95, `allowed ${allowed}`);
    assert.ok(allowed < calls, "the sustained ceiling must bite");
  });
});
