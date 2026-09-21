/**
 * Snake engine — pure functions over an immutable game state, no timers and no
 * randomness outside the seeded RNG carried in the state. Every round is
 * reproducible from its seed, which is what lets the tests (and the reviewer's
 * mutation checks) pin behaviour down.
 */

export type Direction = "up" | "down" | "left" | "right";
export type Point = { x: number; y: number };

/** Fixed iteration order — analysis and tests both rely on it. */
export const DIRECTIONS: readonly Direction[] = ["up", "right", "down", "left"] as const;
export const DELTA: Record<Direction, Point> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};
export const OPPOSITE: Record<Direction, Direction> = {
  up: "down",
  down: "up",
  left: "right",
  right: "left",
};

export const DEFAULT_GRID = 12;
export const START_LENGTH = 3;
export const FOOD_SCORE = 10;
/** Hard cap so a round can never run forever, however well the pilot plays. */
export const MAX_STEPS = 400;

export type EndReason = "wall" | "self" | "step_limit" | "filled";

export type GameState = {
  grid: number;
  /** Head first; the tail is the last entry. */
  body: Point[];
  direction: Direction;
  food: Point;
  score: number;
  eaten: number;
  steps: number;
  /** RNG carried in the state so food spawning stays reproducible. */
  rng: number;
  status: "running" | "over";
  endReason: EndReason | null;
};

export function samePoint(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y;
}

export function cellKey(p: Point): string {
  return `${p.x},${p.y}`;
}

export function inBounds(p: Point, grid: number): boolean {
  return p.x >= 0 && p.y >= 0 && p.x < grid && p.y < grid;
}

export function headOf(state: GameState): Point {
  const head = state.body[0];
  if (!head) throw new Error("snake has no body");
  return head;
}

/** mulberry32 — 32-bit state, one draw per call, returns the next state. */
export function nextRandom(rng: number): { value: number; rng: number } {
  const state = (rng + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { value: ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296, rng: state };
}

/** Uniformly pick a free cell; `null` when the board is full. */
export function randomFreeCell(
  rng: number,
  grid: number,
  body: Point[],
): { cell: Point; rng: number } | null {
  const taken = new Set(body.map(cellKey));
  const free: Point[] = [];
  for (let y = 0; y < grid; y += 1) {
    for (let x = 0; x < grid; x += 1) {
      if (!taken.has(cellKey({ x, y }))) free.push({ x, y });
    }
  }
  if (free.length === 0) return null;
  const draw = nextRandom(rng);
  const index = Math.min(free.length - 1, Math.floor(draw.value * free.length));
  return { cell: free[index], rng: draw.rng };
}

export function createGame(opts: { seed: number; grid?: number }): GameState {
  const grid = opts.grid ?? DEFAULT_GRID;
  const cx = Math.floor(grid / 2);
  const cy = Math.floor(grid / 2);
  const body: Point[] = [];
  for (let i = 0; i < START_LENGTH; i += 1) {
    body.push({ x: cx - i, y: cy });
  }
  const rng = opts.seed >>> 0;
  const spawned = randomFreeCell(rng, grid, body);
  return {
    grid,
    body,
    direction: "right",
    food: spawned?.cell ?? { x: 0, y: 0 },
    score: 0,
    eaten: 0,
    steps: 0,
    rng: spawned?.rng ?? rng,
    status: "running",
    endReason: null,
  };
}

/**
 * One tick: move one cell in `direction`. Walls and self-collisions end the
 * round; food grows the snake and scores. Moving onto the cell the tail is
 * vacating this same tick is legal (the tail leaves before the head arrives),
 * so the tail is excluded from the barrier — only when not eating, which is
 * exactly when the tail actually moves.
 */
export function stepGame(state: GameState, direction: Direction): GameState {
  if (state.status !== "running") return state;
  const head = headOf(state);
  const next: Point = {
    x: head.x + DELTA[direction].x,
    y: head.y + DELTA[direction].y,
  };
  const steps = state.steps + 1;

  if (!inBounds(next, state.grid)) {
    return { ...state, direction, steps, status: "over", endReason: "wall" };
  }

  const eats = samePoint(next, state.food);
  const barrier = eats ? state.body : state.body.slice(0, -1);
  if (barrier.some((segment) => samePoint(segment, next))) {
    return { ...state, direction, steps, status: "over", endReason: "self" };
  }

  const body = eats ? [next, ...state.body] : [next, ...state.body.slice(0, -1)];

  // The step settles in full first — growth, score, respawned food — and only
  // then may the step cap end the round: the last allowed move still counts as
  // played, so it must not lose its point, and the food it ate must never be
  // left sitting under the head.
  let food = state.food;
  let rng = state.rng;
  let score = state.score;
  let eaten = state.eaten;
  if (eats) {
    score += FOOD_SCORE;
    eaten += 1;
    const spawned = randomFreeCell(state.rng, state.grid, body);
    if (!spawned) {
      // Nothing left to spawn: the board is full, which is its own ending.
      return {
        ...state,
        body,
        direction,
        steps,
        score,
        eaten,
        status: "over",
        endReason: "filled",
      };
    }
    food = spawned.cell;
    rng = spawned.rng;
  }

  if (steps >= MAX_STEPS) {
    return {
      ...state,
      body,
      direction,
      steps,
      food,
      rng,
      score,
      eaten,
      status: "over",
      endReason: "step_limit",
    };
  }
  return { ...state, body, direction, steps, food, rng, score, eaten };
}
