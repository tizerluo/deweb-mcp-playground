/**
 * The clock policy both demos share.
 *
 * Each demo runs on a fixed clock the reader picks: the question goes out at the
 * start of a window and the answer is adopted at its end. A provider slower than
 * the picked window would have every answer thrown away one window late
 * (`api.typesafe.ai` measures ~1.25 s from here), so a window may stretch to
 * cover the reply already in flight — never past the cap, which keeps the game
 * moving and keeps each demo's documented "nothing arrived" path reachable.
 *
 * One constant and one formula, so the snake and the car cannot drift apart on
 * a number the rate budget depends on.
 */

/** Hard ceiling on a demo window, ms. */
export const TICK_WAIT_CAP_MS = 2_600;

/** Milliseconds of slack a window gives a reply on top of the last latency. */
export const TICK_WAIT_SLACK_MS = 120;

/** The wait the next window will use, given the last measured latency. */
export function stretchWait(pickedMs: number, lastLatencyMs: number): number {
  return Math.min(TICK_WAIT_CAP_MS, Math.max(pickedMs, Math.ceil(lastLatencyMs) + TICK_WAIT_SLACK_MS));
}
