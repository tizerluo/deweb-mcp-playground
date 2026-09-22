import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";
import { SERVICES } from "@/lib/tape/catalog";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const t = useT();
  return (
    // The cover: hero + the four stalls. The rail and the trace arrive with
    // the first service page (see AppShell).
    <AppShell rail={false} trace={false}>
      <div className="space-y-6">
        <section className="rounded-xl bg-surface px-5 py-6 shadow-[var(--shadow-border)] sm:px-8 sm:py-8">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted">
            {t("home.kicker")}
          </p>
          <h1 className="mt-3 max-w-xl text-3xl font-medium tracking-tight sm:text-4xl">
            {t("home.title")}
          </h1>
          <p className="mt-4 max-w-lg text-sm leading-relaxed text-muted">{t("home.lead")}</p>
          <div className="mt-6 flex flex-wrap gap-2">
            <Button asChild>
              <Link to="/s/$slug" params={{ slug: "price" }}>
                {t("home.readPrice")}
              </Link>
            </Button>
            <Button variant="secondary" asChild>
              <Link to="/mcp">{t("home.openMcp")}</Link>
            </Button>
            <Button variant="ghost" asChild>
              <Link to="/spec">{t("home.readSpec")}</Link>
            </Button>
          </div>
          <p className="mt-4 text-xs text-subtle">{t("home.note")}</p>
        </section>

        <section className="grid gap-3 sm:grid-cols-2">
          {SERVICES.map((s) => (
            <Link
              key={s.slug}
              to="/s/$slug"
              params={{ slug: s.slug }}
              className="group rounded-xl bg-surface p-5 shadow-[var(--shadow-border)] transition-[box-shadow] duration-[var(--motion-quick)] hover:shadow-[var(--shadow-border-hover)]"
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-accent">{s.endpoint}</span>
                <Badge variant={s.mode === "A" ? "live" : "mode"}>{t(`mode.${s.mode}`)}</Badge>
              </div>
              <h2 className="mt-3 text-base font-medium">{t(`svc.${s.slug}.name`)}</h2>
              <p className="mt-1 text-sm leading-relaxed text-muted">{t(`svc.${s.slug}.blurb`)}</p>
              <span className="mt-4 inline-flex items-center gap-1 text-xs text-fg">
                {t("home.open")}
                <ArrowUpRight className="size-3.5 opacity-60 transition-transform duration-[var(--motion-quick)] group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </span>
            </Link>
          ))}
        </section>
      </div>
    </AppShell>
  );
}
