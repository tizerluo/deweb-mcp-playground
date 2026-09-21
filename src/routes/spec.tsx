import { createFileRoute, Link } from "@tanstack/react-router";
import { IdentityBar } from "@/components/identity-bar";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";
import { JEV_REQUEST_EXAMPLE } from "@/lib/jev/protocol";

export const Route = createFileRoute("/spec")({ component: SpecPage });

/**
 * The request shape the page documents: a `deweb.req/v0` envelope whose
 * `params` is the JEV request. `params` is the exported example the sanitizer
 * test exercises, so what the page shows is what the server accepts.
 */
const REQUEST_EXAMPLE = {
  kind: "deweb.req/v0",
  id: "0x…",
  nonce: "0x…",
  method: "decide",
  params: JEV_REQUEST_EXAMPLE,
  replyTo: "#8801@0",
  deadline: 122_900_020,
};

function SpecPage() {
  const t = useT();
  return (
    <div className="tape-grid min-h-dvh bg-bg text-fg">
      <IdentityBar />
      <article className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted">
          {t("spec.kicker")}
        </p>
        <h1 className="mt-3 text-3xl font-medium tracking-tight">{t("spec.title")}</h1>
        <p className="mt-4 text-sm leading-relaxed text-muted">{t("spec.lead")}</p>
        <p className="mt-3 text-xs leading-relaxed text-subtle">{t("spec.reserve")}</p>

        <section className="mt-10">
          <h2 className="text-lg font-medium">{t("spec.layers")}</h2>
          <dl className="mt-4 grid gap-3">
            <div className="rounded-lg bg-surface p-4 shadow-[var(--shadow-border)]">
              <dt className="font-mono text-xs text-accent">DeWEB</dt>
              <dd className="mt-1 text-sm text-muted">{t("spec.deweb")}</dd>
            </div>
            <div className="rounded-lg bg-surface p-4 shadow-[var(--shadow-border)]">
              <dt className="font-mono text-xs text-accent">TapeSend</dt>
              <dd className="mt-1 text-sm text-muted">{t("spec.send")}</dd>
            </div>
            <div className="rounded-lg bg-surface p-4 shadow-[var(--shadow-border)]">
              <dt className="font-mono text-xs text-accent">DeWEB MCP</dt>
              <dd className="mt-1 text-sm text-muted">{t("spec.api")}</dd>
            </div>
          </dl>
        </section>

        <section className="mt-10">
          <h2 className="text-lg font-medium">{t("spec.once")}</h2>
          <ol className="mt-4 space-y-3 text-sm leading-relaxed text-muted">
            <li>{t("spec.s1")}</li>
            <li>{t("spec.s2")}</li>
            <li>{t("spec.s3")}</li>
            <li>{t("spec.s4")}</li>
            <li>{t("spec.s5")}</li>
          </ol>
        </section>

        <section className="mt-10">
          <h2 className="text-lg font-medium">{t("spec.shape")}</h2>
          <pre className="mt-4 overflow-auto rounded-lg bg-surface p-4 font-mono text-xs leading-relaxed text-muted shadow-[var(--shadow-border)]">
            {JSON.stringify(REQUEST_EXAMPLE, null, 2)}
          </pre>
        </section>

        <section className="mt-10">
          <h2 className="text-lg font-medium">{t("spec.modes")}</h2>
          <ul className="mt-4 space-y-2 text-sm text-muted">
            <li>{t("spec.modeA")}</li>
            <li>{t("spec.modeB")}</li>
            <li>{t("spec.modeC")}</li>
          </ul>
        </section>

        <section className="mt-10">
          <h2 className="text-lg font-medium">{t("spec.webmcp")}</h2>
          <p className="mt-3 text-sm leading-relaxed text-muted">{t("spec.webmcpP")}</p>
          <pre className="mt-4 overflow-auto rounded-lg bg-surface p-4 font-mono text-xs leading-relaxed text-muted shadow-[var(--shadow-border)]">{`{
  "webmcp": true,
  "tools": [{
    "name": "jev_decide",
    "inputSchema": { "type": "object", "required": ["state", "question", "options"] },
    "via": { "endpoint": "#9104@0", "method": "decide" }
  }]
}`}</pre>
        </section>

        <div className="mt-10 flex flex-wrap gap-2">
          <Button asChild>
            <Link to="/mcp">{t("spec.openMcp")}</Link>
          </Button>
          <Button variant="secondary" asChild>
            <Link to="/s/$slug" params={{ slug: "jev" }}>
              {t("spec.openJev")}
            </Link>
          </Button>
          <Button variant="ghost" asChild>
            <Link to="/">{t("spec.back")}</Link>
          </Button>
        </div>
      </article>
    </div>
  );
}
