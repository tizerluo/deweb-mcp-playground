/**
 * Question construction — turn the analysed board into one JEV `choice`
 * question whose options are exactly the legal moves. A question with fewer
 * than two options is never sent: one legal move is forced by the rules (the
 * model would be paid to repeat the code's answer) and zero means the round is
 * ending anyway.
 *
 * Pattern (fixed clock, one choice per tick, code computes the facts) is
 * inspired by github.com/sorrycc/typesafe-snake; this implementation is
 * written from scratch against the TypeSafe wire format.
 */
import type { JevRequest } from "../protocol.ts";
import type { BoardAnalysis } from "./analysis.ts";
import type { Direction, GameState } from "./engine.ts";

export const SNAKE_QUESTION = "direction";

const INSTRUCTIONS = [
  "You pilot a snake in a grid arcade game.",
  "Each tick the snake moves exactly one cell in the direction you choose.",
  "Leaving the grid or touching the snake's own body ends the round.",
  "Eating food grows the snake by one cell and scores points.",
  "Prefer the move that keeps the snake alive longest and still reaches the food.",
  "Each option's description holds the facts already computed for that move:",
  "distance to the food, free cells still reachable after the move, and whether",
  "that space is smaller than the snake itself.",
].join(" ");

/** Compact summary of everything the decision depends on. */
export function snakeStateSummary(state: GameState, analysis: BoardAnalysis): string {
  const moves: Record<string, string> = {};
  for (const direction of analysis.legal) {
    const facts = analysis.facts[direction];
    moves[direction] = [
      facts.foodDistance === null ? "food unreachable" : `${facts.foodDistance} to food`,
      `${facts.reachable} reachable`,
      facts.deadEnd ? "pocket too small" : "room to move",
    ].join("; ");
  }
  return JSON.stringify({
    game: "snake",
    grid: `${state.grid}x${state.grid}`,
    step: state.steps,
    head: [analysis.head.x, analysis.head.y],
    heading: state.direction,
    length: state.body.length,
    score: state.score,
    food: [state.food.x, state.food.y],
    legal_moves: analysis.legal,
    moves,
  });
}

/** The request, or null when the code should answer this tick by itself. */
export function buildSnakeRequest(state: GameState, analysis: BoardAnalysis): JevRequest | null {
  if (analysis.legal.length < 2) return null;
  const criteria: Record<string, string> = {};
  for (const direction of analysis.legal) {
    criteria[direction] = analysis.facts[direction].note;
  }
  return {
    kind: "choice",
    state: snakeStateSummary(state, analysis),
    questions: {
      [SNAKE_QUESTION]: {
        type: "choice",
        instructions: INSTRUCTIONS,
        criteria,
      },
    },
  };
}

/** Read the pick out of an answer map without trusting its shape. */
export function readSnakeChoice(answers: Record<string, unknown>): {
  choice: string | null;
  confidence: number | null;
  probabilities: Record<string, number> | null;
} {
  const raw = answers[SNAKE_QUESTION];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { choice: null, confidence: null, probabilities: null };
  }
  const answer = raw as Record<string, unknown>;
  if (answer.type !== "choice") {
    return { choice: null, confidence: null, probabilities: null };
  }
  const probabilities: Record<string, number> = {};
  if (
    answer.probabilities &&
    typeof answer.probabilities === "object" &&
    !Array.isArray(answer.probabilities)
  ) {
    for (const [key, value] of Object.entries(answer.probabilities as Record<string, unknown>)) {
      if (typeof value === "number" && Number.isFinite(value)) probabilities[key] = value;
    }
  }
  return {
    choice: typeof answer.choice === "string" ? answer.choice : null,
    confidence: typeof answer.confidence === "number" ? answer.confidence : null,
    probabilities: Object.keys(probabilities).length > 0 ? probabilities : null,
  };
}

/** Fixed order for rendering a probability row. */
export function probabilityRows(
  probabilities: Record<string, number> | null,
  legal: Direction[],
): { label: string; value: number }[] {
  if (!probabilities) return [];
  const labels = [...new Set([...legal, ...Object.keys(probabilities)])];
  return labels.map((label) => ({ label, value: probabilities[label] ?? 0 }));
}
