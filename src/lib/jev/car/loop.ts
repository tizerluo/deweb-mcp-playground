/**
 * The car demo's decision loop — no React in it, and no clock it does not own:
 * `now` and `sleep` come in through the port, which is what lets the lifecycle
 * rules be tested by hand instead of by waiting.
 *
 * Fixed clock: one `choice` per window, the question goes out at the start of
 * the window, the answer is adopted at the end of it, the previous action is
 * held when nothing arrived. Pause / Reset cancel a run by bumping its epoch,
 * and every write after an `await` re-checks that epoch first — an answer that
 * lands after the driver pressed Pause must not move the car, append a decision
 * row, or overwrite the run Reset just put on the start line.
 */
import type { JevRound } from "../decision.ts";
import { stretchWait } from "../demo-clock.ts";
import type { JevRequest } from "../protocol.ts";
import { advanceCar, type CarAction, type CarState } from "./engine.ts";
import { buildCandidates, predictAction, type Candidate } from "./candidates.ts";
import { resolveCarDecision, type CarDecision } from "./controller.ts";
import { buildCarRequest, readCarChoice } from "./question.ts";
import { senseCar, type CarSensors } from "./sensors.ts";
import type { Track, TrackFix } from "./track.ts";

/** One decision window, settled: everything the caller needs to render it. */
export type CarTick = {
  /** The state after the window was lawfully driven. */
  state: CarState;
  /** The state the decision was made on. */
  from: CarState;
  fix: TrackFix;
  sensors: CarSensors;
  candidates: Candidate[];
  /**
   * The executed action's own rollout, over the same horizon the candidates
   * were measured on — what the UI shows. Recomputed from `decision.action`
   * rather than looked up among `candidates` by label, so a local fallback
   * (continuous steering, not one of the ten levels) and a held action are
   * displayed as the actions they are.
   */
  prediction: Candidate;
  decision: CarDecision;
  /** The request that went on the wire. */
  request: JevRequest;
  /** The round that resolved in time; null means nothing adopted this window. */
  round: JevRound | null;
  /** The wait this window actually used (picked period, possibly stretched). */
  waitedMs: number;
};

export type CarLoopPort = {
  /** The world: the track, and the car as it stands. */
  getTrack(): Track;
  getState(): CarState;
  /** Put the car back on the start line (cleared decision log); returns it. */
  newRun(): CarState;
  /** The decision period the reader picked, ms. */
  getPeriodMs(): number;
  /** One JEV decision, billed as a TAP-10 round trip. */
  decide(request: JevRequest): Promise<JevRound | null>;
  /** The wait the next window is about to use — display only. */
  noteWait(ms: number): void;
  /** Settle one window: append its decision row, adopt its state, return row id. */
  commitTick(tick: CarTick): string;
  /** A round that resolved after its window was already driven. */
  patchTick(rowId: string, round: JevRound): void;
  /** Run-state for the controls. */
  setRunning(running: boolean): void;
  now?(): number;
  sleep?(ms: number): Promise<void>;
};

export type CarRunner = {
  /** Drive. Idempotent. */
  start(): void;
  /** Stop after the window in flight; car and log are kept. */
  pause(): void;
  /** Stop, cancel the window in flight, and put the car back on the start line. */
  reset(): void;
};

function defaultSleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/** What a round looks like to the decision resolver. */
function toCarOutcome(round: JevRound | null): Parameters<typeof resolveCarDecision>[0]["answer"] {
  if (!round) return null;
  if (!round.ok) {
    return {
      ok: false,
      reason: round.reason ?? "network",
      latencyMs: round.latencyMs,
      message: round.message,
    };
  }
  const read = readCarChoice(round.answers ?? {});
  return {
    ok: true,
    choice: read.choice,
    confidence: read.confidence,
    probabilities: read.probabilities,
    latencyMs: round.latencyMs,
    model: round.model ?? "",
    cached: round.cached,
  };
}

export function createCarRunner(port: CarLoopPort): CarRunner {
  const now = port.now ?? (() => Date.now());
  const sleep = port.sleep ?? defaultSleep;

  /** Bumped by start / pause / reset; a stale window compares against it. */
  let epoch = 0;
  let running = false;
  /** How slow the provider was on its last successful answer. */
  let latencyMs = 0;
  /** The action played last window — what a timeout holds onto, once. */
  let lastAction: { action: CarAction; timeout: boolean } | null = null;

  const isCurrent = (mine: number) => mine === epoch;

  /**
   * Track a round without ever letting it reject: a call that fails or throws
   * is "no answer arrived", which the fixed clock already has a policy for.
   */
  function trackRound(raw: Promise<JevRound | null> | null): {
    pending: Promise<JevRound | null> | null;
    box: { round: JevRound | null };
  } {
    const box: { round: JevRound | null } = { round: null };
    if (!raw) return { pending: null, box };
    // One hop only: a second `.then` would put the box a microtask behind the
    // clock, and an instantly-resolved round (a cache hit) would look like a
    // timeout even though it arrived in the window.
    const pending = raw.then(
      (round) => {
        box.round = round;
        return round;
      },
      () => {
        box.round = null;
        return null;
      },
    );
    return { pending, box };
  }

  async function drive(myEpoch: number, first: CarState): Promise<void> {
    const track = port.getTrack();
    let state = first;
    while (isCurrent(myEpoch)) {
      // 1. The code decides the facts and predicts every option first.
      const { fix, sensors } = senseCar(state, track);
      const candidates = buildCandidates(state, track);
      if (!isCurrent(myEpoch)) return; // the sampler is pure but not instant
      const request = buildCarRequest(
        state,
        sensors,
        track,
        candidates,
        lastAction?.action ?? null,
      );
      const picked = port.getPeriodMs();
      // A window may stretch to cover the reply already in flight, capped.
      const waitedMs = stretchWait(picked, latencyMs);
      port.noteWait(waitedMs);
      const startedAt = now();

      // 2. Ask at the start of the window; the answer is adopted at its end.
      const { pending, box } = trackRound(port.decide(request));
      await sleep(Math.max(0, waitedMs - (now() - startedAt)));
      // 3. Pause / Reset cancel by epoch. Nothing below this line may write
      //    state for a run the driver already left.
      if (!isCurrent(myEpoch)) return;

      const round = box.round;
      const decision = resolveCarDecision({
        state,
        track,
        sensors,
        candidates,
        answer: toCarOutcome(round),
        previous: lastAction,
      });
      const next = advanceCar(state, decision.action, track, waitedMs);
      // What the action we just decided on is predicted to do. Its own
      // rollout: the numbers the card shows and the path the board draws bright
      // always belong to the action that ran.
      const prediction = predictAction(state, decision.action, track);
      const rowId = port.commitTick({
        state: next,
        from: state,
        fix,
        sensors,
        candidates,
        prediction,
        decision,
        request,
        round,
        waitedMs,
      });
      lastAction = { action: decision.action, timeout: decision.status === "timeout" };
      state = next;

      // Remember how slow the provider is (successful answers only): the next
      // window then waits long enough to actually adopt a reply, and falls back
      // to the picked period once calls start failing.
      if (round?.ok) latencyMs = round.latencyMs;
      else if (round) latencyMs = Math.min(latencyMs, picked);

      if (pending && round === null) {
        // The round resolved after this window was already driven. A late
        // *answer* keeps the envelope it travelled in and says it missed its
        // window; the row is already written and the id is unique, so a log
        // that was reset in between simply has no such row to patch.
        void pending.then((late) => {
          if (late) port.patchTick(rowId, late);
        });
      }
    }
  }

  function stop(): void {
    const wasRunning = running;
    running = false;
    epoch += 1;
    if (wasRunning) port.setRunning(false);
  }

  return {
    start() {
      if (running) return;
      const state = port.getState();
      running = true;
      epoch += 1;
      const myEpoch = epoch;
      port.setRunning(true);
      void drive(myEpoch, state)
        .catch(() => undefined) // a throwing port must not take the page down
        .finally(() => {
          if (!isCurrent(myEpoch)) return; // a newer run owns the controls now
          running = false;
          port.setRunning(false);
        });
    },
    pause() {
      if (!running) return;
      stop();
    },
    reset() {
      stop();
      lastAction = null;
      port.newRun();
    },
  };
}
