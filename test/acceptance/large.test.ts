import { expect, test } from "bun:test";
import { layout } from "../../src/layout/elk";
import { loadModel } from "../../src/load";
import { collapseSiblings } from "../../src/model/collapse";
import { type Slice, sliceModel } from "../../src/model/slice";
import { laneOfStyle } from "../../src/model/style";
import { esc, laneStyles, renderSvg } from "../../src/render/svg";
import type { MNode, Model, Placed } from "../../src/types";
import { overlaps } from "../helpers/overlap";

const SCALE = "test/fixtures/scale/network.net";
const NETBOX = "test/fixtures/netbox/network.net";
const devices = (m: Model) => m.nodes.filter((n) => n.kind === "device");

test.each([SCALE, NETBOX])("%s loads with no errors", (f) => {
  expect(loadModel(f).diags.filter((d) => d.level === "error")).toEqual([]);
});

test.each([SCALE, NETBOX])("%s: every VLAN def and trunk set rides a link", (f) => {
  const m = loadModel(f);
  const lanes = new Set(m.links.flatMap((l) => l.lanes)),
    trunks = new Set(m.links.map((l) => l.trunk));
  expect(m.vlans.map((v) => v.name).filter((n) => !lanes.has(n))).toEqual([]);
  expect(m.trunks.map((t) => t.name).filter((n) => !trunks.has(n))).toEqual([]);
});

test("SCaLE: ≥30 devices, ≥24 VLANs, links use trunk sets", () => {
  const m = loadModel(SCALE);
  expect(devices(m).length).toBeGreaterThanOrEqual(30);
  expect(m.vlans.length).toBeGreaterThanOrEqual(24);
  expect(m.links.filter((l) => l.trunk).length).toBeGreaterThan(0);
});

test("NetBox: ≥20 linked devices, ≥24 VLANs, port-to-port links", () => {
  const m = loadModel(NETBOX);
  expect(devices(m).length).toBeGreaterThanOrEqual(20);
  expect(m.vlans.length).toBeGreaterThanOrEqual(24);
  // a dev.port endpoint resolves to a child id, parent/port
  expect(m.links.filter((l) => l.from.includes("/") && l.to.includes("/")).length).toBeGreaterThan(0);
});

const display = (name: string) =>
  name.length <= 4 ? name.toUpperCase() : name.charAt(0).toUpperCase() + name.slice(1);
const walk = (ns: MNode[]): MNode[] => ns.flatMap((n) => [n, ...walk(n.children)]);
const rendered = new Map<string, Promise<[Model, Placed, string]>>();
const render = (f: string) => {
  if (!rendered.has(f))
    rendered.set(
      f,
      (async () => {
        const m = loadModel(f),
          p = await layout(m);
        return [m, p, renderSvg(m, p)] as [Model, Placed, string];
      })(),
    );
  return rendered.get(f)!;
};

test.each([SCALE, NETBOX])("%s: full render has no overlaps", async (f) => {
  const [, p, svg] = await render(f);
  expect(overlaps(svg, p)).toEqual([]);
});

test.each([SCALE, NETBOX])("%s: collapsed render has no overlaps", async (f) => {
  const m = collapseSiblings(loadModel(f)),
    p = await layout(m);
  expect(overlaps(renderSvg(m, p), p)).toEqual([]);
});

test.each([
  [SCALE, { view: "physical" }],
  [SCALE, { view: "routing" }],
  [NETBOX, { view: "physical" }],
  [NETBOX, { view: "routing" }],
  [SCALE, { around: "ex-mdf-01" }],
  [SCALE, { vlans: ["exSpkr"] }],
  [NETBOX, { around: "dmi01-akron-rtr01", depth: 0 }],
  [NETBOX, { vlans: ["Data-dm-akron"] }],
  [SCALE, { path: ["confidf", "expoidf"] }],
  [SCALE, { address: "10.0.4.17" }],
  [NETBOX, { address: "10.112.129.0/24" }],
] as [string, Slice][])("%s: slice %o renders with no overlaps", async (f, s) => {
  const r = sliceModel(loadModel(f), s);
  if ("error" in r) throw new Error(r.error);
  const m = collapseSiblings(r.model),
    p = await layout(m);
  if (s.around || s.path) expect(m.nodes.some((n) => n.style === "stub")).toBe(true);
  expect(overlaps(renderSvg(m, p), p)).toEqual([]);
});

test.each([SCALE, NETBOX])(
  "%s: legend lists every VLAN a link or a node style uses, and every trunk set",
  async (f) => {
    const [m, , svg] = await render(f);
    const legend = svg.slice(svg.indexOf('<g class="legend"'));
    const used = new Set([
      ...m.links.flatMap((l) => l.lanes),
      ...walk(m.nodes).flatMap((n) => laneOfStyle(n.style) ?? []),
    ]);
    const vlans = m.vlans.filter((v) => used.has(v.name));
    expect(vlans.length).toBeGreaterThan(0);
    expect(vlans.map((v) => v.name).filter((n) => !legend.includes(`>${esc(display(n))} (`))).toEqual([]);
    // a long set wraps onto continuation rows: read the legend's text rows as one string
    const rows = [...legend.matchAll(/<text [^>]*class="t">(.*?)<\/text>/g)].map((r) => r[1]).join(" ");
    const sets = m.trunks.filter((t) => m.links.some((l) => l.trunk === t.name));
    expect(sets.filter((t) => !rows.includes(esc(`${t.name} → ${t.vlans.join(", ")}`)))).toEqual([]);
  },
);

test("SCaLE: every VLAN lane has its own stroke, width and dash", () => {
  const m = loadModel(SCALE);
  const lanes = laneStyles(m.vlans);
  const looks = m.vlans.map((v) => {
    const s = lanes.get(v.name)!;
    return `${s.stroke}|${s.w}|${s.dash ?? ""}`;
  });
  expect(new Set(looks).size).toBe(looks.length);
});

test("home: every view × slice renders with no overlap", async () => {
  const home = loadModel("examples/home/network.net");
  const slices: Slice[] = [
    {},
    { around: "core" },
    { vlans: ["lte"] },
    { path: ["ap1", "internet"] },
    { address: "10.50.0.0/24" },
  ];
  const bad: string[] = [];
  for (const view of ["combined", "physical", "vlans", "routing"] as const)
    for (const s of slices) {
      const r = sliceModel(home, { ...s, view });
      if ("error" in r) continue; // routing keeps only routers: some slices are empty there
      const m = collapseSiblings(r.model);
      const p = await layout(m);
      for (const o of overlaps(renderSvg(m, p), p)) bad.push(`${view} ${JSON.stringify(s)}: ${o}`);
    }
  expect(bad).toEqual([]);
}, 30_000);

test("home: lanes of different cables running side by side keep 6 px apart", async () => {
  const { lanesFor } = await import("../../src/render/geometry");
  const close: string[] = [];
  for (const view of ["combined", "vlans"] as const) {
    const r = sliceModel(loadModel("examples/home/network.net"), { view });
    if ("error" in r) throw new Error(r.error);
    const m = collapseSiblings(r.model);
    const p = await layout(m);
    const lanes = new Map(m.links.map((l) => [l.id, l]));
    // horizontal runs of every lane, tagged with the link that owns them
    const runs = p.links.flatMap((pl) =>
      lanesFor(pl.points, lanes.get(pl.id)!.lanes, !!lanes.get(pl.id)!.trunk).flatMap((ln) =>
        ln.points.slice(1).flatMap((b, i) => {
          const a = ln.points[i]!;
          return Math.abs(a.y - b.y) < 0.5 && Math.abs(a.x - b.x) > 20
            ? [{ id: pl.id, from: lanes.get(pl.id)!.from, y: a.y, x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x) }]
            : [];
        }),
      ),
    );
    for (const a of runs)
      for (const b of runs)
        if (
          a.id < b.id &&
          Math.abs(a.y - b.y) < 6 &&
          // a fan-out from one port is drawn as one shared line on purpose
          !(a.from === b.from && Math.abs(a.y - b.y) < 0.5) &&
          Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 20
        )
          close.push(`${view}: ${a.id} y${a.y} / ${b.id} y${b.y}`);
  }
  expect(close).toEqual([]);
});
