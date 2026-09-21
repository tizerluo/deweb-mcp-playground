/**
 * One decision row, as the message strip reads it.
 *
 * A row can be in exactly three message states, and they must not be confused
 * with each other: the rules forced the move (nothing was sent at all), the
 * request never went out (no escrow, no letter — the wallet could not pay, or
 * the call was refused before sending), or a letter did go out and the round
 * either settled or came back empty. The old strip treated "no requestId" as
 * "no reply, refunded", which claimed a refund for money that was never held.
 *
 * Structural input on purpose: the tests drive it with plain objects.
 */

export type MessageRowInput = {
  /** This decision asked JEV (false for a rules-forced move, which sends nothing). */
  requested: boolean;
  envelope: { requestId: string };
  /** Machine reason for a decision that could not be taken (null when unknown). */
  decision: { reason: string | null };
};

export type MessageRowKind = "forced" | "not-sent" | "settled";

export function messageRowKind(row: MessageRowInput): MessageRowKind {
  if (!row.requested) return "forced";
  if (row.envelope.requestId === "") return "not-sent";
  return "settled";
}

/** The i18n key explaining *why* nothing was sent. */
export function notSentReasonKey(row: MessageRowInput): string {
  return row.decision.reason ? `jev.err.${row.decision.reason}` : "err.fail";
}
