/**
 * Candidate sampling and rollout prediction — the code's half of the decision.
 * Ten actions (five steering levels × brake/throttle) are simulated forward
 * from the current state, and each one comes back with the numbers the choice
 * is made on: how far the car drifts from the centreline, whether it leaves the
 * track, how much ground it covers, and how harsh the ride is.
 *
 * Everything here is deterministic: same state + same track ⇒ same candidates,
 * same order, same metrics. That is what lets the tests pin the sampler down
 * and the reviewer reproduce a decision by hand.
 */
import {
  CAR,
  actionLabel,
  advanceCar,
  clampUnit,
  longitudinalAccel,
  type CarAction,
  type CarState,
} from "./engine.ts";
import { locate, type Point, type Track } from "./track.ts";

/** Five steering levels, hard left … hard right (positive angle = left). */
export const STEER_LEVELS = [1, 0.5, 0, -0.5, -1] as const;
/** Speed intent: brake, or throttle. */
export const THROTTLE_LEVELS = [-1, 1] as const;

/** How far the predictor looks ahead, ms. Long enough to see the next bend. */
export const CANDIDATE_HORIZON_MS = 2_000;
/** Trajectory sampling for the board; 0.1 s of predicted motion per point. */
export const TRACE_SAMPLE_MS = 100;

/** Lateral acceleration a comfortable car keeps to, m/s². */
const COMFORT_LATERAL = 6;
/** Longitudinal acceleration scale for the comfort score, m/s². */
const COMFORT_LONGITUDINAL = 4;

export type CandidateMetrics = {
  /** Largest |offset| the rollout reaches, m. */
  maxOffset: number;
  /** Signed offset the rollout ends at, m. */
  finalOffset: number;
  /** The rollout leaves the corridor (|offset| > half the track width). */
  collision: boolean;
  /** Times the rollout crosses from inside to outside, for the record. */
  offTrack: number;
  /** Metres covered over the horizon. */
  distance: number;
  /** Speed at the end of the horizon, m/s. */
  finalSpeed: number;
  /** 0 … 1 — 1.00 is the gentlest ride the model can ask for. */
  comfort: number;
  /** Room to the nearer edge at the end of the rollout, m (negative = outside). */
  margin: number;
};

export type Candidate = {
  /** The label that travels to JEV and comes back (≤ 48 chars, unique). */
  label: string;
  action: CarAction;
  metrics: CandidateMetrics;
  /** Predicted path, for the board: one point every TRACE_SAMPLE_MS. */
  trace: Point[];
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Roll one action forward `horizonMs` and measure it. The comfort score is the
 * worst lateral and longitudinal acceleration the rollout actually asks the
 * tyres for — the throttle tapers off towards vMax, so a fast option is a
 * gentler option than a standing start asking for the same thing.
 */
export function rollout(
  state: CarState,
  action: CarAction,
  track: Track,
  opts: { horizonMs?: number; dt?: number } = {},
): { metrics: CandidateMetrics; trace: Point[] } {
  const horizonMs = opts.horizonMs ?? CANDIDATE_HORIZON_MS;
  const dt = opts.dt ?? CAR.dt;
  const steps = Math.max(1, Math.round(horizonMs / (dt * 1000)));
  const stepMs = horizonMs / steps;
  const sampleEvery = Math.max(1, Math.round(TRACE_SAMPLE_MS / stepMs));

  let cursor = state;
  let maxOffset = 0;
  let offTrack = 0;
  let worstLateral = 0;
  let worstLongitudinal = 0;
  const trace: Point[] = [{ x: state.x, y: state.y }];

  for (let i = 0; i < steps; i += 1) {
    // The acceleration this sub-step asks for, from the same formula `stepCar`
    // integrates. The throttle tapers off as speed rises, so the pre-step
    // speed is the hardest longitudinal pull the sub-step sees; the brake is
    // constant. Measuring it here is what keeps `comfort` a reading of the
    // rollout instead of a per-action constant.
    worstLongitudinal = Math.max(
      worstLongitudinal,
      Math.abs(longitudinalAccel(action, cursor.speed)),
    );
    cursor = advanceCar(cursor, action, track, stepMs, dt);
    const fix = locate(track, { x: cursor.x, y: cursor.y });
    maxOffset = Math.max(maxOffset, Math.abs(fix.offset));
    if (Math.abs(fix.offset) > track.halfWidth) offTrack += 1;
    const lateral = (cursor.speed * cursor.speed * Math.tan(cursor.steerAngle)) / CAR.wheelbase;
    worstLateral = Math.max(worstLateral, Math.abs(lateral));
    if ((i + 1) % sampleEvery === 0) trace.push({ x: cursor.x, y: cursor.y });
  }

  const fix = locate(track, { x: cursor.x, y: cursor.y });
  const comfort = Math.max(
    0,
    Math.min(
      1,
      1 -
        0.6 * Math.min(1, worstLateral / COMFORT_LATERAL) -
        0.4 * Math.min(1, worstLongitudinal / COMFORT_LONGITUDINAL),
    ),
  );

  return {
    metrics: {
      maxOffset: round2(maxOffset),
      finalOffset: round2(fix.offset),
      collision: offTrack > 0,
      offTrack,
      distance: round2(cursor.distance - state.distance),
      finalSpeed: round2(cursor.speed),
      comfort: round2(comfort),
      margin: round2(track.halfWidth - Math.abs(fix.offset)),
    },
    trace,
  };
}

/**
 * One action's rollout in the same shape as the sampler's options. Used for
 * the action the car actually drives, so the numbers shown always belong to
 * that action — including a local-policy steer (continuous, not one of the ten
 * sampled levels) or a hold that replays the previous window's action.
 */
export function predictAction(
  state: CarState,
  action: CarAction,
  track: Track,
  opts: { horizonMs?: number; dt?: number } = {},
): Candidate {
  const { metrics, trace } = rollout(state, action, track, opts);
  return { label: actionLabel(action), action, metrics, trace };
}

/** The ten candidates, in a fixed order: brakes first, then throttle. */
export function buildCandidates(
  state: CarState,
  track: Track,
  opts: { horizonMs?: number; dt?: number } = {},
): Candidate[] {
  const candidates: Candidate[] = [];
  for (const steer of STEER_LEVELS) {
    for (const throttle of THROTTLE_LEVELS) {
      const action: CarAction = { steer: clampUnit(steer), throttle };
      candidates.push(predictAction(state, action, track, opts));
    }
  }
  return candidates;
}

/** Find the candidate an answer label names, or null when it names nothing. */
export function readCandidate(label: string, candidates: Candidate[]): Candidate | null {
  return candidates.find((candidate) => candidate.label === label) ?? null;
}

/** Legality report used by the tests and the sanitizer boundary check. */
export function candidateLabels(candidates: Candidate[]): string[] {
  return candidates.map((candidate) => candidate.label);
}
