import { Link } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { useT } from "@/lib/i18n";
import { SERVICES } from "@/lib/tape/catalog";
import { useTape } from "@/lib/tape/store";
import { cn, formatBem } from "@/lib/utils";

export function ServiceRail({ active }: { active?: string }) {
  const t = useT();
  const balances = useTape((s) => s.balances);

  return (
    <nav className="flex gap-2 overflow-x-auto pb-1 md:flex-col md:overflow-visible md:pb-0">
      <Link
        to="/mcp"
        className={cn(
          "min-w-[148px] rounded-lg p-3 shadow-[var(--shadow-border)] transition-[box-shadow,background-color] duration-[var(--motion-quick)] ease-[var(--ease-out)] md:min-w-0",
          active === "mcp"
            ? "bg-raised shadow-[var(--shadow-border-hover)]"
            : "bg-surface hover:bg-raised",
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-xs text-accent">webmcp</span>
          <Badge variant="live">{t("mcp.agentBadge")}</Badge>
        </div>
        <div className="mt-2 text-sm font-medium text-fg">{t("mcp.railTitle")}</div>
        <div className="mt-1 hidden text-xs leading-snug text-muted md:block">
          {t("mcp.railHint")}
        </div>
        <div className="mt-2 font-mono text-[10px] text-subtle">document.modelContext</div>
      </Link>
      {SERVICES.map((s) => {
        const on = active === s.slug;
        return (
          <Link
            key={s.slug}
            to="/s/$slug"
            params={{ slug: s.slug }}
            className={cn(
              "min-w-[148px] rounded-lg p-3 shadow-[var(--shadow-border)] transition-[box-shadow,background-color] duration-[var(--motion-quick)] ease-[var(--ease-out)] md:min-w-0",
              on ? "bg-raised shadow-[var(--shadow-border-hover)]" : "bg-surface hover:bg-raised",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs text-accent">{s.endpoint}</span>
              <Badge variant={s.mode === "A" ? "live" : "mode"}>{t(`mode.${s.mode}`)}</Badge>
            </div>
            <div className="mt-2 text-sm font-medium text-fg">{t(`svc.${s.slug}.name`)}</div>
            <div className="mt-1 hidden text-xs leading-snug text-muted md:block">
              {t(`svc.${s.slug}.headline`)}
            </div>
            <div className="mt-2 font-mono text-[10px] tabular-nums text-subtle">
              {t("svc.balance", { n: formatBem(balances[s.endpoint] ?? 0, 2) })}
            </div>
          </Link>
        );
      })}
    </nav>
  );
}
