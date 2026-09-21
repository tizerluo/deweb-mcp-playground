/**
 * Decision resolution for the car — the fixed-clock contract, made pure so it
 * can be tested without timers. At decision start the caller asks JEV; at the
 * decision point it hands over whatever answer exists, and this decides what
 * the car does for the next window:
 *
 *   no answer yet   → hold the previous action (the documented timeout policy)
 *   a failed call   → local policy: conservative, centred cruise
 *   an answer that names something that was not on offer → local policy
 *   a usable answer → exactly that action
 *
 * The local policy is also the launch action, so the demo is drivable with no
 * key at all — it just says so, on every row.
 */
import type { DecisionStatus, JevOutcome } from "../decision.ts";
import type { JevDecisionReason } from "../protocol.ts";
import { CAR, clampUnit, type CarAction, type CarState } from "./engine.ts";
import { readCarAction } from "./question.ts";
import type { Candidate } from "./candidates.ts";
import type { CarSensors } from "./sensors.ts";
import { lookAhead, pointAtArc, wrapAngle, type Track } from "./track.ts";

/** Lateral acceleration the local policy will accept in a bend, m/s². */
const LOCAL_LAT_ACCEL = 4;
const LOCAL_MIN_SPEED = 3.5;
const LOCAL_MAX_SPEED = 9;
/** How far ahead the local policy looks for the bend it must slow down for, m. */
function localHorizon(speed: number): number {
  return Math.min(20, Math.max(12, 1.6 * speed + 5));
}

/**
 * The local driver: pure pursuit toward a point on the centreline a
 * speed-scaled distance ahead, holding a speed the tightest bend in its own
 * (longer) look-ahead can take. Conservative by construction — this is the
 * fallback, not a racing line.
 */
export function centreAction(state: CarState, track: Track, sensors: CarSensors): CarAction {
  const lookahead = Math.min(12, Math.max(3, 1.1 * state.speed + 2));
  const aim = pointAtArc(track, sensors.arc + lookahead);
  const distance = Math.max(1e-3, Math.hypot(aim.x - state.x, aim.y - state.y));
  const bearing = Math.atan2(aim.y - state.y, aim.x - state.x);
  const err = wrapAngle(bearing - state.heading);
  // Pure pursuit: the wheel angle that would put the car on that point.
  const desired = Math.atan2(2 * CAR.wheelbase * Math.sin(err), distance);
  const steer = clampUnit(desired / CAR.steerMax);
  const radius = Math.max(3, lookAhead(track, sensors.arc, localHorizon(state.speed)).minRadius);
  const target = Math.min(
    LOCAL_MAX_SPEED,
    Math.max(LOCAL_MIN_SPEED, Math.sqrt(LOCAL_LAT_ACCEL * radius)),
  );
  return { steer, throttle: state.speed < target ? 1 : -1 };
}

export type CarDecision = {
  action: CarAction;
  source: "jev" | "local";
  status: DecisionStatus;
  /**
   * Which branch a timeout took: `hold` replayed the previous action for one
   * window, `local` is the local policy driving — a first window that had
   * nothing to hold, or a second timeout in a row. Null for every other status.
   * The UI words the badge from this, so a timeout never claims a hold it did
   * not make.
   */
  timeoutMode: "hold" | "local" | null;
  /** Machine reason for a degraded decision; the UI localizes it. */
  reason: JevDecisionReason | null;
  /** The pick JEV returned, even when it was not playable. */
  rawChoice: string | null;
  confidence: number | null;
  probabilities: Record<string, number> | null;
  latencyMs: number | null;
  model: string | null;
  cached: boolean;
};

export function resolveCarDecision(args: {
  state: CarState;
  track: Track;
  sensors: CarSensors;
  candidates: Candidate[];
  answer: JevOutcome | null;
  /**
   * The action played last window, plus whether that decision was itself a
   * timeout hold. A hold covers the window right after a delivered decision —
   * never a run of them, or an outage would drive the car off the road.
   */
  previous: { action: CarAction; timeout: boolean } | null;
}): CarDecision {
  const { state, track, sensors, candidates, answer, previous } = args;
  const base: Omit<CarDecision, "action" | "source" | "status"> = {
    timeoutMode: null,
    reason: null,
    rawChoice: null,
    confidence: null,
    probabilities: null,
    latencyMs: null,
    model: null,
    cached: false,
  };
  const local = () => centreAction(state, track, sensors);
  /**
   * Timeout: keep doing what we were doing — for one short window. Once a hold
   * has already covered a window, the local policy takes over again, so a
   * provider that stops answering cannot leave the car driving blind. Which of
   * the two ran is reported in `timeoutMode`, because they are not the same
   * thing to the reader: one replays the last action, the other chooses a new
   * one.
   */
  const hold = () => (previous && !previous.timeout ? previous.action : null);

  if (answer === null) {
    const held = hold();
    return {
      ...base,
      action: held ?? local(),
      source: "local",
      status: "timeout",
      timeoutMode: held ? "hold" : "local",
    };
  }

  if (!answer.ok) {
    return {
      ...base,
      action: local(),
      source: "local",
      status: "degraded",
      reason: answer.reason,
      latencyMs: answer.latencyMs,
    };
  }

  const picked = readCarAction(answer.choice, candidates);
  if (!picked) {
    return {
      ...base,
      action: local(),
      source: "local",
      status: "illegal",
      rawChoice: answer.choice,
      confidence: answer.confidence,
      probabilities: answer.probabilities,
      latencyMs: answer.latencyMs,
      model: answer.model,
      cached: answer.cached,
    };
  }

  return {
    action: picked.action,
    source: "jev",
    status: "answered",
    timeoutMode: null,
    reason: null,
    rawChoice: picked.label,
    confidence: answer.confidence,
    probabilities: answer.probabilities,
    latencyMs: answer.latencyMs,
    model: answer.model,
    cached: answer.cached,
  };
}
