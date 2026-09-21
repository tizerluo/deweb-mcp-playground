/**
 * The demo's tick loop — no React in it, and no clock it does not own: `now`
 * and `sleep` come in through the port, which is what lets the lifecycle rules
 * below be tested by hand instead of by waiting.
 *
 * Fixed clock: one `choice` per tick, the question goes out at tick start, the
 * answer is adopted at tick end, straight when nothing arrived. Pause / Reset /
 * a fresh round cancel a run by bumping its epoch, and every write after an
 * `await` re-checks that epoch first — an answer that lands after the reader
 * pressed Pause must not move the snake, append a decision row, or overwrite
 * the round Reset just put in its place.
 */
import type { JevRound } from "../decision.ts";
import { TICK_WAIT_CAP_MS, stretchWait } from "../demo-clock.ts";
import type { JevRequest } from "../protocol.ts";
import { analyzeBoard, type BoardAnalysis } from "./analysis.ts";
import { resolveSnakeDecision, type JevOutcome, type SnakeDecision } from "./controller.ts";
import { stepGame, type GameState } from "./engine.ts";
import { buildSnakeRequest, readSnakeChoice } from "./question.ts";

/**
 * A JEV round as this loop needs it — the shared shape (`../decision.ts`), kept
 * under the demo's own name so readers of this file see what it means here.
 */
export type SnakeRound = JevRound;

/** Hard ceiling on a tick; the constraint is shared with the car demo. */
export { TICK_WAIT_CAP_MS };

/** One tick, settled: everything the caller needs to render it. */
export type SnakeTick = {
  /** The round after this tick was lawfully applied. */
  game: GameState;
  /** The request that went on the wire (null when the move was forced). */
  request: JevRequest | null;
  /** The analysis the decision was made on. */
  analysis: BoardAnalysis;
  decision: SnakeDecision;
  /** The round that resolved in time; null means nothing adopted this tick. */
  round: SnakeRound | null;
  /** The wait this tick actually used (may exceed the picked speed, capped). */
  waitedMs: number;
};

export type SnakeLoopPort = {
  /** The round in play. The loop reads it, only `commitTick` replaces it. */
  getGame(): GameState;
  /** Put a fresh round in play (new seed, cleared decision log); returns it. */
  newRound(): GameState;
  /** The tick length the reader picked. */
  getSpeedMs(): number;
  /** One JEV decision, billed as a TAP-10 round trip. */
  decide(request: JevRequest): Promise<SnakeRound | null>;
  /** The wait the next tick is about to use — display only. */
  noteWait(ms: number): void;
  /** Settle one tick: append its decision row, adopt its state, return the row id. */
  commitTick(tick: SnakeTick): string;
  /** A round that resolved after its tick was already played. */
  patchTick(rowId: string, round: SnakeRound): void;
  /** Run-state for the controls. */
  setRunning(running: boolean): void;
  now?(): number;
  sleep?(ms: number): Promise<void>;
};

export type SnakeRunner = {
  /** Play. Idempotent; starts a fresh round when the current one is over. */
  start(): void;
  /** Stop after the tick in flight; round and log are kept. */
  pause(): void;
  /** Stop, cancel the tick in flight, and put a fresh round in play. */
  reset(): void;
};

function defaultSleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/** What a round looks like to the decision resolver. */
function toSnakeOutcome(round: SnakeRound | null): JevOutcome | null {
  if (!round) return null;
  if (!round.ok) {
    return {
      ok: false,
      reason: round.reason ?? "network",
      latencyMs: round.latencyMs,
      message: round.message,
    };
  }
  const read = readSnakeChoice(round.answers ?? {});
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

export function createSnakeRunner(port: SnakeLoopPort): SnakeRunner {
  const now = port.now ?? (() => Date.now());
  const sleep = port.sleep ?? defaultSleep;

  /** Bumped by start / pause / reset; a stale tick compares against it. */
  let epoch = 0;
  let running = false;
  /** How slow the provider was on its last successful answer. */
  let latencyMs = 0;

  const isCurrent = (mine: number) => mine === epoch;

  /**
   * Track a round without ever letting it reject: a call that fails or throws
   * is "no answer arrived", which the fixed clock already has a policy for.
   */
  function trackRound(raw: Promise<SnakeRound | null> | null): {
    pending: Promise<SnakeRound | null> | null;
    box: { round: SnakeRound | null };
  } {
    const box: { round: SnakeRound | null } = { round: null };
    if (!raw) return { pending: null, box };
    const pending = raw.then(
      (round) => round,
      () => null,
    );
    void pending.then((round) => {
      box.round = round;
    });
    return { pending, box };
  }

  async function play(myEpoch: number, first: GameState): Promise<void> {
    let game = first;
    while (isCurrent(myEpoch) && game.status === "running") {
      // 1. The code decides the facts before anything is asked.
      const analysis = analyzeBoard(game);
      const request = buildSnakeRequest(game, analysis);
      const selectedMs = port.getSpeedMs();
      // A tick may stretch to cover the reply already in flight, capped.
      const waitedMs = request ? stretchWait(selectedMs, latencyMs) : selectedMs;
      port.noteWait(waitedMs);
      const startedAt = now();

      // 2. Ask at tick start; the answer is adopted at tick end (or not).
      const { pending, box } = trackRound(request ? port.decide(request) : null);
      await sleep(Math.max(0, waitedMs - (now() - startedAt)));
      // 3. Pause / Reset / a newer run cancel by epoch. Nothing below this line
      //    may write state for a run the reader already left.
      if (!isCurrent(myEpoch)) return;

      const round = box.round;
      const decision = resolveSnakeDecision({ analysis, answer: toSnakeOutcome(round) });
      const next = stepGame(game, decision.direction);
      const rowId = port.commitTick({
        game: next,
        request,
        analysis,
        decision,
        round,
        waitedMs,
      });
      game = next;

      // Remember how slow the provider is (successful answers only): the next
      // tick then waits long enough to actually adopt a reply, and falls back
      // to the picked speed once calls start failing.
      if (round?.ok) latencyMs = round.latencyMs;
      else if (round) latencyMs = Math.min(latencyMs, selectedMs);

      if (pending && round === null) {
        // The round resolved after this tick was already played. A late *answer*
        // keeps the letter pair it travelled in and says it missed its tick; a
        // round that failed after the tick stays "no reply" with its refund, so
        // nothing claims a reply that never came. The row is already written and
        // the id is unique, so a log that was reset in between simply has no
        // such row to patch.
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
      let game = port.getGame();
      // Game over is not a dead end: "再来一局" really deals a new round.
      if (game.status !== "running") game = port.newRound();
      running = true;
      epoch += 1;
      const myEpoch = epoch;
      port.setRunning(true);
      void play(myEpoch, game)
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
      port.newRound();
    },
  };
}
