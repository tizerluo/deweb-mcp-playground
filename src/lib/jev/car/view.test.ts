/**
 * The car's decision → decision-stream mapping, without a browser: which words
 * each status gets, and above all that a timeout is labelled by the branch that
 * actually ran — one window may hold the last action, but a first window with
 * nothing to hold (or a second timeout in a row) is the local policy driving.
 * Both used to render "holding the last action".
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { LOCALES, t } from "../../i18n.ts";
import { buildCandidates } from "./candidates.ts";
import { centreAction, resolveCarDecision } from "./controller.ts";
import { createCar } from "./engine.ts";
import { senseCar } from "./sensors.ts";
import { createTrack } from "./track.ts";
import { carDecisionView, carStatusKey } from "./view.ts";

const track = createTrack();

/** Everything one decision needs, from the launch state. */
function context() {
  const state = createCar(track);
  const { sensors } = senseCar(state, track);
  return { state, track, sensors, candidates: buildCandidates(state, track) };
}

const previous = { action: { steer: 1, throttle: 1 }, timeout: false };
const ctx = context();
const local = centreAction(ctx.state, track, ctx.sensors);

describe("car decision view / status words", () => {
  it("labels each timeout with the branch that ran", () => {
    // First window: nothing arrived and there is nothing to hold.
    const first = resolveCarDecision({ ...ctx, answer: null, previous: null });
    assert.equal(first.timeoutMode, "local");
    assert.equal(carDecisionView(first).statusKey, "jev.car.state.timeout_local");
    assert.deepEqual(first.action, local, "the local policy chose this one");

    // One hold: the previous action is replayed, for one window.
    const held = resolveCarDecision({ ...ctx, answer: null, previous });
    assert.equal(held.timeoutMode, "hold");
    assert.equal(carDecisionView(held).statusKey, "jev.car.state.timeout_hold");
    assert.deepEqual(held.action, previous.action);

    // A second timeout in a row: the hold is spent, the local policy drives.
    const second = resolveCarDecision({
      ...ctx,
      answer: null,
      previous: { ...previous, timeout: true },
    });
    assert.equal(second.timeoutMode, "local");
    assert.equal(carDecisionView(second).statusKey, "jev.car.state.timeout_local");
    assert.deepEqual(second.action, local);
    assert.notDeepEqual(second.action, previous.action, "not the held action");
  });

  it("keeps the other statuses on one key each, with no branch attached", () => {
    const answered = resolveCarDecision({
      ...ctx,
      answer: {
        ok: true,
        choice: ctx.candidates[5].label,
        confidence: 0.63,
        probabilities: null,
        latencyMs: 240,
        model: "jev-1.13",
        cached: false,
      },
      previous: null,
    });
    const degraded = resolveCarDecision({
      ...ctx,
      answer: { ok: false, reason: "no_key", latencyMs: 3 },
      previous,
    });
    const illegal = resolveCarDecision({
      ...ctx,
      answer: {
        ok: true,
        choice: "teleport",
        confidence: 0.9,
        probabilities: null,
        latencyMs: 180,
        model: "jev-1.13",
        cached: false,
      },
      previous: null,
    });
    assert.equal(carStatusKey(answered), "jev.car.state.answered");
    assert.equal(carStatusKey(degraded), "jev.car.state.degraded");
    assert.equal(carStatusKey(illegal), "jev.car.state.illegal");
    for (const decision of [answered, degraded, illegal]) {
      assert.equal(decision.timeoutMode, null);
      assert.equal(carDecisionView(decision).statusKey, carStatusKey(decision));
    }
  });

  it("carries the played action through as the pick, and the evidence with it", () => {
    const decision = resolveCarDecision({ ...ctx, answer: null, previous });
    const view = carDecisionView(decision);
    assert.equal(view.source, "local");
    assert.equal(view.status, "timeout");
    assert.equal(view.pick, "hard left · throttle", "the action that was replayed");
    assert.equal(view.rawChoice, null);
    assert.equal(view.latencyMs, null);
  });

  it("has words for every key it can render, in all four locales", () => {
    const keys = [
      "jev.car.state.answered",
      "jev.car.state.forced",
      "jev.car.state.timeout",
      "jev.car.state.timeout_hold",
      "jev.car.state.timeout_local",
      "jev.car.state.illegal",
      "jev.car.state.degraded",
    ];
    for (const { id } of LOCALES) {
      for (const key of keys) {
        const text = t(key, {}, id);
        assert.notEqual(text, key, `${id} is missing ${key}`);
        assert.notEqual(text.trim(), "", `${id} has an empty ${key}`);
      }
    }
    // The two timeout branches must not say the same thing: that was the bug.
    for (const { id } of LOCALES) {
      assert.notEqual(
        t("jev.car.state.timeout_hold", {}, id),
        t("jev.car.state.timeout_local", {}, id),
        `${id} words both timeout branches alike`,
      );
    }
  });
});
