/**
 * Kinematics regression: what one integration step does, what the constraints
 * stop it from doing, and how the two counters the demo reports (off-track
 * events, laps) move. The model is a kinematic bicycle; the numbers below are
 * the arithmetic, not a recording.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CAR,
  actionLabel,
  advanceCar,
  clampUnit,
  createCar,
  longitudinalAccel,
  sameAction,
  stepCar,
  steerLabel,
} from "./engine.ts";
import { TRACK_WIDTH, createTrack, locate, pointAtArc } from "./track.ts";

const track = createTrack();

/** A car on the centreline at `arc`, heading along the track, at a set speed. */
function carAt(arc: number, speed: number = CAR.launchSpeed) {
  const base = createCar(track, { startArc: arc });
  const next = pointAtArc(track, arc + 0.5);
  const here = pointAtArc(track, arc);
  return {
    ...base,
    speed,
    heading: Math.atan2(next.y - here.y, next.x - here.x),
  };
}

describe("car engine / kinematics", () => {
  it("integrates one step exactly: throttle, no steering, no yaw", () => {
    const start = { ...carAt(20, 3), heading: 0, x: 0, y: 0 };
    const dt = 0.1;
    const accel = CAR.accelUp * (1 - 3 / CAR.vMax);
    const step = stepCar(start, { steer: 0, throttle: 1 }, track, dt);
    assert.ok(Math.abs(step.speed - (3 + accel * dt)) < 1e-12, `speed ${step.speed}`);
    assert.equal(step.heading, 0, "zero wheel angle means no yaw");
    assert.ok(Math.abs(step.x - step.speed * dt) < 1e-12);
    assert.equal(step.y, 0);
    assert.equal(step.steerAngle, 0);
    assert.equal(step.steps, 1);
    assert.ok(Math.abs(step.distance - step.speed * dt) < 1e-12);
  });

  it("moves the wheel toward the asked angle at the steering rate, never past it", () => {
    const dt = 0.05;
    let car = { ...carAt(20, 6), steerAngle: 0 };
    car = stepCar(car, { steer: 1, throttle: 1 }, track, dt);
    assert.ok(Math.abs(car.steerAngle - CAR.steerRate * dt) < 1e-12);

    // Half lock is a target, not a rate: the wheel settles on +0.25 and stays.
    let half = { ...carAt(20, 6), steerAngle: 0 };
    for (let i = 0; i < 40; i += 1) half = stepCar(half, { steer: 0.5, throttle: 0 }, track, dt);
    assert.ok(Math.abs(half.steerAngle - CAR.steerMax / 2) < 1e-9, `wheel ${half.steerAngle}`);

    // Full lock saturates exactly at the mechanical limit.
    let full = { ...carAt(20, 6), steerAngle: 0 };
    for (let i = 0; i < 40; i += 1) full = stepCar(full, { steer: 5, throttle: 1 }, track, dt);
    assert.equal(full.steerAngle, CAR.steerMax);
    assert.equal(clampUnit(5), 1);
  });

  it("turns the way the sign says (+1 = left of travel) and only while moving", () => {
    const left = stepCar(
      { ...carAt(60, 8), heading: 0, x: 0, y: 0, steerAngle: CAR.steerMax },
      {
        steer: 1,
        throttle: 1,
      },
      track,
      0.1,
    );
    assert.ok(left.heading > 0, "positive wheel angle yaws counter-clockwise (left)");

    const stopped = { ...carAt(20, 0), heading: 0.7, x: 0, y: 0, steerAngle: CAR.steerMax };
    const braked = stepCar(stopped, { steer: 1, throttle: -1 }, track, 0.1);
    assert.equal(braked.speed, 0, "the brake never drives the car backwards");
    assert.equal(braked.heading, 0.7, "a stopped car does not yaw");
  });

  it("caps the top speed and never integrates backwards through zero", () => {
    // The throttle tapers off towards vMax, so a long run approaches it.
    let fast = { ...carAt(20, CAR.vMax - 0.1), heading: 0, x: 0, y: 0, steerAngle: 0 };
    for (let i = 0; i < 20; i += 1) fast = stepCar(fast, { steer: 0, throttle: 1 }, track, 0.05);
    assert.ok(fast.speed > CAR.vMax - 0.1 && fast.speed <= CAR.vMax, `speed ${fast.speed}`);
    for (let i = 0; i < 600; i += 1) fast = stepCar(fast, { steer: 0, throttle: 1 }, track, 0.05);
    assert.ok(fast.speed > 13.5 && fast.speed <= CAR.vMax, `speed ${fast.speed}`);
    // The cap itself holds even if a state is handed in at the limit.
    const atLimit = stepCar(
      { ...carAt(20, CAR.vMax), heading: 0, x: 0, y: 0, steerAngle: 0 },
      { steer: 0, throttle: 1 },
      track,
      0.05,
    );
    assert.equal(atLimit.speed, CAR.vMax);

    let slow = { ...carAt(20, 0.4), heading: 0, x: 0, y: 0, steerAngle: 0 };
    for (let i = 0; i < 20; i += 1) slow = stepCar(slow, { steer: 0, throttle: -1 }, track, 0.05);
    assert.equal(slow.speed, 0);
  });

  it("tapers the throttle with speed — one formula for the step and the score", () => {
    assert.equal(longitudinalAccel({ steer: 0, throttle: 1 }, 0), CAR.accelUp, "standing start");
    assert.equal(longitudinalAccel({ steer: 0, throttle: 1 }, CAR.vMax / 2), CAR.accelUp / 2);
    assert.equal(
      longitudinalAccel({ steer: 0, throttle: 1 }, CAR.vMax),
      0,
      "at the limit the throttle asks for nothing",
    );
    assert.equal(
      longitudinalAccel({ steer: 0, throttle: 1 }, CAR.vMax * 2),
      0,
      "and never pushes past it",
    );
    assert.equal(longitudinalAccel({ steer: 0, throttle: -1 }, CAR.vMax), -CAR.brake);
    // The number is not a model of its own: it is exactly what one step adds.
    for (const speed of [0, CAR.launchSpeed, CAR.vMax / 2, CAR.vMax]) {
      const step = stepCar(
        { ...carAt(20, speed), heading: 0, x: 0, y: 0, steerAngle: 0 },
        { steer: 0, throttle: 1 },
        track,
        0.05,
      );
      assert.ok(
        Math.abs(
          step.speed - (speed + longitudinalAccel({ steer: 0, throttle: 1 }, speed) * 0.05),
        ) < 1e-12,
        `speed ${speed}`,
      );
    }
  });

  it("matches actions by what they ask for, angle included", () => {
    assert.equal(sameAction({ steer: 0.5, throttle: 1 }, { steer: 0.5, throttle: 1 }), true);
    assert.equal(sameAction({ steer: 0.5, throttle: 1 }, { steer: 0.35, throttle: 1 }), false);
    assert.equal(sameAction({ steer: 0, throttle: 0.5 }, { steer: 0, throttle: -1 }), false);
  });

  it("counts a boundary crossing once, not once per step outside", () => {
    // Point the car straight at the left edge from the centreline.
    const base = carAt(20, 5);
    const outward = { ...base, heading: base.heading + Math.PI / 2 };
    let car = outward;
    for (let i = 0; i < 20; i += 1) car = stepCar(car, { steer: 0, throttle: 1 }, track, 0.05);
    assert.equal(car.onTrack, false, "2 m/s for a second leaves a 3.5 m half-width");
    assert.equal(car.offTrackCount, 1, "one crossing means one event");
    assert.ok(Math.abs(locate(track, { x: car.x, y: car.y }).offset) > track.halfWidth);
  });

  it("counts a lap when the arc wraps past the start line", () => {
    const car = carAt(track.length - 1, 6);
    const before = locate(track, { x: car.x, y: car.y });
    assert.ok(before.arc > track.length - 1.5, `starts near the line at ${before.arc}`);
    const after = advanceCar(car, { steer: 0, throttle: 1 }, track, 1_000);
    assert.ok(after.arc < before.arc, `crossed into the new lap at ${after.arc}`);
    assert.equal(after.laps, 1);
    assert.equal(after.offTrackCount, 0, "the crossing itself is not an off-track event");
  });

  it("advanceCar spends the wall-clock budget in fixed steps", () => {
    const car = carAt(20, 6);
    const driven = advanceCar(car, { steer: 0, throttle: 1 }, track, 400);
    assert.equal(driven.steps, 8, "400 ms at the 50 ms step");
    assert.ok(driven.distance > 2.2 && driven.distance < 2.9, `distance ${driven.distance}`);
    // Time-accurate even when the budget is not a multiple of dt: one step.
    const odd = advanceCar(car, { steer: 0, throttle: 1 }, track, 30);
    assert.equal(odd.steps, 1);
  });

  it("is deterministic: the same state and action give the same next state", () => {
    const car = carAt(33, 7);
    const action = { steer: 0.5, throttle: 1 };
    assert.deepEqual(advanceCar(car, action, track, 500), advanceCar(car, action, track, 500));
  });

  it("labels the steering levels and actions the way the options are named", () => {
    assert.equal(steerLabel(1), "hard left");
    assert.equal(steerLabel(0.5), "left");
    assert.equal(steerLabel(0), "straight");
    assert.equal(steerLabel(-0.5), "right");
    assert.equal(steerLabel(-1), "hard right");
    assert.equal(actionLabel({ steer: 0.5, throttle: -1 }), "left · brake");
    assert.equal(actionLabel({ steer: -1, throttle: 1 }), "hard right · throttle");
    for (const label of [
      steerLabel(1),
      steerLabel(0.5),
      steerLabel(0),
      steerLabel(-0.5),
      steerLabel(-1),
    ]) {
      assert.ok(label.length <= 48);
    }
  });

  it("launches on the track, rolling forward", () => {
    const car = createCar(track);
    const fix = locate(track, { x: car.x, y: car.y });
    assert.ok(Math.abs(fix.offset) < 1e-6, "starts on the centreline");
    assert.equal(car.speed, CAR.launchSpeed);
    assert.equal(car.onTrack, true);
    assert.equal(car.laps, 0);
    assert.ok(Math.abs(car.heading - fix.heading) < 1e-6, "starts pointing along the track");
    assert.equal(TRACK_WIDTH, track.width);
  });
});
