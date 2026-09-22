/**
 * One submission's chat call, and the only retry it is allowed to make.
 *
 * Whether the day's trial or the visitor's wallet pays is always the server's
 * answer (`quota.ts`), never this tab's copy of the counter: that copy is a
 * snapshot, and a second tab of the same visitor, a rolled-over day or a
 * restarted server all leave it stale. The snapshot therefore only chooses
 * which budget to *ask* for — and the answer decides the call:
 *
 * - `quota` is a refusal that costs nothing: no unit is taken and no model is
 *   reached, so the same submission may buy the call and send it again, once.
 *   That is exactly the continuation the panel's own line promises once the
 *   trial is spent, so the visitor never sees a failure their call can recover
 *   from inside the same press of send.
 * - Every other refusal (no key, rate limit, upstream, transport) is final.
 *   Retrying those would put an outage or a malformed request on the visitor's
 *   bill, and a loop here would spend a wallet that has nothing left in it.
 *
 * Pure on purpose: `send` is the only thing that touches the network, so the
 * policy is the same in the browser and in the tests.
 */

export type ChatAttempt = {
  ok: boolean;
  /** The machine reason a failed attempt came back with; null when it never reached the server. */
  reason?: string | null;
};

export type ChatContinuation<A extends ChatAttempt> = {
  /** The attempt whose answer belongs to the visitor. */
  result: A;
  /** Whether the submission ended up buying the call. */
  bought: boolean;
};

export async function chatWithTrialFallback<A extends ChatAttempt>(input: {
  /** What this tab last read from the server; null when it has read nothing yet. */
  trialLeft: number | null;
  /** One attempt: `paid: true` bills the visitor's wallet instead of the trial. */
  send: (paid: boolean) => Promise<A>;
}): Promise<ChatContinuation<A>> {
  // Zero — not `null` — is this tab *knowing* the trial is spent; an unread
  // counter is not a spent one, so it asks for the trial like any other.
  const buy = input.trialLeft === 0;
  const first = await input.send(buy);
  // Nothing left to recover from when this tab already asked for the wallet,
  // or when the attempt failed for a reason a second attempt cannot pay away.
  if (first.ok || buy || first.reason !== "quota") {
    return { result: first, bought: buy };
  }
  // The server is the one that said the trial is gone, so this call is bought.
  // One attempt, and it is the last one either way: a paid call that fails is
  // reported as it is, never paid for twice.
  const bought = await input.send(true);
  return { result: bought, bought: true };
}
