import { textWidth } from "../layout/measure";
import { laneOfStyle, NAMED } from "../model/style";
import type { Box, MNode, Model, P, Placed, VlanDef } from "../types";
import { f, jumpArcs, jumpPath, lanesFor, TRUNK_AT } from "./geometry";

const FONT = "Inter, 'DejaVu Sans', Arial, sans-serif";
const JUMP_R = 5;
/** For colour names the theme doesn't know: picked by VLAN def position, so the result is stable. */
const PALETTE = ["#00838F", "#AD1457", "#6D4C41", "#283593", "#9E9D24", "#546E7A", "#FF8F00", "#4527A0"];
const DASHES = ["12 4 3 4", "4 4", "14 6", "7 3 2 3"];
const TINT: Record<string, string | undefined> & Record<"lan" | "guest" | "lte" | "wan" | "router" | "dev", string> = {
  lan: "#E8F5E9",
  guest: "#E3F2FD",
  lte: "#FFF3E0",
  wan: "#FDECEA",
  router: "#F3E5F5",
  dev: "#FAFAFA",
};
const ROUTE = "#6A1B9A",
  ALLOW = "#1565C0",
  WIRE = "#555";

/** `tint` (VLAN lanes only): the group/chip fill for nodes styled by that VLAN def. */
type Stroke = { stroke: string; w: number; dash?: string; tint?: string };
/** Theme fills for the theme's own colours; any other colour gets a computed light tint. */
const THEME_TINT: Record<string, string> = {
  [NAMED.green!]: "#E8F5E9",
  [NAMED.blue!]: "#E3F2FD",
  [NAMED.orange!]: "#FFF3E0",
};
/** Where along a segment a label may go: 0.05 … 0.95, nearest the middle first. */
const STEPS = Array.from({ length: 19 }, (_, i) => (i + 1) / 20).sort(
  (a, b) => Math.abs(a - 0.5) - Math.abs(b - 0.5) || a - b,
);
type Rect = { x0: number; y0: number; x1: number; y1: number };
const walk = (ns: MNode[]): MNode[] => ns.flatMap((n) => [n, ...walk(n.children)]);

export const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const hex = (c: string, i: number): string =>
  c.startsWith("#") ? c : (NAMED[c.toLowerCase()] ?? PALETTE[i % PALETTE.length]!);
/** Light tint of a colour: mixed 88 % towards white, for group fills the theme has no tint for. */
const tint = (c: string): string => {
  const n = parseInt(c.slice(1).padEnd(6, "0").slice(0, 6), 16);
  const ch = (s: number) =>
    Math.round(((n >> s) & 255) * 0.12 + 255 * 0.88)
      .toString(16)
      .padStart(2, "0");
  return `#${ch(16)}${ch(8)}${ch(0)}`.toUpperCase();
};

/** Stroke per lane name: one per VLAN def, plus the fixed kinds. */
export function laneStyles(vlans: VlanDef[]): Map<string, Stroke> {
  const m = new Map<string, Stroke>([
    ["wire", { stroke: WIRE, w: 2.5 }],
    ["trunk", { stroke: WIRE, w: 8 }],
    ["route", { stroke: ROUTE, w: 4 }],
    ["allow", { stroke: ALLOW, w: 2, dash: "2 4" }],
  ]);
  let tagged = 0;
  const seen = new Set<string>(),
    look = (s: Stroke) => `${s.stroke} ${s.w} ${s.dash ?? ""}`;
  vlans.forEach((v, i) => {
    const stroke = hex(v.color, i),
      t = THEME_TINT[stroke.toUpperCase()] ?? tint(stroke);
    const s: Stroke =
      v.ids === "untagged"
        ? { stroke, w: 4, tint: t }
        : v.name === "lte" || stroke === NAMED.orange
          ? { stroke, w: 4, dash: "10 4", tint: t }
          : { stroke, w: 3, dash: tagged++ === 0 ? "7 5" : DASHES[(tagged - 2) % DASHES.length], tint: t };
    // the same look as an earlier VLAN (same colour at scale): step through the dash list until it is unique
    for (const d of dashes()) {
      if (!seen.has(look(s))) break;
      s.dash = d;
    }
    seen.add(look(s));
    m.set(v.name, s);
  });
  return m;
}

/** Today's dashes, then generated ones: dash/gap pairs, then the same with one or two dots. Never runs out. */
function* dashes(): Generator<string> {
  yield* DASHES;
  const lens = [2, 4, 6, 8, 10, 12, 16, 20, 24, 30],
    gaps = [3, 6, 4, 5, 2];
  for (const dots of ["", " 2 G", " 2 G 2 G"])
    for (const g of gaps) for (const d of lens) yield `${d} ${g}${dots.replaceAll("G", String(g))}`;
  for (let d = 31; ; d++) yield `${d} 3`;
}

const strokeAttrs = (s: Stroke) =>
  `stroke="${s.stroke}" stroke-width="${f(s.w)}"${s.dash ? ` stroke-dasharray="${s.dash}"` : ""}`;
const markers = (lane: string) =>
  lane === "route"
    ? ' marker-start="url(#ap)" marker-end="url(#ap)"'
    : lane === "allow"
      ? ' marker-end="url(#ab)"'
      : "";

/** "10–13, 40": runs of three or more consecutive ids collapse into ranges; "50, 51" stays a list. */
export function idList(ids: number[]): string {
  const s = [...new Set(ids)].sort((a, b) => a - b),
    out: string[] = [];
  for (let i = 0; i < s.length; i++) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j]! + 1) j++;
    if (j - i >= 2) {
      out.push(`${s[i]}–${s[j]}`);
      i = j;
    } else out.push(String(s[i]));
  }
  return out.join(", ");
}
const display = (name: string) =>
  name.length <= 4 ? name.toUpperCase() : name.charAt(0).toUpperCase() + name.slice(1);
const text = (x: number, y: number, s: string, attrs: string) =>
  `<text x="${f(x)}" y="${f(y)}" ${attrs}>${esc(s)}</text>`;
const halo = 'stroke="#fff" stroke-width="4" stroke-linejoin="round" paint-order="stroke"';

/** Cloud outline inside its box: five bumps over a flat base. */
const cloud = ({ x, y, w, h }: Box) => {
  const p = (u: number, v: number) => `${f(x + u * w)},${f(y + v * h)}`;
  const a = (r: number, u: number, v: number) => ` A${f(r * w)},${f(r * w)} 0 0 1 ${p(u, v)}`;
  return `M${p(0.14, 0.95)}${a(0.14, 0.03, 0.55)}${a(0.18, 0.3, 0.18)}${a(0.22, 0.7, 0.12)}${a(0.17, 0.97, 0.55)}${a(0.13, 0.86, 0.95)} Z`;
};

/** Shapes, and their labels separately so they can go on top of the cables (with a halo in the box's own fill). */
function drawNodes(
  model: Model,
  placed: Placed,
  lanes: Map<string, Stroke>,
  laneOf: Map<string, string>,
): { shapes: string[]; texts: string[] } {
  const out: string[] = [],
    texts: string[] = [];
  const lane = (style: string) => lanes.get(laneOfStyle(style) ?? "");
  const styleStroke = (style: string, fallback: string) => lane(style)?.stroke ?? fallback;
  const draw = (n: MNode) => {
    const b = placed.boxes.get(n.id);
    if (!b) return;
    const [x, y, w, h] = [b.x, b.y, b.w, b.h];
    let bg = "#F5F5F5";
    const rect = (rx: number, fill: string, s: Stroke) => {
      bg = fill;
      out.push(
        `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" rx="${rx}" fill="${fill}" ${strokeAttrs(s)}/>`,
      );
    };
    const container = n.children.length > 0;
    let centred = !container && n.sub.length === 0,
      labelFill = "";
    if (n.kind === "cloud") {
      out.push(`<path d="${cloud(b)}" fill="#F5F5F5" stroke="#777" stroke-width="1.5"/>`);
      centred = true;
    } else if (n.kind === "router") {
      const pts = [
        [0, h / 2],
        [20, 0],
        [w - 20, 0],
        [w, h / 2],
        [w - 20, h],
        [20, h],
      ]
        .map(([u, v]) => `${f(x + u!)},${f(y + v!)}`)
        .join(" ");
      out.push(`<polygon points="${pts}" fill="${TINT.router}" stroke="${ROUTE}" stroke-width="2"/>`);
      centred = true;
      labelFill = ' fill="#4A148C"';
      bg = TINT.router;
    } else if (n.kind === "iface") {
      const c = lane(n.style)?.stroke ?? lanes.get(laneOf.get(n.id) ?? "")?.stroke ?? ALLOW;
      rect(6, lane(n.style)?.tint ?? TINT[n.style] ?? "#fff", { stroke: c, w: 1.5, dash: "6 4" });
    } else if (n.style === "spare") rect(6, "#F5F5F5", { stroke: "#999", w: 1.5, dash: "4 3" });
    else if (n.kind === "radio" && lane(n.style)?.tint)
      rect(6, lane(n.style)!.tint!, { stroke: lane(n.style)!.stroke, w: 1.5 }); // a use-tag radio chip
    else if (n.style === "dev") rect(10, TINT.dev, { stroke: "#333", w: 2 });
    else if (n.style === "wan") rect(10, TINT.wan, { stroke: "#C62828", w: 1.5 });
    else if (container) {
      const c = styleStroke(n.style, WIRE);
      rect(10, lane(n.style)?.tint ?? TINT[n.style] ?? tint(c), { stroke: c, w: 1.5 });
    } else rect(6, "#fff", { stroke: WIRE, w: 1.5 });

    const tx = centred ? x + w / 2 : x + 14,
      anchor = centred ? ' text-anchor="middle"' : "";
    const ty = n.kind === "cloud" ? y + h / 2 + 5 - 8 * n.sub.length : y + (n.kind === "router" ? h / 2 + 5 : 24);
    const h2 = ` stroke="${bg}" stroke-width="3" stroke-linejoin="round" paint-order="stroke"`;
    texts.push(text(tx, ty, n.label, `class="h"${anchor}${labelFill}${h2}`));
    n.sub.forEach((s, i) => {
      texts.push(text(tx, ty + 17 * (i + 1), s, `class="s"${anchor}${h2}`));
    });
    n.children.forEach(draw);
  };
  model.nodes.forEach(draw);
  return { shapes: out, texts };
}

type Line = { owner: string; lane: string; points: P[] };
/** `list`: a trunk set's VLANs, wrapped onto continuation rows (`more`, no swatch) when long. */
type Entry = { key: string; label: string; sub?: string; lane: string; list?: string[]; more?: boolean };

// the router chip label is the only place the model records NAT
const nats = (ns: MNode[]) => walk(ns).some((n) => n.kind === "router" && n.label.includes("NAT"));

function legendEntries(model: Model, lanes: Map<string, Stroke>, lines: Line[]): Entry[] {
  const used = new Set(lines.map((l) => l.lane));
  const carried = new Set([
    ...model.links.flatMap((l) => l.lanes),
    ...walk(model.nodes).flatMap((n) => laneOfStyle(n.style) ?? []),
  ]);
  const kinds: Entry[] = [
    { key: "wire", label: "plain cable", lane: "wire" },
    {
      key: "trunk",
      label: model.links.some((l) => l.trunk)
        ? "trunk: named set or more than 4 VLANs"
        : `trunk, more than ${TRUNK_AT} VLANs`,
      lane: "trunk",
    },
    { key: "route", label: nats(model.nodes) ? "routed / NAT" : "routed", lane: "route" },
    { key: "allow", label: "firewall allows", lane: "allow" },
  ];
  const entries: Entry[] = [
    ...model.vlans
      .filter((v) => carried.has(v.name))
      .map((v) => ({
        key: v.name,
        label: `${display(v.name)} (${v.ids === "untagged" ? "untagged" : idList(v.ids)})`,
        sub: v.subnets.length ? v.subnets.join(", ") : undefined,
        lane: v.name,
      })),
    ...model.trunks
      .filter((t) => model.links.some((l) => l.trunk === t.name))
      .map((t) => ({ key: t.name, label: `${t.name} → ${t.vlans.join(", ")}`, lane: "trunk", list: t.vlans })),
    ...kinds.filter((k) => used.has(k.lane)),
    ...model.legend.add.map((a) => ({ key: a.text, label: a.text, lane: lanes.has(a.style) ? a.style : "wire" })),
  ];
  const gone = new Set(model.legend.remove.map((r) => r.toLowerCase()));
  return entries.filter((e) => !gone.has(e.key.toLowerCase()) && !gone.has(e.label.toLowerCase()));
}

function drawLegend(
  model: Model,
  placed: Placed,
  lanes: Map<string, Stroke>,
  lines: Line[],
): { svg: string; w: number; h: number } | undefined {
  if (model.legend.mode === "off") return undefined;
  const all = legendEntries(model, lanes, lines),
    notes = model.legend.notes;
  if (!all.length && !notes.length) return undefined;
  const ew = (e: Entry) => 56 + textWidth(e.label, 13, true) + (e.sub ? 8 + textWidth(e.sub, 12.5, false) : 0) + 28;
  // a long trunk set wraps to the width of the other entries (at least 400 px of text)
  const max = Math.max(400, ...all.filter((e) => !e.list).map((e) => ew(e) - 84));
  const entries = all.flatMap((e): Entry[] => {
    if (!e.list) return [e];
    const rows: string[] = [];
    let cur = `${e.key} →`;
    e.list.forEach((v, i) => {
      const piece = i < e.list!.length - 1 ? `${v},` : v;
      if (!cur.endsWith("→") && textWidth(`${cur} ${piece}`, 13, true) > max) {
        rows.push(cur);
        cur = piece;
      } else cur = `${cur} ${piece}`;
    });
    rows.push(cur);
    return rows.map((label, i) => ({ ...e, label, more: i > 0 }));
  });
  const colW = Math.max(...entries.map(ew), 0);
  const noteW = Math.max(...notes.map((n) => textWidth(n, 12.5, false)), 0) + 32;
  const top = 50,
    rowH = 26;
  const shape = (right: boolean) => {
    const avail = right ? colW + 32 : Math.max(placed.width - 80, colW + 32, noteW);
    const cols = Math.max(1, Math.min(entries.length, Math.floor((avail - 32) / Math.max(colW, 1))));
    const rows = Math.ceil(entries.length / cols);
    return { right, avail, rows, h: top + rows * rowH + (notes.length ? 8 + notes.length * 18 : 0) + 6 };
  };
  // a right-hand legend taller than the diagram goes below it instead
  const r = shape(true),
    { right, avail, rows, h } = model.legend.position === "right" && r.h <= placed.height ? r : shape(false);
  const x = right ? placed.width : 40,
    y = right ? 110 : placed.height;
  const w = right ? Math.max(colW + 32, noteW) : avail;
  const out = [
    `<g class="legend">`,
    `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" rx="10" fill="#fff" stroke="#BDBDBD" stroke-width="1"/>`,
    text(x + 16, y + 28, "Legend", 'class="h"'),
  ];
  entries.forEach((e, i) => {
    const ex = x + 16 + Math.floor(i / rows) * colW,
      ey = y + top + (i % rows) * rowH;
    const s = lanes.get(e.lane)!,
      [x0, x1] = e.lane === "route" ? [ex + 4, ex + 44] : [ex, ex + (e.lane === "allow" ? 38 : 44)];
    if (!e.more)
      out.push(`<path d="M${f(x0)},${f(ey)} L${f(x1)},${f(ey)}" fill="none" ${strokeAttrs(s)}${markers(e.lane)}/>`);
    out.push(
      `<text x="${f(ex + 56)}" y="${f(ey + 4.5)}" class="t">${esc(e.label)}${e.sub ? ` <tspan class="s">${esc(e.sub)}</tspan>` : ""}</text>`,
    );
  });
  notes.forEach((n, i) => {
    out.push(text(x + 16, y + top + rows * rowH + 6 + i * 18, n, 'class="s"'));
  });
  out.push("</g>");
  return { svg: out.join("\n"), w: x + w, h: y + h };
}

export function renderSvg(model: Model, placed: Placed): string {
  const lanes = laneStyles(model.vlans);
  const link = new Map(model.links.map((l) => [l.id, l]));
  const arrow = new Map(model.arrows.map((a) => [a.id, a]));

  const lines: Line[] = [];
  for (const pl of placed.links) {
    const l = link.get(pl.id);
    if (!l || pl.points.length < 2) continue;
    for (const ln of lanesFor(pl.points, l.lanes, !!l.trunk))
      lines.push({ owner: pl.id, lane: lanes.has(ln.lane) ? ln.lane : "wire", points: ln.points });
  }
  for (const pa of placed.arrows) {
    const a = arrow.get(pa.id);
    if (a && pa.points.length >= 2) lines.push({ owner: pa.id, lane: a.kind, points: pa.points });
  }
  /** A VLAN iface is drawn in the colour of the lane its cables carry. */
  const laneOf = new Map<string, string>();
  for (const l of model.links)
    for (const end of [l.from, l.to]) if (!laneOf.has(end) && l.lanes[0]) laneOf.set(end, l.lanes[0]);

  const order = ["allow", "wire", ...model.vlans.map((v) => v.name), "trunk", "route"];
  const rank = (lane: string) => order.indexOf(lane);
  const sorted = lines
    .map((l, i) => [l, i] as const)
    .sort(([a, i], [b, j]) => rank(a.lane) - rank(b.lane) || i - j)
    .map(([l]) => l);

  const verticals = lines.flatMap((l) =>
    l.points.slice(1).flatMap((b, i) => {
      const a = l.points[i]!;
      return Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) > 0.5
        ? [{ owner: l.owner, x: a.x, y1: Math.min(a.y, b.y), y2: Math.max(a.y, b.y) }]
        : [];
    }),
  );
  const crossers = (l: Line) => verticals.filter((v) => v.owner !== l.owner);
  const paths = sorted.map((l) => {
    const d = jumpPath(l.points, crossers(l), JUMP_R, model.jumps);
    return `<path d="${d}" fill="none" ${strokeAttrs(lanes.get(l.lane)!)} stroke-linejoin="round"${markers(l.lane)}/>`;
  });
  // Arcs again, above every line: a white halo cuts the crossed line, then a solid arc (a 10 px arc of a dashed or
  // dotted line can fall into its gaps). Halos first, so one lane's halo never cuts a neighbouring lane's arc.
  const arcs =
    model.jumps === "arc"
      ? sorted.flatMap((l) => jumpArcs(l.points, crossers(l), JUMP_R).map((d) => ({ d, s: lanes.get(l.lane)! })))
      : [];
  const bridges = [
    ...arcs.map(({ d, s }) => `<path d="${d}" fill="none" stroke="#fff" stroke-width="${f(s.w + 4)}"/>`),
    ...arcs.map(({ d, s }) => `<path d="${d}" fill="none" stroke="${s.stroke}" stroke-width="${f(s.w)}"/>`),
  ];

  const labels: string[] = [];
  /** Middle of the longest segment: where a label without `labelAt` goes. */
  const mid = (pts: P[]): P => {
    const segs = pts.slice(1).map((b, i) => [pts[i]!, b] as const);
    const [a, b] = segs.reduce((best, s) =>
      Math.hypot(s[1].x - s[0].x, s[1].y - s[0].y) > Math.hypot(best[1].x - best[0].x, best[1].y - best[0].y)
        ? s
        : best,
    );
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };
  const containers = new Set(
    walk(model.nodes)
      .filter((n) => n.children.length)
      .map((n) => n.id),
  );
  /** Rects of the labels placed so far: a later label must not touch them. */
  const taken: Rect[] = [];
  /** A label must not touch a leaf box, another label, nor cross a container border (inside a container is fine). */
  const clean = (r: Rect) =>
    taken.every((t) => !(r.x1 > t.x0 && r.x0 < t.x1 && r.y1 > t.y0 && r.y0 < t.y1)) &&
    [...placed.boxes.values()].every((b) => {
      const meets = r.x1 > b.x && r.x0 < b.x + b.w && r.y1 > b.y && r.y0 < b.y + b.h;
      return !meets || (containers.has(b.id) && r.x0 >= b.x && r.x1 <= b.x + b.w && r.y0 >= b.y && r.y1 <= b.y + b.h);
    });
  /**
   * Baseline start: the default spot (above-right of `at`), else the first clean spot beside a segment, longest
   * segment first, else the same spots moved away from the line in 14 px steps. `dx`/`dy`: the away direction.
   */
  type Spot = P & { end?: boolean; dx: number; dy: number };
  const spot = (pts: P[], at: P, s: string): Spot => {
    const w = textWidth(s, 12, true),
      rect = (q: P): Rect => ({ x0: q.x, y0: q.y - 11, x1: q.x + w, y1: q.y + 3 });
    const segs = pts
      .slice(1)
      .map((b, i) => [pts[i]!, b] as const)
      .sort(([a, b], [c, d]) => Math.hypot(d.x - c.x, d.y - c.y) - Math.hypot(b.x - a.x, b.y - a.y));
    const options: Spot[] = [
      { x: at.x + 6, y: at.y - 6, dx: 0, dy: -1 },
      ...segs.flatMap(([a, b]) =>
        STEPS.flatMap((t) => {
          const m = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
          return Math.abs(a.y - b.y) < 0.5
            ? [
                { x: m.x - w / 2, y: m.y - 6, dx: 0, dy: -1 },
                { x: m.x - w / 2, y: m.y + 16, dx: 0, dy: 1 },
              ]
            : // left of a vertical: drawn end-anchored, so a font narrower than the estimate still hugs the line
              [
                { x: m.x + 6, y: m.y + 4, dx: 1, dy: 0 },
                { x: m.x - 6 - w, y: m.y + 4, end: true, dx: -1, dy: 0 },
              ];
        }),
      ),
    ];
    const q =
      options.find((q) => clean(rect(q))) ??
      Array.from({ length: 10 }, (_, k) =>
        options.map((o) => ({ ...o, x: o.x + o.dx * 14 * (k + 1), y: o.y + o.dy * 14 * (k + 1) })),
      )
        .flat()
        .find((q) => clean(rect(q))) ??
      options[0]!;
    taken.push(rect(q));
    return q;
  };
  const label = (pts: P[], at: P, s: string, colour: string) => {
    const q = spot(pts, at, s);
    labels.push(
      q.end
        ? text(q.x + textWidth(s, 12, true), q.y, s, `class="t" text-anchor="end" fill="${colour}" ${halo}`)
        : text(q.x, q.y, s, `class="t" fill="${colour}" ${halo}`),
    );
  };
  for (const pl of placed.links) {
    const l = link.get(pl.id);
    if (!l || pl.points.length < 2) continue;
    const trunk = l.lanes.length > TRUNK_AT || !!l.trunk;
    const ids = trunk && !l.trunk ? model.vlans.filter((v) => l.lanes.includes(v.name)) : [];
    const vlanText = l.trunk
      ? l.trunk
      : trunk
        ? `VLAN ${idList(ids.flatMap((v) => (v.ids === "untagged" ? [] : v.ids)))}${ids.some((v) => v.ids === "untagged") ? " + untagged" : ""}`
        : "";
    const s = [l.label, vlanText].filter(Boolean).join(" · ");
    const colour = trunk
      ? "#333"
      : l.lanes[0] && l.lanes[0] !== "wire"
        ? (lanes.get(l.lanes[0])?.stroke ?? "#333")
        : "#333";
    if (s) label(pl.points, pl.labelAt ?? mid(pl.points), s, colour);
  }
  for (const pa of placed.arrows) {
    const a = arrow.get(pa.id);
    if (a?.label && pa.points.length >= 2)
      label(pa.points, pa.labelAt ?? mid(pa.points), a.label, a.kind === "route" ? ROUTE : ALLOW);
  }

  const nodes = drawNodes(model, placed, lanes, laneOf);
  const legend = drawLegend(model, placed, lanes, lines);
  // whole pixels, rounded up: rounding to 0.1 px could clip the layout by a fraction
  const W = Math.ceil(Math.max(placed.width, legend ? legend.w + 40 : 0)),
    H = Math.ceil(Math.max(placed.height, legend ? legend.h + 40 : 0));
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${f(W)}" height="${f(H)}" viewBox="0 0 ${f(W)} ${f(H)}" font-family="${FONT}" font-size="14" fill="#222">`,
    "<defs>",
    `<marker id="ap" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="2.75" markerHeight="2.75" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${ROUTE}"/></marker>`,
    `<marker id="ab" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="${ALLOW}"/></marker>`,
    "<style>.h{font-weight:700;font-size:15px}.s{font-size:12.5px;fill:#444}.t{font-size:12px;font-weight:600}</style>",
    "</defs>",
    `<rect width="${f(W)}" height="${f(H)}" fill="#fff"/>`,
    text(40, 46, model.title, 'font-size="26" font-weight="700"'),
    ...(model.subtitle ? [text(40, 72, model.subtitle, 'class="s" font-size="14"')] : []),
    ...nodes.shapes,
    ...paths,
    ...bridges,
    ...nodes.texts,
    ...labels,
    ...(legend ? [legend.svg] : []),
    "</svg>",
    "",
  ].join("\n");
}
