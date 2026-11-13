import type { P } from "../types";

export const LANE_GAP = 7;
export const TRUNK_AT = 4;

/** Coordinates in SVG output: rounded to 0.1 px, no trailing ".0", no "-0". */
export const f = (n: number): string => String(Math.round(n * 10) / 10 + 0);

const normal = (a: P, b: P): P => {
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
  return len ? { x: -dy / len, y: dx / len } : { x: 0, y: 0 };
};

/**
 * Polyline shifted by `d` along the segment normals (−dy, dx). Interior points are the intersection of the two
 * adjacent offset lines (mitre), so any angle works; at a right angle that is p + (nIn + nOut)·d.
 */
export function laneOffset(points: P[], d: number): P[] {
  return points.map((p, i) => {
    const nIn = i > 0 ? normal(points[i - 1]!, p) : undefined;
    const nOut = i < points.length - 1 ? normal(p, points[i + 1]!) : undefined;
    const a = nIn && (nIn.x || nIn.y) ? nIn : nOut!, b = nOut && (nOut.x || nOut.y) ? nOut : a;
    const k = 1 + a.x * b.x + a.y * b.y;
    // near-reversal: the mitre would shoot off, fall back to the incoming normal
    const [mx, my] = k < 0.2 ? [a.x, a.y] : [(a.x + b.x) / k, (a.y + b.y) / k];
    return { x: p.x + mx * d, y: p.y + my * d };
  });
}

/** One polyline per lane, centred on the cable and LANE_GAP apart; more than TRUNK_AT lanes collapse into one trunk. */
export function lanesFor(points: P[], lanes: string[]): { lane: string; points: P[] }[] {
  if (lanes.length > TRUNK_AT) return [{ lane: "trunk", points }];
  return lanes.map((lane, i) => ({ lane, points: laneOffset(points, (i - (lanes.length - 1) / 2) * LANE_GAP) }));
}

/** SVG path `d` for a polyline; horizontal segments jump (arc or gap) over vertical crossers strictly inside them. */
export function jumpPath(points: P[], crossers: { x: number; y1: number; y2: number }[], r: number, style: "arc" | "gap" | "none"): string {
  let d = `M${f(points[0]!.x)},${f(points[0]!.y)}`;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!;
    if (style !== "none" && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.x - b.x) > 0.5) {
      const dir = Math.sign(b.x - a.x), y = f(a.y);
      const xs = crossers
        .filter((c) => c.y1 < a.y - 3 && c.y2 > a.y + 3 && (c.x - a.x) * dir >= r + 3 && (b.x - c.x) * dir >= r + 3)
        .map((c) => c.x)
        .sort((p, q) => (p - q) * dir);
      // crossers closer than 2r (a lane bundle) share one jump, stretched flat to span them all
      const runs: [number, number][] = [];
      for (const x of xs) {
        const run = runs.at(-1);
        if (run && (x - run[1]) * dir < 2 * r) run[1] = x;
        else runs.push([x, x]);
      }
      for (const [s0, s1] of runs) {
        const [x0, x1] = [f(s0 - r * dir), f(s1 + r * dir)];
        d += style === "arc" ? ` L${x0},${y} A${f(r + Math.abs(s1 - s0) / 2)},${f(r)} 0 0 ${dir > 0 ? 1 : 0} ${x1},${y}` : ` L${x0},${y} M${x1},${y}`;
      }
    }
    d += ` L${f(b.x)},${f(b.y)}`;
  }
  return d;
}
