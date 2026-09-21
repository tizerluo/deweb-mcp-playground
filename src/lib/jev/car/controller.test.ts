/**
 * Decision resolution regression — the fixed-clock contract: what the car does
 * when nothing arrived, when the call failed, when JEV named something that was
 * not on offer, and when it answered properly. Plus the local policy itself,
 * which is what makes the demo drivable with no key at all.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { advanceCar, createCar, type CarState } from "./engine.ts";
import { buildCandidates } from "./candidates.ts";
import { centreAction, resolveCarDecision } from "./controller.ts";
import { senseCar } from "./sensors.ts";
import { createTrack, locate, pointAtArc } from "./track.ts";

const track = createTrack();

function carAt(arc: number, speed: number): CarState {
  const base = createCar(track, { startArc: arc });
  const here = pointAtArc(track, arc);
  const next = pointAtArc(track, arc + 0.5);
  return { ...base, speed, heading: Math.atan2(next.y - here.y, next.x - here.x) };
}

function withOffset(state: CarState, lateral: number): CarState {
  const fix = locate(track, { x: state.x, y: state.y });
  return {
    ...state,
    x: state.x - Math.sin(fix.heading) * lateral,
    y: state.y + Math.cos(fix.heading) * lateral,
  };
}

/** Everything one decision needs, from a state. */
function context(state: CarState) {
  const { sensors } = senseCar(state, track);
  return { state, track, sensors, candidates: buildCandidates(state, track) };
}

describe("car controller / decision rules", () => {
  it("holds the previous action when nothing arrived", () => {
    const ctx = context(carAt(20, 7));
    const previous = { action: { steer: 1, throttle: 1 }, timeout: false };
    const decision = resolveCarDecision({ ...ctx, answer: null, previous });
    assert.equal(decision.status, "timeout");
    assert.equal(decision.source, "local");
    assert.equal(decision.timeoutMode, "hold", "this window replayed the previous action");
    assert.deepEqual(decision.action, previous.action, "a timeout keeps driving the last action");
    assert.equal(decision.reason, null);
    assert.equal(decision.latencyMs, null);
  });

  it("bounds the hold: a second timeout in a row goes back to the local policy", () => {
    const ctx = context(carAt(20, 7));
    const held = resolveCarDecision({
      ...ctx,
      answer: null,
      previous: { action: { steer: 1, throttle: 1 }, timeout: true },
    });
    assert.equal(held.status, "timeout");
    assert.equal(held.timeoutMode, "local", "a timeout that chooses an action is not a hold");
    assert.deepEqual(
      held.action,
      centreAction(ctx.state, track, ctx.sensors),
      "a hold never covers two windows: an outage must not drive blind",
    );
  });

  it("falls back to the local policy on the very first window", () => {
    const ctx = context(carAt(20, 7));
    const decision = resolveCarDecision({ ...ctx, answer: null, previous: null });
    assert.equal(decision.status, "timeout");
    assert.equal(decision.timeoutMode, "local", "nothing to hold on the first window");
    assert.deepEqual(decision.action, centreAction(ctx.state, track, ctx.sensors));
  });

  it("degrades to a centred cruise when the call failed, with the reason", () => {
    const ctx = context(carAt(20, 7));
    const decision = resolveCarDecision({
      ...ctx,
      answer: { ok: false, reason: "rate_limited", latencyMs: 12, message: "cooling down for 2s" },
      previous: { action: { steer: 1, throttle: 1 }, timeout: false },
    });
    assert.equal(decision.status, "degraded");
    assert.equal(decision.source, "local");
    assert.equal(decision.timeoutMode, null, "only a timeout has a timeout branch");
    assert.equal(decision.reason, "rate_limited");
    assert.equal(decision.latencyMs, 12);
    assert.deepEqual(decision.action, centreAction(ctx.state, track, ctx.sensors));
  });

  it("plays exactly the option JEV picked", () => {
    const ctx = context(carAt(20, 7));
    const wanted = ctx.candidates[5];
    const decision = resolveCarDecision({
      ...ctx,
      answer: {
        ok: true,
        choice: wanted.label,
        confidence: 0.63,
        probabilities: { [wanted.label]: 0.63 },
        latencyMs: 240,
        model: "jev-1.13",
        cached: false,
      },
      previous: null,
    });
    assert.equal(decision.status, "answered");
    assert.equal(decision.source, "jev");
    assert.equal(decision.timeoutMode, null);
    assert.deepEqual(decision.action, wanted.action);
    assert.equal(decision.rawChoice, wanted.label);
    assert.equal(decision.confidence, 0.63);
    assert.equal(decision.model, "jev-1.13");
    assert.deepEqual(decision.probabilities, { [wanted.label]: 0.63 });
  });

  it("refuses a pick that was not on offer, and keeps the reasons", () => {
    const ctx = context(carAt(20, 7));
    const decision = resolveCarDecision({
      ...ctx,
      answer: {
        ok: true,
        choice: "teleport",
        confidence: 0.9,
        probabilities: { teleport: 0.9 },
        latencyMs: 180,
        model: "jev-1.13",
        cached: false,
      },
      previous: null,
    });
    assert.equal(decision.status, "illegal");
    assert.equal(decision.source, "local");
    assert.equal(decision.rawChoice, "teleport");
    assert.deepEqual(decision.action, centreAction(ctx.state, track, ctx.sensors));
    // The evidence travels with the decision so the stream can show it.
    assert.equal(decision.confidence, 0.9);
    assert.deepEqual(decision.probabilities, { teleport: 0.9 });
  });

  it("treats an empty pick as illegal too", () => {
    const ctx = context(carAt(20, 7));
    const decision = resolveCarDecision({
      ...ctx,
      answer: {
        ok: true,
        choice: null,
        confidence: null,
        probabilities: null,
        latencyMs: 90,
        model: "jev-1.13",
        cached: false,
      },
      previous: { action: { steer: -1, throttle: 1 }, timeout: false },
    });
    assert.equal(decision.status, "illegal");
    assert.equal(decision.rawChoice, null);
    assert.deepEqual(decision.action, centreAction(ctx.state, track, ctx.sensors));
  });
});

describe("car controller / local policy", () => {
  it("steers with the road: the sign of the wheel follows the bend", () => {
    const tightLeft = track.curvature.reduce(
      (best, value, index) => (value > track.curvature[best] ? index : best),
      0,
    );
    const tightRight = track.curvature.reduce(
      (best, value, index) => (value < track.curvature[best] ? index : best),
      0,
    );
    assert.ok(track.curvature[tightLeft] > 0.05 && track.curvature[tightRight] < -0.05);
    for (const [index, expected] of [
      [tightLeft, 1],
      [tightRight, -1],
    ] as const) {
      const state = carAt(track.arc[index], 5);
      const action = centreAction(state, track, senseCar(state, track).sensors);
      assert.equal(Math.sign(action.steer), expected, `bend ${track.curvature[index]}`);
    }
  });

  it("drives two clean laps with no JEV at all — the documented fallback", () => {
    let state = createCar(track);
    for (let window = 0; window < 300; window += 1) {
      const action = centreAction(state, track, senseCar(state, track).sensors);
      state = advanceCar(state, action, track, 400);
    }
    assert.ok(state.laps >= 2, `laps ${state.laps}`);
    assert.equal(state.offTrackCount, 0, "the centred cruise never leaves the road");
    assert.equal(state.onTrack, true);
  });

  it("steers back toward the centreline from either side", () => {
    const left = withOffset(carAt(20, 6), 2.5);
    const right = withOffset(carAt(20, 6), -2.5);
    const back = centreAction(left, track, senseCar(left, track).sensors);
    const other = centreAction(right, track, senseCar(right, track).sensors);
    assert.ok(back.steer < 0, `sitting left of the line steers right, got ${back.steer}`);
    assert.ok(other.steer > 0, `sitting right of the line steers left, got ${other.steer}`);
  });

  it("brakes for a bend it cannot take at speed", () => {
    let tightArc = 0;
    let worst = 0;
    for (let i = 0; i < track.curvature.length; i += 1) {
      if (Math.abs(track.curvature[i]) > Math.abs(worst)) {
        worst = track.curvature[i];
        tightArc = track.arc[i];
      }
    }
    const fast = carAt(Math.max(0, tightArc - 6), 12);
    const { sensors } = senseCar(fast, track);
    assert.equal(centreAction(fast, track, sensors).throttle, -1, "12 m/s into the bend: brake");
    const slow = carAt(Math.max(0, tightArc - 6), 3);
    const slowSensors = senseCar(slow, track).sensors;
    assert.equal(
      centreAction(slow, track, slowSensors).throttle,
      1,
      "3 m/s into the bend: keep going",
    );
  });

  it("is deterministic", () => {
    const state = carAt(45, 7);
    const sensors = senseCar(state, track).sensors;
    assert.deepEqual(centreAction(state, track, sensors), centreAction(state, track, sensors));
  });
});
