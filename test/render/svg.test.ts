import { expect, test } from "bun:test";
import { layout } from "../../src/layout/elk";
import { loadModel } from "../../src/model/build";
import { renderSvg } from "../../src/render/svg";
import type { Model, Placed } from "../../src/types";

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
