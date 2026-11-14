import { expect, test } from "bun:test";
import { parseDsl } from "../../src/dsl/parse";
import { buildModel, loadModel } from "../../src/load";
import { collapseSiblings } from "../../src/model/collapse";
import { type Slice, sliceModel } from "../../src/model/slice";
import type { MNode, Model } from "../../src/types";

const HOME = loadModel("examples/home/network.net");
const ok = (m: Model, s: Slice): Model => {
  const r = sliceModel(m, s);
  if ("error" in r) throw new Error(r.error);
  return r.model;
};
const kept = (m: Model) => m.nodes.filter((n) => n.style !== "stub").map((n) => n.id);
const stubs = (m: Model) => m.nodes.filter((n) => n.style === "stub").map((n) => n.id);
const ids = (ns: MNode[]): string[] => ns.flatMap((n) => [n.id, ...ids(n.children)]);
const top = (id: string) => id.split("/")[0]!;

/** No arrow, hint or link names anything the sliced model lacks. */
function consistent(m: Model) {
  const all = new Set(ids(m.nodes)),
    real = new Set(kept(m));
  for (const l of m.links) {
    expect(all.has(l.from)).toBe(true);
    expect(all.has(l.to)).toBe(true);
  }
  for (const a of m.arrows) {
    expect(real.has(top(a.from))).toBe(true);
    expect(real.has(top(a.to))).toBe(true);
  }
}

test("--around core keeps core and its neighbours; the next ring are stubs", () => {
  const m = ok(HOME, { around: "core" });
  expect(kept(m).sort()).toEqual(["ap1", "ap2", "core", "isp", "media", "printer", "switch", "tv"]);
  expect(stubs(m).sort()).toEqual(["hub", "internet", "lte", "pi2"]);
  const lte = m.nodes.find((n) => n.id === "lte")!;
  expect(lte).toMatchObject({ kind: "device", style: "stub", label: "lte", children: [] });
  expect(m.links.find((l) => l.label === "tagged 60")).toMatchObject({ from: "lte", to: "ap2/ether2" });
  expect(m.nodes.some((n) => n.id === "mobile")).toBe(false);
  consistent(m);
});

test("a child id means its device; --depth 0 keeps only it", () => {
  expect(ok(HOME, { around: "core/ether2" })).toEqual(ok(HOME, { around: "core" }));
  const m = ok(HOME, { around: "core", depth: 0 });
  expect(kept(m)).toEqual(["core"]);
  expect(stubs(m).sort()).toEqual(["ap1", "ap2", "isp", "media", "printer", "switch", "tv"]);
  consistent(m);
});

test("--vlan by name or id: kept links carry only that VLAN", () => {
  const m = ok(HOME, { vlans: ["guest"] });
  expect(ok(HOME, { vlans: ["50"] })).toEqual(m);
  expect(kept(m).sort()).toEqual(["ap1", "ap2", "core"]);
  expect(m.nodes.find((n) => n.id === "core")!.children).toEqual(HOME.nodes.find((n) => n.id === "core")!.children);
  expect([...new Set(m.links.flatMap((l) => l.lanes))].sort()).toEqual(["guest", "wire"]);
  expect(m.links.find((l) => l.from === "core/ether4" && l.to === "ap2/ether1")!.lanes).toEqual(["guest"]);
  consistent(m);
});

test("flags intersect", () => {
  expect(kept(ok(HOME, { vlans: ["lte"], around: "core", depth: 0 }))).toEqual(["core"]);
  expect(sliceModel(HOME, { vlans: ["lte"], around: "switch", depth: 0 })).toEqual({ error: "the slice is empty" });
});

test("unknown names and an unused VLAN are errors", () => {
  expect(sliceModel(HOME, { vlans: ["gust"] })).toEqual({ error: 'unknown vlan "gust"', hint: "did you mean guest?" });
  expect(sliceModel(HOME, { around: "cor" })).toEqual({ error: 'unknown device "cor"', hint: "did you mean core?" });
  const m = buildModel(parseDsl("title T\nvlan iot 70\ndevice a\ndevice b\nlink a -- b\n", "t.net").stmts, new Map());
  expect(sliceModel(m, { vlans: ["iot"] })).toEqual({ error: "VLAN iot is carried by no link" });
});

test("a trunk set link that loses VLANs no longer claims the set", () => {
  const src = "title T\nvlan a 10\nvlan b 20\ntrunk both vlans a, b\ndevice x\ndevice y\nlink x -- y trunk both\n";
  const m = ok(buildModel(parseDsl(src, "t.net").stmts, new Map()), { vlans: ["a"] });
  expect(m.links[0]!.lanes).toEqual(["a"]);
  expect(m.links[0]!.trunk).toBeUndefined();
});

test("three cut-off stubs on the same parent endpoint collapse into one stub-styled node", () => {
  const src = `title T\ndevice sw\nclient far\n${["a1", "a2", "a3"].map((a) => `device ${a}\nlink sw -- ${a}\nlink ${a} -- far`).join("\n")}\n`;
  const m = collapseSiblings(ok(buildModel(parseDsl(src, "t.net").stmts, new Map()), { around: "sw", depth: 0 }));
  expect(m.nodes.map((n) => [n.id, n.style])).toEqual([
    ["sw", "box"],
    ["a1..a3", "stub"],
  ]);
});

for (const [file, around] of [
  ["test/fixtures/scale/network.net", "ex-mdf-01"],
  ["test/fixtures/netbox/network.net", "dmi01-akron-rtr01"],
] as const)
  test(`slices of ${file} are consistent`, () => {
    const m = loadModel(file);
    consistent(ok(m, { around }));
    consistent(ok(m, { vlans: [m.links.find((l) => l.lanes[0] !== "wire")!.lanes[0]!] }));
  });

test("physical view: wires only, no arrows, no trunk", () => {
  const m = ok(HOME, { view: "physical" });
  expect(m.arrows).toEqual([]);
  expect(m.links.every((l) => l.lanes.join() === "wire" && !l.trunk)).toBe(true);
  expect(m.nodes.map((n) => n.id)).toEqual(HOME.nodes.map((n) => n.id));
});

test("vlans view: no arrows, lanes unchanged", () => {
  const m = ok(HOME, { view: "vlans" });
  expect(m.arrows).toEqual([]);
  expect(m.links).toEqual(HOME.links);
});

test.each(["test/fixtures/scale/network.net", "test/fixtures/netbox/network.net"])(
  "routing view of %s keeps only router devices, plus stubs",
  (f) => {
    const m = ok(loadModel(f), { view: "routing" });
    const real = m.nodes.filter((n) => n.style !== "stub");
    expect(real.length).toBeGreaterThan(0);
    for (const n of real) expect(n.children.some((c) => c.kind === "router")).toBe(true);
    expect(m.links.length).toBeGreaterThan(0);
  },
);

test("routing view of a model with no router is empty", () => {
  expect(
    sliceModel(buildModel(parseDsl("device a\ndevice b\nlink a -- b\n", "t.net").stmts, new Map()), {
      view: "routing",
    }),
  ).toEqual({
    error: "the slice is empty",
  });
});

test("physical view of home renders no VLAN in strokes or legend", async () => {
  const { layout } = await import("../../src/layout/elk");
  const { laneStyles, renderSvg } = await import("../../src/render/svg");
  const m = ok(HOME, { view: "physical" });
  const svg = renderSvg(m, await layout(m));
  const legend = svg.slice(svg.indexOf('<g class="legend"'));
  for (const v of HOME.vlans) expect(legend).not.toMatch(new RegExp(`>${v.name}\\b`, "i"));
  const lanes = laneStyles(HOME.vlans);
  for (const v of HOME.vlans) expect(svg).not.toContain(`stroke="${lanes.get(v.name)!.stroke}"`);
});
