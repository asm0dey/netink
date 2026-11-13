import { expect, test } from "bun:test";
import { layout } from "../../src/layout/elk";
import { loadModel } from "../../src/model/build";
import { renderSvg } from "../../src/render/svg";
import { textWidth } from "../../src/layout/measure";
import type { MNode, Model, Placed } from "../../src/types";

const HOME = "examples/home/network.net";

const tiny = (label: string): [Model, Placed] => [
  { title: "T", nodes: [{ id: "a", kind: "device", style: "box", label, sub: [], children: [], tier: 0 }], links: [], arrows: [], vlans: [],
    legend: { mode: "auto", add: [], remove: [], notes: [], position: "bottom" }, jumps: "arc", hints: [], diags: [] },
  { width: 300, height: 200, boxes: new Map([["a", { id: "a", x: 40, y: 110, w: 200, h: 38 }]]), links: [], arrows: [] },
];

test("text is escaped (RF 3)", () => {
  const svg = renderSvg(...tiny(`A&B <ax³> "Zürich"`));
  expect(svg).toContain("A&amp;B &lt;ax³&gt; &quot;Zürich&quot;");
  expect(svg).not.toContain("<ax");
});

test("subtitle only when the model has one", () => {
  const [m, p] = tiny("x");
  expect(renderSvg(m, p)).not.toContain('y="72"');
  expect(renderSvg({ ...m, subtitle: "sub" }, p)).toContain('y="72"');
});

test("home render: LTE lanes, jumps, legend", async () => {
  const m = loadModel(HOME);
  const p = await layout(m);
  const svg = renderSvg(m, p);
  expect(svg.match(/<path [^>]*stroke-dasharray="10 4"/g)!.length).toBeGreaterThanOrEqual(3);
  expect(svg).toContain(" A5,5 ");
  const legend = svg.slice(svg.indexOf('<g class="legend"'));
  expect(legend).toContain(">LAN");
  expect(legend).toContain("Failover");
  const [w, h] = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/)!.slice(1).map(Number);
  expect(h).toBeGreaterThan(p.height);
  expect(w).toBeGreaterThanOrEqual(p.width);
  expect(svg).not.toMatch(/ (?:x|y|d|points|width|height)="[^"]*\d\.\d\d/); // rounded to 0.1 px
  expect(renderSvg(m, p)).toBe(svg); // deterministic

  const off = renderSvg({ ...m, legend: { ...m.legend, mode: "off" } }, p);
  expect(off).not.toContain('class="legend"');
  expect(off).not.toContain("Failover");
});

test("more than 4 lanes render as one labelled trunk", () => {
  const vlans = [10, 11, 12, 13, 40].map((id, i) => ({ name: `v${i}`, ids: [id], color: "green" }));
  const [m, p] = tiny("x");
  const svg = renderSvg({ ...m, vlans, links: [{ id: "l", from: "a", to: "a", lanes: vlans.map((v) => v.name), line: 1 }] },
    { ...p, links: [{ id: "l", points: [{ x: 50, y: 160 }, { x: 250, y: 160 }] }] });
  expect(svg).toContain('stroke-width="8"');
  expect(svg).toContain("VLAN 10–13, 40");
});

test("legend add/remove and position right", async () => {
  const m = loadModel(HOME);
  const p = await layout(m);
  const svg = renderSvg({ ...m, legend: { ...m.legend, add: [{ style: "wire", text: "Mgmt cable" }], remove: ["guest"], position: "right" } }, p);
  const legend = svg.slice(svg.indexOf('<g class="legend"'));
  expect(legend).toContain("Mgmt cable");
  expect(legend).not.toContain("Guest");
  expect(Number(svg.match(/width="([\d.]+)"/)![1])).toBeGreaterThan(p.width);
});

/** Text box of a 12 px label whose baseline starts at (x, y). */
const labelRect = (x: number, y: number, s: string) => ({ x0: x, y0: y - 11, x1: x + textWidth(s, 12, true), y1: y + 3 });

test("home: no cable or arrow label overlaps a box or straddles a container border", async () => {
  const m = loadModel(HOME);
  const p = await layout(m);
  const svg = renderSvg(m, p);
  const all = (ns: MNode[]): MNode[] => ns.flatMap((n) => [n, ...all(n.children)]);
  const nodes = all(m.nodes);
  const labels = [...svg.slice(0, svg.indexOf('<g class="legend"')).matchAll(/<text x="([\d.]+)" y="([\d.]+)" class="t"( text-anchor="end")?[^>]*>([^<]*)</g)];
  expect(labels.length).toBeGreaterThanOrEqual(6);
  const bad: string[] = [];
  for (const [, x, y, end, s] of labels) {
    const r = labelRect(Number(x) - (end ? textWidth(s!, 12, true) : 0), Number(y), s!);
    for (const n of nodes) {
      const b = p.boxes.get(n.id)!;
      const meets = r.x1 > b.x && r.x0 < b.x + b.w && r.y1 > b.y && r.y0 < b.y + b.h;
      const inside = r.x0 >= b.x && r.x1 <= b.x + b.w && r.y0 >= b.y && r.y1 <= b.y + b.h;
      if (meets && (n.children.length === 0 || !inside)) bad.push(`"${s}" vs ${n.id}`);
    }
  }
  expect(bad).toEqual([]);
});

test("route arrowheads are 10-12 px", () => {
  const svg = renderSvg(...tiny("x"));
  const [w] = svg.match(/<marker id="ap"[^>]*markerWidth="([\d.]+)"/)!.slice(1).map(Number);
  expect(w! * 4).toBeGreaterThanOrEqual(10); // route stroke is 4 px; markerUnits = strokeWidth
  expect(w! * 4).toBeLessThanOrEqual(12);
});

test("group and WAN-chip colours follow the VLAN def, not its name", async () => {
  const { mkdtempSync, readFileSync, writeFileSync, rmSync } = require("node:fs"), { tmpdir } = require("node:os"), { join, resolve } = require("node:path");
  const dir = mkdtempSync(join(tmpdir(), "netdraw-rename-"));
  try {
    const src = readFileSync(HOME, "utf8")
      .replace(/(\w+)\.rsc as/g, (_: string, n: string) => `${resolve("examples/home", n)}.rsc as`)
      .replace(/^vlan lan /m, "vlan main ").replace(/^vlan guest /m, "vlan visitors ").replace(/^vlan lte /m, "vlan backup ")
      .replace("vlans lte", "vlans backup");
    writeFileSync(join(dir, "n.net"), src);
    const renamed = loadModel(join(dir, "n.net")), orig = loadModel(HOME);
    const style = (m: Model, id: string) => { const w = (ns: MNode[]): MNode[] => ns.flatMap((n) => [n, ...w(n.children)]); return w(m.nodes).find((n) => n.id === id)!.style; };
    expect(["core/bridge", "core/br-guest", "ap2/br-guest", "core/vlan60-lte"].map((id) => style(renamed, id))).toEqual(["main", "visitors", "visitors", "backup"]);
    // the header carries the canvas height, which follows the legend's (name-dependent) row count
    const body = async (m: Model) => renderSvg(m, await layout(m)).split('<g class="legend">')[0]!.split("\n").filter((l) => !/^<svg |^<rect width=/.test(l)).join("\n");
    expect(await body(renamed)).toBe(await body(orig));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a use-tag radio chip is filled and outlined in its VLAN's colours", async () => {
  const m = loadModel(HOME);
  const p = await layout(m), b = p.boxes.get("ap1/radio-bridgeLocal-tag50")!;
  const f = (n: number) => String(Math.round(n * 10) / 10);
  expect(renderSvg(m, p)).toContain(`<rect x="${f(b.x)}" y="${f(b.y)}" width="${f(b.w)}" height="${f(b.h)}" rx="6" fill="#E3F2FD" stroke="#1565C0" stroke-width="1.5"/>`);
});
