import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { CallWorkspace } from "@/components/call-workspace";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";
import { useTape } from "@/lib/tape/store";
import { serviceBySlug } from "@/lib/tape/catalog";

export const Route = createFileRoute("/s/$slug")({
  component: ServicePage,
});

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
