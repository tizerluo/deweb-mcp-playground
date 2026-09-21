/**
 * Sensors — the facts the code computes before anything is asked. Nothing here
 * consults a model: the car's position on the track, how much room is left on
 * each side, how far it is pointing from the track direction, and what the
 * centreline does just ahead. JEV only ever sees these numbers, never the raw
 * world.
 */
import type { CarState } from "./engine.ts";
import { locate, lookAhead, type LookAhead, type Track, type TrackFix } from "./track.ts";

export type CarSensors = {
  /** Current speed, m/s. */
  speed: number;
  /** Signed lateral offset from the centreline, m (positive = left of travel). */
  offset: number;
  /** Distance to the left edge, m (negative once past it). */
  leftEdge: number;
  /** Distance to the right edge, m. */
  rightEdge: number;
  /** Heading error, rad: how far the nose points from the track direction. */
  headingError: number;
  /** Signed curvature under the car now, 1/m. */
  curvature: number;
  /** Curvature over the braking horizon ahead. */
  ahead: LookAhead;
  onTrack: boolean;
  /** 0 … 1: how centred the car is (1.00 exactly on the centreline). */
  centred: number;
  lap: number;
  offTrackCount: number;
  distance: number;
  arc: number;
};

export type SenseResult = { fix: TrackFix; sensors: CarSensors };

/** How far ahead the braking horizon reaches, in metres — speed-dependent. */
export function brakingHorizon(speed: number): number {
  return Math.min(18, Math.max(6, 0.8 * speed + 4));
}

export function senseCar(state: CarState, track: Track): SenseResult {
  const fix = locate(track, { x: state.x, y: state.y });
  const headingError = (() => {
    let diff = state.heading - fix.heading;
    while (diff <= -Math.PI) diff += 2 * Math.PI;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    return diff;
  })();
  const offset = fix.offset;
  return {
    fix,
    sensors: {
      speed: state.speed,
      offset,
      leftEdge: fix.leftEdge,
      rightEdge: fix.rightEdge,
      headingError,
      curvature: fix.curvature,
      ahead: lookAhead(track, fix.arc, brakingHorizon(state.speed)),
      onTrack: state.onTrack,
      centred: Math.max(0, 1 - Math.abs(offset) / track.halfWidth),
      lap: state.laps,
      offTrackCount: state.offTrackCount,
      distance: state.distance,
      arc: fix.arc,
    },
  };
}

/** Compact metre/degree readings for the UI strip. */
export function sensorReadout(sensors: CarSensors): {
  offset: number;
  leftEdge: number;
  rightEdge: number;
  headingErrorDeg: number;
  minRadius: number;
} {
  return {
    offset: sensors.offset,
    leftEdge: sensors.leftEdge,
    rightEdge: sensors.rightEdge,
    headingErrorDeg: (sensors.headingError * 180) / Math.PI,
    minRadius: sensors.ahead.minRadius,
  };
}
