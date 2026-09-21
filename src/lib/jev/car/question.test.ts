/**
 * Request-shape regression: what the car sends is what the server's sanitizer
 * accepts (labels short and distinct, two or more options, instructions
 * present), and what comes back maps onto an action.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { JEV_MAX_LABEL_CHARS, sanitizeJevRequest } from "../protocol.ts";
import { buildCandidates } from "./candidates.ts";
import { CAR, createCar } from "./engine.ts";
import {
  CAR_QUESTION,
  buildCarRequest,
  carProbabilityRows,
  carStateSummary,
  candidateNote,
  readCarAction,
  readCarChoice,
} from "./question.ts";
import { createTrack } from "./track.ts";
import { senseCar } from "./sensors.ts";

const track = createTrack();
const state = createCar(track);
const { sensors } = senseCar(state, track);
const candidates = buildCandidates(state, track);

describe("car question / wire shape", () => {
  it("builds a request the server's sanitizer accepts unchanged", () => {
    const request = buildCarRequest(state, sensors, track, candidates, null);
    const sanitized = sanitizeJevRequest(request);
    assert.ok(sanitized.ok, sanitized.ok ? "" : sanitized.message);
    const question = sanitized.request.questions[CAR_QUESTION];
    assert.equal(sanitized.request.kind, "choice");
    assert.equal(question.type, "choice");
    assert.ok(question.instructions.length > 0 && question.instructions.length <= 1_200);
    const labels = Object.keys(question.criteria);
    assert.equal(labels.length, 10, "ten options reach the model");
    assert.ok(labels.length >= 2, "a choice needs at least two options");
    assert.equal(new Set(labels).size, labels.length);
    for (const label of labels) {
      assert.ok(label.length <= JEV_MAX_LABEL_CHARS, label);
      assert.ok((question.criteria[label] ?? "").length <= 240);
    }
    // The sanitizer returns the same object it validated: nothing is dropped.
    assert.deepEqual(
      Object.keys(question.criteria),
      candidates.map((c) => c.label),
    );
  });

  it("describes the situation as machine-readable facts", () => {
    const request = buildCarRequest(state, sensors, track, candidates, {
      steer: 0.5,
      throttle: -1,
    });
    const parsed = JSON.parse(request.state) as Record<string, unknown>;
    for (const key of [
      "game",
      "track_width_m",
      "speed_mps",
      "offset_m",
      "left_edge_m",
      "right_edge_m",
      "heading_error_deg",
      "curvature_1_per_m",
      "curvature_ahead_1_per_m",
      "min_radius_ahead_m",
      "on_track",
      "lap",
      "off_track_events",
      "distance_m",
      "last_action",
    ]) {
      assert.ok(key in parsed, `state is missing ${key}`);
    }
    assert.equal(parsed.game, "car");
    assert.equal(parsed.last_action, "left · brake");
    assert.equal(parsed.track_width_m, track.width);
    assert.equal(parsed.on_track, true);
    assert.ok(request.state.length < 1_000, "state stays well inside the 4 000 char budget");
    assert.equal(
      carStateSummary(state, sensors, track, null).includes('"last_action":"none"'),
      true,
    );
  });

  it("writes each option's predicted numbers into its description", () => {
    const candidate = candidates[0];
    const note = candidateNote(candidate);
    assert.ok(note.includes("max offset"));
    assert.ok(note.includes(candidate.metrics.collision ? "leaves the road" : "stays on the road"));
    assert.ok(note.includes(`comfort ${candidate.metrics.comfort.toFixed(2)}`));
    assert.ok(note.length <= 240);
  });

  it("sends the model the comfort the kinematics really ask for at the limit", () => {
    // At vMax a throttle has nothing left to give: the option must not reach
    // the model priced like a fixed 3 m/s² push (R2-01 advertised 0.70 there).
    const top = { ...state, speed: CAR.vMax, steerAngle: 0 };
    const flat = buildCandidates(top, track).find((entry) => entry.label === "straight · throttle");
    assert.ok(flat, "straight · throttle is on offer");
    assert.equal(flat.metrics.comfort, 1);
    assert.ok(candidateNote(flat).includes("comfort 1.00"), candidateNote(flat));
  });

  it("truncates a long label, and refuses one that collides after truncation", () => {
    const base = buildCarRequest(state, sensors, track, candidates, null);
    const question = base.questions[CAR_QUESTION];
    assert.equal(question.type, "choice");
    const padded = "straight · throttle".padEnd(60, " ");
    const single = sanitizeJevRequest({
      ...base,
      questions: {
        [CAR_QUESTION]: {
          type: "choice",
          instructions: question.instructions,
          criteria: { [padded]: "one", "left · brake": "two" },
        },
      },
    });
    assert.ok(single.ok, "a uniquely truncating label is accepted");
    if (single.ok) {
      const asked = single.request.questions[CAR_QUESTION];
      if (asked.type !== "choice") throw new Error("expected a choice question back");
      const labels = Object.keys(asked.criteria);
      assert.equal(labels.length, 2);
      for (const label of labels) assert.ok(label.length <= JEV_MAX_LABEL_CHARS);
    }
    // Two car-style labels that only differ past the truncation point: refused,
    // because the rebuilt choice would have fewer options than it was asked for.
    const collide = sanitizeJevRequest({
      ...base,
      questions: {
        [CAR_QUESTION]: {
          type: "choice",
          instructions: question.instructions,
          criteria: {
            ["hard left · brake".padEnd(52, " ") + "A"]: "one",
            ["hard left · brake".padEnd(52, " ") + "B"]: "two",
          },
        },
      },
    });
    assert.equal(collide.ok, false);
    if (!collide.ok) assert.equal(collide.reason, "invalid_request");
  });

  it("reads an answer without trusting its shape", () => {
    const answer = {
      [CAR_QUESTION]: {
        type: "choice",
        choice: "left · throttle",
        confidence: 0.72,
        probabilities: { "left · throttle": 0.72, "straight · brake": 0.28, junk: Number.NaN },
      },
    };
    const read = readCarChoice(answer);
    assert.equal(read.choice, "left · throttle");
    assert.equal(read.confidence, 0.72);
    assert.deepEqual(read.probabilities, { "left · throttle": 0.72, "straight · brake": 0.28 });
    assert.deepEqual(readCarChoice({}), { choice: null, confidence: null, probabilities: null });
    assert.deepEqual(readCarChoice({ [CAR_QUESTION]: { type: "score", score: 3 } }), {
      choice: null,
      confidence: null,
      probabilities: null,
    });
    assert.deepEqual(readCarChoice({ [CAR_QUESTION]: "left · throttle" }), {
      choice: null,
      confidence: null,
      probabilities: null,
    });
  });

  it("maps a chosen label back onto an action, and nothing else", () => {
    const picked = readCarAction("hard right · throttle", candidates);
    assert.ok(picked);
    assert.deepEqual(picked.action, { steer: -1, throttle: 1 });
    assert.equal(readCarAction("teleport", candidates), null);
    assert.equal(readCarAction(null, candidates), null);
    // Labels are matched exactly: no trimming, no case folding.
    assert.equal(readCarAction(" Hard right · throttle", candidates), null);
  });

  it("keeps probability rows in candidate order, with strays at the end", () => {
    const rows = carProbabilityRows(
      { "straight · throttle": 0.5, ghost: 0.1, "hard left · brake": 0.4 },
      candidates,
    );
    assert.deepEqual(
      rows.map((row) => row.label),
      [...candidates.map((candidate) => candidate.label), "ghost"],
    );
    assert.equal(rows[0].value, 0.4, "candidate order, not answer order");
    assert.equal(rows.at(-1)?.value, 0.1);
    assert.deepEqual(carProbabilityRows(null, candidates), []);
  });
});
