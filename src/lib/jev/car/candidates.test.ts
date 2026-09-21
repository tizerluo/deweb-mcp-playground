/**
 * Candidate sampler regression: the ten options the code offers, the numbers
 * their rollouts produce, and the determinism the whole decision depends on.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CAR, createCar, type CarState } from "./engine.ts";
import {
  CANDIDATE_HORIZON_MS,
  STEER_LEVELS,
  THROTTLE_LEVELS,
  buildCandidates,
  candidateLabels,
  predictAction,
  readCandidate,
  rollout,
} from "./candidates.ts";
import { createTrack, locate, pointAtArc, wrapAngle } from "./track.ts";

const track = createTrack();

/** Index of the straightest piece of the loop (largest radius of curvature). */
const straightIndex = track.curvature.reduce(
  (best, value, index) => (Math.abs(value) < Math.abs(track.curvature[best]) ? index : best),
  0,
);
/** Index of the tightest bend. */
const tightIndex = track.curvature.reduce(
  (best, value, index) => (Math.abs(value) > Math.abs(track.curvature[best]) ? index : best),
  0,
);

/** A car on the centreline, heading along the track, at a set speed. */
function carAt(arc: number, speed: number): CarState {
  const base = createCar(track, { startArc: arc });
  const here = pointAtArc(track, arc);
  const next = pointAtArc(track, arc + 0.5);
  return { ...base, speed, heading: Math.atan2(next.y - here.y, next.x - here.x) };
}

function at(state: CarState, lateral: number): CarState {
  const fix = locate(track, { x: state.x, y: state.y });
  return {
    ...state,
    x: state.x - Math.sin(fix.heading) * lateral,
    y: state.y + Math.cos(fix.heading) * lateral,
  };
}

describe("car candidates / sampling", () => {
  it("offers ten options in a fixed order with labels the wire can carry", () => {
    const candidates = buildCandidates(carAt(track.arc[straightIndex], 6), track);
    assert.equal(candidates.length, STEER_LEVELS.length * THROTTLE_LEVELS.length);
    assert.equal(candidates.length, 10);
    assert.equal(candidates[0].label, "hard left · brake");
    assert.equal(candidates[1].label, "hard left · throttle");
    assert.equal(candidates.at(-1)?.label, "hard right · throttle");
    const labels = candidateLabels(candidates);
    assert.equal(new Set(labels).size, labels.length, "labels must be pairwise distinct");
    for (const label of labels) {
      assert.ok(label.length <= 48, `label too long: ${label}`);
      assert.notEqual(label.trim(), "");
    }
  });

  it("is deterministic: same state, same candidates, same metrics", () => {
    const state = carAt(track.arc[tightIndex - 8], 9);
    const first = buildCandidates(state, track);
    const second = buildCandidates(state, track);
    assert.deepEqual(first, second);
    // And the rollout alone reproduces one candidate's numbers.
    const alone = rollout(state, first[0].action, track);
    assert.deepEqual(alone.metrics, first[0].metrics);
    assert.deepEqual(alone.trace, first[0].trace);
  });

  it("rolls each option over the brief's 1.5–2.5 s horizon", () => {
    const state = carAt(track.arc[straightIndex], 6);
    const { trace } = rollout(state, { steer: 0, throttle: 1 }, track);
    assert.equal(CANDIDATE_HORIZON_MS, 2_000);
    assert.ok(trace.length >= 15, `trace points ${trace.length}`);
    assert.deepEqual(trace[0], { x: state.x, y: state.y }, "the trace starts at the car");
    assert.equal(readCandidate("nope", buildCandidates(state, track)), null);
    assert.equal(
      readCandidate("straight · throttle", buildCandidates(state, track))?.action.throttle,
      1,
    );
  });

  it("predicts the side of the road a steering level leads to", () => {
    // The heading the rollout ends on is the steering and nothing else: on the
    // straightest piece of the loop a left level yaws left, a right level right.
    const state = carAt(track.arc[straightIndex], 5);
    const headingOf = (trace: { x: number; y: number }[]) => {
      const a = trace[trace.length - 2];
      const b = trace[trace.length - 1];
      return Math.atan2(b.y - a.y, b.x - a.x);
    };
    const left = rollout(state, { steer: 1, throttle: 1 }, track, { horizonMs: 600 });
    const right = rollout(state, { steer: -1, throttle: 1 }, track, { horizonMs: 600 });
    const leftYaw = wrapAngle(headingOf(left.trace) - state.heading);
    const rightYaw = wrapAngle(headingOf(right.trace) - state.heading);
    assert.ok(leftYaw > 0.3, `hard left must yaw left, got ${leftYaw}`);
    assert.ok(rightYaw < -0.3, `hard right must yaw right, got ${rightYaw}`);
    assert.ok(Math.abs(leftYaw + rightYaw) < 1e-6, "the levels are symmetric");
    // And the offset follows the sign: left of travel is positive.
    assert.ok(left.metrics.finalOffset > 0, `left offset ${left.metrics.finalOffset}`);
    assert.ok(right.metrics.finalOffset < 0, `right offset ${right.metrics.finalOffset}`);
    assert.ok(left.metrics.finalOffset > right.metrics.finalOffset + 1);
  });

  it("flags the options that leave the road — more of them the further out the car is", () => {
    // 3 m to the right of a 7 m track: fewer options keep it inside than when
    // the car is centred, and steering further right is one of the losers.
    const centred = buildCandidates(carAt(track.arc[straightIndex], 6), track);
    const drifted = at(carAt(track.arc[straightIndex], 6), -3);
    assert.equal(locate(track, { x: drifted.x, y: drifted.y }).offset.toFixed(1), "-3.0");
    const candidates = buildCandidates(drifted, track);
    const colliding = candidates.filter((candidate) => candidate.metrics.collision);
    const safe = candidates.filter((candidate) => !candidate.metrics.collision);
    assert.ok(colliding.length > 0 && safe.length > 0, "both outcomes are on offer");
    assert.ok(
      colliding.length > centred.filter((candidate) => candidate.metrics.collision).length,
      "being out of position must cost options",
    );
    const furtherRight = readCandidate("hard right · throttle", candidates);
    assert.ok(furtherRight?.metrics.collision, "steering into the edge leaves the road");
    assert.ok(furtherRight.metrics.maxOffset >= 3, "starts at 3 m and gets further");
    for (const candidate of safe) assert.ok(candidate.metrics.margin > 0, candidate.label);
  });

  it("scores comfort from the accelerations the rollout actually asks for", () => {
    const state = carAt(track.arc[straightIndex], 6);
    const candidates = buildCandidates(state, track);
    const gentle = readCandidate("straight · throttle", candidates);
    const harsh = readCandidate("hard left · brake", candidates);
    assert.ok(gentle && harsh);
    assert.ok(
      gentle.metrics.comfort > harsh.metrics.comfort,
      `${gentle.metrics.comfort} vs ${harsh.metrics.comfort}`,
    );
    assert.ok(gentle.metrics.comfort <= 1 && gentle.metrics.comfort > 0.5);
    assert.ok(harsh.metrics.comfort >= 0 && harsh.metrics.comfort < 0.4);
  });

  it("pins comfort at the speed boundaries instead of a fixed throttle push", () => {
    // At vMax the throttle has nothing left to give and nothing is steering, so
    // the rollout asks for 0 m/s² on both axes: a perfect score. The per-action
    // constant priced this at 0.70 — the standing-start number.
    const atTop = { ...carAt(track.arc[straightIndex], CAR.vMax), steerAngle: 0 };
    const flat = readCandidate("straight · throttle", buildCandidates(atTop, track));
    assert.ok(flat, "straight · throttle is on offer");
    assert.equal(flat.metrics.comfort, 1);

    // From standstill the throttle does push its hardest, all horizon long.
    const standing = { ...carAt(track.arc[straightIndex], 0), steerAngle: 0 };
    const launch = readCandidate("straight · throttle", buildCandidates(standing, track));
    assert.ok(launch);
    assert.equal(launch.metrics.comfort, 0.7);

    // Half speed, half the acceleration: 0.40 × (1.5 / 4) off the top score.
    const half = { ...carAt(track.arc[straightIndex], CAR.vMax / 2), steerAngle: 0 };
    const cruise = readCandidate("straight · throttle", buildCandidates(half, track));
    assert.ok(cruise);
    assert.equal(cruise.metrics.comfort, 0.85);
  });

  it("rolls out the action it is handed, not the nearest level", () => {
    const state = carAt(track.arc[straightIndex], 6);
    const action = { steer: 0.35295509428616784, throttle: 1 };
    const predicted = predictAction(state, action, track);
    const alone = rollout(state, action, track);
    assert.deepEqual(predicted.action, action);
    assert.deepEqual(predicted.metrics, alone.metrics);
    assert.deepEqual(predicted.trace, alone.trace);
    assert.equal(predicted.label, "left · throttle");
    // The ten levels do not have to contain it: that is the whole point of
    // predicting the action rather than looking a candidate up by label.
    assert.equal(readCandidate(predicted.label, buildCandidates(state, track))?.action.steer, 0.5);
  });

  it("keeps every metric internally consistent", () => {
    const state = carAt(track.arc[tightIndex - 5], 11);
    for (const candidate of buildCandidates(state, track)) {
      const { metrics } = candidate;
      assert.ok(metrics.maxOffset >= Math.abs(metrics.finalOffset) - 1e-9, candidate.label);
      assert.equal(
        metrics.collision,
        metrics.offTrack > 0,
        `${candidate.label}: ${metrics.offTrack}`,
      );
      assert.ok(
        Math.abs(metrics.margin - (track.halfWidth - Math.abs(metrics.finalOffset))) < 0.011,
      );
      assert.ok(metrics.distance > 0 && metrics.distance < 40);
      assert.ok(metrics.finalSpeed >= 0 && metrics.finalSpeed <= CAR.vMax);
      assert.ok(metrics.comfort >= 0 && metrics.comfort <= 1);
      assert.ok(candidate.trace.length >= 15);
    }
  });
});
