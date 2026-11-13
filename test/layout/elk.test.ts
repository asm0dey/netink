import { expect, test } from "bun:test";
import { layout, toElkGraph } from "../../src/layout/elk";
import { textWidth } from "../../src/layout/measure";
import { loadModel } from "../../src/model/build";
import type { Box, MNode, Model, P, Placed } from "../../src/types";

const HOME = "examples/home/network.net";
const all = (ns: MNode[]): MNode[] => ns.flatMap((n) => [n, ...all(n.children)]);

/** True when the open segment a→b passes through the interior of box b (strictly inside, not along its border). */
const segmentHitsBox = (a: P, c: P, b: Box): boolean => {
  const e = 0.5;
  const [x0, x1] = [Math.min(a.x, c.x), Math.max(a.x, c.x)];
  const [y0, y1] = [Math.min(a.y, c.y), Math.max(a.y, c.y)];
  return x1 > b.x + e && x0 < b.x + b.w - e && y1 > b.y + e && y0 < b.y + b.h - e;
};

const json = (p: Placed) => JSON.stringify({ ...p, boxes: [...p.boxes.entries()].sort(([a], [b]) => a.localeCompare(b)) });

test("textWidth heuristic", () => {
  expect(textWidth("abcd", 10, false)).toBeCloseTo(22);
  expect(textWidth("abcd", 10, true)).toBeCloseTo(24);
});

test("home places WAN group above bridge", async () => {
  const p = await layout(loadModel(HOME));
  expect(p.boxes.get("core/wan")!.y).toBeLessThan(p.boxes.get("core/bridge")!.y);
});

test("one placed entry per link and arrow, every node boxed", async () => {
  const m = loadModel(HOME);
  const p = await layout(m);
  expect(p.links.map((l) => l.id).sort()).toEqual(m.links.map((l) => l.id).sort());
  expect(p.arrows.map((a) => a.id).sort()).toEqual(m.arrows.map((a) => a.id).sort());
  for (const l of [...p.links, ...p.arrows]) expect(l.points.length).toBeGreaterThanOrEqual(2);
  for (const n of all(m.nodes)) expect(p.boxes.get(n.id)?.w).toBeGreaterThan(0);
  expect(p.links.find((l) => l.id === "isp--core/ether1")!.labelAt).toBeDefined();
});

test("no link passes through a sibling group", async () => {
  const m = loadModel(HOME);
  const p = await layout(m);
  const nodes = all(m.nodes);
  const groups = nodes.filter((n) => n.children.length > 0);
  const inside = (g: MNode, id: string) => all([g]).some((n) => n.id === id);
  const ends = new Map([...m.links, ...m.arrows].map((l) => [l.id, [l.from, l.to]] as const));
  const hits: string[] = [];
  for (const l of [...p.links, ...p.arrows]) {
    const [from, to] = ends.get(l.id)!;
    for (const g of groups) {
      if (inside(g, from) || inside(g, to)) continue;
      const box = p.boxes.get(g.id)!;
      l.points.slice(1).forEach((c, i) => {
        if (segmentHitsBox(l.points[i]!, c, box)) hits.push(`${l.id} seg ${i} ${JSON.stringify([l.points[i], c])} hits ${g.id}`);
      });
    }
  }
  expect(hits).toEqual([]);
});

test("polylines are orthogonal and start/end on their endpoint boxes", async () => {
  const m = loadModel(HOME);
  const p = await layout(m);
  const ends = new Map([...m.links, ...m.arrows].map((l) => [l.id, [l.from, l.to]] as const));
  const touches = (q: P, b: Box) => q.x >= b.x - 1 && q.x <= b.x + b.w + 1 && q.y >= b.y - 1 && q.y <= b.y + b.h + 1;
  const bad: string[] = [];
  for (const l of [...p.links, ...p.arrows]) {
    const [from, to] = ends.get(l.id)!;
    l.points.slice(1).forEach((c, i) => {
      const a = l.points[i]!;
      if (Math.abs(a.x - c.x) > 0.01 && Math.abs(a.y - c.y) > 0.01) bad.push(`${l.id} diagonal seg ${i}`);
    });
    if (!touches(l.points[0]!, p.boxes.get(from)!)) bad.push(`${l.id} start off ${from}`);
    if (!touches(l.points.at(-1)!, p.boxes.get(to)!)) bad.push(`${l.id} end off ${to}`);
  }
  expect(bad).toEqual([]);
});

test("layout lets the process exit", () => {
  const r = Bun.spawnSync(["bun", "-e", `import {layout} from "./src/layout/elk.ts"; import {loadModel} from "./src/model/build.ts"; await layout(loadModel("${HOME}"));`], { timeout: 4000 });
  expect(r.exitCode).toBe(0);
});

test("deterministic", async () => {
  const m = loadModel(HOME);
  expect(json(await layout(m))).toBe(json(await layout(m)));
});

test("lonely node", async () => {
  const group: MNode = { id: "solo/empty", kind: "group", style: "lan", label: "empty", sub: [], children: [], tier: 3 };
  const dev: MNode = { id: "solo", kind: "device", style: "device", label: "Solo", sub: [], children: [group], tier: 0 };
  const m: Model = { title: "t", nodes: [dev], links: [], arrows: [], vlans: [], hints: [], diags: [], jumps: "arc",
    legend: { mode: "auto", add: [], remove: [], notes: [], position: "bottom" } };
  const p = await layout(m);
  expect(p.boxes.get("solo")!.w).toBeGreaterThan(0);
  expect(p.boxes.get("solo/empty")!.w).toBeGreaterThan(0);
});

test("side hint reorders the device's emitted groups", () => {
  const g = (id: string): MNode => ({ id, kind: "group", style: "lan", label: id, sub: [], children: [], tier: 3 });
  const dev: MNode = { id: "d", kind: "device", style: "device", label: "D", sub: [], children: [g("d/a"), g("d/b"), g("d/c")], tier: 0 };
  const m: Model = { title: "t", nodes: [dev], links: [], arrows: [], vlans: [], diags: [], jumps: "arc",
    hints: [{ type: "side", device: "d", group: "d/c", side: "top" }, { type: "side", device: "d", group: "d/a", side: "bottom" }],
    legend: { mode: "auto", add: [], remove: [], notes: [], position: "bottom" } };
  expect(toElkGraph(m).children![0]!.children!.map((c) => c.id)).toEqual(["d/c", "d/b", "d/a"]);
});

const nearIsp = async () => {
  const p = await layout(loadModel(HOME));
  const [isp, lte] = [p.boxes.get("isp")!, p.boxes.get("lte")!];
  return { gap: lte.y - (isp.y + isp.h), dx: Math.abs(lte.x + lte.w / 2 - (isp.x + isp.w / 2)) };
};

test("place lte near isp: lte below isp and close to it horizontally", async () => {
  const { gap, dx } = await nearIsp();
  expect(gap).toBeGreaterThanOrEqual(0);
  expect(dx).toBeLessThan(400);
});

// Known gap (see the hint note in elk.ts): lte's NORTH border port costs a layer, so the gap is ~189 px.
// test.failing turns red once ELK manages one layer, so the expectation can be promoted.
test.failing("place lte near isp: lte within one layer step below isp", async () => {
  expect((await nearIsp()).gap).toBeLessThanOrEqual(60);
});

test("row ap1, ap2: same top", async () => {
  const p = await layout(loadModel(HOME));
  expect(p.boxes.get("ap1")!.y).toBe(p.boxes.get("ap2")!.y);
});

test("hint edges are laid out but never placed", async () => {
  const m = loadModel(HOME);
  const hintEdges = toElkGraph(m).edges!.filter((e) => !m.links.some((l) => l.id === e.id) && !m.arrows.some((a) => a.id === e.id) && !e.id.endsWith("#inner"));
  expect(hintEdges.length).toBeGreaterThan(0);
  const p = await layout(m);
  const placed = new Set([...p.links, ...p.arrows].map((l) => l.id));
  for (const e of hintEdges) expect(placed.has(e.id)).toBe(false);
});
