import { Badge } from "@/components/ui/badge";
import { useT } from "@/lib/i18n";
import { useTape } from "@/lib/tape/store";
import { formatBlock, shortHex } from "@/lib/utils";

export function ProtocolTrace() {
  const t = useT();
  const traces = useTape((s) => s.traces);
  const messages = useTape((s) => s.messages);
  const current = traces[0];

  return (
    <aside className="flex min-h-0 flex-col gap-4">
      <div className="rounded-xl bg-surface p-4 shadow-[var(--shadow-border)]">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">{t("trace.title")}</h3>
          {current ? (
            <Badge
              variant={
                current.status === "ok" ? "live" : current.status === "error" ? "danger" : "warn"
              }
            >
              {current.status === "ok"
                ? t("trace.status.ok")
                : current.status === "error"
                  ? t("trace.status.err")
                  : t("trace.status.run")}
            </Badge>
          ) : null}
        </div>
        {!current ? (
          <p className="mt-3 text-sm text-muted">{t("trace.empty")}</p>
        ) : (
          <ol className="mt-3 space-y-2">
            {current.events.map((ev) => (
              <li key={ev.id} className="grid grid-cols-[72px_1fr] gap-2">
                <span className="font-mono text-[10px] tabular-nums text-subtle">
                  {formatBlock(ev.block)}
                </span>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] uppercase text-accent">
                      {t(`kind.${ev.kind}`)}
                    </span>
                    <span className="text-xs text-fg">{t(ev.code, ev.vars)}</span>
                  </div>
                  {ev.detail ? (
                    <p className="mt-0.5 break-all font-mono text-[10px] text-subtle">
                      {ev.detail}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="rounded-xl bg-surface p-4 shadow-[var(--shadow-border)]">
        <h3 className="text-sm font-medium">{t("trace.hub")}</h3>
        {messages.length === 0 ? (
          <p className="mt-3 text-sm text-muted">{t("trace.noMail")}</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {messages.slice(0, 8).map((m) => (
              <li key={m.id} className="border-b border-line pb-3 last:border-0 last:pb-0">
                <div className="flex items-center justify-between gap-2">
                  <Badge variant={m.kind.endsWith("req/v0") ? "mode" : "live"}>{m.kind}</Badge>
                  <span className="font-mono text-[10px] tabular-nums text-subtle">
                    blk {formatBlock(m.block)}
                  </span>
                </div>
                <p className="mt-1.5 font-mono text-xs text-muted">
                  {m.from} → {m.to}
                </p>
                <p className="mt-0.5 font-mono text-[10px] text-subtle">
                  {shortHex(m.digest, 4, 4)}
                  {m.paidBem ? ` · ${m.paidBem} BEM` : ""}
                  {m.ref ? ` · ref ${shortHex(m.ref, 4, 4)}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
