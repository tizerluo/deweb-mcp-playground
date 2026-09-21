import { useEffect, useMemo, useRef } from "react";
import type { Candidate } from "@/lib/jev/car/candidates";
import { type CarState, sameAction } from "@/lib/jev/car/engine";
import { type Point, type Track, trackBounds, trackEdges, wrapAngle } from "@/lib/jev/car/track";

type Props = {
  /** The state the window ended on. */
  state: CarState;
  /** The state the window started from: what the car is animated away from. */
  from: CarState;
  track: Track;
  /** Every option the decision was made over, with the path it predicted. */
  candidates: Candidate[];
  /**
   * The action that was played, with its own rollout: the path drawn bright.
   * Its own rollout, not a candidate looked up by label — a local fallback
   * steers continuously and its path is not any of the ten.
   */
  played: Candidate | null;
  /** How long the window lasted, ms — the animation covers exactly one. */
  waitedMs: number;
  running: boolean;
};

const SIZE = 560;
const PAD = 16;
/** Metres of empty space kept around the track, so nothing touches the frame. */
const MARGIN_M = 6;

function themeColor(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function lerp(from: number, to: number, t: number) {
  return from + (to - from) * t;
}

/**
 * The track and the car, in one canvas: the lane with both edges, every option's
 * predicted path (faint) with the played one bright, the start line, and the car
 * animated across the window it just drove. The world is metres and +y points
 * up, so screen coordinates flip y once here and everything else stays in the
 * same frame the physics uses.
 */
export function CarBoard({ state, from, track, candidates, played, waitedMs, running }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const previousRef = useRef<{ state: CarState; from: CarState } | null>(null);

  const projection = useMemo(() => {
    const bounds = trackBounds(track);
    const width = Math.max(1, bounds.maxX - bounds.minX) + MARGIN_M * 2;
    const height = Math.max(1, bounds.maxY - bounds.minY) + MARGIN_M * 2;
    const scale = (SIZE - PAD * 2) / Math.max(width, height);
    const offsetX = (SIZE - width * scale) / 2 - bounds.minX * scale + MARGIN_M * scale;
    const offsetY = (SIZE - height * scale) / 2 - bounds.minY * scale + MARGIN_M * scale;
    const toScreen = (point: Point) => ({
      x: offsetX + point.x * scale,
      y: SIZE - (offsetY + point.y * scale),
    });
    return { toScreen, scale };
  }, [track]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const prior = previousRef.current;
    previousRef.current = { state, from };
    // Animate only a real advance: a pause, a reset or a first paint is drawn
    // as it stands, not interpolated from a stale window.
    const animate =
      running && prior !== null && prior.state.steps === from.steps && state.steps > from.steps;
    const startedAt = performance.now();
    let frame = 0;

    const paint = (progress: number) => {
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      if (canvas.width !== Math.round(SIZE * ratio)) {
        canvas.width = Math.round(SIZE * ratio);
        canvas.height = Math.round(SIZE * ratio);
      }
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, SIZE, SIZE);

      const surface = themeColor("--color-surface", "#141416");
      const raised = themeColor("--color-raised", "#1b1b1e");
      const line = themeColor("--color-line", "#2a2a2e");
      const accent = themeColor("--color-accent", "#c5cdd6");
      const fg = themeColor("--color-fg", "#ecece8");
      const ok = themeColor("--color-ok", "#7d9b8a");
      const warn = themeColor("--color-warn", "#b08a62");
      const danger = themeColor("--color-danger", "#b07070");

      const { toScreen, scale } = projection;
      ctx.fillStyle = surface;
      ctx.fillRect(0, 0, SIZE, SIZE);

      const path = (points: Point[]) => {
        ctx.beginPath();
        points.forEach((point, index) => {
          const at = toScreen(point);
          if (index === 0) ctx.moveTo(at.x, at.y);
          else ctx.lineTo(at.x, at.y);
        });
        ctx.closePath();
      };

      // The lane: a wide stroke of the centreline, then both edges on top.
      ctx.strokeStyle = raised;
      ctx.lineWidth = track.width * scale;
      ctx.lineJoin = "round";
      path(track.centerline);
      ctx.stroke();

      const edges = trackEdges(track);
      ctx.strokeStyle = line;
      ctx.lineWidth = 1;
      path(edges.left);
      ctx.stroke();
      path(edges.right);
      ctx.stroke();

      // Every option's predicted path, faint; the played one bright on top.
      for (const candidate of candidates) {
        // The played action's own trace is drawn below; skip the candidate it
        // *is*, and only that one: a local fallback can share a candidate's
        // label while steering somewhere else entirely, and its faint option
        // still belongs on the map.
        if (played && sameAction(candidate.action, played.action)) continue;
        ctx.strokeStyle = candidate.metrics.collision ? danger : accent;
        ctx.globalAlpha = 0.16;
        ctx.lineWidth = 1;
        ctx.beginPath();
        candidate.trace.forEach((point, index) => {
          const at = toScreen(point);
          if (index === 0) ctx.moveTo(at.x, at.y);
          else ctx.lineTo(at.x, at.y);
        });
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      if (played) {
        ctx.strokeStyle = played.metrics.collision ? danger : ok;
        ctx.lineWidth = 2.5;
        ctx.lineCap = "round";
        ctx.beginPath();
        played.trace.forEach((point, index) => {
          const at = toScreen(point);
          if (index === 0) ctx.moveTo(at.x, at.y);
          else ctx.lineTo(at.x, at.y);
        });
        ctx.stroke();
      }

      // The start line: a short bar across the lane at arc 0.
      const start = toScreen(track.centerline[0]);
      const next = toScreen(track.centerline[1]);
      const angle = Math.atan2(next.y - start.y, next.x - start.x);
      ctx.strokeStyle = warn;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(
        start.x - Math.sin(angle) * track.halfWidth * scale,
        start.y + Math.cos(angle) * track.halfWidth * scale,
      );
      ctx.lineTo(
        start.x + Math.sin(angle) * track.halfWidth * scale,
        start.y - Math.cos(angle) * track.halfWidth * scale,
      );
      ctx.stroke();

      // The car, at the interpolated pose of the window just driven.
      const heading = from.heading + wrapAngle(state.heading - from.heading) * progress;
      const at = toScreen({
        x: lerp(from.x, state.x, progress),
        y: lerp(from.y, state.y, progress),
      });
      const body = state.onTrack ? fg : danger;
      const length = 3.4 * scale;
      const width = 1.7 * scale;
      ctx.save();
      ctx.translate(at.x, at.y);
      // The screen flips y, so a counter-clockwise world turn is one on screen too.
      ctx.rotate(-heading);
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.moveTo(length / 2, 0);
      ctx.lineTo(length / 2 - width * 0.6, width / 2);
      ctx.lineTo(-length / 2, width / 2);
      ctx.lineTo(-length / 2, -width / 2);
      ctx.lineTo(length / 2 - width * 0.6, -width / 2);
      ctx.closePath();
      ctx.fill();
      if (Math.abs(state.steerAngle) > 0.01) {
        ctx.strokeStyle = warn;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(length / 4, 0);
        ctx.lineTo(length / 4, state.steerAngle * width * 4);
        ctx.stroke();
      }
      ctx.restore();
    };

    const step = (now: number) => {
      const progress = animate ? Math.min(1, (now - startedAt) / Math.max(1, waitedMs)) : 1;
      paint(progress);
      if (progress < 1) frame = window.requestAnimationFrame(step);
    };
    frame = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(frame);
  }, [state, from, track, candidates, played, waitedMs, running, projection]);

  return (
    <canvas
      ref={canvasRef}
      width={SIZE}
      height={SIZE}
      style={{ width: "100%", maxWidth: SIZE, aspectRatio: "1 / 1" }}
      className="rounded-lg"
      aria-label="car track"
      data-testid="car-board"
    />
  );
}
