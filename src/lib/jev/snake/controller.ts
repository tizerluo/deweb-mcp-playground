/**
 * Decision resolution — the fixed-clock contract, made pure so it can be
 * tested without timers: at tick start the caller asks (or skips asking when
 * the move is forced); at tick end the caller hands over whatever answer
 * exists, and this decides what the snake does.
 *
 * Rules, in order: no legal move → the round is over anyway; exactly one legal
 * move → forced, no call; no answer yet → straight (the documented timeout
 * policy); an answer that names an illegal move → straight, recorded; a failed
 * call → local policy, with the machine reason kept for the UI.
 */
import type { DecisionStatus, JevOutcome } from "../decision.ts";
import type { JevDecisionReason } from "../protocol.ts";
import type { BoardAnalysis } from "./analysis.ts";
import type { Direction } from "./engine.ts";

/**
 * The JEV answer shape and the status vocabulary are shared with the car demo
 * (`../decision.ts`); re-exported here so this module stays the one place the
 * snake's callers import its decision types from.
 */
export type { DecisionStatus, JevOutcome };

export type SnakeDecision = {
  direction: Direction;
  source: "jev" | "local";
  status: DecisionStatus;
  /** Machine reason for a degraded tick; the UI localizes it. */
  reason: JevDecisionReason | null;
  /** The pick JEV returned, even when it was illegal. */
  rawChoice: string | null;
  confidence: number | null;
  probabilities: Record<string, number> | null;
  latencyMs: number | null;
  model: string | null;
  cached: boolean;
};

/** Straight when the rules allow it, else the roomiest legal move. */
export function localDirection(analysis: BoardAnalysis): Direction {
  if (analysis.legal.includes(analysis.straight)) return analysis.straight;
  return analysis.fallback ?? analysis.straight;
}

export function resolveSnakeDecision(args: {
  analysis: BoardAnalysis;
  answer: JevOutcome | null;
}): SnakeDecision {
  const { analysis, answer } = args;
  const base: Omit<SnakeDecision, "direction" | "source" | "status"> = {
    reason: null,
    rawChoice: null,
    confidence: null,
    probabilities: null,
    latencyMs: null,
    model: null,
    cached: false,
  };

  if (analysis.legal.length === 0) {
    return { ...base, direction: analysis.straight, source: "local", status: "forced" };
  }
  if (analysis.legal.length === 1) {
    const only = analysis.legal[0];
    return {
      ...base,
      direction: only,
      source: "local",
      status: "forced",
      rawChoice: only,
      reason: null,
    };
  }

  if (answer === null) {
    return {
      ...base,
      direction: localDirection(analysis),
      source: "local",
      status: "timeout",
    };
  }

  if (!answer.ok) {
    return {
      ...base,
      direction: localDirection(analysis),
      source: "local",
      status: "degraded",
      reason: answer.reason,
      latencyMs: answer.latencyMs,
    };
  }

  const picked = answer.choice;
  const legal = picked !== null && analysis.legal.includes(picked as Direction);
  if (!legal) {
    return {
      ...base,
      direction: localDirection(analysis),
      source: "local",
      status: "illegal",
      rawChoice: picked,
      confidence: answer.confidence,
      probabilities: answer.probabilities,
      latencyMs: answer.latencyMs,
      model: answer.model,
      cached: answer.cached,
    };
  }

  return {
    direction: picked as Direction,
    source: "jev",
    status: "answered",
    reason: null,
    rawChoice: picked,
    confidence: answer.confidence,
    probabilities: answer.probabilities,
    latencyMs: answer.latencyMs,
    model: answer.model,
    cached: answer.cached,
  };
}
