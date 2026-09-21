/**
 * Car engine — a kinematic bicycle model stepped at a fixed dt, plus the two
 * things a driving demo needs to count: how often the car leaves the track and
 * how many laps it has put in. Pure functions over an immutable state, so the
 * tests can pin the integration down and the rollout can copy a state without
 * the real one noticing.
 *
 * Model: the front wheel angle δ moves toward the commanded steer at a bounded
 * rate; yaw rate is v·tan δ / wheelbase; position integrates at v·cos/sin θ.
 * Speed is bounded (no reverse) and so is the acceleration, which is what makes
 * the choice between throttle and brake a real decision.
 */
import { locate, type Track } from "./track.ts";

export const CAR = {
  /** Top speed, m/s. */
  vMax: 14,
  /** Throttle acceleration at zero speed, m/s² — it falls off towards vMax. */
  accelUp: 3,
  /** Brake deceleration, m/s² (never reverses). */
  brake: 3.5,
  /** Steering angle rate, rad/s. */
  steerRate: 1.9,
  /** Maximum steering angle, rad (≈ 28.6°). */
  steerMax: 0.5,
  /** Wheelbase, m. */
  wheelbase: 2.4,
  /** Rollout / integration step, s. */
  dt: 0.05,
  /** Launch speed, m/s — a rolling start, so the demo is moving on tick one. */
  launchSpeed: 3.5,
} as const;

/**
 * What the model is asked to do until the next decision point. `steer` is the
 * steering level (−1 hard left … +1 hard right) — a target wheel angle the
 * steering moves towards at a bounded rate, so the levels stay distinguishable;
 * `throttle` is +1 accelerate, −1 brake.
 */
export type CarAction = { steer: number; throttle: number };

export type CarState = {
  x: number;
  y: number;
  /** Heading in radians, world frame. */
  heading: number;
  /** Current speed, m/s. */
  speed: number;
  /** Current front-wheel angle, rad. */
  steerAngle: number;
  /** Integration steps taken. */
  steps: number;
  /** Metres driven. */
  distance: number;
  /** Times the car crossed from the track to the outside. */
  offTrackCount: number;
  onTrack: boolean;
  /** Completed laps. */
  laps: number;
  /** Last known stretch position on the centreline, m. */
  arc: number;
  /** True while the car is still on the track. */
  status: "driving";
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function clampUnit(value: number): number {
  return clamp(value, -1, 1);
}

/**
 * Labels for the five steering levels the candidate sampler uses. The sign
 * follows the world frame: the car turns counter-clockwise for a positive wheel
 * angle, which is a left turn on a top-down map, so +1 is hard left.
 */
export function steerLabel(steer: number): string {
  if (steer >= 0.75) return "hard left";
  if (steer > 0.1) return "left";
  if (steer >= -0.1) return "straight";
  if (steer > -0.75) return "right";
  return "hard right";
}

/** Stable human label of an action ("left · brake"). */
export function actionLabel(action: CarAction): string {
  return `${steerLabel(action.steer)} · ${action.throttle > 0 ? "throttle" : "brake"}`;
}

/** True when two actions ask for exactly the same steering and throttle. */
export function sameAction(a: CarAction, b: CarAction): boolean {
  return a.steer === b.steer && a.throttle === b.throttle;
}

/**
 * The longitudinal acceleration an action asks for at a given speed, m/s².
 * The throttle pushes hardest from standstill and tapers off towards vMax; the
 * brake is a constant deceleration and never drives the car backwards.
 *
 * Exported because it is the single source of that formula: `stepCar`
 * integrates it and the candidate rollout scores comfort on the acceleration
 * the action would really ask for, so a prediction cannot price a throttle
 * like a fixed push the car never gets at speed.
 */
export function longitudinalAccel(action: CarAction, speed: number): number {
  return action.throttle > 0 ? CAR.accelUp * Math.max(0, 1 - speed / CAR.vMax) : -CAR.brake;
}

/** Put the car on the centreline at `startArc`, rolling forward. */
export function createCar(track: Track, opts: { startArc?: number } = {}): CarState {
  const startArc = opts.startArc ?? 0;
  const index = Math.max(0, track.arc.findIndex((value) => value > startArc % track.length) - 1);
  const from = track.centerline[index] ?? track.centerline[0];
  const to = track.centerline[(index + 1) % track.centerline.length];
  const heading = Math.atan2(to.y - from.y, to.x - from.x);
  const local = (startArc - track.arc[index]) / Math.max(1e-9, track.lengths[index]);
  const x = from.x + (to.x - from.x) * local;
  const y = from.y + (to.y - from.y) * local;
  return {
    x,
    y,
    heading,
    speed: CAR.launchSpeed,
    steerAngle: 0,
    steps: 0,
    distance: 0,
    offTrackCount: 0,
    onTrack: true,
    laps: 0,
    arc: startArc,
    status: "driving",
  };
}

/**
 * One integration step with the action held. The counters (off-track
 * transitions, laps) move here, so a rollout over many steps reports what the
 * real drive would have counted.
 */
export function stepCar(
  state: CarState,
  action: CarAction,
  track: Track,
  dt: number = CAR.dt,
): CarState {
  // The steering level is a target wheel angle, reached at the steering rate.
  const targetAngle = clampUnit(action.steer) * CAR.steerMax;
  const maxDelta = CAR.steerRate * dt;
  const steerAngle = clamp(
    state.steerAngle + clamp(targetAngle - state.steerAngle, -maxDelta, maxDelta),
    -CAR.steerMax,
    CAR.steerMax,
  );
  // Throttle pushes hardest from low speed and tapers off towards vMax; the
  // brake is a constant deceleration and never drives the car backwards.
  const accel = longitudinalAccel(action, state.speed);
  const speed = clamp(state.speed + accel * dt, 0, CAR.vMax);
  const heading = state.heading + (speed / CAR.wheelbase) * Math.tan(steerAngle) * dt;
  const x = state.x + Math.cos(heading) * speed * dt;
  const y = state.y + Math.sin(heading) * speed * dt;
  const fix = locate(track, { x, y });
  const onTrack = Math.abs(fix.offset) <= track.halfWidth;
  // A lap is the arc wrapping past the start line: it can only jump backwards.
  const wrapped = fix.arc < state.arc - track.length / 2;
  return {
    x,
    y,
    heading,
    speed,
    steerAngle,
    steps: state.steps + 1,
    distance: state.distance + speed * dt,
    offTrackCount: state.offTrackCount + (state.onTrack && !onTrack ? 1 : 0),
    onTrack,
    laps: state.laps + (wrapped ? 1 : 0),
    arc: fix.arc,
    status: "driving",
  };
}

/** Drive `ms` of wall time with the action held; the last step takes the rest. */
export function advanceCar(
  state: CarState,
  action: CarAction,
  track: Track,
  ms: number,
  dt: number = CAR.dt,
): CarState {
  const steps = Math.max(1, Math.round(ms / (dt * 1000)));
  const step = ms / steps / 1000;
  let next = state;
  for (let i = 0; i < steps; i += 1) next = stepCar(next, action, track, step);
  return next;
}
