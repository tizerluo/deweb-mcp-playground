import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { SnakeDemo } from "@/components/jev/snake-demo";
import { CarDemo } from "@/components/jev/car-demo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/lib/i18n";
import { SERVICES, serviceBySlug } from "@/lib/tape/catalog";
import { useTape } from "@/lib/tape/store";
import { formatBem, formatUsd } from "@/lib/utils";
import type { ServiceDef } from "@/lib/tape/types";

export function CallWorkspace({ slug }: { slug: string }) {
  const t = useT();
  const svc = serviceBySlug(slug);
  if (!svc) {
    return (
      <div className="rounded-xl bg-surface p-6 shadow-[var(--shadow-border)]">
        <p className="text-sm text-muted">{t("call.missing")}</p>
      </div>
    );
  }
  return (
    <section className="rounded-xl bg-surface p-4 shadow-[var(--shadow-border)] sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-medium tracking-tight">{svc.endpoint}</h2>
            <Badge variant={svc.mode === "A" ? "live" : "mode"}>{t(`mode.${svc.mode}`)}</Badge>
          </div>
          <p className="mt-1 max-w-xl text-sm text-muted">{t(`svc.${svc.slug}.blurb`)}</p>
        </div>
        <div className="font-mono text-xs text-subtle">
          {svc.endpoint}
          <span className="mx-2">·</span>
          {t("call.mode", { m: svc.mode })}
        </div>
      </header>
      <div className="mt-6">
        {svc.slug === "price" ? <PricePanel svc={svc} /> : null}
        {svc.slug === "jev" ? <JevPanel svc={svc} /> : null}
        {svc.slug === "game" ? <GamePanel svc={svc} /> : null}
        {svc.slug === "payment" ? <PayPanel svc={svc} /> : null}
      </div>
    </section>
  );
}

function PricePanel({ svc }: { svc: ServiceDef }) {
  const t = useT();
  const price = useTape((s) => s.price);
  const busy = useTape((s) => s.busy);
  const refreshPrice = useTape((s) => s.refreshPrice);
  const call = useTape((s) => s.call);

  useEffect(() => {
    if (!price) void refreshPrice();
  }, [price, refreshPrice]);

  const change = price && price.ok ? price.change24h : 0;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
      <div>
        <p className="text-xs font-medium text-muted">{t("price.label")}</p>
        <p className="mt-1 font-mono text-4xl tabular-nums tracking-tight whitespace-nowrap sm:text-5xl">
          {price?.ok ? formatUsd(price.usd) : price && !price.ok ? "—" : t("price.reading")}
        </p>
        <p
          className={`mt-2 font-mono text-sm tabular-nums ${change >= 0 ? "text-ok" : "text-danger"}`}
        >
          {price?.ok
            ? `${change >= 0 ? "+" : ""}${change.toFixed(2)}% 24h`
            : price && !price.ok
              ? price.error
              : ""}
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Button
            disabled={busy}
            onClick={async () => {
              const r = await call({ slug: svc.slug, method: "get", params: {} });
              if (!r.ok) toast.error(r.error);
            }}
          >
            {t("price.readOnchain")}
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => void refreshPrice()}>
            {t("price.refresh")}
          </Button>
        </div>
        <p className="mt-3 text-xs text-subtle">{t("price.hint")}</p>
      </div>
      <pre className="overflow-auto rounded-lg bg-raised p-4 font-mono text-xs leading-relaxed text-muted shadow-[var(--shadow-border)]">
        {JSON.stringify(
          price?.ok
            ? {
                path: "/data/price.json",
                pair: "BEM/USDT",
                usd: price.usd,
                change24h: price.change24h,
                liquidityUsd: Math.round(price.liquidityUsd),
                fdv: Math.round(price.fdv),
                source: price.source,
              }
            : { path: "/data/price.json", status: "empty" },
          null,
          2,
        )}
      </pre>
    </div>
  );
}

function JevPanel({ svc }: { svc: ServiceDef }) {
  const t = useT();
  const method = svc.methods[0];
  return (
    <div className="grid gap-6">
      <p className="font-mono text-xs text-subtle">
        {t("jev.method", {
          name: method?.name ?? "decide",
          n: formatBem(method?.priceBem ?? 0, 3),
        })}
      </p>
      <p className="max-w-2xl text-sm leading-relaxed text-muted">{t("jev.panel.lead")}</p>
      <div className="grid gap-2 border-t border-line pt-4">
        <h3 className="text-xs font-medium uppercase tracking-wide text-subtle">
          {t("jev.demo.one")}
        </h3>
        <SnakeDemo />
      </div>
      <div className="grid gap-2 border-t border-line pt-4">
        <h3 className="text-xs font-medium uppercase tracking-wide text-subtle">
          {t("jev.demo.two")}
        </h3>
        <CarDemo />
      </div>
    </div>
  );
}

function GamePanel({ svc }: { svc: ServiceDef }) {
  const t = useT();
  const [name, setName] = useState("arcade");
  const [score, setScore] = useState(88);
  const board = useTape((s) => s.board);
  const busy = useTape((s) => s.busy);
  const call = useTape((s) => s.call);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
      <div className="grid gap-3">
        <div className="grid gap-2">
          <Label htmlFor="gn">{t("game.name")}</Label>
          <Input id="gn" value={name} maxLength={16} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="gs">{t("game.score")}</Label>
          <div className="flex gap-2">
            <Input
              id="gs"
              type="number"
              value={score}
              onChange={(e) => setScore(Number(e.target.value))}
            />
            <Button type="button" variant="secondary" onClick={() => setScore((n) => n + 13)}>
              +13
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={busy}
            onClick={async () => {
              const r = await call({
                slug: svc.slug,
                method: "save",
                params: { name, score },
              });
              if (!r.ok) toast.error(r.error);
              else toast.success(t("game.saved"));
            }}
          >
            {t("game.save", { n: formatBem(svc.methods[0].priceBem, 2) })}
          </Button>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={async () => {
              const r = await call({ slug: svc.slug, method: "board", params: {} });
              if (!r.ok) toast.error(r.error);
            }}
          >
            {t("game.board")}
          </Button>
        </div>
      </div>
      <ol className="rounded-lg bg-raised p-4 shadow-[var(--shadow-border)]">
        {board.length === 0 ? (
          <li className="text-sm text-muted">{t("game.empty")}</li>
        ) : (
          board.slice(0, 8).map((row, i) => (
            <li
              key={`${row.from}-${row.at}`}
              className="flex items-baseline justify-between gap-3 border-b border-line py-2 last:border-0"
            >
              <span className="text-xs text-subtle">{i + 1}</span>
              <span className="flex-1 truncate text-sm">{row.name}</span>
              <span className="font-mono text-sm tabular-nums">{row.score}</span>
            </li>
          ))
        )}
      </ol>
    </div>
  );
}

function PayPanel({ svc }: { svc: ServiceDef }) {
  const t = useT();
  const others = useMemo(() => SERVICES.filter((s) => s.slug !== "payment"), []);
  const [to, setTo] = useState(others[0]?.endpoint ?? "");
  const [amount, setAmount] = useState(0.5);
  const [memo, setMemo] = useState(t("pay.memoDefault"));
  const busy = useTape((s) => s.busy);
  const call = useTape((s) => s.call);
  const faucet = useTape((s) => s.faucet);
  const bem = useTape((s) => s.bem);
  const fee = svc.methods[0].priceBem;

  return (
    <div className="grid max-w-lg gap-3">
      <div className="grid gap-2">
        <Label htmlFor="to">{t("pay.to")}</Label>
        <select
          id="to"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="h-11 rounded-md border border-line bg-raised px-3 text-sm"
        >
          {others.map((s) => (
            <option key={s.endpoint} value={s.endpoint}>
              {t(`svc.${s.slug}.name`)} · {s.endpoint}
            </option>
          ))}
        </select>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="amt">{t("pay.amount")}</Label>
        <Input
          id="amt"
          type="number"
          min={0.001}
          step={0.001}
          value={amount}
          onChange={(e) => setAmount(Number(e.target.value))}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="memo">{t("pay.memo")}</Label>
        <Input id="memo" value={memo} maxLength={80} onChange={(e) => setMemo(e.target.value)} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={busy || amount <= 0}
          onClick={async () => {
            const r = await call({
              slug: svc.slug,
              method: "pay",
              params: { to, amount, memo },
            });
            if (!r.ok) toast.error(r.error);
            else toast.success(t("pay.ok"));
          }}
        >
          {t("pay.send", { n: formatBem(fee, 3) })}
        </Button>
        {bem < 0.2 ? (
          <Button variant="secondary" onClick={faucet}>
            {t("pay.faucet")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
