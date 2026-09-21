import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CarBoard } from "@/components/jev/car-board";
import {
  DecisionRowStats,
  DecisionStream,
  MessageStrip,
  type DecisionRow,
} from "@/components/jev/decision-log";
import { useT } from "@/lib/i18n";
import { candidateLabels } from "@/lib/jev/car/candidates";
import { createCar, type CarState } from "@/lib/jev/car/engine";
import { createCarRunner, type CarTick } from "@/lib/jev/car/loop";
import { carProbabilityRows } from "@/lib/jev/car/question";
import { createTrack } from "@/lib/jev/car/track";
import { carDecisionView, carStatusKey } from "@/lib/jev/car/view";
import type { JevRound } from "@/lib/jev/decision";
import { useTape } from "@/lib/tape/store";
import { cn, formatBem } from "@/lib/utils";

/** Decision periods offered by the control, inside the brief's 300–500 ms. */
const PERIOD_CHOICES = [300, 400, 500] as const;
const DEFAULT_PERIOD_MS = 400;
const MAX_ROWS = 120;

/** The car's decision in the vocabulary the shared stream renders. */
const decisionView = carDecisionView;

/**
 * Car auto-drive driven by JEV: code senses the track and simulates ten
 * candidate actions, JEV picks one, and the pick is driven for one window —
 * then the code asks again. Same fixed clock as the snake (ask at window
 * start, adopt at window end) with one difference: a window that ends with
 * nothing keeps driving the last action, once.
 *
 * The window loop lives in `@/lib/jev/car/loop` — Pause / Reset / unmount
 * cancel by epoch, which is testable only because the loop owns no React state.
 */
export function CarDemo() {
  const t = useT();
  const identity = useTape((s) => s.identity);
  const bem = useTape((s) => s.bem);
  const faucet = useTape((s) => s.faucet);
  const jevDecision = useTape((s) => s.jevDecision);

  const track = useMemo(() => createTrack(), []);
  const [car, setCar] = useState<CarState>(() => createCar(track));
  const [previous, setPrevious] = useState<CarState>(() => car);
  const [running, setRunning] = useState(false);
  const [periodMs, setPeriodMs] = useState<number>(DEFAULT_PERIOD_MS);
  const [effectiveMs, setEffectiveMs] = useState<number>(DEFAULT_PERIOD_MS);
  const [rows, setRows] = useState<DecisionRow[]>([]);
  const [latest, setLatest] = useState<CarTick | null>(null);

  const carRef = useRef<CarState>(car);
  const periodRef = useRef<number>(DEFAULT_PERIOD_MS);
  // The runner is created once, so everything it reads from a render goes
  // through a ref the latest render keeps current.
  const decideRef = useRef(jevDecision);
  const identityRef = useRef(identity);

  useEffect(() => {
    periodRef.current = periodMs;
  }, [periodMs]);
  useEffect(() => {
    decideRef.current = jevDecision;
  }, [jevDecision]);
  useEffect(() => {
    identityRef.current = identity;
  }, [identity]);

  /** One settled window: append its decision row and adopt its state. */
  const commitTick = useCallback((tick: CarTick) => {
    const rowId = crypto.randomUUID();
    const view = decisionView(tick.decision);
    const row: DecisionRow = {
      id: rowId,
      tick: tick.state.steps,
      requested: true,
      decision: view,
      options: carProbabilityRows(tick.decision.probabilities, tick.candidates),
      legal: candidateLabels(tick.candidates),
      // The shared stream's defaults are the snake's words; a car window that
      // got no answer held its last action, and its options are actions.
      labels: {
        statusKeyPrefix: "jev.car.state",
        optionsKey: "jev.car.options",
        lateKey: "jev.car.messages.late",
      },
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
    setPrevious(tick.from);
    carRef.current = tick.state;
    setCar(tick.state);
    setLatest(tick);
    return rowId;
  }, []);

  /** A round that resolved after its window: patch the row it missed. */
  const patchTick = useCallback((rowId: string, round: JevRound) => {
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
      createCarRunner({
        getTrack: () => track,
        getState: () => carRef.current,
        newRun: () => {
          // Back to the start line: fresh car, cleared log, no candidate still
          // drawn from a window of the previous run.
          const fresh = createCar(track);
          carRef.current = fresh;
          setCar(fresh);
          setPrevious(fresh);
          setLatest(null);
          setRows([]);
          return fresh;
        },
        getPeriodMs: () => periodRef.current,
        decide: (request) => decideRef.current(request),
        noteWait: setEffectiveMs,
        commitTick,
        patchTick,
        setRunning,
      }),
    [commitTick, patchTick, track],
  );

  // Leaving the page cancels the window in flight: nothing writes after unmount.
  useEffect(() => () => runner.pause(), [runner]);

  const latestDecision = latest ? decisionView(latest.decision) : null;
  /** What the action that was played is predicted to do — its own rollout. */
  const prediction = latest?.prediction ?? null;
  const jevOnline = latestDecision ? latestDecision.source === "jev" : null;
  const sensors = latest?.sensors ?? null;
  /** The three likeliest options of the last answer, for the card's bars. */
  const topProbabilities = (
    latest?.decision.probabilities
      ? carProbabilityRows(latest.decision.probabilities, latest.candidates)
      : []
  )
    .filter((option) => option.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 3);

  return (
    <div className="grid gap-4" data-testid="jev-car-demo">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium">{t("jev.car.title")}</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted">{t("jev.car.lead")}</p>
        </div>
        <Badge
          variant={jevOnline === null ? "default" : jevOnline ? "live" : "danger"}
          data-testid="jev-source-badge-car"
        >
          {jevOnline === null
            ? t("jev.badge.idle")
            : jevOnline
              ? t("jev.badge.jev")
              : t("jev.badge.local")}
        </Badge>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,560px)_minmax(0,1fr)]">
        <div className="grid content-start gap-3">
          <CarBoard
            state={car}
            from={previous}
            track={track}
            candidates={latest?.candidates ?? []}
            played={prediction}
            waitedMs={effectiveMs}
            running={running}
          />

          <div className="flex flex-wrap items-center gap-2">
            {running ? (
              <Button size="sm" variant="secondary" onClick={() => runner.pause()}>
                {t("jev.control.pause")}
              </Button>
            ) : (
              <Button size="sm" onClick={() => runner.start()}>
                {rows.length === 0 ? t("jev.car.control.start") : t("jev.car.control.resume")}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => runner.reset()}>
              {t("jev.control.reset")}
            </Button>
            <div
              className="flex items-center gap-1"
              role="group"
              aria-label={t("jev.car.periodGroup")}
            >
              {PERIOD_CHOICES.map((choice) => (
                <Button
                  key={choice}
                  size="sm"
                  variant={choice === periodMs ? "secondary" : "ghost"}
                  onClick={() => setPeriodMs(choice)}
                >
                  <span className="font-mono text-[11px]">{choice} ms</span>
                </Button>
              ))}
            </div>
          </div>

          <div
            className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-subtle"
            data-testid="car-stats"
          >
            <span>{t("jev.car.laps", { n: car.laps })}</span>
            <span>{t("jev.car.distance", { n: Math.round(car.distance) })}</span>
            <span>{t("jev.car.offTrack", { n: car.offTrackCount })}</span>
            <span>{t("jev.car.window", { n: effectiveMs })}</span>
            <span>{t("jev.wallet", { n: formatBem(bem, 2) })}</span>
          </div>

          {sensors ? (
            <div
              className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-subtle"
              data-testid="car-sensors"
            >
              <span>{t("jev.car.sensor.speed", { v: sensors.speed.toFixed(1) })}</span>
              <span>{t("jev.car.sensor.offset", { v: sensors.offset.toFixed(2) })}</span>
              <span>
                {t("jev.car.sensor.edges", {
                  l: sensors.leftEdge.toFixed(1),
                  r: sensors.rightEdge.toFixed(1),
                })}
              </span>
              <span>
                {t("jev.car.sensor.curvature", { r: sensors.ahead.minRadius.toFixed(1) })}
              </span>
              <span className={sensors.onTrack ? "text-ok" : "text-danger"}>
                {sensors.onTrack ? t("jev.car.sensor.onTrack") : t("jev.car.sensor.offTrack")}
              </span>
            </div>
          ) : null}

          <div
            className="grid gap-2 rounded-lg bg-raised px-3 py-3 shadow-[var(--shadow-border)]"
            data-testid="car-current-decision"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-medium">{t("jev.car.current")}</span>
              <span className="flex items-center gap-2">
                <Badge variant="default">
                  {latest ? t(carStatusKey(latest.decision)) : t("jev.badge.idle")}
                </Badge>
                {latestDecision && latestDecision.latencyMs !== null ? (
                  <span className="font-mono text-[10px] tabular-nums text-subtle">
                    {latestDecision.latencyMs} ms
                  </span>
                ) : null}
              </span>
            </div>
            <p className="font-mono text-sm text-fg">
              {latestDecision?.pick ? `→ ${latestDecision.pick}` : "—"}
              {latestDecision && latestDecision.confidence !== null
                ? ` · ${t("jev.confidence")} ${latestDecision.confidence.toFixed(2)}`
                : ""}
            </p>
            {prediction ? (
              <p
                className="font-mono text-[10px] leading-relaxed text-subtle"
                data-testid="car-predict"
              >
                {t("jev.car.predict", {
                  offset: prediction.metrics.maxOffset.toFixed(2),
                  road: prediction.metrics.collision ? t("jev.car.leaves") : t("jev.car.stays"),
                  distance: prediction.metrics.distance.toFixed(1),
                  speed: prediction.metrics.finalSpeed.toFixed(1),
                  comfort: prediction.metrics.comfort.toFixed(2),
                })}
              </p>
            ) : (
              <p className="text-[10px] text-subtle">{t("jev.car.waiting")}</p>
            )}
            {latestDecision?.reason ? (
              <p className="text-[10px] text-danger">
                {t("jev.degraded", { reason: t(`jev.err.${latestDecision.reason}`) })}
              </p>
            ) : null}
            {topProbabilities.length > 0 ? (
              <div className="grid gap-1" data-testid="car-top-probabilities">
                <span className="text-[10px] font-medium uppercase tracking-wide text-subtle">
                  {t("jev.car.topProb")}
                </span>
                {topProbabilities.map((option) => (
                  <div
                    key={option.label}
                    className="grid grid-cols-[110px_1fr_34px] items-center gap-2"
                  >
                    <span
                      className={cn(
                        "truncate font-mono text-[10px]",
                        option.label === latestDecision?.pick ? "text-fg" : "text-subtle",
                      )}
                    >
                      {option.label}
                    </span>
                    <span className="h-1 overflow-hidden rounded-full bg-surface">
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
            ) : null}
          </div>

          {bem < 0.05 ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-raised px-3 py-2 shadow-[var(--shadow-border)]">
              <p className="text-xs text-warn">{t("jev.lowBem")}</p>
              <Button size="sm" variant="secondary" onClick={faucet}>
                {t("faucet")}
              </Button>
            </div>
          ) : null}
        </div>

        <div className="grid content-start gap-4">
          <DecisionRowStats rows={rows} />
          <DecisionStream rows={rows} />
          <MessageStrip rows={rows} />
          <p className="text-[10px] leading-relaxed text-subtle">{t("jev.car.note")}</p>
        </div>
      </div>
    </div>
  );
}
