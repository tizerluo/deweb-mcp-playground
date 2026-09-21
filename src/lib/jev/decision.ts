/**
 * The vocabulary both JEV demos share. The snake decides a direction, the car
 * decides an action, but what came back from JEV, what a settled decision can
 * carry and what one decision's TAP-10 round trip looks like are the same
 * shapes — which is what lets the decision stream and the message strip be a
 * single pair of components instead of two near-identical copies.
 *
 * Pure types, no runtime: the loops, the components and the tests all name
 * these instead of redeclaring them.
 */
import type { JevDecisionReason } from "./protocol.ts";

/**
 * How a decision was reached: JEV answered and it was played; the rules left
 * exactly one option; nothing arrived in time; JEV named something that was not
 * on offer; or the call failed and a local policy took over.
 */
export type DecisionStatus = "answered" | "forced" | "timeout" | "illegal" | "degraded";

/**
 * The status badge key per decision status, written out rather than built from
 * `"jev.state" + "." + status`: literal keys are what the language-parity test
 * can check, and there is one less string to keep in step with the tables.
 */
export const STATUS_KEY: Record<DecisionStatus, string> = {
  answered: "jev.state.answered",
  forced: "jev.state.forced",
  timeout: "jev.state.timeout",
  illegal: "jev.state.illegal",
  degraded: "jev.state.degraded",
};

/** What the caller got back from JEV (or not) before its decision point. */
export type JevOutcome =
  | {
      ok: true;
      choice: string | null;
      confidence: number | null;
      probabilities: Record<string, number> | null;
      latencyMs: number;
      model: string;
      cached: boolean;
    }
  | { ok: false; reason: JevDecisionReason; latencyMs: number; message?: string };

/**
 * One JEV decision as a demo loop needs it — the store's `JevRound`, applied
 * structurally so neither loop (nor the components) has to import the store.
 */
export type JevRound = {
  ok: boolean;
  reason: JevDecisionReason | null;
  message: string;
  answers: Record<string, unknown> | null;
  model: string | null;
  latencyMs: number;
  /** BEM that actually left the wallet (0 when the escrow was refunded). */
  charge: number;
  cached: boolean;
  envelope: {
    requestId: string;
    from: string;
    to: string;
    block: number;
    paidBem: number;
    reqDigest: string;
    resDigest: string | null;
  };
};

/**
 * The display fields a decision stream renders, whatever was decided. Each demo
 * maps its own decision onto this (`pick` is a snake direction or a car action
 * label), so the stream itself stays demo-agnostic.
 */
export type DecisionView = {
  source: "jev" | "local";
  status: DecisionStatus;
  /**
   * Exact i18n key for the status badge, when a demo needs finer words than
   * one key per `DecisionStatus` — a car timeout that held the last action
   * reads differently from one where the local policy took over. Left out, the
   * stream falls back to its `<prefix>.<status>` default.
   */
  statusKey?: string;
  reason: JevDecisionReason | null;
  /** The option that was actually played. */
  pick: string | null;
  /** What JEV answered when it could not be played. */
  rawChoice: string | null;
  latencyMs: number | null;
  confidence: number | null;
  cached: boolean;
};
