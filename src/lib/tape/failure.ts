/**
 * Why a paid call failed, as a machine code.
 *
 * The playground used to throw plain `Error`s carrying an already-localized
 * sentence, so every downstream branch — the trace, the refund note, the
 * toast — had to guess what had gone wrong from prose, and a language switch
 * could never re-translate it. A call now fails with a code; the UI turns the
 * code into words at render time, and the refund note says what actually
 * happened (a local input/balance check is not "the provider never answered").
 */

export type CallErrorCode =
  /** No such service slug. */
  | "noService"
  /** No such method on that service. */
  | "noMethod"
  /** Local workspace lock: the previous call is still running. */
  | "busy"
  /** The wallet cannot cover the escrow. */
  | "lowBem"
  /** Payment tool: no payee container given. */
  | "noPayee"
  /** Payment tool: the transfer amount is not a positive number. */
  | "badAmt"
  /** Payment tool: the wallet cannot cover the transfer itself. */
  | "lowPay"
  /** Method not implemented by this playground. */
  | "unknown"
  /** The provider side failed (work threw, upstream unreachable). */
  | "provider"
  /** The quote source failed; `detail` is its machine reason (http/empty/network). */
  | "price"
  /** The JEV upstream answered with a classified failure; `detail` is its reason. */
  | "jev";

export class CallError extends Error {
  readonly code: CallErrorCode;
  /** Machine detail for a classified failure (the JEV reason, an upstream status). */
  readonly detail?: string;

  constructor(code: CallErrorCode, detail?: string) {
    super(detail ? `${code}:${detail}` : code);
    this.name = "CallError";
    this.code = code;
    this.detail = detail;
  }
}

/** Which escrow note a failure deserves. */
export type RefundBucket = "validation" | "provider" | "unknown";

export function refundBucket(error: unknown): RefundBucket {
  if (!(error instanceof CallError)) return "unknown";
  switch (error.code) {
    case "noPayee":
    case "badAmt":
    case "lowPay":
    case "lowBem":
      return "validation";
    case "provider":
    case "jev":
    case "price":
      return "provider";
    default:
      return "unknown";
  }
}

/** The i18n key that names this failure, resolved when it is displayed. */
export function errorMessageKey(error: unknown): string {
  if (error instanceof CallError) {
    if (error.code === "jev" && error.detail) return `jev.err.${error.detail}`;
    if (error.code === "price" && error.detail) return `price.err.${error.detail}`;
    if (error.code === "provider") return "err.fail";
    return `err.${error.code}`;
  }
  return "err.fail";
}

/** Raw machine detail for the failure (never prose, never a secret). */
export function errorDetail(error: unknown): string | undefined {
  return error instanceof CallError ? error.detail : undefined;
}

/** Placeholder values the message key needs (only `err.lowBem` takes one). */
export function errorVars(error: unknown): Record<string, string | number> | undefined {
  if (error instanceof CallError && error.code === "lowBem" && error.detail) {
    return { n: error.detail };
  }
  return undefined;
}

/** Refund note key for a failure — `emit.refundDetail.<bucket>`. */
export function refundDetailKey(error: unknown): string {
  return `emit.refundDetail.${refundBucket(error)}`;
}
