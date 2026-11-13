import ELK from "elkjs/lib/elk.bundled.js";
import type { ElkExtendedEdge, ElkNode, ElkPort } from "elkjs/lib/elk-api";
import type { Box, MNode, Model, P, Placed } from "../types";
import { textWidth } from "./measure";

const LANE_GAP = 7;

const elk = new ELK();
// elk-worker sees Bun's global `self` and installs `self.onmessage` while ELK is constructed; that listener keeps Bun's event loop alive forever.
(globalThis as { onmessage?: unknown }).onmessage = null;

/*
 * ELK options. Root values are from the task brief (spike-proven). Notes on what was tried:
 * - Physical ports with an external cable become ports on the device border (FIXED_SIDE),
 *   linked to the inner chip by an internal edge, so the cable leaves the device at its edge
 *   instead of being routed from the chip through sibling groups. This alone fixed it on the
 *   home network: no cable or arrow segment crosses a group that holds neither of its ends.
 * - Only cables leaving a device use its border port. Internal links and arrows attach to the chip;
 *   routing them via the border port made them leave the device and come back.
 * - `elk.layered.mergeHierarchyEdges=false`: no change in the output, so dropped.
 * - Hints. `side` orders a device's groups in model order. `row` keeps its ids consecutive in model
 *   order; ELK ignores `elk.layered.layering.layerChoiceConstraint` (probed on leaves and compounds),
 *   and `layerConstraint` is ignored inside compounds, so "same layer" is best effort.
 *   `near` is an invisible edge b → a (thickness 0, high straightness/shortness priority) that pulls
 *   a below b and next to it horizontally. On home, lte still lands 189 px below isp, not one layer:
 *   its NORTH border port (cable from mobile) takes a layer of its own. Aiming the edge at lte's top
 *   leaf or at that border port gave 247 px (and centres 411 to 687 px apart). No edge gave 254 px
 *   and 1242 px. LONGEST_PATH, LONGEST_PATH_SOURCE, COFFMAN_GRAHAM and MIN_WIDTH layering made it
 *   worse, and STRETCH_WIDTH stalled.
 * - Same-tier ends (isp → core/ether1) kept EAST per the brief. NORTH for the downstream end
 *   straightened the WAN cable, but ELK then returned diagonal sections for the radio → client
 *   cables and the allow arrow.
 */
const ROOT_OPTIONS: Record<string, string> = {
  "elk.algorithm": "layered",
  "elk.direction": "DOWN",
  "elk.edgeRouting": "ORTHOGONAL",
  "elk.hierarchyHandling": "INCLUDE_CHILDREN",
  "elk.json.edgeCoords": "ROOT",
  "elk.json.shapeCoords": "ROOT",
  "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
  "elk.spacing.nodeNode": "40",
  "elk.layered.spacing.nodeNodeBetweenLayers": "50",
  "elk.spacing.edgeEdge": "14",
  "elk.spacing.edgeNode": "18",
  "elk.padding": "[top=110,left=40,bottom=40,right=40]",
};

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Children sorted by id, then moved per hints: `row` keeps ids consecutive, `side` orders groups (top first, bottom last). */
const ordered = (kids: MNode[], model: Model, parent?: string): MNode[] => {
  let out = [...kids].sort(byId);
  const move = (id: string, after: string) => {
    const n = out.find((k) => k.id === id);
    if (!n || !out.some((k) => k.id === after) || id === after) return;
    out = out.filter((k) => k !== n);
    out.splice(out.findIndex((k) => k.id === after) + 1, 0, n);
  };
  for (const h of model.hints) {
    if (h.type === "row") h.ids.slice(1).forEach((id, i) => move(id, h.ids[i]!));
  }
  // shortcut: side left/right is not expressed (DOWN layout has no in-device column control); add when a fixture needs it.
  const sides = new Map(model.hints.flatMap((h) => (h.type === "side" && h.device === parent ? [[h.group, h.side] as const] : [])));
  const rank = (n: MNode) => (sides.get(n.id) === "top" ? 0 : sides.get(n.id) === "bottom" ? 2 : 1);
  return out.map((n, i) => ({ n, i })).sort((a, b) => rank(a.n) - rank(b.n) || a.i - b.i).map((x) => x.n);
};

const labelWidth = (n: MNode) => Math.max(textWidth(n.label, 15, true), ...n.sub.map((s) => textWidth(s, 12.5, false)));

/** The ELK input for a model, plus what `layout` needs to read the result back. Exported for tests. */
export function toElkGraph(model: Model): ElkNode {
  return build(model).graph;
}

function build(model: Model) {
  const info = new Map<string, { node: MNode; top: MNode }>();
  const index = (n: MNode, top: MNode) => { info.set(n.id, { node: n, top }); n.children.forEach((c) => index(c, top)); };
  model.nodes.forEach((n) => index(n, n));
  const top = (id: string) => info.get(id)!.top;

  // Border ports: one per physical port that has a cable leaving its device.
  const border = new Map<string, { device: string; side: string }>();
  for (const l of model.links) {
    for (const [end, far] of [[l.from, l.to], [l.to, l.from]] as const) {
      const n = info.get(end)!.node;
      if (n.kind !== "port" || border.has(end) || top(end) === top(far)) continue;
      const [mine, theirs] = [top(end).tier, top(far).tier];
      border.set(end, { device: top(end).id, side: theirs < mine ? "NORTH" : theirs > mine ? "SOUTH" : "EAST" });
    }
  }
  const bid = (port: string) => `${port}#border`;
  const portsOf = new Map<string, ElkPort[]>();
  for (const [port, b] of [...border].sort(([a], [c]) => (a < c ? -1 : 1))) {
    portsOf.set(b.device, [...(portsOf.get(b.device) ?? []), { id: bid(port), width: 10, height: 10, layoutOptions: { "elk.port.side": b.side } }]);
  }

  const toElk = (n: MNode): ElkNode => {
    const w = labelWidth(n);
    const e: ElkNode = { id: n.id, layoutOptions: {} };
    if (n.children.length) {
      e.children = ordered(n.children, model, n.id).map(toElk);
      e.layoutOptions!["elk.padding"] = `[top=${36 + 16 * n.sub.length},left=12,bottom=12,right=12]`;
      e.layoutOptions!["elk.nodeSize.constraints"] = "MINIMUM_SIZE";
      // (height, width): with direction DOWN + INCLUDE_CHILDREN, ELK (elkjs 0.12) applies a compound's minimum transposed.
      e.layoutOptions!["elk.nodeSize.minimum"] = `(40,${w + 24})`;
    } else {
      e.width = Math.max(n.kind === "cloud" ? 150 : 70, w + 28);
      e.height = n.kind === "cloud" ? 80 : 38 + 16 * n.sub.length;
    }
    const ports = portsOf.get(n.id);
    if (ports) { e.ports = ports; e.layoutOptions!["elk.portConstraints"] = "FIXED_SIDE"; }
    return e;
  };

  const edge = (id: string, s: string, t: string, thickness: number): ElkExtendedEdge =>
    ({ id, sources: [s], targets: [t], layoutOptions: { "elk.edge.thickness": String(thickness) } });
  const inner = (port: string) => `${port}#inner`;
  /** Only a cable leaving the device uses the border port; device-internal links and arrows attach to the chip. */
  const via = (l: { from: string; to: string }, end: string) => border.has(end) && top(l.from) !== top(l.to);
  const edges: ElkExtendedEdge[] = [
    // NORTH border port: cable comes from above, so the inner edge flows border → chip; otherwise chip → border.
    ...[...border].map(([p, b]) => (b.side === "NORTH" ? edge(inner(p), bid(p), p, 4) : edge(inner(p), p, bid(p), 4))),
    ...model.links.map((l) => edge(l.id, via(l, l.from) ? bid(l.from) : l.from, via(l, l.to) ? bid(l.to) : l.to, Math.max(4, l.lanes.length * LANE_GAP))),
    ...model.arrows.map((a) => edge(a.id, a.from, a.to, 4)),
    // `place a near b`: invisible edge b → a pulls a below b and towards it (best effort, see the note above). Never placed.
    ...model.hints.flatMap((h) => (h.type === "near" && info.has(h.a) && info.has(h.b)
      ? [{ ...edge(`near:${h.b}->${h.a}`, h.b, h.a, 0), layoutOptions: { "elk.edge.thickness": "0", "elk.layered.priority.straightness": "100", "elk.layered.priority.shortness": "100" } }] : [])),
  ].sort(byId);

  const graph: ElkNode = { id: "root", layoutOptions: ROOT_OPTIONS, children: ordered(model.nodes, model).map(toElk), edges };
  return { graph, border, via, inner };
}

export async function layout(model: Model): Promise<Placed> {
  const { graph, border, via, inner } = build(model);
  const out = await elk.layout(graph);

  const boxes = new Map<string, Box>();
  const walk = (e: ElkNode) => e.children?.forEach((c) => {
    boxes.set(c.id, { id: c.id, x: c.x ?? 0, y: c.y ?? 0, w: c.width ?? 0, h: c.height ?? 0 });
    walk(c);
  });
  walk(out);

  const routes = new Map((out.edges ?? []).map((e) => [e.id, (e.sections ?? []).flatMap((s) => [s.startPoint, ...(s.bendPoints ?? []), s.endPoint])]));
  const route = (id: string) => routes.get(id)!.map(({ x, y }) => ({ x, y }));
  /** Inner chip → border port, whichever way ELK's edge ran. */
  const leg = (p: string) => (border.get(p)!.side === "NORTH" ? route(inner(p)).reverse() : route(inner(p)));

  const placed = (id: string, from: string, to: string, label: string | undefined, cable: boolean) => {
    const ends = { from, to };
    const pts = [
      ...(cable && via(ends, from) ? leg(from) : []),
      ...route(id),
      ...(cable && via(ends, to) ? leg(to).reverse() : []),
    ];
    const points = simplify(pts);
    return label === undefined ? { id, points } : { id, points, labelAt: labelPoint(points) };
  };

  return {
    width: out.width ?? 0,
    height: out.height ?? 0,
    boxes,
    links: model.links.map((l) => placed(l.id, l.from, l.to, l.label, true)),
    arrows: model.arrows.map((a) => placed(a.id, a.from, a.to, a.label, false)),
  };
}

const near = (a: P, b: P) => Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01;

/** Drops repeated points (where legs join) and middle points of straight runs. */
const simplify = (pts: P[]): P[] => {
  const out: P[] = [];
  for (const p of pts) {
    if (out.length && near(out[out.length - 1]!, p)) continue;
    const [a, b] = [out[out.length - 2], out[out.length - 1]];
    if (a && b && ((Math.abs(a.x - b.x) < 0.01 && Math.abs(b.x - p.x) < 0.01) || (Math.abs(a.y - b.y) < 0.01 && Math.abs(b.y - p.y) < 0.01))) out.pop();
    out.push(p);
  }
  return out.length >= 2 ? out : [pts[0]!, pts[pts.length - 1]!];
};

/** Midpoint of the longest segment. */
const labelPoint = (pts: P[]): P => {
  let best = 0, len = -1;
  pts.slice(1).forEach((p, i) => { const d = Math.hypot(p.x - pts[i]!.x, p.y - pts[i]!.y); if (d > len) { len = d; best = i; } });
  return { x: (pts[best]!.x + pts[best + 1]!.x) / 2, y: (pts[best]!.y + pts[best + 1]!.y) / 2 };
};
