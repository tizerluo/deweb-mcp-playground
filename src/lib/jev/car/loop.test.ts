/**
 * Loop-level lifecycle regression: the car's decision loop owns the rules
 * Pause / Reset are supposed to follow, and it takes its clock and sleep through
 * the port, so every one of those rules is exercised here by hand — including
 * the one the snake does not have: a window that ends with no answer keeps
 * driving the last action instead of inventing one.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { JevRound } from "../decision.ts";
import type { JevRequest } from "../protocol.ts";
import { createCar, sameAction, type CarState } from "./engine.ts";
import { rollout } from "./candidates.ts";
import { createCarRunner, type CarLoopPort, type CarTick } from "./loop.ts";
import { CAR_QUESTION } from "./question.ts";
import { createTrack } from "./track.ts";

const track = createTrack();
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

/** An answered round; overrides reach the fields the case at hand cares about. */
function round(choice = "straight · throttle", overrides: Partial<JevRound> = {}): JevRound {
  return {
    ok: true,
    reason: null,
    message: "",
    answers: {
      [CAR_QUESTION]: {
        type: "choice",
        choice,
        confidence: 0.7,
        probabilities: { [choice]: 0.7 },
      },
    },
    model: "jev-1.13.0",
    latencyMs: 320,
    charge: 0.01,
    cached: false,
    envelope: {
      requestId: "req-car-1",
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
  opts: { periodMs?: number; decide?: (request: JevRequest) => Promise<JevRound | null> } = {},
) {
  let state: CarState = createCar(track);
  let runs = 0;
  let clock = 0;
  const answers: Array<(round: JevRound | null) => void> = [];
  const sleepers: Array<{ ms: number; resolve: () => void }> = [];
  const requests: JevRequest[] = [];
  const waits: number[] = [];
  const rows: CarTick[] = [];
  const rowIds: string[] = [];
  const patches: { rowId: string; round: JevRound }[] = [];
  const runningFlags: boolean[] = [];

  const port: CarLoopPort = {
    getTrack: () => track,
    getState: () => state,
    newRun: () => {
      runs += 1;
      state = createCar(track);
      rows.length = 0;
      return state;
    },
    getPeriodMs: () => opts.periodMs ?? 400,
    decide: (request) => {
      requests.push(request);
      if (opts.decide) return opts.decide(request);
      return new Promise<JevRound | null>((resolve) => answers.push(resolve));
    },
    noteWait: (ms) => waits.push(ms),
    commitTick: (tick) => {
      const rowId = `row-${tick.state.steps}`;
      rows.push(tick);
      rowIds.push(rowId);
      state = tick.state;
      return rowId;
    },
    patchTick: (rowId, late) => patches.push({ rowId, round: late }),
    setRunning: (running) => runningFlags.push(running),
    now: () => clock,
    sleep: (ms) => new Promise<void>((resolve) => sleepers.push({ ms, resolve })),
  };

  return {
    port,
    runner: createCarRunner(port),
    requests,
    waits,
    rows,
    rowIds,
    patches,
    runningFlags,
    state: () => state,
    runs: () => runs,
    async answer(value: JevRound | null) {
      const resolve = answers.shift();
      assert.ok(resolve, "no decision in flight");
      resolve(value);
      await settle();
    },
    async wake() {
      const sleeper = sleepers.shift();
      assert.ok(sleeper, "no window in flight");
      clock += sleeper.ms;
      sleeper.resolve();
      await settle();
    },
  };
}

describe("createCarRunner / lifecycle", () => {
  it("drives one window per wait and adopts the answer that arrived in time", async () => {
    const h = harness();
    h.runner.start();
    assert.equal(h.requests.length, 1);
    assert.deepEqual(h.runningFlags, [true]);

    await h.answer(round("hard left · throttle"));
    await h.wake();

    assert.equal(h.rows.length, 1);
    const [tick] = h.rows;
    assert.equal(tick.decision.source, "jev");
    assert.deepEqual(tick.decision.action, { steer: 1, throttle: 1 });
    assert.equal(tick.round?.charge, 0.01);
    assert.equal(tick.request.questions[CAR_QUESTION].type, "choice");
    assert.ok(tick.state.steps > 0, "the car moved");
    assert.ok(tick.state.steps > tick.from.steps);
    assert.ok(tick.candidates.length === 10, "the row carries the options it decided between");
    assert.equal(tick.sensors.onTrack, true);

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

    // The window that was in flight when Pause was pressed writes nothing.
    await h.answer(round());
    await h.wake();
    assert.equal(h.rows.length, 0);
    assert.equal(h.state().steps, 0);
    assert.equal(h.state().distance, 0);
  });

  it("Reset: the new run cannot be overwritten by the window it cancelled", async () => {
    const h = harness();
    h.runner.start();
    h.runner.reset(); // back to the start line, log cleared
    const fresh = h.state();
    assert.equal(h.runs(), 1);
    assert.equal(fresh.steps, 0);
    assert.deepEqual(h.runningFlags, [true, false]);

    await h.answer(round("hard left · throttle"));
    await h.wake();

    assert.equal(h.state().steps, 0, "the stale window must not drive the fresh run");
    assert.equal(h.state().x, fresh.x);
    assert.equal(h.state().arc, fresh.arc);
    assert.equal(h.rows.length, 0, "the log Reset cleared stays empty");
    assert.deepEqual(h.patches, []);
  });
});

describe("createCarRunner / timeout, failure and illegal answers", () => {
  it("holds the previous action when a window ends with nothing", async () => {
    const h = harness();
    h.runner.start();
    // Window 1: JEV answers a specific action — a full-lock left with throttle.
    await h.answer(round("hard left · throttle"));
    await h.wake();
    assert.deepEqual(h.rows[0].decision.action, { steer: 1, throttle: 1 });

    // Window 2: nothing arrives. The car must keep doing what it was doing.
    await h.wake();
    const [second] = h.rows.slice(1);
    assert.equal(second.decision.status, "timeout");
    assert.equal(second.decision.source, "local");
    assert.deepEqual(second.decision.action, { steer: 1, throttle: 1 });
    assert.equal(second.round, null);
    assert.equal(h.requests.length, 3, "the loop is still asking");

    h.runner.pause();
  });

  it("degrades to the local policy when the call fails, and keeps driving", async () => {
    const h = harness({
      decide: () =>
        Promise.resolve(
          round("straight · throttle", {
            ok: false,
            reason: "rate_limited",
            message: "cooling down for 2s",
            answers: null,
          }),
        ),
    });
    h.runner.start();
    await h.wake();
    assert.equal(h.rows[0].decision.status, "degraded");
    assert.equal(h.rows[0].decision.reason, "rate_limited");
    assert.equal(h.rows[0].decision.source, "local");
    assert.ok(h.state().steps > 0, "the local policy still drives the car");
    assert.equal(h.state().offTrackCount, 0);
    h.runner.pause();
  });

  it("treats a rejected call as no answer, and keeps the loop ticking", async () => {
    let calls = 0;
    const h = harness({
      decide: () => {
        calls += 1;
        return calls === 1
          ? Promise.reject(new Error("offline"))
          : Promise.resolve(round("straight · throttle"));
      },
    });
    h.runner.start();
    await h.wake();
    assert.equal(h.rows[0].round, null);
    assert.equal(h.rows[0].decision.status, "timeout");

    await h.wake();
    assert.equal(h.rows.length, 2);
    assert.equal(h.rows[1].decision.source, "jev");
    h.runner.pause();
  });

  it("refuses a pick that was not on offer and falls back to the local policy", async () => {
    const h = harness({ decide: () => Promise.resolve(round("teleport")) });
    h.runner.start();
    await h.wake();
    assert.equal(h.rows[0].decision.status, "illegal");
    assert.equal(h.rows[0].decision.rawChoice, "teleport");
    assert.equal(h.rows[0].decision.source, "local");
    h.runner.pause();
  });

  it("patches the row a late answer missed, and never invents a second one", async () => {
    const h = harness();
    h.runner.start();
    await h.wake(); // the window ends with nothing; the previous action is held

    assert.equal(h.rows.length, 1);
    assert.equal(h.rows[0].round, null);
    assert.equal(h.patches.length, 0);

    await h.answer(round("right · brake", { message: "arrived late" }));
    await settle();
    assert.deepEqual(
      h.patches.map((patch) => patch.rowId),
      [h.rowIds[0]],
    );
    assert.equal(h.rows.length, 1, "a late round patches, it does not append");
    h.runner.pause();
  });
});

describe("createCarRunner / what the card shows", () => {
  it("carries the executed action's own rollout, recomputed from the tick alone", async () => {
    const h = harness();
    h.runner.start();
    await h.answer(round("hard left · throttle"));
    await h.wake();

    const [tick] = h.rows;
    assert.equal(tick.decision.source, "jev");
    assert.deepEqual(tick.prediction.action, tick.decision.action);
    const alone = rollout(tick.from, tick.decision.action, track);
    assert.deepEqual(tick.prediction.metrics, alone.metrics, "the numbers belong to that action");
    assert.deepEqual(tick.prediction.trace, alone.trace);
    h.runner.pause();
  });

  it("never shows a lookalike candidate's numbers for a local action", async () => {
    // No answer at all: every window runs the local policy, whose steering is
    // continuous. A label lookup would find a candidate with the same name and
    // a different wheel angle — exactly the numbers that used to be on show.
    const h = harness();
    h.runner.start();
    for (let window = 0; window < 6; window += 1) await h.wake();

    assert.equal(h.rows.length, 6);
    for (const tick of h.rows) {
      assert.deepEqual(tick.prediction.action, tick.decision.action);
      const alone = rollout(tick.from, tick.decision.action, track);
      assert.deepEqual(tick.prediction.metrics, alone.metrics);
      const byLabel = tick.candidates.find(
        (candidate) => candidate.label === tick.prediction.label,
      );
      assert.ok(byLabel, `"${tick.prediction.label}" is a candidate label too`);
      assert.ok(
        !sameAction(byLabel.action, tick.decision.action),
        "the local action is not the level that shares its name",
      );
      assert.notDeepEqual(byLabel.metrics, tick.prediction.metrics);
    }
    h.runner.pause();
  });

  it("reports the timeout branch the window actually took", async () => {
    const h = harness();
    h.runner.start();
    // Window 1: JEV answers, so window 2 has something to hold.
    await h.answer(round("hard left · throttle"));
    await h.wake();
    assert.equal(h.rows[0].decision.timeoutMode, null);

    // Window 2: nothing arrives — one bounded hold of the delivered action.
    await h.wake();
    assert.equal(h.rows[1].decision.timeoutMode, "hold");
    assert.deepEqual(h.rows[1].decision.action, h.rows[0].decision.action);

    // Window 3: nothing again — the hold is spent, the local policy drives.
    await h.wake();
    assert.equal(h.rows[2].decision.timeoutMode, "local");
    assert.equal(h.rows[2].decision.status, "timeout");
    h.runner.pause();
  });
});

describe("createCarRunner / clock and long runs", () => {
  it("stretches a window to cover a slow provider, never past the cap", async () => {
    const h = harness({ periodMs: 400 });
    h.runner.start();
    assert.deepEqual(h.waits, [400], "no latency measured yet: the picked period");

    await h.answer(round("straight · throttle", { latencyMs: 1_250 }));
    await h.wake();
    assert.equal(h.waits[1], 1_370, "the next window waits long enough to adopt a reply");

    await h.answer(round("straight · throttle", { latencyMs: 9_000 }));
    await h.wake();
    assert.equal(h.waits[2], 2_600, "the shared cap is never exceeded");

    h.runner.pause();
  });

  it("drives on with no answers at all: the fallback holds the road", async () => {
    const h = harness({ periodMs: 400 });
    h.runner.start();
    for (let window = 0; window < 240 && h.rows.length < 240; window += 1) {
      await h.wake();
    }
    assert.equal(h.rows.length, 240);
    assert.equal(h.state().laps >= 2, true, `laps ${h.state().laps}`);
    assert.equal(h.state().offTrackCount, 0);
    for (const row of h.rows) {
      assert.equal(row.decision.source, "local");
      assert.equal(row.decision.status, "timeout");
      assert.equal(
        row.decision.timeoutMode,
        "local",
        "with nothing ever delivered there is nothing to hold",
      );
      assert.equal(row.round, null);
      assert.equal(row.request.questions[CAR_QUESTION].type, "choice");
    }
    h.runner.pause();
    assert.deepEqual(h.runningFlags, [true, false], "a paused runner reports it stopped");
  });
});
