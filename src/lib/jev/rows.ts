/**
 * One decision row, as the message strip reads it.
 *
 * A row can be in exactly three message states, and they must not be confused
 * with each other: the rules forced the move (nothing was sent at all), the
 * request never went out (no escrow, no letter — the call was refused before
 * sending), or a letter did go out and the round either settled or came back
 * empty. The old strip treated "no requestId" as "no reply, refunded", which
 * claimed a refund for money that was never held.
 *
 * Structural input on purpose: the tests drive it with plain objects.
 */

export type MessageRowInput = {
  /** This decision asked JEV (false for a rules-forced move, which sends nothing). */
  requested: boolean;
  envelope: { requestId: string; paidBem: number; resDigest: string | null };
  /** Machine reason for a decision that could not be taken (null when unknown). */
  decision: { reason: string | null };
};

export type MessageRowKind = "forced" | "not-sent" | "settled";

export function messageRowKind(row: MessageRowInput): MessageRowKind {
  if (!row.requested) return "forced";
  if (row.envelope.requestId === "") return "not-sent";
  return "settled";
}

/**
 * What a settled letter's line claims about its outcome — or nothing at all.
 *
 * Three facts, in this order: a reply arrived (the request was accepted and
 * answered); the request carried money that bought no reply (refunded); or the
 * request was free and came back empty, in which case the digest line already
 * says the reply is missing and no money changed hands. The old rule was
 * `charge > 0 ? charged : refunded`, which called every free, unanswered
 * letter "refunded" — a refund of money that was never paid.
 */
export function messageStatusKey(row: MessageRowInput): string | null {
  if (messageRowKind(row) !== "settled") return null;
  if (row.envelope.resDigest) return "jev.messages.charged";
  if (row.envelope.paidBem > 0) return "jev.messages.refunded";
  return null;
}

/** The i18n key explaining *why* nothing was sent. */
export function notSentReasonKey(row: MessageRowInput): string {
  return row.decision.reason ? `jev.err.${row.decision.reason}` : "err.fail";
}
