import { Link } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { TapeMark } from "@/components/mark";
import { LOCALES, useLocale, useI18n, useT } from "@/lib/i18n";
import { useTape } from "@/lib/tape/store";
import { cn, formatBem, formatBlock } from "@/lib/utils";

export function IdentityBar() {
  const t = useT();
  // The pressed language must come from the same source the server painted
  // with: the store says "en" during SSR (no request locale in it), the
  // provider says what this request asked for — a mismatch here is a hydration
  // error on every non-English load.
  const locale = useLocale();
  const setLocale = useI18n((s) => s.setLocale);
  const identity = useTape((s) => s.identity);
  const bem = useTape((s) => s.bem);
  const locked = useTape((s) => s.locked);
  const block = useTape((s) => s.block);
  const activeCalls = useTape((s) => s.activeCalls);
  // The header reports paid work, not just the single-call workspace lock: a
  // JEV loop sends and settles every tick without ever taking that lock.
  const inFlight = activeCalls > 0;

  return (
    <header className="border-b border-line bg-bg/90 backdrop-blur-sm">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex items-center gap-3">
          <Link to="/" className="flex items-center gap-2.5 text-fg">
            <TapeMark className="size-7 text-accent" />
            <span className="text-base font-medium tracking-tight">{t("brand")}</span>
          </Link>
          <Badge variant="mode">{t("badge")}</Badge>
          <span className="hidden text-xs text-muted sm:inline">{t("tagline")}</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-xs text-muted">
          <span className="text-fg">{identity.endpoint}</span>
          <span className="tabular-nums text-fg">
            {formatBem(bem)} BEM
            {locked > 0 ? (
              <span className="ml-1.5 text-warn">{t("locked", { n: formatBem(locked, 3) })}</span>
            ) : null}
          </span>
          <span className="tabular-nums">blk {formatBlock(block)}</span>
          <span className={inFlight ? "text-warn" : "text-ok"}>
            {inFlight ? t("status.busy") : t("status.idle")}
          </span>
          <div className="flex items-center gap-1" role="group" aria-label={t("locale.group")}>
            {LOCALES.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => setLocale(l.id)}
                aria-pressed={locale === l.id}
                aria-label={l.label}
                className={cn(
                  "min-h-11 min-w-11 rounded-md px-2 text-xs transition-colors duration-[var(--motion-quick)]",
                  locale === l.id ? "bg-raised text-fg" : "text-muted hover:text-fg",
                )}
              >
                {l.native}
              </button>
            ))}
          </div>
          <Link
            to="/mcp"
            className="text-muted transition-colors duration-[var(--motion-quick)] hover:text-fg"
          >
            {t("nav.webmcp")}
          </Link>
          <Link
            to="/spec"
            className="text-muted transition-colors duration-[var(--motion-quick)] hover:text-fg"
          >
            {t("nav.spec")}
          </Link>
        </div>
      </div>
    </header>
  );
}
