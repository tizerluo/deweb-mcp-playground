/**
 * Board analysis — the code decides the facts first (what is legal, how far the
 * food is, how much open space each move keeps, whether a move walks into a
 * pocket), and JEV only picks between the legal moves. Pure functions over the
 * engine state; the grid is small (12×12), so four flood fills per tick is
 * nothing.
 */
import {
  DELTA,
  DIRECTIONS,
  cellKey,
  headOf,
  inBounds,
  samePoint,
  type Direction,
  type GameState,
  type Point,
} from "./engine.ts";

export type MoveFacts = {
  direction: Direction;
  /** No wall and no body in the target cell. */
  safe: boolean;
  /** Short English phrase, sent to JEV as the option's description. */
  note: string;
  /** Steps from the target cell to the food through free cells, or null. */
  foodDistance: number | null;
  /** Free cells reachable from the target cell (including it). */
  reachable: number;
  /** Reachable space cannot hold the whole snake — entering it is a trap. */
  deadEnd: boolean;
};

export type BoardAnalysis = {
  head: Point;
  legal: Direction[];
  facts: Record<Direction, MoveFacts>;
  straight: Direction;
  /** Straight when legal, else the roomiest legal move; null when stuck. */
  fallback: Direction | null;
};

type Region = { size: number; distanceTo: (p: Point) => number | null };

/** Flood fill from `start` through cells that are not in `blocked`. */
function regionFrom(grid: number, blocked: Set<string>, start: Point): Region {
  const distances = new Map<string, number>();
  const queue: Point[] = [start];
  distances.set(cellKey(start), 0);
  for (let i = 0; i < queue.length; i += 1) {
    const cell = queue[i];
    const from = distances.get(cellKey(cell)) ?? 0;
    for (const direction of DIRECTIONS) {
      const next: Point = {
        x: cell.x + DELTA[direction].x,
        y: cell.y + DELTA[direction].y,
      };
      const key = cellKey(next);
      if (!inBounds(next, grid) || blocked.has(key) || distances.has(key)) continue;
      distances.set(key, from + 1);
      queue.push(next);
    }
  }
  return {
    size: distances.size,
    distanceTo: (p: Point) => distances.get(cellKey(p)) ?? null,
  };
}

export function analyzeBoard(state: GameState): BoardAnalysis {
  const head = headOf(state);
  // The tail cell empties this tick unless the snake eats — and food is never
  // on a body cell — so the tail is not a barrier. Same rule the engine uses.
  const blocked = new Set(state.body.slice(0, -1).map(cellKey));
  const facts = {} as Record<Direction, MoveFacts>;
  const legal: Direction[] = [];

  for (const direction of DIRECTIONS) {
    const target: Point = {
      x: head.x + DELTA[direction].x,
      y: head.y + DELTA[direction].y,
    };
    if (!inBounds(target, state.grid)) {
      facts[direction] = {
        direction,
        safe: false,
        note: "off the grid",
        foodDistance: null,
        reachable: 0,
        deadEnd: false,
      };
      continue;
    }
    if (blocked.has(cellKey(target))) {
      facts[direction] = {
        direction,
        safe: false,
        note: "into its own body",
        foodDistance: null,
        reachable: 0,
        deadEnd: false,
      };
      continue;
    }
    const region = regionFrom(state.grid, blocked, target);
    const foodDistance = region.distanceTo(state.food);
    const deadEnd = region.size <= state.body.length;
    const parts = [
      foodDistance === null ? "food not reachable" : `${foodDistance} cells to the food`,
      `${region.size} free cells reachable`,
    ];
    if (deadEnd) parts.push("space smaller than the snake");
    facts[direction] = {
      direction,
      safe: true,
      note: parts.join(", "),
      foodDistance,
      reachable: region.size,
      deadEnd,
    };
    legal.push(direction);
  }

  const straight = state.direction;
  const roomiest = [...legal].sort(
    (a, b) =>
      facts[b].reachable - facts[a].reachable || DIRECTIONS.indexOf(a) - DIRECTIONS.indexOf(b),
  )[0];
  const fallback = legal.includes(straight) ? straight : (roomiest ?? null);

  return { head, legal, facts, straight, fallback };
}

/** Sanity helper used by the UI legend and the tests. */
export function isLegalDirection(analysis: BoardAnalysis, value: unknown): value is Direction {
  return typeof value === "string" && analysis.legal.includes(value as Direction);
}

/** Food position relative to the head, for the canvas legend. */
export function foodDelta(state: GameState): { dx: number; dy: number } {
  const head = headOf(state);
  return { dx: state.food.x - head.x, dy: state.food.y - head.y };
}

export function sameCell(a: Point, b: Point): boolean {
  return samePoint(a, b);
}
