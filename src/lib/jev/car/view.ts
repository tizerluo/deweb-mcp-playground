/**
 * The car's decision, in the vocabulary the shared decision stream renders.
 *
 * Pure and outside the component for two reasons: the stream wants one
 * `DecisionView` whatever decided (see `@/lib/jev/decision`), and this mapping
 * has rules worth testing without a browser — above all that a timeout says
 * which branch actually ran, a held action or the local policy.
 */
import type { DecisionView } from "../decision.ts";
import { actionLabel } from "./engine.ts";
import type { CarDecision } from "./controller.ts";

/**
 * The status badge key for one car decision. One key per `DecisionStatus`,
 * except a timeout, which gets a key per branch: `timeout_hold` replays the
 * previous action, `timeout_local` is the local policy driving. The plain
 * `jev.car.state.timeout` stays as the wording for a timeout whose branch is
 * not recorded — it claims nothing about what was driven.
 */
export function carStatusKey(decision: Pick<CarDecision, "status" | "timeoutMode">): string {
  if (decision.status === "timeout" && decision.timeoutMode) {
    return `jev.car.state.timeout_${decision.timeoutMode}`;
  }
  return `jev.car.state.${decision.status}`;
}

/** The car's decision in the vocabulary the shared stream renders. */
export function carDecisionView(decision: CarDecision): DecisionView {
  return {
    source: decision.source,
    status: decision.status,
    statusKey: carStatusKey(decision),
    reason: decision.reason,
    // The action that was actually played. It is one of the ten offered labels
    // when JEV picked one; a local fallback steers continuously, so its label
    // names the level it sits in and the tick carries its own rollout — the
    // metrics on show are never another action's.
    pick: actionLabel(decision.action),
    rawChoice: decision.rawChoice,
    latencyMs: decision.latencyMs,
    confidence: decision.confidence,
    cached: decision.cached,
  };
}
