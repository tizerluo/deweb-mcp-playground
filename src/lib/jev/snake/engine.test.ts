import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_GRID,
  FOOD_SCORE,
  MAX_STEPS,
  START_LENGTH,
  createGame,
  headOf,
  nextRandom,
  randomFreeCell,
  samePoint,
  stepGame,
  type GameState,
} from "./engine.ts";

/** A hand-built state so each rule can be exercised in isolation. */
function state(overrides: Partial<GameState> = {}): GameState {
  return {
    grid: 8,
    body: [
      { x: 3, y: 3 },
      { x: 2, y: 3 },
      { x: 1, y: 3 },
    ],
    direction: "right",
    food: { x: 6, y: 6 },
    score: 0,
    eaten: 0,
    steps: 0,
    rng: 12_345,
    status: "running",
    endReason: null,
    ...overrides,
  };
}

describe("createGame", () => {
  it("starts a centred snake heading right on the default grid", () => {
    const game = createGame({ seed: 7 });
    assert.equal(game.grid, DEFAULT_GRID);
    assert.equal(game.body.length, START_LENGTH);
    assert.equal(game.direction, "right");
    assert.equal(headOf(game).x, Math.floor(DEFAULT_GRID / 2));
    assert.equal(game.status, "running");
    assert.equal(game.score, 0);
  });

  it("is reproducible from the seed and never puts food on the snake", () => {
    const a = createGame({ seed: 99 });
    const b = createGame({ seed: 99 });
    assert.deepEqual(a, b);
    assert.deepEqual(b.food, a.food);
    assert.equal(
      a.body.some((segment) => segment.x === a.food.x && segment.y === a.food.y),
      false,
    );
    const c = createGame({ seed: 100 });
    assert.notEqual(c.rng, a.rng);
  });

  it("draws the same sequence for the same rng state", () => {
    const first = nextRandom(4_242);
    const second = nextRandom(4_242);
    assert.deepEqual(first, second);
    assert.equal(first.value >= 0 && first.value < 1, true);
    assert.notEqual(nextRandom(first.rng).value, first.value);
  });

  it("reports a full board instead of inventing a cell", () => {
    const full = Array.from({ length: 4 }, (_, y) =>
      Array.from({ length: 4 }, (_, x) => ({ x, y })),
    ).flat();
    assert.equal(randomFreeCell(1, 4, full), null);
  });
});

describe("stepGame", () => {
  it("moves the head one cell and drops the tail", () => {
    const moved = stepGame(state(), "right");
    assert.deepEqual(moved.body, [
      { x: 4, y: 3 },
      { x: 3, y: 3 },
      { x: 2, y: 3 },
    ]);
    assert.equal(moved.steps, 1);
    assert.equal(moved.status, "running");
    assert.equal(moved.direction, "right");
  });

  it("ends the round at a wall without moving the snake", () => {
    const atEdge = state({
      body: [
        { x: 0, y: 3 },
        { x: 1, y: 3 },
        { x: 2, y: 3 },
      ],
      direction: "left",
    });
    const dead = stepGame(atEdge, "left");
    assert.equal(dead.status, "over");
    assert.equal(dead.endReason, "wall");
    assert.deepEqual(dead.body, atEdge.body);
    assert.equal(dead.steps, 1);
  });

  it("ends the round when the head enters its own body", () => {
    const tangled = state({
      body: [
        { x: 3, y: 3 },
        { x: 3, y: 4 },
        { x: 4, y: 4 },
        { x: 4, y: 3 },
        { x: 4, y: 2 },
      ],
      direction: "down",
    });
    const dead = stepGame(tangled, "right");
    assert.equal(dead.status, "over");
    assert.equal(dead.endReason, "self");
  });

  it("treats the cell the tail is vacating as free, but only without eating", () => {
    const chasing = state({
      body: [
        { x: 3, y: 3 },
        { x: 2, y: 3 },
        { x: 2, y: 4 },
        { x: 3, y: 4 },
      ],
      direction: "down",
    });
    const followed = stepGame(chasing, "down");
    assert.equal(followed.status, "running");
    assert.deepEqual(followed.body[0], { x: 3, y: 4 });
  });

  it("grows, scores, and respawns food off the body when eating", () => {
    const hungry = state({ food: { x: 4, y: 3 } });
    const fed = stepGame(hungry, "right");
    assert.equal(fed.body.length, hungry.body.length + 1);
    assert.equal(fed.eaten, 1);
    assert.equal(fed.score, 10);
    assert.equal(
      fed.body.some((segment) => segment.x === fed.food.x && segment.y === fed.food.y),
      false,
    );
    assert.notEqual(fed.rng, hungry.rng);
  });

  it("stops at the step cap so a round can never run forever", () => {
    const almost = state({ steps: MAX_STEPS - 1 });
    const capped = stepGame(almost, "right");
    assert.equal(capped.steps, MAX_STEPS);
    assert.equal(capped.status, "over");
    assert.equal(capped.endReason, "step_limit");
  });

  it("still credits and respawns the food eaten on the last allowed step", () => {
    // The reported inconsistency: the tick ate, so it grew — but the cap threw
    // the score away and left the food under the head.
    const almost = state({ steps: MAX_STEPS - 1, food: { x: 4, y: 3 } });
    const fed = stepGame(almost, "right");
    assert.equal(fed.steps, MAX_STEPS);
    assert.equal(fed.status, "over");
    assert.equal(fed.endReason, "step_limit");
    assert.equal(fed.body.length, almost.body.length + 1);
    assert.deepEqual(fed.body[0], { x: 4, y: 3 });
    assert.equal(fed.score, FOOD_SCORE);
    assert.equal(fed.eaten, 1);
    assert.equal(samePoint(fed.food, fed.body[0]), false, "food must not sit under the head");
    assert.equal(
      fed.body.some((segment) => samePoint(segment, fed.food)),
      false,
      "food must not spawn on the snake",
    );
    assert.notEqual(fed.rng, almost.rng, "the respawn consumed a draw");
  });

  it("calls the last allowed step a filled board when it fills the board", () => {
    const almost = state({
      grid: 2,
      body: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
      ],
      direction: "down",
      food: { x: 0, y: 1 },
      steps: MAX_STEPS - 1,
    });
    const full = stepGame(almost, "down");
    assert.equal(full.steps, MAX_STEPS);
    assert.equal(full.status, "over");
    assert.equal(full.endReason, "filled");
    assert.equal(full.body.length, 4);
    assert.equal(full.score, FOOD_SCORE);
    assert.equal(full.eaten, 1);
  });

  it("ignores further moves once the round is over", () => {
    const dead = state({ status: "over", endReason: "wall" });
    assert.deepEqual(stepGame(dead, "right"), dead);
  });

  it("keeps heading and position deterministic for a fixed direction sequence", () => {
    const script = ["right", "down", "left", "up", "right", "right"] as const;
    const run = () =>
      script.reduce((game, direction) => stepGame(game, direction), createGame({ seed: 3 }));
    assert.deepEqual(run(), run());
  });
});
