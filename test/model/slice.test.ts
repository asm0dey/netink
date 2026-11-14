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
/** The model without its subtitle, which echoes the slice as typed. */
const body = ({ subtitle: _, ...m }: Model) => m;
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
  expect(body(ok(HOME, { around: "core/ether2" }))).toEqual(body(ok(HOME, { around: "core" })));
  const m = ok(HOME, { around: "core", depth: 0 });
  expect(kept(m)).toEqual(["core"]);
  expect(stubs(m).sort()).toEqual(["ap1", "ap2", "isp", "media", "printer", "switch", "tv"]);
  consistent(m);
});

test("--vlan by name or id: kept links carry only that VLAN", () => {
  const m = ok(HOME, { vlans: ["guest"] });
  expect(body(ok(HOME, { vlans: ["50"] }))).toEqual(body(m));
  expect(kept(m).sort()).toEqual(["ap1", "ap2", "core"]);
  expect(m.nodes.find((n) => n.id === "core")!.children).toEqual(HOME.nodes.find((n) => n.id === "core")!.children);
  expect([...new Set(m.links.flatMap((l) => l.lanes))].sort()).toEqual(["guest", "other"]);
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

test("physical view: no VLAN interface, router badge or link inside one device", () => {
  const m = ok(HOME, { view: "physical" });
  const all = (ns: MNode[]): MNode[] => ns.flatMap((n) => [n, ...all(n.children)]);
  expect(all(m.nodes).filter((n) => n.kind === "iface" || n.kind === "router")).toEqual([]);
  expect(m.links.filter((l) => top(l.from) === top(l.to))).toEqual([]);
  consistent(m);
});

test("legend notes stay in the full picture and leave every slice and view", () => {
  expect(HOME.legend.notes.length).toBeGreaterThan(0);
  expect(ok(HOME, { view: "combined" }).legend.notes).toEqual(HOME.legend.notes);
  for (const s of [{ view: "physical" }, { view: "vlans" }, { around: "core" }, { vlans: ["guest"] }] as Slice[])
    expect(ok(HOME, s).legend.notes).toEqual([]);
});

test("a slice names itself in the subtitle; the full picture keeps the file's own", () => {
  expect(ok(HOME, {}).subtitle).toBe(HOME.subtitle);
  expect(ok(HOME, { view: "physical", around: "core" }).subtitle).toStartWith("physical view · around core (depth 1)");
  expect(ok(HOME, { vlans: ["guest"], address: "10.50.0.0/24" }).subtitle).toStartWith(
    "VLAN guest · address 10.50.0.0/24",
  );
  expect(ok(HOME, { path: ["core", "isp"] }).subtitle).toStartWith("path core ↔ isp");
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
  // a cable leaving core breaks core's frame (a notch in the frame's fill), so it does not read as a second cable
  expect(svg).toMatch(/<rect x="[\d.]+" y="[\d.]+" width="[\d.]+" height="4" fill="#[0-9A-F]{6}"\/>/);
});

test("--vlan: links without the VLAN become context lanes, never wire", () => {
  const m = ok(HOME, { vlans: ["guest"] });
  expect(m.slice).toEqual({ vlans: ["guest"] });
  const was = new Map(HOME.links.map((l) => [`${l.from}>${l.to}`, l.lanes]));
  for (const l of m.links) if (l.lanes[0] === "wire") expect(was.get(`${l.from}>${l.to}`)).toEqual(["wire"]);
  expect(m.links.some((l) => l.lanes.join() === "other")).toBe(true);
});

test("--path keeps the shortest chain; every other neighbour of it is a stub", () => {
  const m = ok(HOME, { path: ["ap1", "internet"] });
  expect(kept(m).sort()).toEqual(["ap1", "core", "internet", "isp"]);
  expect(stubs(m).sort()).toEqual(["ap2", "media", "printer", "switch", "tv"]);
  consistent(m);
});

test("--path keeps every shortest path; a child id means its device", () => {
  const dia = buildModel(
    parseDsl("device a\ndevice b\ndevice c\ndevice d\nlink a -- b\nlink a -- c\nlink b -- d\nlink c -- d\n", "t.net")
      .stmts,
    new Map(),
  );
  expect(kept(ok(dia, { path: ["a", "d"] })).sort()).toEqual(["a", "b", "c", "d"]);
  expect(body(ok(HOME, { path: ["core/ether2", "internet"] }))).toEqual(body(ok(HOME, { path: ["core", "internet"] })));
});

test("--path errors: unknown id hints, disconnected devices have no path", () => {
  expect(sliceModel(HOME, { path: ["cor", "internet"] })).toEqual({
    error: 'unknown device "cor"',
    hint: "did you mean core?",
  });
  const nb = loadModel("test/fixtures/netbox/network.net");
  expect(sliceModel(nb, { path: ["dmi01-akron-rtr01", "dmi01-albany-rtr01"] })).toEqual({
    error: "no path between dmi01-akron-rtr01 and dmi01-albany-rtr01",
  });
});

test("--path with --around intersects; with --vlan keeps every path device", () => {
  expect(kept(ok(HOME, { path: ["ap1", "internet"], around: "core", depth: 0 }))).toEqual(["core"]);
  const m = ok(HOME, { path: ["ap1", "internet"], vlans: ["lte"] });
  expect(kept(m).sort()).toEqual(["ap1", "core", "internet", "isp"]);
  expect(m.links.some((l) => l.lanes.includes("other"))).toBe(true);
});

test("--address: an IP keeps the devices owning or containing it; a prefix selects its VLAN", () => {
  expect(kept(ok(HOME, { address: "192.168.0.1" }))).toContain("core");
  expect(kept(ok(HOME, { address: "192.168.0.200" }))).toContain("printer");
  const lan = ok(HOME, { address: "192.168.0.0/24" });
  expect(lan.slice).toEqual({ vlans: ["lan"] });
  // hub and pi2 lease addresses in it but sit on no lan lane
  expect(kept(lan).sort()).toEqual([...kept(ok(HOME, { vlans: ["lan"] })), "hub", "pi2"].sort());
  consistent(lan);
});

test("--address on SCaLE: IPv4 subnet owners and its VLAN; IPv6 owner", () => {
  const scale = loadModel("test/fixtures/scale/network.net");
  const m = ok(scale, { address: "10.0.4.17" });
  expect(kept(m)).toEqual(expect.arrayContaining(["br-mdf-01", "ex-mdf-01"]));
  expect(m.slice?.vlans).toContain("exMDF");
  expect(kept(ok(scale, { address: "2001:470:f026:503::9" }))).toContain("cf-mdf-01");
  consistent(m);
});

test("--address: VLANs it selects join --vlan; nothing matching is an error", () => {
  expect(ok(HOME, { address: "192.168.0.0/24", vlans: ["guest"] }).slice).toEqual({ vlans: ["guest", "lan"] });
  expect(sliceModel(HOME, { address: "203.0.113.9" })).toEqual({ error: "nothing has an address in 203.0.113.9" });
});
