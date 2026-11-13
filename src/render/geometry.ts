import type { P } from "../types";

export const LANE_GAP = 7;
export const TRUNK_AT = 4;
/** Widest white halo svg.ts draws behind a jump arc (`s.w + 4`, widest lane stroke 8 = trunk); a crosser must extend past the line by r + half of it + 2 px, or the halo erases its end. */
export const JUMP_HALO_MAX_W = 12;

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

type Crosser = { x: number; y1: number; y2: number };

/** The jumps of one segment a→b: horizontal segments jump over vertical crossers strictly inside them, as `[from, to]` x runs. */
function runsOf(a: P, b: P, crossers: Crosser[], r: number): [number, number][] {
  if (Math.abs(a.y - b.y) >= 0.5 || Math.abs(a.x - b.x) <= 0.5) return [];
  const dir = Math.sign(b.x - a.x);
  const m = r + JUMP_HALO_MAX_W / 2 + 2;
  const xs = crossers
    .filter((c) => c.y1 < a.y - m && c.y2 > a.y + m && (c.x - a.x) * dir >= r + 3 && (b.x - c.x) * dir >= r + 3)
    .map((c) => c.x)
    .sort((p, q) => (p - q) * dir);
  // crossers closer than 2r (a lane bundle) share one jump, stretched flat to span them all
  const runs: [number, number][] = [];
  for (const x of xs) {
    const run = runs.at(-1);
    if (run && (x - run[1]) * dir < 2 * r) run[1] = x;
    else runs.push([x, x]);
  }
  return runs.map(([s0, s1]) => [s0 - r * dir, s1 + r * dir]);
}

const arc = (x0: number, x1: number, y: number, r: number, span: number) =>
  `A${f(r + span / 2)},${f(r)} 0 0 ${x1 > x0 ? 1 : 0} ${f(x1)},${f(y)}`;

/** SVG path `d` for a polyline; horizontal segments jump (arc or gap) over vertical crossers strictly inside them. */
export function jumpPath(points: P[], crossers: Crosser[], r: number, style: "arc" | "gap" | "none"): string {
  let d = `M${f(points[0]!.x)},${f(points[0]!.y)}`;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!, y = f(a.y);
    if (style !== "none") for (const [x0, x1] of runsOf(a, b, crossers, r))
      d += style === "arc" ? ` L${f(x0)},${y} ${arc(x0, x1, a.y, r, Math.abs(x1 - x0) - 2 * r)}` : ` L${f(x0)},${y} M${f(x1)},${y}`;
    d += ` L${f(b.x)},${f(b.y)}`;
  }
  return d;
}

/** One `d` per arc jumpPath draws, for drawing the jumps again on top of everything they cross. */
export function jumpArcs(points: P[], crossers: Crosser[], r: number): string[] {
  return points.slice(1).flatMap((b, i) => runsOf(points[i]!, b, crossers, r)
    .map(([x0, x1]) => `M${f(x0)},${f(b.y)} ${arc(x0, x1, b.y, r, Math.abs(x1 - x0) - 2 * r)}`));
}
