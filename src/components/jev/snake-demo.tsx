import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DecisionRowStats,
  DecisionStream,
  MessageStrip,
  type DecisionRow,
} from "@/components/jev/decision-log";
import { SnakeBoard } from "@/components/jev/snake-board";
import { useT } from "@/lib/i18n";
import { createSnakeRunner, type SnakeRound, type SnakeTick } from "@/lib/jev/snake/loop";
import type { SnakeDecision } from "@/lib/jev/snake/controller";
import type { DecisionView } from "@/lib/jev/decision";
import { EMPTY_STATS, recordDecision, recordLateReply, type RoundStats } from "@/lib/jev/stats";
import { createGame, type GameState } from "@/lib/jev/snake/engine";
import { probabilityRows } from "@/lib/jev/snake/question";
import { useTape } from "@/lib/tape/store";
import { formatBem } from "@/lib/utils";

/** Tick lengths offered by the speed control, inside the brief's 300–900 ms. */
const TICK_CHOICES = [900, 600, 350] as const;
const DEFAULT_TICK_MS = 900;
const MAX_ROWS = 120;

/** The snake's decision in the vocabulary the shared stream renders. */
function decisionView(decision: SnakeDecision): DecisionView {
  return {
    source: decision.source,
    status: decision.status,
    reason: decision.reason,
    pick: decision.direction,
    rawChoice: decision.rawChoice,
    latencyMs: decision.latencyMs,
    confidence: decision.confidence,
    cached: decision.cached,
  };
}

/**
 * Snake auto-play driven by JEV: one `choice` per tick, the fixed clock the
 * brief asks for (ask at tick start, adopt the answer at tick end, straight
 * when nothing arrived), every decision billed as a TAP-10 round trip.
 *
 * The tick loop itself lives in `@/lib/jev/snake/loop` — it is the part with
 * the lifecycle rules (Pause / Reset / new round cancel the tick in flight),
 * and living outside React is what lets those rules be tested by hand.
 */
export function SnakeDemo() {
  const t = useT();
  const identity = useTape((s) => s.identity);
  const bem = useTape((s) => s.bem);
  const faucet = useTape((s) => s.faucet);
  const jevDecision = useTape((s) => s.jevDecision);
  const call = useTape((s) => s.call);
  const board = useTape((s) => s.board);

  const seedRef = useRef(20_260_921);
  const [game, setGame] = useState<GameState>(() => createGame({ seed: seedRef.current }));
  const [running, setRunning] = useState(false);
  const [tickMs, setTickMs] = useState<number>(DEFAULT_TICK_MS);
  const [effectiveMs, setEffectiveMs] = useState<number>(DEFAULT_TICK_MS);
  const [rows, setRows] = useState<DecisionRow[]>([]);
  // The round's totals, counted as each tick settles — the row list is capped
  // at MAX_ROWS, so anything derived from it stops describing the round.
  const [stats, setStats] = useState<RoundStats>(EMPTY_STATS);
  const [name, setName] = useState("arcade");

  const speedRef = useRef<number>(DEFAULT_TICK_MS);
  const gameRef = useRef<GameState>(game);
  // The runner is created once, so anything it reads from a render (the store
  // actions, the identity) is read through a ref that the latest render keeps
  // current — no stale closure can answer a tick.
  const decideRef = useRef(jevDecision);
  const identityRef = useRef(identity);

  useEffect(() => {
    speedRef.current = tickMs;
  }, [tickMs]);
  useEffect(() => {
    decideRef.current = jevDecision;
  }, [jevDecision]);
  useEffect(() => {
    identityRef.current = identity;
  }, [identity]);

  /** One settled tick: append its decision row and adopt its state. */
  const commitTick = useCallback((tick: SnakeTick) => {
    const rowId = crypto.randomUUID();
    const row: DecisionRow = {
      id: rowId,
      tick: tick.game.steps,
      requested: tick.request !== null,
      decision: decisionView(tick.decision),
      options: probabilityRows(tick.decision.probabilities, tick.analysis.legal),
      legal: tick.analysis.legal,
      envelope: tick.round?.envelope ?? {
        requestId: "",
        from: identityRef.current.endpoint,
        to: "",
        block: 0,
        paidBem: 0,
        reqDigest: "",
        resDigest: null,
      },
      charge: tick.round?.charge ?? 0,
      late: false,
      message: tick.round?.message ?? "",
    };
    setRows((prev) => [row, ...prev].slice(0, MAX_ROWS));
    setStats((prev) =>
      recordDecision(prev, {
        status: tick.decision.status,
        source: tick.decision.source,
        charge: tick.round?.charge ?? 0,
        latencyMs: tick.decision.latencyMs,
      }),
    );
    gameRef.current = tick.game;
    setGame(tick.game);
    return rowId;
  }, []);

  /** A round that resolved after its tick: patch the row it missed, if it is still there. */
  const patchTick = useCallback((rowId: string, round: SnakeRound) => {
    setStats((prev) => recordLateReply(prev, { ok: round.ok, charge: round.charge }));
    setRows((prev) =>
      prev.some((entry) => entry.id === rowId)
        ? prev.map((entry) =>
            entry.id === rowId
              ? {
                  ...entry,
                  late: round.ok,
                  charge: round.charge,
                  message: round.message,
                  envelope: round.envelope,
                }
              : entry,
          )
        : prev,
    );
  }, []);

  const runner = useMemo(
    () =>
      createSnakeRunner({
        getGame: () => gameRef.current,
        newRound: () => {
          // A fresh round: new seed, empty decision log. The loop asks for this
          // on 重开 and when "再来一局" is pressed after a round ended.
          const nextSeed = seedRef.current + 1;
          seedRef.current = nextSeed;
          const fresh = createGame({ seed: nextSeed });
          gameRef.current = fresh;
          setGame(fresh);
          setRows([]);
          setStats(EMPTY_STATS);
          return fresh;
        },
        getSpeedMs: () => speedRef.current,
        decide: (request) => decideRef.current(request),
        noteWait: setEffectiveMs,
        commitTick,
        patchTick,
        setRunning,
      }),
    [commitTick, patchTick],
  );

  // Leaving the page cancels the tick in flight: nothing writes after unmount.
  useEffect(() => () => runner.pause(), [runner]);

  const latest = rows[0] ?? null;
  const jevOnline = latest ? latest.decision.source === "jev" : null;
  const over = game.status === "over";

  return (
    <div className="grid gap-4" data-testid="jev-snake-demo">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium">{t("jev.snake.title")}</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted">{t("jev.snake.lead")}</p>
        </div>
        <Badge
          variant={jevOnline === null ? "default" : jevOnline ? "live" : "danger"}
          data-testid="jev-source-badge"
        >
          {jevOnline === null
            ? t("jev.badge.idle")
            : jevOnline
              ? t("jev.badge.jev")
              : t("jev.badge.local")}
        </Badge>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
        <div className="grid content-start gap-3">
          <SnakeBoard
            game={game}
            tickMs={effectiveMs}
            running={running}
            label={t("jev.snake.boardLabel")}
          />

          <div className="flex flex-wrap items-center gap-2">
            {running ? (
              <Button size="sm" variant="secondary" onClick={() => runner.pause()}>
                {t("jev.control.pause")}
              </Button>
            ) : (
              <Button size="sm" onClick={() => runner.start()}>
                {over
                  ? t("jev.control.again")
                  : rows.length === 0
                    ? t("jev.control.start")
                    : t("jev.control.resume")}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => runner.reset()}>
              {t("jev.control.reset")}
            </Button>
            <div
              className="flex items-center gap-1"
              role="group"
              aria-label={t("jev.control.speed")}
            >
              {TICK_CHOICES.map((choice) => (
                <Button
                  key={choice}
                  size="sm"
                  variant={choice === tickMs ? "secondary" : "ghost"}
                  aria-pressed={choice === tickMs}
                  onClick={() => setTickMs(choice)}
                >
                  <span className="font-mono text-[11px]">{choice} ms</span>
                </Button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-subtle">
            <span>{t("jev.score", { n: game.score })}</span>
            <span>{t("jev.eaten", { n: game.eaten })}</span>
            <span>{t("jev.step", { n: game.steps })}</span>
            <span>{t("jev.wallet", { n: formatBem(bem, 2) })}</span>
            <span>{t("jev.tickWait", { n: effectiveMs })}</span>
          </div>

          {bem < 0.05 ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-raised px-3 py-2 shadow-[var(--shadow-border)]">
              <p className="text-xs text-warn">{t("jev.lowBem")}</p>
              <Button size="sm" variant="secondary" onClick={faucet}>
                {t("faucet")}
              </Button>
            </div>
          ) : null}

          {over ? (
            <div className="grid gap-2 rounded-lg bg-raised px-3 py-3 shadow-[var(--shadow-border)]">
              <p className="text-xs text-muted">
                {t("jev.over", { reason: t(`jev.end.${game.endReason ?? "wall"}`), n: game.score })}
              </p>
              <div className="grid gap-1.5">
                <Label htmlFor="snake-name">{t("game.name")}</Label>
                <div className="flex gap-2">
                  <Input
                    id="snake-name"
                    value={name}
                    maxLength={16}
                    onChange={(event) => setName(event.target.value)}
                  />
                  <Button
                    size="sm"
                    disabled={game.score <= 0}
                    onClick={async () => {
                      const result = await call({
                        slug: "game",
                        method: "save",
                        params: { name, score: game.score },
                      });
                      if (!result.ok) toast.error(result.error);
                      else toast.success(t("game.saved"));
                    }}
                  >
                    {t("jev.save")}
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <div className="grid content-start gap-4">
          <DecisionRowStats stats={stats} />
          <DecisionStream rows={rows} total={stats.ticks} />
          <MessageStrip rows={rows} />
          <p className="text-[10px] leading-relaxed text-subtle">{t("jev.note")}</p>
        </div>
      </div>

      <p className="text-[10px] leading-relaxed text-subtle">
        {t("jev.leaderboard", { name: board[0]?.name ?? "—", n: board[0]?.score ?? 0 })}
      </p>
    </div>
  );
}
