import { useEffect, useRef } from "react";
import type { GameState, Point } from "@/lib/jev/snake/engine";

type Props = {
  game: GameState;
  tickMs: number;
  running: boolean;
  /** Accessible name for the canvas — the demo passes a localized one. */
  label: string;
};

const CELL = 32;
const PAD = 10;

function themeColor(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function lerp(from: number, to: number, t: number) {
  return from + (to - from) * t;
}

/**
 * Board with one-cell-per-tick interpolation: a tick paints the snake between
 * its previous cells and its new ones over the tick duration, so the move the
 * model chose is visible as motion rather than a jump.
 */
export function SnakeBoard({ game, tickMs, running, label }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const previousRef = useRef<GameState | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const previous = previousRef.current;
    previousRef.current = game;
    const animate =
      running &&
      previous !== null &&
      previous.status === "running" &&
      game.status === "running" &&
      previous.steps < game.steps;
    const startedAt = performance.now();
    let frame = 0;

    const paint = (progress: number) => {
      const size = game.grid * CELL + PAD * 2;
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      if (canvas.width !== Math.round(size * ratio)) {
        canvas.width = Math.round(size * ratio);
        canvas.height = Math.round(size * ratio);
      }
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, size, size);

      const bg = themeColor("--color-surface", "#141416");
      const line = themeColor("--color-line", "#2a2a2e");
      const body = themeColor("--color-accent", "#c5cdd6");
      const head = themeColor("--color-fg", "#ecece8");
      const food = themeColor("--color-warn", "#b08a62");

      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, size, size);
      ctx.strokeStyle = line;
      ctx.lineWidth = 1;
      for (let i = 1; i < game.grid; i += 1) {
        const at = PAD + i * CELL;
        ctx.beginPath();
        ctx.moveTo(at, PAD);
        ctx.lineTo(at, size - PAD);
        ctx.moveTo(PAD, at);
        ctx.lineTo(size - PAD, at);
        ctx.stroke();
      }

      // Food
      ctx.fillStyle = food;
      ctx.beginPath();
      ctx.arc(
        PAD + game.food.x * CELL + CELL / 2,
        PAD + game.food.y * CELL + CELL / 2,
        CELL * 0.22,
        0,
        Math.PI * 2,
      );
      ctx.fill();

      const drawCell = (point: { x: number; y: number }, fill: string, inset: number) => {
        const x = PAD + point.x * CELL + inset;
        const y = PAD + point.y * CELL + inset;
        const side = CELL - inset * 2;
        const radius = Math.min(8, side / 2.5);
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.arcTo(x + side, y, x + side, y + side, radius);
        ctx.arcTo(x + side, y + side, x, y + side, radius);
        ctx.arcTo(x, y + side, x, y, radius);
        ctx.arcTo(x, y, x + side, y, radius);
        ctx.closePath();
        ctx.fill();
      };

      const target = game.body;
      const source: Point[] = previous?.body ?? target;
      for (let index = target.length - 1; index >= 0; index -= 1) {
        const to = target[index];
        const from = source[index] ?? to;
        const cellPoint = {
          x: lerp(from.x, to.x, progress),
          y: lerp(from.y, to.y, progress),
        };
        if (index === 0) {
          drawCell(cellPoint, head, 2);
        } else {
          ctx.globalAlpha = Math.max(0.35, 1 - index * 0.03);
          drawCell(cellPoint, body, 4);
          ctx.globalAlpha = 1;
        }
      }
    };

    const step = (now: number) => {
      const progress = animate ? Math.min(1, (now - startedAt) / tickMs) : 1;
      paint(progress);
      if (progress < 1) frame = window.requestAnimationFrame(step);
    };
    frame = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(frame);
  }, [game, tickMs, running]);

  const size = game.grid * CELL + PAD * 2;
  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      style={{ width: "100%", maxWidth: size, aspectRatio: "1 / 1" }}
      className="rounded-lg"
      role="img"
      aria-label={label}
    />
  );
}
