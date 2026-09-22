import { Badge } from "@/components/ui/badge";
import { useT } from "@/lib/i18n";
import { STATUS_KEY, type DecisionView } from "@/lib/jev/decision";
import { messageRowKind, messageStatusKey, notSentReasonKey } from "@/lib/jev/rows";
import type { RoundStats } from "@/lib/jev/stats";
import { averageLatencyMs } from "@/lib/jev/stats";
import { cn, shortHex } from "@/lib/utils";

/**
 * One decision, as the page tells it: what the options were, what JEV answered,
 * and the TAP-10 letter pair the decision travelled in. The decision itself is
 * the shared `DecisionView`, so the snake and the car render the same stream
 * while each keeps its own notion of what was picked.
 */
export type DecisionRow = {
  id: string;
  /** The demo's own clock: a snake step, a car window's step count. */
  tick: number;
  decision: DecisionView;
  /** This decision asked JEV (false for a rules-forced move, which sends nothing). */
  requested: boolean;
  /** Probability per option, in the order the demo offered them. */
  options: { label: string; value: number }[];
  legal: string[];
  envelope: {
    requestId: string;
    from: string;
    to: string;
    block: number;
    paidBem: number;
    reqDigest: string;
    resDigest: string | null;
  };
  /** The reply arrived after the window had already been driven. */
  late: boolean;
  message: string;
  /**
   * i18n keys for the lines below, when the demo's own words differ from the
   * snake-flavoured defaults: a car timeout holds the last action rather than
   * playing straight, and its options are actions, not moves. Keys, not text,
   * so a row written before a language switch still renders in the new one.
   */
  labels?: {
    /** Key for the fallback option list line; defaults to "jev.options". */
    optionsKey?: string;
    /** Key for the late-reply note; defaults to "jev.messages.late". */
    lateKey?: string;
  };
};

const STATUS_VARIANT: Record<
  DecisionView["status"],
  "live" | "mode" | "warn" | "danger" | "default"
> = {
  answered: "live",
  forced: "default",
  timeout: "warn",
  illegal: "danger",
  degraded: "danger",
};

export function DecisionStream({ rows, total }: { rows: DecisionRow[]; total?: number }) {
  const t = useT();
  // The list is a ring buffer; the round is not. Counting the list would let
  // the header claim 120 ticks after the three-hundredth one.
  const ticks = total ?? rows.length;
  return (
    <div
      className="rounded-xl bg-surface p-4 shadow-[var(--shadow-border)]"
      data-testid="jev-decision-stream"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{t("jev.stream.title")}</h3>
        <span className="font-mono text-[10px] text-subtle">
          {t("jev.stream.count", { n: ticks })}
          {ticks > rows.length ? ` · ${t("jev.stream.shown", { shown: rows.length })}` : ""}
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="mt-3 text-xs leading-relaxed text-muted">{t("jev.stream.empty")}</p>
      ) : (
        <ol className="mt-3 max-h-72 space-y-3 overflow-auto pr-1">
          {rows.map((row) => (
            <li key={row.id} className="border-b border-line pb-3 last:border-0 last:pb-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] tabular-nums text-subtle">
                    #{row.tick}
                  </span>
                  <Badge variant={row.decision.source === "jev" ? "live" : "default"}>
                    {row.decision.source === "jev" ? "JEV" : t("jev.source.local")}
                  </Badge>
                  <Badge variant={STATUS_VARIANT[row.decision.status]}>
                    {t(row.decision.statusKey ?? STATUS_KEY[row.decision.status])}
                  </Badge>
                  <span className="font-mono text-xs text-fg">→ {row.decision.pick ?? "—"}</span>
                </div>
                <span className="font-mono text-[10px] tabular-nums text-subtle">
                  {row.decision.latencyMs === null ? "—" : `${row.decision.latencyMs} ms`}
                  {row.decision.confidence !== null
                    ? ` · ${t("jev.confidence")} ${row.decision.confidence.toFixed(2)}`
                    : ""}
                </span>
              </div>

              {row.options.length > 0 ? (
                <div className="mt-2 grid gap-1">
                  {row.options.map((option) => (
                    <div
                      key={option.label}
                      className="grid grid-cols-[52px_1fr_48px] items-center gap-2"
                    >
                      <span
                        className={cn(
                          "font-mono text-[10px]",
                          option.label === row.decision.pick ? "text-fg" : "text-subtle",
                        )}
                      >
                        {option.label}
                      </span>
                      <span className="h-1 overflow-hidden rounded-full bg-raised">
                        <span
                          className="block h-full bg-accent"
                          style={{ width: `${Math.round(Math.min(1, option.value) * 100)}%` }}
                        />
                      </span>
                      <span className="text-right font-mono text-[10px] tabular-nums text-muted">
                        {option.value.toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-1 font-mono text-[10px] text-subtle">
                  {t(row.labels?.optionsKey ?? "jev.options", {
                    list: row.legal.join(" · ") || "—",
                  })}
                </p>
              )}

              {row.decision.reason ? (
                <>
                  <p className="mt-1 text-[10px] text-danger">
                    {t("jev.degraded", { reason: t(`jev.err.${row.decision.reason}`) })}
                  </p>
                  {/* Upstream prose is developer material, not the headline:
                      it goes behind a fold instead of into the row. */}
                  {row.message ? (
                    <details className="mt-1">
                      <summary className="cursor-pointer font-mono text-[10px] text-subtle">
                        {t("jev.detail")}
                      </summary>
                      <p className="mt-1 break-all font-mono text-[10px] text-subtle">
                        {row.message}
                      </p>
                    </details>
                  ) : null}
                </>
              ) : null}
              {row.decision.status === "illegal" ? (
                <p className="mt-1 font-mono text-[10px] text-danger">
                  {t("jev.illegal", { pick: row.decision.rawChoice ?? "—" })}
                </p>
              ) : null}
              {row.late ? (
                <p className="mt-1 text-[10px] text-warn">
                  {t(row.labels?.lateKey ?? "jev.messages.late")}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function MessageStrip({ rows }: { rows: DecisionRow[] }) {
  const t = useT();
  return (
    <div
      className="rounded-xl bg-surface p-4 shadow-[var(--shadow-border)]"
      data-testid="jev-message-strip"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{t("jev.messages.title")}</h3>
        <span className="font-mono text-[10px] text-subtle">TAP-10 · deweb.req/v0 · res/v0</span>
      </div>
      {rows.length === 0 ? (
        <p className="mt-3 text-xs leading-relaxed text-muted">{t("jev.messages.empty")}</p>
      ) : (
        <ul className="mt-3 max-h-72 space-y-2 overflow-auto pr-1">
          {rows.map((row) => {
            // Three states, three sentences. "No request id" means no letter
            // went out at all — the wallet may never have been charged, so it
            // must not be told the money was held and refunded.
            const kind = messageRowKind(row);
            if (kind === "forced") {
              return (
                <li key={row.id} className="rounded-lg px-3 py-2 shadow-[var(--shadow-border)]">
                  <p className="font-mono text-[10px] text-subtle">
                    #{row.tick} · {t("jev.messages.none")}
                  </p>
                </li>
              );
            }
            if (kind === "not-sent") {
              return (
                <li key={row.id} className="rounded-lg px-3 py-2 shadow-[var(--shadow-border)]">
                  <p className="font-mono text-[10px] text-subtle">
                    #{row.tick} · {row.envelope.from} → {row.envelope.to || "…"} ·{" "}
                    {t("jev.messages.notSent", { reason: t(notSentReasonKey(row)) })}
                  </p>
                </li>
              );
            }
            return (
              <li
                key={row.id}
                className="rounded-lg bg-raised px-3 py-2 shadow-[var(--shadow-border)]"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-[11px] text-fg">
                    {row.envelope.from} → {row.envelope.to}
                  </span>
                  <span className="font-mono text-[10px] tabular-nums text-subtle">
                    blk {row.envelope.block}
                  </span>
                </div>
                <p className="mt-1 font-mono text-[10px] text-subtle">
                  req {shortHex(row.envelope.reqDigest, 6, 4)}
                  {row.envelope.resDigest
                    ? ` · res ${shortHex(row.envelope.resDigest, 6, 4)}`
                    : ` · ${t("jev.messages.noReply")}`}
                </p>
                <p className="mt-1 font-mono text-[10px] text-subtle">
                  {t("jev.messages.paid")}
                  {/* One sentence, and only when the row has an outcome to
                      report: a reply (accepted) or money without one
                      (refunded). A free letter that got no reply says nothing
                      here — the digest line above already says so. */}
                  {(() => {
                    const key = messageStatusKey(row);
                    return key ? ` · ${t(key)}` : "";
                  })()}
                  {row.decision.latencyMs === null ? "" : ` · ${row.decision.latencyMs} ms`}
                </p>
                {row.late ? (
                  <p className="mt-1 font-mono text-[10px] text-warn">
                    {t(row.labels?.lateKey ?? "jev.messages.late")}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * The round's totals. They come from the counters the loops keep, not from the
 * rows they render: the row list is capped, and an average or a spend computed
 * from a capped list drifts away from the truth as the round runs.
 */
export function DecisionRowStats({ stats }: { stats: RoundStats }) {
  const t = useT();
  const avg = averageLatencyMs(stats);
  const breakdown = t("jev.stats.breakdown", {
    timeout: stats.byStatus.timeout,
    degraded: stats.byStatus.degraded,
    illegal: stats.byStatus.illegal,
    forced: stats.byStatus.forced,
  });
  return (
    <div className="@container" data-testid="jev-stats">
      <dl className="grid grid-cols-2 gap-2 @[420px]:grid-cols-3 @[640px]:grid-cols-4">
        <Stat label={t("jev.stats.decisions")} value={String(stats.ticks)} />
        <Stat label={t("jev.stats.jev")} value={String(stats.replied)} />
        <Stat label={t("jev.stats.adopted")} value={String(stats.adopted)} />
        <Stat label={t("jev.stats.avg")} value={avg === null ? "—" : `${avg} ms`} />
      </dl>
      <p className="mt-2 font-mono text-[10px] text-subtle" data-testid="jev-stats-breakdown">
        {breakdown}
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-raised px-3 py-2 shadow-[var(--shadow-border)]">
      <dt className="text-[10px] font-medium uppercase tracking-wide text-subtle">{label}</dt>
      <dd className="mt-1 font-mono text-sm tabular-nums text-fg">{value}</dd>
    </div>
  );
}
