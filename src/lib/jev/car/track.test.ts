/**
 * Track geometry regression: the closed loop, the projection (signed offset,
 * edge distances, arc position) and the look-ahead that tells the car what it
 * is driving into. Every number here is what the sensors and the board read.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  TRACK_SAMPLES,
  TRACK_WIDTH,
  createTrack,
  locate,
  lookAhead,
  pointAtArc,
  trackBounds,
  trackEdges,
  wrapAngle,
} from "./track.ts";

const track = createTrack();

/** A point offset from the centreline: +left, −right, in world metres. */
function offsetPoint(arc: number, lateral: number) {
  const base = pointAtArc(track, arc);
  const next = pointAtArc(track, arc + 0.5);
  const heading = Math.atan2(next.y - base.y, next.x - base.x);
  return { x: base.x - Math.sin(heading) * lateral, y: base.y + Math.cos(heading) * lateral };
}

describe("track / geometry", () => {
  it("is a closed loop with a monotonic arc and all samples accounted for", () => {
    assert.equal(track.centerline.length, TRACK_SAMPLES);
    assert.equal(track.arc.length, TRACK_SAMPLES);
    assert.equal(track.arc[0], 0);
    assert.ok(track.length > 100 && track.length < 140, `unexpected length ${track.length}`);
    const summed = track.lengths.reduce((sum, step) => sum + step, 0);
    assert.ok(Math.abs(summed - track.length) < 1e-6, "lengths must add up to the track length");
    for (let i = 1; i < track.arc.length; i += 1) {
      assert.ok(track.arc[i] > track.arc[i - 1], `arc must increase at ${i}`);
    }
    // The loop is smooth: no segment is a discontinuity.
    for (const step of track.lengths) assert.ok(step > 0.3 && step < 0.9, `segment ${step}`);
  });

  it("bends both ways — the radius breathes between ~8 m and ~450 m", () => {
    const radii = track.curvature.map((k) => 1 / Math.abs(k));
    const tightest = Math.min(...radii);
    assert.ok(tightest > 7 && tightest < 9, `tightest radius ${tightest}`);
    assert.ok(track.curvature.some((k) => k > 0.05), "needs a left-hand bend");
    assert.ok(track.curvature.some((k) => k < -0.05), "needs a right-hand bend");
  });

  it("locates a point on the centreline at zero offset", () => {
    for (const arc of [0, 12.5, 40, 77.7, track.length - 0.2]) {
      const fix = locate(track, pointAtArc(track, arc));
      assert.ok(Math.abs(fix.offset) < 1e-6, `offset at ${arc} is ${fix.offset}`);
      assert.ok(Math.abs(fix.arc - arc) < 1e-6, `arc at ${arc} is ${fix.arc}`);
      assert.equal(fix.leftEdge, track.halfWidth - fix.offset);
      assert.equal(fix.rightEdge, track.halfWidth + fix.offset);
    }
  });

  it("signs the offset by side of travel: left positive, right negative", () => {
    const left = locate(track, offsetPoint(20, 2));
    const right = locate(track, offsetPoint(20, -2));
    assert.ok(Math.abs(left.offset - 2) < 0.02, `left offset ${left.offset}`);
    assert.ok(Math.abs(right.offset + 2) < 0.02, `right offset ${right.offset}`);
    // Edges: 2 m to the left of the centre leaves 5.5 m of road on the right.
    assert.ok(Math.abs(left.leftEdge - 1.5) < 0.02);
    assert.ok(Math.abs(left.rightEdge - 5.5) < 0.02);
    // Past the edge: the near edge distance goes negative, the far one grows.
    const outside = locate(track, offsetPoint(20, 4));
    assert.ok(outside.leftEdge < 0, "4 m left is outside a 3.5 m half-width");
    assert.ok(outside.rightEdge > 7);
  });

  it("wraps the arc at the finish line and keeps pointAtArc inverse to locate", () => {
    const just = locate(track, pointAtArc(track, track.length - 0.1));
    assert.ok(just.arc > track.length - 0.3 && just.arc < track.length, `arc ${just.arc}`);
    const wrapped = pointAtArc(track, track.length + 5);
    const direct = pointAtArc(track, 5);
    assert.ok(Math.abs(wrapped.x - direct.x) < 1e-6 && Math.abs(wrapped.y - direct.y) < 1e-6);
  });

  it("looks ahead to the tightest bend in the window", () => {
    const whole = lookAhead(track, 0, track.length);
    assert.ok(whole.minRadius > 7 && whole.minRadius < 9, `min radius ${whole.minRadius}`);
    // The window never lies: the reported bend is inside it.
    const local = lookAhead(track, 30, 10);
    const scanned = [];
    for (let s = 0; s < 10; s += 0.5) {
      const index = Math.min(
        track.centerline.length - 1,
        Math.floor(((30 + s) / track.length) * track.centerline.length),
      );
      scanned.push(track.curvature[index]);
    }
    const worst = scanned.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a));
    assert.ok(Math.abs(local.worstCurvature) >= Math.abs(worst) - 1e-9);
  });

  it("publishes consistent bounds and edge polylines for the board", () => {
    const bounds = trackBounds(track);
    const { left, right } = trackEdges(track);
    assert.equal(left.length, track.centerline.length);
    assert.equal(right.length, track.centerline.length);
    for (let i = 0; i < track.centerline.length; i += 1) {
      const centre = track.centerline[i];
      assert.ok(bounds.minX <= centre.x && centre.x <= bounds.maxX);
      assert.ok(bounds.minY <= centre.y && centre.y <= bounds.maxY);
      const separation = Math.hypot(left[i].x - right[i].x, left[i].y - right[i].y);
      assert.ok(Math.abs(separation - track.width) < 1e-6, `width ${separation}`);
    }
    assert.equal(track.width, TRACK_WIDTH);
  });

  it("wraps angles into (−π, π]", () => {
    assert.ok(Math.abs(wrapAngle(Math.PI * 3) - Math.PI) < 1e-9);
    assert.ok(Math.abs(wrapAngle(-Math.PI * 2 - 0.5) + 0.5) < 1e-9);
    assert.equal(wrapAngle(0.25), 0.25);
  });
});
