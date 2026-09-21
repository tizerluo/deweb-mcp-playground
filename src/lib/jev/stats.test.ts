/**
 * The round counters behind the JEV demos' statistics.
 *
 * The demo keeps at most 120 decision rows, and the page used to compute
 * "ticks", "JEV answered" and "round spend" by filtering that list: after 120
 * steps the totals silently froze, and the spend stopped describing the round.
 * These counters are recorded per decision instead, so the assertions below run
 * 300 decisions through a 3-row view and the totals still describe all 300.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { DecisionStatus } from "./decision.ts";
import {
  EMPTY_STATS,
  averageLatencyMs,
  recordDecision,
  recordLateReply,
  type RoundStats,
} from "./stats.ts";

type Settled = Parameters<typeof recordDecision>[1];

function decide(stats: RoundStats, input: Settled): RoundStats {
  return recordDecision(stats, input);
}

describe("round statistics", () => {
  it("counts a full round, not the rows a capped list happened to keep", () => {
    let stats = EMPTY_STATS;
    for (let i = 0; i < 300; i += 1) {
      stats = decide(stats, {
        status: "answered",
        source: "jev",
        charge: 0.01,
        latencyMs: 100 + (i % 5) * 10,
      });
    }
    assert.equal(stats.ticks, 300);
    assert.equal(stats.replied, 300);
    assert.equal(stats.adopted, 300);
    assert.equal(stats.latencyCount, 300);
    // 300 × 0.01 — counted in full, and off float noise.
    assert.equal(stats.spent, 3);
    assert.equal(averageLatencyMs(stats), 120);
  });

  it("counts a reply JEV gave but the demo did not adopt: illegal is still an answer", () => {
    let stats = EMPTY_STATS;
    stats = decide(stats, { status: "illegal", source: "local", charge: 0.01, latencyMs: 220 });
    stats = decide(stats, { status: "answered", source: "jev", charge: 0.01, latencyMs: 180 });
    assert.equal(stats.ticks, 2);
    assert.equal(stats.replied, 2, "the illegal answer came from JEV");
    assert.equal(stats.adopted, 1, "only the legal answer was adopted");
    assert.equal(stats.byStatus.illegal, 1);
    assert.equal(stats.byStatus.answered, 1);
  });

  it("does not count a tick that never reached JEV as a reply", () => {
    let stats = EMPTY_STATS;
    stats = decide(stats, { status: "timeout", source: "local", charge: 0, latencyMs: null });
    stats = decide(stats, {
      status: "degraded",
      source: "local",
      charge: 0,
      latencyMs: 42,
      // A degraded tick is a failed call: nothing was answered, nothing was spent.
    });
    stats = decide(stats, { status: "forced", source: "local", charge: 0, latencyMs: null });
    assert.equal(stats.ticks, 3);
    assert.equal(stats.replied, 0);
    assert.equal(stats.adopted, 0);
    assert.equal(stats.spent, 0);
    assert.equal(stats.byStatus.timeout, 1);
    assert.equal(stats.byStatus.degraded, 1);
    assert.equal(stats.byStatus.forced, 1);
    assert.equal(averageLatencyMs(stats), 42, "a failed call still has a latency");
  });

  it("charges only what left the wallet: a refunded escrow is not a spend", () => {
    let stats = EMPTY_STATS;
    stats = decide(stats, { status: "degraded", source: "local", charge: 0, latencyMs: null });
    assert.equal(stats.spent, 0);
    stats = decide(stats, { status: "answered", source: "jev", charge: 0.01, latencyMs: 10 });
    assert.equal(stats.spent, 0.01);
  });

  it("records a late reply as money moved and a reply received, and nothing else", () => {
    let stats = decide(EMPTY_STATS, {
      status: "timeout",
      source: "local",
      charge: 0,
      latencyMs: null,
    });
    stats = recordLateReply(stats, { ok: true, charge: 0.01 });
    assert.equal(stats.ticks, 1, "the tick was already counted");
    assert.equal(stats.replied, 1);
    assert.equal(stats.adopted, 0, "the window was already driven");
    assert.equal(stats.spent, 0.01);
    // A late failure moved no money and answered nothing.
    stats = recordLateReply(stats, { ok: false, charge: 0 });
    assert.equal(stats.replied, 1);
    assert.equal(stats.spent, 0.01);
  });

  it("has no average before a reply carries a latency", () => {
    assert.equal(averageLatencyMs(EMPTY_STATS), null);
    const stats = decide(EMPTY_STATS, {
      status: "forced",
      source: "local",
      charge: 0,
      latencyMs: null,
    });
    assert.equal(averageLatencyMs(stats), null);
  });

  it("never mutates the stats it was handed", () => {
    const before = decide(EMPTY_STATS, {
      status: "answered",
      source: "jev",
      charge: 0.01,
      latencyMs: 50,
    });
    const snapshot = JSON.stringify(before);
    const after = decide(before, {
      status: "timeout",
      source: "local",
      charge: 0,
      latencyMs: null,
    });
    assert.equal(JSON.stringify(before), snapshot);
    assert.equal(after.ticks, 2);
    assert.equal(before.ticks, 1);
    assert.equal(EMPTY_STATS.ticks, 0, "the empty value is shared and must stay empty");
  });

  it("covers every status the demo can settle on", () => {
    const seen: DecisionStatus[] = ["answered", "forced", "timeout", "illegal", "degraded"];
    for (const status of seen) {
      const stats = decide(EMPTY_STATS, { status, source: "local", charge: 0, latencyMs: null });
      assert.equal(stats.byStatus[status], 1, status);
    }
    assert.equal(Object.keys(EMPTY_STATS.byStatus).length, seen.length);
  });
});
