import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { CallWorkspace } from "@/components/call-workspace";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";
import { useTape } from "@/lib/tape/store";
import { serviceBySlug } from "@/lib/tape/catalog";

export const Route = createFileRoute("/s/$slug")({
  /**
   * A slug that names no service is not a page that happens to be empty: it is
   * a 404, decided before the card renders. It used to answer a soft 200 with
   * "no such service" written inside a normal card.
   */
  loader: ({ params }) => {
    if (!serviceBySlug(params.slug)) throw notFound();
    return null;
  },
  notFoundComponent: MissingService,
  component: ServicePage,
});

function MissingService() {
  const t = useT();
  return (
    <AppShell slug="">
      <div className="rounded-xl bg-surface p-6 text-center shadow-[var(--shadow-border)]">
        <h1 className="text-base font-medium">{t("notFound.title")}</h1>
        <p className="mt-2 text-sm text-muted">{t("notFound.body")}</p>
        <Link
          to="/"
          className="mt-4 inline-block rounded-md px-3 py-2 text-sm text-accent underline underline-offset-4"
        >
          {t("notFound.back")}
        </Link>
      </div>
    </AppShell>
  );
}

function ServicePage() {
  const { slug } = Route.useParams();
  const t = useT();
  const faucet = useTape((s) => s.faucet);
  const bem = useTape((s) => s.bem);
  const svc = serviceBySlug(slug);

  return (
    <AppShell slug={slug}>
      <CallWorkspace slug={slug} />
      {svc && bem < 0.2 && svc.mode !== "A" ? (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-xl bg-surface px-4 py-3 shadow-[var(--shadow-border)]">
          <p className="text-sm text-muted">{t("pay.low")}</p>
          <Button size="sm" variant="secondary" onClick={faucet}>
            {t("faucet")}
          </Button>
        </div>
      ) : null}
    </AppShell>
  );
}
