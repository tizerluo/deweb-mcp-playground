import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { analyzeBoard } from "./analysis.ts";
import { localDirection, resolveSnakeDecision, type JevOutcome } from "./controller.ts";
import { MAX_STEPS, createGame, stepGame, type GameState } from "./engine.ts";

function state(overrides: Partial<GameState>): GameState {
  return {
    grid: 4,
    body: [
      { x: 0, y: 3 },
      { x: 1, y: 3 },
    ],
    direction: "up",
    food: { x: 3, y: 3 },
    score: 0,
    eaten: 0,
    steps: 0,
    rng: 1,
    status: "running",
    endReason: null,
    ...overrides,
  };
}

const answered = (choice: string | null): JevOutcome => ({
  ok: true,
  choice,
  confidence: 0.91,
  probabilities: { up: 0.91, right: 0.09 },
  latencyMs: 210,
  model: "jev-1.13.0",
  cached: false,
});

const splitBoard = () =>
  analyzeBoard(
    state({
      grid: 5,
      body: [
        { x: 2, y: 0 },
        { x: 2, y: 1 },
        { x: 2, y: 2 },
        { x: 2, y: 3 },
        { x: 2, y: 4 },
        { x: 3, y: 4 },
        { x: 4, y: 4 },
      ],
      direction: "up",
      food: { x: 0, y: 4 },
    }),
  );

describe("localDirection", () => {
  it("keeps going straight while straight is legal", () => {
    const analysis = analyzeBoard(state({}));
    assert.equal(analysis.straight, "up");
    assert.equal(localDirection(analysis), "up");
  });

  it("falls back to the roomiest legal move when straight is blocked", () => {
    const analysis = splitBoard();
    assert.equal(analysis.legal.includes("up"), false);
    assert.equal(localDirection(analysis), "left");
  });
});

describe("resolveSnakeDecision", () => {
  it("takes JEV's pick when it is one of the legal moves", () => {
    const analysis = analyzeBoard(state({}));
    const decision = resolveSnakeDecision({ analysis, answer: answered("right") });
    assert.equal(decision.source, "jev");
    assert.equal(decision.status, "answered");
    assert.equal(decision.direction, "right");
    assert.equal(decision.confidence, 0.91);
    assert.deepEqual(decision.probabilities, { up: 0.91, right: 0.09 });
    assert.equal(decision.latencyMs, 210);
    assert.equal(decision.model, "jev-1.13.0");
  });

  it("goes straight and records the raw pick when JEV names an illegal move", () => {
    const analysis = analyzeBoard(state({}));
    const decision = resolveSnakeDecision({ analysis, answer: answered("down") });
    assert.equal(decision.source, "local");
    assert.equal(decision.status, "illegal");
    assert.equal(decision.direction, "up");
    assert.equal(decision.rawChoice, "down");
    // The distribution is kept: the decision log shows what JEV was thinking
    // even when the pick was not a move the rules allow.
    assert.deepEqual(decision.probabilities, { up: 0.91, right: 0.09 });
  });

  it("treats a choice that is not a move at all as illegal too", () => {
    const analysis = analyzeBoard(state({}));
    const decision = resolveSnakeDecision({ analysis, answer: answered("north-west") });
    assert.equal(decision.status, "illegal");
    assert.equal(decision.direction, "up");
  });

  it("goes straight when no answer arrived before the tick ended", () => {
    const analysis = analyzeBoard(state({}));
    const decision = resolveSnakeDecision({ analysis, answer: null });
    assert.equal(decision.source, "local");
    assert.equal(decision.status, "timeout");
    assert.equal(decision.direction, "up");
    assert.equal(decision.latencyMs, null);
  });

  it("keeps the machine reason when the call failed", () => {
    const analysis = analyzeBoard(state({}));
    for (const reason of ["no_key", "rate_limited", "timeout", "parse_error"] as const) {
      const decision = resolveSnakeDecision({
        analysis,
        answer: { ok: false, reason, latencyMs: 12 },
      });
      assert.equal(decision.status, "degraded");
      assert.equal(decision.reason, reason);
      assert.equal(decision.direction, "up");
      assert.equal(decision.source, "local");
    }
  });

  it("uses the roomiest legal move when the degraded tick cannot go straight", () => {
    const decision = resolveSnakeDecision({
      analysis: splitBoard(),
      answer: { ok: false, reason: "no_key", latencyMs: 0 },
    });
    assert.equal(decision.direction, "left");
    assert.equal(decision.status, "degraded");
  });

  it("does not spend a call on a forced move", () => {
    const forced = state({
      grid: 3,
      body: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
        { x: 2, y: 1 },
        { x: 2, y: 2 },
        { x: 1, y: 2 },
      ],
      direction: "down",
      food: { x: 1, y: 2 },
    });
    const decision = resolveSnakeDecision({ analysis: analyzeBoard(forced), answer: null });
    assert.equal(decision.status, "forced");
    assert.equal(decision.source, "local");
    assert.equal(decision.direction, "down");
  });

  it("hands the round-ending tick back to the engine when nothing is legal", () => {
    const packed = state({
      grid: 4,
      body: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
        { x: 3, y: 0 },
        { x: 3, y: 1 },
        { x: 2, y: 1 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
        { x: 0, y: 2 },
        { x: 1, y: 2 },
        { x: 2, y: 2 },
        { x: 3, y: 2 },
        { x: 3, y: 3 },
      ],
      direction: "right",
      food: { x: 2, y: 3 },
    });
    const analysis = analyzeBoard(packed);
    const decision = resolveSnakeDecision({ analysis, answer: null });
    assert.equal(decision.status, "forced");
    assert.equal(decision.direction, "right");
    assert.equal(stepGame(packed, decision.direction).status, "over");
  });

  it("plays a whole round on the local policy and always terminates", () => {
    let game = createGame({ seed: 20_260_921 });
    for (let tick = 0; tick < MAX_STEPS + 10 && game.status === "running"; tick += 1) {
      const decision = resolveSnakeDecision({ analysis: analyzeBoard(game), answer: null });
      game = stepGame(game, decision.direction);
    }
    assert.equal(game.status, "over");
    assert.ok(game.steps <= MAX_STEPS, `round ran ${game.steps} steps`);
  });
});
