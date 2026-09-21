/**
 * Question construction for the car demo — the ten predicted actions become one
 * JEV `choice` question, and the answer comes back as a label the controller
 * can act on. The code decides what is possible and what each option costs;
 * JEV only decides which one to take.
 *
 * The label is the option's identity end to end: it goes up in `criteria`, it
 * comes back in `choice`, and it is what the decision stream prints. Labels are
 * short and pairwise distinct, which is also what the request sanitizer
 * (`sanitizeJevRequest`) insists on.
 */
import type { JevRequest } from "../protocol.ts";
import type { Candidate } from "./candidates.ts";
import type { CarAction, CarState } from "./engine.ts";
import { actionLabel } from "./engine.ts";
import type { CarSensors } from "./sensors.ts";
import type { Track } from "./track.ts";

export const CAR_QUESTION = "action";

const INSTRUCTIONS = [
  "You drive a car on a closed 2-D track and must keep it on the road.",
  "Each option is one action — a steering level plus brake or throttle — held until the next decision point.",
  "Every option was already simulated for the next 2 s, and its description holds the results:",
  "the largest lateral distance from the track centre, whether the car leaves the road, the ground covered,",
  "the speed at the end, and a comfort score where 1.00 is the gentlest ride and 0.00 is harsh.",
  "Judge the options on these numbers: staying on the road matters most, then a comfortable ride,",
  "then progress along the track. Prefer options whose predicted path stays inside the track.",
].join(" ");

/** Compact, machine-readable situation: everything the numbers depend on. */
export function carStateSummary(
  state: CarState,
  sensors: CarSensors,
  track: Track,
  lastAction: CarAction | null,
): string {
  const degrees = (radians: number) => Math.round(((radians * 180) / Math.PI) * 10) / 10;
  return JSON.stringify({
    game: "car",
    track: "closed loop",
    track_width_m: track.width,
    speed_mps: Math.round(sensors.speed * 100) / 100,
    offset_m: Math.round(sensors.offset * 100) / 100,
    left_edge_m: Math.round(sensors.leftEdge * 100) / 100,
    right_edge_m: Math.round(sensors.rightEdge * 100) / 100,
    heading_error_deg: degrees(sensors.headingError),
    curvature_1_per_m: Math.round(sensors.curvature * 10_000) / 10_000,
    curvature_ahead_1_per_m: Math.round(sensors.ahead.worstCurvature * 10_000) / 10_000,
    min_radius_ahead_m: Math.round(sensors.ahead.minRadius * 10) / 10,
    on_track: sensors.onTrack,
    lap: sensors.lap,
    off_track_events: sensors.offTrackCount,
    distance_m: Math.round(sensors.distance),
    last_action: lastAction ? actionLabel(lastAction) : "none",
  });
}

/** One option's description: the rollout numbers, in the brief's order. */
export function candidateNote(candidate: Candidate): string {
  const { metrics } = candidate;
  return [
    `max offset ${metrics.maxOffset.toFixed(2)} m`,
    metrics.collision ? "leaves the road" : "stays on the road",
    `covers ${metrics.distance.toFixed(1)} m`,
    `ends at ${metrics.finalSpeed.toFixed(1)} m/s`,
    `comfort ${metrics.comfort.toFixed(2)}`,
  ].join("; ");
}

/**
 * The request. There is no "no question" case here (the sampler always offers
 * ten legal actions), which is why this never returns null — the fixed clock
 * still has a policy for an answer that does not arrive, and that policy lives
 * in the controller.
 */
export function buildCarRequest(
  state: CarState,
  sensors: CarSensors,
  track: Track,
  candidates: Candidate[],
  lastAction: CarAction | null,
): JevRequest {
  const criteria: Record<string, string> = {};
  for (const candidate of candidates) criteria[candidate.label] = candidateNote(candidate);
  return {
    kind: "choice",
    state: carStateSummary(state, sensors, track, lastAction),
    questions: {
      [CAR_QUESTION]: {
        type: "choice",
        instructions: INSTRUCTIONS,
        criteria,
      },
    },
  };
}

/** Read the pick out of an answer map without trusting its shape. */
export function readCarChoice(answers: Record<string, unknown>): {
  choice: string | null;
  confidence: number | null;
  probabilities: Record<string, number> | null;
} {
  const raw = answers[CAR_QUESTION];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { choice: null, confidence: null, probabilities: null };
  }
  const answer = raw as Record<string, unknown>;
  if (answer.type !== "choice") {
    return { choice: null, confidence: null, probabilities: null };
  }
  const probabilities: Record<string, number> = {};
  if (
    answer.probabilities &&
    typeof answer.probabilities === "object" &&
    !Array.isArray(answer.probabilities)
  ) {
    for (const [key, value] of Object.entries(answer.probabilities as Record<string, unknown>)) {
      if (typeof value === "number" && Number.isFinite(value)) probabilities[key] = value;
    }
  }
  return {
    choice: typeof answer.choice === "string" ? answer.choice : null,
    confidence: typeof answer.confidence === "number" ? answer.confidence : null,
    probabilities: Object.keys(probabilities).length > 0 ? probabilities : null,
  };
}

/**
 * Map an answer label onto an action. Returns null for a label that is not one
 * of the options this tick offered — the controller treats that as an illegal
 * answer, exactly like the snake does with an impossible move.
 */
export function readCarAction(
  label: string | null,
  candidates: Candidate[],
): { action: CarAction; label: string } | null {
  if (label === null) return null;
  const found = candidates.find((candidate) => candidate.label === label);
  return found ? { action: found.action, label: found.label } : null;
}

/** Probability rows in candidate order, so the bars never reshuffle. */
export function carProbabilityRows(
  probabilities: Record<string, number> | null,
  candidates: Candidate[],
): { label: string; value: number }[] {
  if (!probabilities) return [];
  const known = candidates.map((candidate) => candidate.label);
  const extra = Object.keys(probabilities).filter((label) => !known.includes(label));
  return [...known, ...extra].map((label) => ({ label, value: probabilities[label] ?? 0 }));
}
