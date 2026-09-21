import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { analyzeBoard } from "./analysis.ts";
import {
  buildSnakeRequest,
  probabilityRows,
  readSnakeChoice,
  snakeStateSummary,
} from "./question.ts";
import { sanitizeJevRequest } from "../protocol.ts";
import type { GameState } from "./engine.ts";

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

describe("analyzeBoard", () => {
  it("counts the reachable region and the food distance for each legal move", () => {
    const analysis = analyzeBoard(state({}));
    assert.deepEqual(analysis.legal, ["up", "right"]);
    assert.equal(analysis.facts.up.safe, true);
    assert.equal(analysis.facts.up.reachable, 15);
    assert.equal(analysis.facts.up.foodDistance, 4);
    assert.equal(analysis.facts.up.deadEnd, false);
    assert.equal(analysis.facts.down.safe, false);
    assert.equal(analysis.facts.down.note, "off the grid");
    assert.equal(analysis.facts.right.safe, true);
    assert.equal(analysis.facts.right.foodDistance, 2);
  });

  it("refuses the cell its own neck occupies (no 180° turn)", () => {
    // Head (2,0) with the body running down: "down" is straight into the neck.
    const wall = analyzeBoard(
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
    assert.equal(wall.facts.down.safe, false);
    assert.equal(wall.facts.down.note, "into its own body");
    assert.equal(wall.legal.includes("down"), false);
  });

  it("prefers the roomier side when both flanks are open", () => {
    // A wall at column 2 splits the board; the left side keeps one more cell.
    const split = analyzeBoard(
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
    assert.deepEqual(split.legal, ["right", "left"]);
    assert.equal(split.facts.left.reachable, 10);
    assert.equal(split.facts.right.reachable, 9);
    assert.equal(split.fallback, "left");
    assert.equal(split.facts.left.foodDistance, 5);
    assert.equal(split.facts.right.foodDistance, null);
    assert.match(split.facts.right.note, /food not reachable/);
  });

  it("flags a pocket the snake cannot fit into", () => {
    const pocket = analyzeBoard(
      state({
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
      }),
    );
    assert.deepEqual(pocket.legal, ["down"]);
    assert.equal(pocket.facts.down.reachable, 4);
    assert.equal(pocket.facts.down.foodDistance, 2);
    assert.equal(pocket.facts.down.deadEnd, true);
    assert.match(pocket.facts.down.note, /space smaller than the snake/);
  });

  it("reports no legal move when the snake has boxed itself in", () => {
    const packed: GameState = state({
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
    assert.deepEqual(analysis.legal, []);
    assert.equal(analysis.fallback, null);
  });
});

describe("buildSnakeRequest", () => {
  const open = state({});

  it("asks one choice question whose options are exactly the legal moves", () => {
    const analysis = analyzeBoard(open);
    const request = buildSnakeRequest(open, analysis);
    assert.ok(request);
    assert.equal(request.kind, "choice");
    const question = request.questions.direction;
    assert.equal(question.type, "choice");
    if (question.type !== "choice") return;
    assert.deepEqual(Object.keys(question.criteria).sort(), [...analysis.legal].sort());
    assert.equal(question.criteria.up, analysis.facts.up.note);
    assert.match(question.instructions, /moves exactly one cell/);
  });

  it("produces a request the server-side validator accepts as-is", () => {
    const request = buildSnakeRequest(open, analyzeBoard(open));
    assert.ok(request);
    const parsed = sanitizeJevRequest(request);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.deepEqual(parsed.request, request);
  });

  it("does not pay for a question when the rules already force the move", () => {
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
    const analysis = analyzeBoard(forced);
    assert.equal(analysis.legal.length, 1);
    assert.equal(buildSnakeRequest(forced, analysis), null);
  });

  it("summarizes the board as parseable JSON with the facts inside", () => {
    const analysis = analyzeBoard(open);
    const summary = JSON.parse(snakeStateSummary(open, analysis)) as Record<string, unknown>;
    assert.equal(summary.game, "snake");
    assert.equal(summary.grid, "4x4");
    assert.deepEqual(summary.legal_moves, ["up", "right"]);
    assert.equal(typeof (summary.moves as Record<string, string>).up, "string");
  });
});

describe("readSnakeChoice", () => {
  it("pulls the pick, confidence, and probabilities out of a live-shaped answer", () => {
    const read = readSnakeChoice({
      direction: {
        type: "choice",
        choice: "up",
        confidence: 0.99,
        probabilities: { up: 0.99, down: 0.01, left: 0 },
      },
    });
    assert.equal(read.choice, "up");
    assert.equal(read.confidence, 0.99);
    assert.deepEqual(read.probabilities, { up: 0.99, down: 0.01, left: 0 });
  });

  it("returns nothing for a missing, mistyped, or empty answer", () => {
    assert.deepEqual(readSnakeChoice({}), { choice: null, confidence: null, probabilities: null });
    assert.deepEqual(readSnakeChoice({ direction: { type: "noul", noul: 0.5 } }), {
      choice: null,
      confidence: null,
      probabilities: null,
    });
    assert.equal(readSnakeChoice({ direction: "up" }).choice, null);
  });
});

describe("probabilityRows", () => {
  it("keeps the legal-move order and backfills missing labels with zero", () => {
    const rows = probabilityRows({ up: 0.7, left: 0.3 }, ["up", "right", "left"]);
    assert.deepEqual(rows, [
      { label: "up", value: 0.7 },
      { label: "right", value: 0 },
      { label: "left", value: 0.3 },
    ]);
    assert.deepEqual(probabilityRows(null, ["up"]), []);
  });
});
