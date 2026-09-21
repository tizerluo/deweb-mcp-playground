/**
 * Track geometry for the car demo. One closed loop — an analytic curve whose
 * radius breathes (left and right bends, no self-intersection) — plus the
 * queries that turn a position into facts: signed lateral offset, the distance
 * to each edge, heading error and the curvature lying ahead.
 *
 * Pure functions over plain numbers: the canvas, the sensors and the tests all
 * read the same geometry, so what the board draws is what the car reasons
 * about. Coordinates are world metres in a right-handed frame (y up); the
 * board is the only place that flips y for the screen.
 */

export type Point = { x: number; y: number };

/** Corridor width in metres: the car is off track when it leaves this band. */
export const TRACK_WIDTH = 7;
/** Centreline resolution. 240 samples over ~120 m is a 0.5 m step. */
export const TRACK_SAMPLES = 240;
export const TRACK_R0 = 18;
export const TRACK_A = 3.2;
export const TRACK_B = 2.2;

export type Track = {
  width: number;
  halfWidth: number;
  /** Closed centreline: the last point connects back to the first. */
  centerline: Point[];
  /** Cumulative arc length at each centreline point; `arc[0]` is 0. */
  arc: number[];
  /** Segment lengths; `lengths[i]` runs from point i to point i+1 (wrapped). */
  lengths: number[];
  /** Signed curvature per segment (1/m, positive = turning left). */
  curvature: number[];
  /** Total centreline length in metres. */
  length: number;
};

/** r(θ) = R0 + A·cos 2θ + B·sin 3θ — smooth, closed, radius 12.6 m … 22.4 m. */
export function trackRadius(theta: number): number {
  return TRACK_R0 + TRACK_A * Math.cos(2 * theta) + TRACK_B * Math.sin(3 * theta);
}

function pointAtTheta(theta: number): Point {
  const r = trackRadius(theta);
  return { x: r * Math.cos(theta), y: r * Math.sin(theta) };
}

/** Wrap an angle into (−π, π]. */
export function wrapAngle(angle: number): number {
  let out = angle;
  while (out <= -Math.PI) out += 2 * Math.PI;
  while (out > Math.PI) out -= 2 * Math.PI;
  return out;
}

export function createTrack(opts: { width?: number; samples?: number } = {}): Track {
  const width = opts.width ?? TRACK_WIDTH;
  const samples = opts.samples ?? TRACK_SAMPLES;
  const centerline: Point[] = [];
  for (let i = 0; i < samples; i += 1) {
    centerline.push(pointAtTheta((2 * Math.PI * i) / samples));
  }

  const lengths: number[] = [];
  const arc: number[] = [];
  let length = 0;
  for (let i = 0; i < samples; i += 1) {
    const from = centerline[i];
    const to = centerline[(i + 1) % samples];
    const step = Math.hypot(to.x - from.x, to.y - from.y);
    arc.push(length);
    lengths.push(step);
    length += step;
  }

  const curvature: number[] = [];
  for (let i = 0; i < samples; i += 1) {
    const next = (i + 1) % samples;
    const heading = Math.atan2(
      centerline[next].y - centerline[i].y,
      centerline[next].x - centerline[i].x,
    );
    const headingAfter = Math.atan2(
      centerline[(next + 1) % samples].y - centerline[next].y,
      centerline[(next + 1) % samples].x - centerline[next].x,
    );
    // Piecewise-constant curvature on the segment: how fast the tangent turns.
    curvature.push(wrapAngle(headingAfter - heading) / Math.max(1e-9, lengths[i]));
  }

  return { width, halfWidth: width / 2, centerline, arc, lengths, curvature, length };
}

export type TrackFix = {
  /** Centreline segment index the position projects onto. */
  index: number;
  /** Projection point on the centreline. */
  point: Point;
  /** Stretch position along the centreline, in metres (0 … track.length). */
  arc: number;
  /** Signed lateral offset in metres: positive to the LEFT of travel. */
  offset: number;
  /** Distance to the left edge (metres, negative when already outside). */
  leftEdge: number;
  /** Distance to the right edge (metres, negative when already outside). */
  rightEdge: number;
  /** Centreline heading at the projection (radians). */
  heading: number;
  /** Signed curvature of that segment (1/m, positive = turning left). */
  curvature: number;
};

/** Project `p` onto the nearest centreline segment and report the fix. */
export function locate(track: Track, p: Point): TrackFix {
  let bestIndex = 0;
  let bestT = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  const count = track.centerline.length;

  for (let i = 0; i < count; i += 1) {
    const from = track.centerline[i];
    const to = track.centerline[(i + 1) % count];
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const lenSq = dx * dx + dy * dy;
    const t =
      lenSq === 0
        ? 0
        : Math.min(1, Math.max(0, ((p.x - from.x) * dx + (p.y - from.y) * dy) / lenSq));
    const projX = from.x + dx * t;
    const projY = from.y + dy * t;
    const distance = Math.hypot(p.x - projX, p.y - projY);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
      bestT = t;
    }
  }

  const from = track.centerline[bestIndex];
  const to = track.centerline[(bestIndex + 1) % count];
  const heading = Math.atan2(to.y - from.y, to.x - from.x);
  const point = { x: from.x + (to.x - from.x) * bestT, y: from.y + (to.y - from.y) * bestT };
  // 2-D cross product of the tangent with the offset vector: positive means the
  // point sits to the left of travel.
  const cross = Math.cos(heading) * (p.y - point.y) - Math.sin(heading) * (p.x - point.x);
  const offset = bestDistance * Math.sign(cross);
  const arc = (track.arc[bestIndex] + track.lengths[bestIndex] * bestT) % track.length;

  return {
    index: bestIndex,
    point,
    arc,
    offset,
    leftEdge: track.halfWidth - offset,
    rightEdge: track.halfWidth + offset,
    heading,
    curvature: track.curvature[bestIndex],
  };
}

/** The centreline point at a given arc position (wraps around the loop). */
export function pointAtArc(track: Track, arc: number): Point {
  const target = ((arc % track.length) + track.length) % track.length;
  let index = 0;
  while (index < track.centerline.length - 1 && track.arc[index + 1] <= target) index += 1;
  const local = (target - track.arc[index]) / Math.max(1e-9, track.lengths[index]);
  const from = track.centerline[index];
  const to = track.centerline[(index + 1) % track.centerline.length];
  return { x: from.x + (to.x - from.x) * local, y: from.y + (to.y - from.y) * local };
}

export type LookAhead = {
  /** Curvature at the end of the window (what the car will be turning into). */
  curvature: number;
  /** The signed curvature with the largest magnitude inside the window. */
  worstCurvature: number;
  /** Tightest radius of curvature inside the window, in metres. */
  minRadius: number;
  /** Arc position of that tightest bend. */
  worstArc: number;
};

/**
 * Scan the centreline `distance` metres ahead of `fromArc` and report the bend
 * the car is heading into. The window is where the rollout cannot see yet, so
 * it is what tells a fast car to slow down before the corner.
 */
export function lookAhead(track: Track, fromArc: number, distance: number): LookAhead {
  const count = track.centerline.length;
  const start = ((fromArc % track.length) + track.length) % track.length;
  let index = 0;
  while (index < count - 1 && track.arc[index + 1] <= start) index += 1;

  let walked = 0;
  let worst = track.curvature[index];
  let worstArc = start;
  let cursor = index;
  // One lap is the whole track; a window longer than that is meaningless.
  const budget = Math.min(distance, track.length);
  while (walked < budget) {
    const step = track.lengths[cursor];
    walked += step;
    const here = track.curvature[cursor];
    if (Math.abs(here) > Math.abs(worst)) {
      worst = here;
      worstArc = track.arc[cursor];
    }
    cursor = (cursor + 1) % count;
    if (walked >= budget) break;
  }
  const atEnd = track.curvature[(cursor - 1 + count) % count];
  return {
    curvature: atEnd,
    worstCurvature: worst,
    minRadius: 1 / Math.max(1e-9, Math.abs(worst)),
    worstArc,
  };
}

/** Bounding box of the corridor (centreline expanded by half the width). */
export function trackBounds(track: Track): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of track.centerline) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  const pad = track.halfWidth + 1;
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}

/** Left/right edge polylines, offset from the centreline (for the board). */
export function trackEdges(track: Track): { left: Point[]; right: Point[] } {
  const left: Point[] = [];
  const right: Point[] = [];
  const count = track.centerline.length;
  for (let i = 0; i < count; i += 1) {
    const from = track.centerline[i];
    const to = track.centerline[(i + 1) % count];
    const heading = Math.atan2(to.y - from.y, to.x - from.x);
    const nx = -Math.sin(heading);
    const ny = Math.cos(heading);
    left.push({ x: from.x + nx * track.halfWidth, y: from.y + ny * track.halfWidth });
    right.push({ x: from.x - nx * track.halfWidth, y: from.y - ny * track.halfWidth });
  }
  return { left, right };
}
