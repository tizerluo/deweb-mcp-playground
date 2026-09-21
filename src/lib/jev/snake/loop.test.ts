/**
 * Loop-level lifecycle regression: the tick loop owns the rules Pause / Reset /
 * a new round are supposed to follow, and it takes its clock and sleep through
 * the port, so every one of those rules is exercised here by hand.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createGame, type GameState } from "./engine.ts";
import {
  TICK_WAIT_CAP_MS,
  createSnakeRunner,
  type SnakeLoopPort,
  type SnakeRound,
  type SnakeTick,
} from "./loop.ts";
import type { JevRequest } from "../protocol.ts";

/** A tick of the event loop: every microtask chained after `sleep` has run. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

/** An answered round; overrides reach the fields the case at hand cares about. */
function round(overrides: Partial<SnakeRound> = {}): SnakeRound {
  return {
    ok: true,
    reason: null,
    message: "",
    answers: {
      direction: { type: "choice", choice: "up", confidence: 0.9, probabilities: { up: 0.9 } },
    },
    model: "jev-1.13.0",
    latencyMs: 120,
    charge: 0.01,
    cached: false,
    envelope: {
      requestId: "req-1",
      from: "#8801@0",
      to: "#9104@0",
      block: 7,
      paidBem: 0.01,
      reqDigest: "ab",
      resDigest: "cd",
    },
    ...overrides,
  };
}

/** The demo's port, with the clock and every await under the test's control. */
function harness(
  opts: {
    game?: GameState;
    speedMs?: number;
    decide?: (request: JevRequest) => Promise<SnakeRound | null>;
  } = {},
) {
  let game = opts.game ?? createGame({ seed: 7 });
  let seed = 7;
  let clock = 0;
  const answers: Array<(round: SnakeRound | null) => void> = [];
  const sleepers: Array<{ ms: number; resolve: () => void }> = [];
  const requests: JevRequest[] = [];
  const waits: number[] = [];
  const rows: SnakeTick[] = [];
  const rowIds: string[] = [];
  const patches: { rowId: string; round: SnakeRound }[] = [];
  const runningFlags: boolean[] = [];

  const port: SnakeLoopPort = {
    getGame: () => game,
    newRound: () => {
      seed += 1;
      game = createGame({ seed });
      rows.length = 0;
      return game;
    },
    getSpeedMs: () => opts.speedMs ?? 900,
    decide: (request) => {
      requests.push(request);
      if (opts.decide) return opts.decide(request);
      return new Promise<SnakeRound | null>((resolve) => answers.push(resolve));
    },
    noteWait: (ms) => waits.push(ms),
    commitTick: (tick) => {
      const rowId = `row-${tick.game.steps}`;
      rows.push(tick);
      rowIds.push(rowId);
      game = tick.game;
      return rowId;
    },
    patchTick: (rowId, late) => patches.push({ rowId, round: late }),
    setRunning: (running) => runningFlags.push(running),
    now: () => clock,
    sleep: (ms) => new Promise<void>((resolve) => sleepers.push({ ms, resolve })),
  };

  return {
    port,
    runner: createSnakeRunner(port),
    requests,
    waits,
    rows,
    rowIds,
    patches,
    runningFlags,
    game: () => game,
    seed: () => seed,
    /** The tick in flight, still waiting for its round. */
    async answer(value: SnakeRound | null) {
      const resolve = answers.shift();
      assert.ok(resolve, "no decision in flight");
      resolve(value);
      // The round settles in its own microtasks, exactly as a real one does
      // while the tick is still waiting: the box must be filled before the
      // tick ends, or the answer would read as late.
      await settle();
    },
    /** Let the tick in flight end. */
    async wake() {
      const sleeper = sleepers.shift();
      assert.ok(sleeper, "no tick in flight");
      clock += sleeper.ms;
      sleeper.resolve();
      await settle();
    },
  };
}

describe("createSnakeRunner / lifecycle", () => {
  it("plays one tick per wait and adopts the answer that arrived in time", async () => {
    const h = harness();
    h.runner.start();
    assert.equal(h.requests.length, 1);
    assert.deepEqual(h.runningFlags, [true]);

    await h.answer(round({ answers: { direction: { type: "choice", choice: "right" } } }));
    await h.wake();

    assert.equal(h.rows.length, 1);
    const [tick] = h.rows;
    assert.equal(tick.decision.source, "jev");
    assert.equal(tick.decision.direction, "right");
    assert.equal(tick.round?.charge, 0.01);
    assert.equal(tick.request !== null, true);
    assert.equal(h.game().steps, 1);

    h.runner.pause();
  });

  it("starts / pauses idempotently and never runs two loops at once", async () => {
    const h = harness();
    h.runner.start();
    h.runner.start();
    assert.equal(h.requests.length, 1);
    assert.deepEqual(h.runningFlags, [true]);

    h.runner.pause();
    h.runner.pause();
    assert.deepEqual(h.runningFlags, [true, false]);

    // The tick that was in flight when Pause was pressed writes nothing.
    await h.answer(round());
    await h.wake();
    assert.equal(h.rows.length, 0);
    assert.equal(h.game().steps, 0);
  });

  it("sends nothing (and waits the picked speed) for a rules-forced move", async () => {
    const forced = createGame({ seed: 7 });
    const h = harness({
      game: {
        ...forced,
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
      },
    });
    h.runner.start();
    assert.equal(h.requests.length, 0);
    assert.deepEqual(h.waits, [900]);

    await h.wake();
    assert.equal(h.rows[0].request, null);
    assert.equal(h.rows[0].decision.status, "forced");
    assert.equal(h.rows[0].decision.direction, "down");
    h.runner.pause();
  });
});

describe("createSnakeRunner / Pause and Reset cancel the tick in flight", () => {
  it("Pause: the round that lands afterwards does not move the snake or log a row", async () => {
    const h = harness();
    h.runner.start();
    assert.equal(h.requests.length, 1);

    // The reader pauses while the tick is mid-flight, and the answer arrives
    // after it: this is the stale write the reviewer reproduced.
    h.runner.pause();
    await h.answer(round({ answers: { direction: { type: "choice", choice: "right" } } }));
    await h.wake();

    assert.deepEqual(h.runningFlags, [true, false]);
    assert.equal(h.rows.length, 0, "a paused tick must not append a decision row");
    assert.equal(h.game().steps, 0, "a paused tick must not advance the round");
    assert.deepEqual(h.patches, [], "a paused tick has no row to patch");
  });

  it("Pause then Resume keeps the round and drops only the cancelled tick", async () => {
    const h = harness();
    h.runner.start();
    h.runner.pause();
    await h.answer(round({ latencyMs: 1_250 }));
    await h.wake();
    assert.equal(h.game().steps, 0);

    h.runner.start();
    assert.equal(h.requests.length, 2);
    await h.answer(round({ answers: { direction: { type: "choice", choice: "up" } } }));
    await h.wake();

    assert.equal(h.rows.length, 1);
    assert.equal(h.game().steps, 1);
    assert.equal(h.seed(), 7, "Resume continues the same round");
    h.runner.pause();
  });

  it("Reset: the new round cannot be overwritten by the tick it cancelled", async () => {
    const h = harness();
    h.runner.start();
    assert.equal(h.game().steps, 0);

    h.runner.reset(); // new seed, cleared log
    const fresh = h.game();
    assert.equal(h.seed(), 8);
    assert.equal(fresh.steps, 0);
    assert.deepEqual(h.runningFlags, [true, false]);

    // The cancelled tick's round lands late. It must not touch the new round.
    await h.answer(round({ answers: { direction: { type: "choice", choice: "right" } } }));
    await h.wake();

    assert.equal(h.game().steps, 0, "the stale tick must not advance the fresh round");
    assert.equal(h.game().food.x, fresh.food.x, "the fresh round is untouched");
    assert.equal(h.rows.length, 0, "the log Reset cleared stays empty");
    assert.deepEqual(h.patches, []);
  });

  it("Reset works while the demo is idle and while it is running", async () => {
    const idle = harness();
    idle.runner.reset();
    assert.equal(idle.seed(), 8);
    assert.deepEqual(idle.runningFlags, [], "an idle Reset has no run to stop");

    const busy = harness();
    busy.runner.start();
    busy.runner.reset();
    assert.equal(busy.seed(), 8);
    assert.equal(busy.game().steps, 0);
    await busy.answer(round());
    await busy.wake();
    assert.equal(busy.rows.length, 0);
  });
});

describe("createSnakeRunner / round ends and restarts", () => {
  it("stops at the end of a round and leaves the controls idle", async () => {
    const h = harness({ game: { ...createGame({ seed: 7 }), steps: 399 } });
    h.runner.start();
    await h.answer(round());
    await h.wake();

    assert.equal(h.game().status, "over");
    assert.equal(h.game().endReason, "step_limit");
    assert.equal(h.rows.length, 1);
    assert.deepEqual(h.runningFlags, [true, false], "the run ends with the round");
    assert.equal(h.requests.length, 1, "no tick is asked after the round ended");
  });

  it("'再来一局' really deals a new round when the old one is over", async () => {
    const over: GameState = {
      ...createGame({ seed: 7 }),
      status: "over",
      endReason: "wall",
      steps: 3,
      score: 20,
      eaten: 2,
    };
    const h = harness({ game: over });

    h.runner.start();
    // The restart is a new round, not a no-op on the dead one.
    assert.equal(h.seed(), 8);
    assert.equal(h.game().status, "running");
    assert.equal(h.game().steps, 0);
    assert.equal(h.game().score, 0);
    assert.equal(h.requests.length, 1, "the new round is played, not just dealt");

    await h.answer(round({ answers: { direction: { type: "choice", choice: "up" } } }));
    await h.wake();
    assert.equal(h.rows.length, 1);
    assert.equal(h.rows[0].game.steps, 1);
    h.runner.pause();
  });
});

describe("createSnakeRunner / late rounds and slow providers", () => {
  it("patches the row a late answer missed, and never invents a second one", async () => {
    const h = harness();
    h.runner.start();
    await h.wake(); // the tick ends with nothing; the code plays straight

    assert.equal(h.rows.length, 1);
    assert.equal(h.rows[0].round, null);
    assert.equal(h.rows[0].decision.status, "timeout");
    assert.equal(h.patches.length, 0);

    await h.answer(round({ message: "arrived late" })); // the round lands after its tick
    await settle();
    assert.deepEqual(
      h.patches.map((patch) => patch.rowId),
      [h.rowIds[0]],
    );
    assert.equal(h.rows.length, 1, "a late round patches, it does not append");
    h.runner.pause();
  });

  it("treats a decision that fails to resolve as no answer, and keeps playing", async () => {
    let calls = 0;
    const h = harness({
      decide: () => {
        calls += 1;
        // The first tick's call rejects outright; the next one answers.
        return calls === 1
          ? Promise.reject(new Error("offline"))
          : Promise.resolve(round({ answers: { direction: { type: "choice", choice: "up" } } }));
      },
    });
    h.runner.start();
    await h.wake();

    assert.equal(h.rows.length, 1);
    assert.equal(h.rows[0].round, null);
    assert.equal(h.rows[0].decision.status, "timeout");
    assert.equal(h.requests.length, 2, "the loop is still ticking");

    await h.wake();
    assert.equal(h.rows.length, 2);
    assert.equal(h.rows[1].decision.source, "jev");
    h.runner.pause();
  });

  it("stretches a tick to cover a slow provider, never past the cap", async () => {
    const h = harness();
    h.runner.start();
    assert.deepEqual(h.waits, [900], "no latency measured yet: the picked speed");

    await h.answer(round({ latencyMs: 1_250 })); // api.typesafe.ai measures ~1.25 s
    await h.wake();
    assert.equal(h.waits[1], 1_370, "the next tick waits long enough to adopt a reply");

    await h.answer(round({ latencyMs: 9_000 })); // far slower than the cap allows
    await h.wake();
    assert.equal(h.waits[2], TICK_WAIT_CAP_MS);

    h.runner.pause();
  });

  it("plays a whole round to its end without any answer at all", async () => {
    const h = harness();
    h.runner.start();
    // The local policy alone ends every round: wall, self, or the step cap.
    for (let tick = 0; tick < 500 && h.game().status === "running"; tick += 1) {
      await h.wake();
    }
    assert.equal(h.game().status, "over");
    assert.equal(h.rows.length, h.game().steps);
    assert.deepEqual(h.runningFlags, [true, false]);
  });
});
