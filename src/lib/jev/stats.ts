/**
 * One demo round's totals.
 *
 * The decision rows a demo keeps are a ring buffer (the newest 120): fine for
 * the stream, fatal for a counter — "ticks", "JEV answered" and "round spend"
 * used to be recomputed from that list, so every round silently froze at 120
 * ticks and the spend stopped meaning the round. These counters are recorded
 * as each decision settles and never truncate; the list stays a view.
 *
 * Pure on purpose: the loops own the clock and the state, this owns the
 * arithmetic, and the arithmetic is what the tests pin down.
 */
import type { DecisionStatus } from "./decision.ts";

export type RoundStats = {
  /** Decisions settled this round. */
  ticks: number;
  /** Replies received from JEV, played or not — an illegal answer is still an answer. */
  replied: number;
  /** Ticks whose move was JEV's own pick. */
  adopted: number;
  /** BNB that actually left the wallet this round (a refunded escrow is not a spend). */
  spent: number;
  latencySum: number;
  /** Replies that carried a latency number (the average's denominator). */
  latencyCount: number;
  byStatus: Record<DecisionStatus, number>;
};

export const EMPTY_STATS: RoundStats = {
  ticks: 0,
  replied: 0,
  adopted: 0,
  spent: 0,
  latencySum: 0,
  latencyCount: 0,
  byStatus: { answered: 0, forced: 0, timeout: 0, illegal: 0, degraded: 0 },
};

/** A settled decision, as the stream and the counters both see it. */
export type SettledDecision = {
  status: DecisionStatus;
  source: "jev" | "local";
  /** BNB charged for this decision (0 when nothing was sent, or the escrow was refunded). */
  charge: number;
  latencyMs: number | null;
};

export function recordDecision(stats: RoundStats, decision: SettledDecision): RoundStats {
  const replied = decision.status === "answered" || decision.status === "illegal";
  return {
    ticks: stats.ticks + 1,
    replied: stats.replied + (replied ? 1 : 0),
    adopted: stats.adopted + (decision.source === "jev" ? 1 : 0),
    spent: roundBem(stats.spent + decision.charge),
    latencySum: stats.latencySum + (decision.latencyMs ?? 0),
    latencyCount: stats.latencyCount + (decision.latencyMs === null ? 0 : 1),
    byStatus: { ...stats.byStatus, [decision.status]: stats.byStatus[decision.status] + 1 },
  };
}

/**
 * A reply that landed after its window had been driven: it is not adopted (the
 * window already ran) but it did arrive, and it did move the wallet.
 */
export function recordLateReply(
  stats: RoundStats,
  reply: { ok: boolean; charge: number },
): RoundStats {
  return {
    ...stats,
    replied: stats.replied + (reply.ok ? 1 : 0),
    spent: roundBem(stats.spent + reply.charge),
  };
}

export function averageLatencyMs(stats: RoundStats): number | null {
  if (stats.latencyCount === 0) return null;
  return Math.round(stats.latencySum / stats.latencyCount);
}

/** BNB is a currency: keep the counters off float noise. */
function roundBem(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
