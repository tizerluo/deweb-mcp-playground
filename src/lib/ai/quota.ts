/**
 * The free trial's bookkeeping: how many calls a visitor gets per day, and who
 * a visitor is.
 *
 * Server-side state on purpose — the quota is what keeps a public demo from
 * being a free model proxy, so the browser only ever displays it. Counting is
 * "from simple": one bucket per (IP, visitor cookie) per UTC day, refilled by
 * the day's key changing rather than by a timer. Restarting the server resets
 * it, which is the right trade for a playground and is why the number is
 * described as a trial, not as an entitlement.
 *
 * Pure and clock-injected so the tests can drive a day rollover without a
 * server.
 */

export const FREE_DAILY_LIMIT = 2;
export const VISITOR_COOKIE = "deweb-ai-visitor";

/** Buckets kept for the current day before the oldest are dropped. */
const MAX_BUCKETS = 5_000;

export type QuotaView = { left: number; limit: number; exempt: boolean };
export type QuotaTake = { ok: boolean; left: number; limit: number };

/** The UTC day a timestamp belongs to (`2026-09-22`). */
export function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/**
 * Who the quota is counted against. The cookie makes two visitors behind one
 * NAT distinct; the IP keeps a cookie-less script from minting a fresh bucket
 * per request by simply not storing a cookie.
 */
export function quotaKey(
  ip: string | null | undefined,
  visitor: string | null | undefined,
): string {
  const where = (ip ?? "").trim() || "unknown";
  const who = (visitor ?? "").trim() || "anon";
  return `${where}|${who}`;
}

/**
 * Exemptions for local work and for the operator: `FREE_LIMITS_BYPASS=1`
 * lifts the daily limit for this process, `FREE_LIMITS_WHITELIST=ip,ip` lifts
 * it for named addresses (a phone on the same Wi-Fi, a demo kiosk).
 */
export function quotaExempt(input: {
  bypass?: string | null;
  whitelist?: string | null;
  ip?: string | null;
}): boolean {
  if ((input.bypass ?? "").trim() === "1") return true;
  const ip = (input.ip ?? "").trim();
  if (!ip) return false;
  return (input.whitelist ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .includes(ip);
}

/**
 * Which budget one chat call draws on. The day's trial is the ordinary one;
 * `paid` is the visitor's own — the call the panel's line promises once the
 * trial is spent ("connect a wallet to keep going — about 0.0003 BNB per
 * call").
 */
export type ChatBudget = {
  source: "trial" | "paid";
  /** What the trial has left after this decision. */
  left: number;
  limit: number;
};

export type ChatDraw = { ok: true; budget: ChatBudget } | { ok: false; reason: "quota" };

/**
 * Decide what pays for one chat call, and take it.
 *
 * A paid call never touches the trial counter: the visitor is buying this one,
 * so taking a free unit for it would spend a call they never used, and handing
 * one back when the provider failed would refund a call they never spent. A
 * free call is spent exactly as before — `ok: false` means the visitor is out
 * for the day.
 */
export function drawChatBudget(quota: DailyQuota, key: string, paid: boolean): ChatDraw {
  const limit = quota.limit;
  if (paid) return { ok: true, budget: { source: "paid", left: quota.peek(key).left, limit } };
  const took = quota.take(key);
  if (!took.ok) return { ok: false, reason: "quota" };
  return { ok: true, budget: { source: "trial", left: took.left, limit } };
}

/**
 * A call that failed upstream is not a spent call: give the trial unit back,
 * and leave a paid call's counter exactly as it was. An exempt visitor has no
 * counter to correct.
 */
export function giveBackChatBudget(
  quota: DailyQuota,
  key: string,
  budget: ChatBudget,
  exempt: boolean,
): number {
  if (exempt || budget.source === "paid") return budget.left;
  return quota.give(key).left;
}

export class DailyQuota {
  readonly limit: number;
  private readonly now: () => number;
  private buckets = new Map<string, { day: string; used: number }>();

  constructor(limit: number = FREE_DAILY_LIMIT, now: () => number = Date.now) {
    this.limit = limit;
    this.now = now;
  }

  /** What is left, without spending anything. */
  peek(key: string): QuotaTake {
    return this.view(key);
  }

  /** Spend one call; `ok: false` means the visitor is out for today. */
  take(key: string): QuotaTake {
    const day = utcDay(this.now());
    this.reap(day);
    const bucket = this.buckets.get(key);
    if (bucket && bucket.used >= this.limit) return { ok: false, left: 0, limit: this.limit };
    const used = (bucket?.used ?? 0) + 1;
    this.buckets.set(key, { day, used });
    return { ok: true, left: Math.max(0, this.limit - used), limit: this.limit };
  }

  /** Hand a unit back — a call that failed upstream is not a used trial. */
  give(key: string): QuotaTake {
    const day = utcDay(this.now());
    this.reap(day);
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.used <= 0) return this.view(key);
    bucket.used -= 1;
    return { ok: true, left: Math.max(0, this.limit - bucket.used), limit: this.limit };
  }

  /** Test seam: forget everyone. */
  clear(): void {
    this.buckets.clear();
  }

  private view(key: string): QuotaTake {
    const day = utcDay(this.now());
    this.reap(day);
    const used = this.buckets.get(key)?.used ?? 0;
    return { ok: used < this.limit, left: Math.max(0, this.limit - used), limit: this.limit };
  }

  /**
   * Yesterday's buckets never matter again, and a client that rotates cookies
   * must not grow the map without bound: drop the stale day, then the oldest
   * keys until the cap holds. Evicting the oldest (not clearing) keeps one
   * busy visitor from resetting everybody else's count.
   */
  private reap(day: string): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.day !== day) this.buckets.delete(key);
    }
    while (this.buckets.size > MAX_BUCKETS) {
      const oldest = this.buckets.keys().next().value;
      if (oldest === undefined) break;
      this.buckets.delete(oldest);
    }
  }
}
