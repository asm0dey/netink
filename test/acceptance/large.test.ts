import { expect, test } from "bun:test";
import { layout } from "../../src/layout/elk";
import { loadModel } from "../../src/load";
import { collapseSiblings } from "../../src/model/collapse";
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
