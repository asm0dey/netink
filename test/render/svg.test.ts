import { expect, test } from "bun:test";
import { layout } from "../../src/layout/elk";
import { textWidth } from "../../src/layout/measure";
import { loadModel } from "../../src/load";
import { laneStyles, renderSvg } from "../../src/render/svg";
import type { MNode, Model, Placed } from "../../src/types";

const HOME = "examples/home/network.net";

const tiny = (label: string): [Model, Placed] => [
  {
    title: "T",
    nodes: [{ id: "a", kind: "device", style: "box", label, sub: [], children: [], tier: 0 }],
    links: [],
    arrows: [],
    vlans: [],
    trunks: [],
    legend: { mode: "auto", add: [], remove: [], notes: [], position: "bottom" },
    jumps: "arc",
    hints: [],
    diags: [],
  },
  {
    width: 300,
    height: 200,
    boxes: new Map([["a", { id: "a", x: 40, y: 110, w: 200, h: 38 }]]),
    links: [],
    arrows: [],
  },
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
  const [w, h] = svg
    .match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/)!
    .slice(1)
    .map(Number);
  expect(h).toBeGreaterThan(p.height);
  expect(w).toBeGreaterThanOrEqual(p.width);
  expect(svg).not.toMatch(/ (?:x|y|d|points|width|height)="[^"]*\d\.\d\d/); // rounded to 0.1 px
  expect(renderSvg(m, p)).toBe(svg); // deterministic

  const off = renderSvg({ ...m, legend: { ...m.legend, mode: "off" } }, p);
  expect(off).not.toContain('class="legend"');
  expect(off).not.toContain("Failover");
});

test("more than 4 lanes render as one labelled trunk", () => {
  const vlans = [10, 11, 12, 13, 40].map((id, i) => ({
    name: `v${i}`,
    ids: [id],
    color: "green",
    subnets: [] as string[],
  }));
  const [m, p] = tiny("x");
  const svg = renderSvg(
    { ...m, vlans, links: [{ id: "l", from: "a", to: "a", lanes: vlans.map((v) => v.name), line: 1 }] },
    {
      ...p,
      links: [
        {
          id: "l",
          points: [
            { x: 50, y: 160 },
            { x: 250, y: 160 },
          ],
        },
      ],
    },
  );
  expect(svg).toContain('stroke-width="8"');
  expect(svg).toContain("VLAN 10–13, 40");
});

test("legend add/remove and position right", async () => {
  const m = loadModel(HOME);
  const p = await layout(m);
  const svg = renderSvg(
    {
      ...m,
      legend: { ...m.legend, add: [{ style: "wire", text: "Mgmt cable" }], remove: ["guest"], position: "right" },
    },
    p,
  );
  const legend = svg.slice(svg.indexOf('<g class="legend"'));
  expect(legend).toContain("Mgmt cable");
  expect(legend).not.toContain("Guest");
  expect(Number(svg.match(/width="([\d.]+)"/)![1])).toBeGreaterThan(p.width);
});

/** Text box of a 12 px label whose baseline starts at (x, y). */
const labelRect = (x: number, y: number, s: string) => ({
  x0: x,
  y0: y - 11,
  x1: x + textWidth(s, 12, true),
  y1: y + 3,
});

test("home: no cable or arrow label overlaps a box or straddles a container border", async () => {
  const m = loadModel(HOME);
  const p = await layout(m);
  const svg = renderSvg(m, p);
  const all = (ns: MNode[]): MNode[] => ns.flatMap((n) => [n, ...all(n.children)]);
  const nodes = all(m.nodes);
  const labels = [
    ...svg
      .slice(0, svg.indexOf('<g class="legend"'))
      .matchAll(/<text x="([\d.]+)" y="([\d.]+)" class="t"( text-anchor="end")?[^>]*>([^<]*)</g),
  ];
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
  const [w] = svg
    .match(/<marker id="ap"[^>]*markerWidth="([\d.]+)"/)!
    .slice(1)
    .map(Number);
  expect(w! * 4).toBeGreaterThanOrEqual(10); // route stroke is 4 px; markerUnits = strokeWidth
  expect(w! * 4).toBeLessThanOrEqual(12);
});

test("group and WAN-chip colours follow the VLAN def, not its name", async () => {
  const { mkdtempSync, readFileSync, writeFileSync, rmSync } = require("node:fs"),
    { tmpdir } = require("node:os"),
    { join, resolve } = require("node:path");
  const dir = mkdtempSync(join(tmpdir(), "netink-rename-"));
  try {
    const src = readFileSync(HOME, "utf8")
      .replace(/(\w+)\.rsc as/g, (_: string, n: string) => `${resolve("examples/home", n)}.rsc as`)
      .replace(/^vlan lan /m, "vlan main ")
      .replace(/^vlan guest /m, "vlan visitors ")
      .replace(/^vlan lte /m, "vlan backup ")
      .replace("vlans lte", "vlans backup");
    writeFileSync(join(dir, "n.net"), src);
    const renamed = loadModel(join(dir, "n.net")),
      orig = loadModel(HOME);
    const style = (m: Model, id: string) => {
      const w = (ns: MNode[]): MNode[] => ns.flatMap((n) => [n, ...w(n.children)]);
      return w(m.nodes).find((n) => n.id === id)!.style;
    };
    expect(["core/bridge", "core/br-guest", "ap2/br-guest", "core/vlan60-lte"].map((id) => style(renamed, id))).toEqual(
      ["vlan:main", "vlan:visitors", "vlan:visitors", "vlan:backup"],
    );
    // the header carries the canvas height, which follows the legend's (name-dependent) row count
    const body = async (m: Model) =>
      renderSvg(m, await layout(m))
        .split('<g class="legend">')[0]!
        .split("\n")
        .filter((l) => !/^<svg |^<rect width=/.test(l))
        .join("\n");
    expect(await body(renamed)).toBe(await body(orig));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a use-tag radio chip is filled and outlined in its VLAN's colours", async () => {
  const m = loadModel(HOME);
  const p = await layout(m),
    b = p.boxes.get("ap1/radio-bridgeLocal-tag50")!;
  const f = (n: number) => String(Math.round(n * 10) / 10);
  expect(renderSvg(m, p)).toContain(
    `<rect x="${f(b.x)}" y="${f(b.y)}" width="${f(b.w)}" height="${f(b.h)}" rx="6" fill="#E3F2FD" stroke="#1565C0" stroke-width="1.5"/>`,
  );
});

/** One guest lane and one allow arrow crossing at (100, 100); `laneVertical` swaps which of them is the vertical. */
const crossing = (laneVertical: boolean): [Model, Placed] => {
  const node = (id: string): MNode => ({ id, kind: "client", style: "box", label: id, sub: [], children: [], tier: 0 });
  const H = [
      { x: 0, y: 100 },
      { x: 200, y: 100 },
    ],
    V = [
      { x: 100, y: 0 },
      { x: 100, y: 200 },
    ];
  return [
    {
      title: "T",
      nodes: ["a", "b", "c", "d"].map(node),
      links: [{ id: "l", from: "a", to: "b", lanes: ["guest"], line: 1 }],
      arrows: [{ id: "x", from: "c", to: "d", kind: "allow" }],
      vlans: [{ name: "guest", ids: [50], color: "blue", subnets: [] }],
      trunks: [],
      legend: { mode: "off", add: [], remove: [], notes: [], position: "bottom" },
      jumps: "arc",
      hints: [],
      diags: [],
    },
    {
      width: 300,
      height: 300,
      boxes: new Map(),
      links: [{ id: "l", points: laneVertical ? V : H }],
      arrows: [{ id: "x", points: laneVertical ? H : V }],
    },
  ];
};

test("every jump is drawn on top of what it crosses: a white halo, then a solid arc in the jumping line's colour", () => {
  for (const laneVertical of [false, true]) {
    const svg = renderSvg(...crossing(laneVertical));
    const w = laneVertical ? 2 : 3; // the jumping (horizontal) line: allow arrow 2 px, guest lane 3 px
    const halo = svg.indexOf(
      `<path d="M95,100 A5,5 0 0 1 105,100" fill="none" stroke="#fff" stroke-width="${w + 4}"/>`,
    );
    const arc = svg.indexOf(`<path d="M95,100 A5,5 0 0 1 105,100" fill="none" stroke="#1565C0" stroke-width="${w}"/>`);
    const lastLine = Math.max(svg.indexOf('stroke-dasharray="2 4"'), svg.indexOf('stroke-dasharray="7 5"'));
    expect(halo).toBeGreaterThan(lastLine);
    expect(arc).toBeGreaterThan(halo);
  }
});

test("a vlan:wan group is stroked in the VLAN colour, not the WAN red", async () => {
  const m: Model = {
    title: "T",
    nodes: [
      {
        id: "g",
        kind: "group",
        style: "vlan:wan",
        label: "g",
        sub: [],
        children: [{ id: "c", kind: "port", style: "port", label: "c", sub: [], children: [], tier: 1 }],
        tier: 0,
      },
    ],
    links: [],
    arrows: [],
    vlans: [{ name: "wan", ids: [70], color: "cyan", subnets: [] }],
    trunks: [],
    legend: { mode: "off", add: [], remove: [], notes: [], position: "bottom" },
    jumps: "arc",
    hints: [],
    diags: [],
  };
  const svg = renderSvg(m, await layout(m));
  expect(svg).toContain("#0097A7");
  expect(svg).not.toContain("#C62828");
});

test("legend says NAT only when some router does NAT", async () => {
  const { parseDsl } = await import("../../src/dsl/parse");
  const { buildModel } = await import("../../src/load");
  const legendOf = async (src: string) => {
    const m = buildModel(parseDsl(src, "t.net").stmts, new Map(), { file: "t.net" });
    const svg = renderSvg(m, await layout(m));
    return svg.slice(svg.indexOf('<g class="legend"'));
  };
  const lan = "  router\n  bridge br lan address 10.0.0.1/24\n    ports ether2\n";
  expect(await legendOf(`device d\n${lan}`)).toContain(">routed<");
  expect(await legendOf(`device d\n  wan ether1 nat\n${lan}`)).toContain(">routed / NAT<");
});

test("a two-vlan trunk set draws one trunk bar labelled with its name", () => {
  const [m, p] = tiny("");
  m.vlans = [
    { name: "a", ids: [10], color: "blue", subnets: [] },
    { name: "b", ids: [20], color: "red", subnets: [] },
  ];
  m.trunks = [{ name: "up", vlans: ["a", "b"] }];
  m.links = [{ id: "l", from: "a", to: "b", lanes: ["a", "b"], trunk: "up", line: 1 }];
  p.links = [
    {
      id: "l",
      points: [
        { x: 0, y: 0 },
        { x: 200, y: 0 },
      ],
    },
  ];
  const svg = renderSvg(m, p);
  expect(svg.match(/<path d="M[\d.,]+ L200,0"[^>]*stroke-width="8"/g)?.length).toBe(1); // one bar; a lane pair would offset the path
  expect(svg).toContain(">up</text>");
  expect(svg).not.toContain("VLAN 10");
  expect(svg).toContain("trunk: named set or more than 4 VLANs");
  expect(svg).not.toContain("trunk, more than 4 VLANs");
});

test("legend: a VLAN only a node style uses is listed; one nothing uses is not; trunk sets show their VLANs", () => {
  const [m, p] = tiny("x");
  m.nodes[0]!.style = "vlan:b";
  m.vlans = [
    { name: "a", ids: [10], color: "blue", subnets: [] },
    { name: "b", ids: [20], color: "red", subnets: [] },
    { name: "unused", ids: [30], color: "green", subnets: [] },
  ];
  m.trunks = [{ name: "up", vlans: ["a", "b"] }];
  m.links = [{ id: "l", from: "a", to: "a", lanes: ["a"], trunk: "up", line: 1 }];
  p.links = [
    {
      id: "l",
      points: [
        { x: 50, y: 170 },
        { x: 250, y: 170 },
      ],
    },
  ];
  const legend = renderSvg(m, p).split('<g class="legend">')[1]!;
  expect(legend).toContain(">A (10)<");
  expect(legend).toContain(">B (20)<");
  expect(legend).not.toContain("Unused");
  // the set entry is drawn with the trunk stroke
  expect(legend).toMatch(/stroke="#555" stroke-width="8"\/>\n<text [^>]*>up → a, b<\/text>/);
});

test("a right-hand legend taller than the diagram moves below it", () => {
  const [m, p] = tiny("x");
  m.vlans = Array.from({ length: 12 }, (_, i) => ({ name: `v${i}`, ids: [10 + i], color: "blue", subnets: [] }));
  m.links = [{ id: "l", from: "a", to: "a", lanes: m.vlans.map((v) => v.name), line: 1 }];
  m.legend.position = "right";
  p.links = [
    {
      id: "l",
      points: [
        { x: 50, y: 170 },
        { x: 250, y: 170 },
      ],
    },
  ];
  const y = Number(/<g class="legend">\n<rect x="[\d.]+" y="([\d.]+)"/.exec(renderSvg(m, p))![1]);
  expect(y).toBeGreaterThanOrEqual(p.height);
});

test("lane contrast floor: pale colours darken in hue, tints stay, dark colours are untouched", () => {
  const ratio = (c: string) => {
    const ch = [16, 8, 0]
      .map((s) => ((parseInt(c.slice(1), 16) >> s) & 255) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 1.05 / (0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]! + 0.05);
  };
  const hue = (c: string) => {
    const [r, g, b] = [16, 8, 0].map((s) => ((parseInt(c.slice(1), 16) >> s) & 255) / 255) as [number, number, number];
    const d = Math.max(r, g, b) - Math.min(r, g, b);
    const h =
      Math.max(r, g, b) === r ? ((g - b) / d + 6) % 6 : Math.max(r, g, b) === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return h * 60;
  };
  const lanes = laneStyles(
    ["#C0FF00", "#FFFF00", "#283593"].map((color, i) => ({ name: `v${i}`, ids: [i + 1], color, subnets: [] }) as never),
  );
  for (const [n, orig, tint] of [
    ["v0", "#C0FF00", "#F7FFE0"],
    ["v1", "#FFFF00", "#FFFFE0"],
  ] as const) {
    const s = lanes.get(n)!;
    expect(ratio(s.stroke)).toBeGreaterThanOrEqual(3);
    expect(Math.abs(hue(s.stroke) - hue(orig))).toBeLessThan(10);
    expect(s.tint).toBe(tint);
  }
  expect(lanes.get("v2")!.stroke).toBe("#283593");
});

test("--vlan context links: faint grey line and a 'doesn't carry' legend entry", async () => {
  const { sliceModel } = await import("../../src/model/slice");
  const r = sliceModel(loadModel(HOME), { vlans: ["guest"] });
  if ("error" in r) throw new Error(r.error);
  const svg = renderSvg(r.model, await layout(r.model));
  expect(svg).toContain(`stroke="#BDBDBD" stroke-width="1.5"`);
  expect(svg).toContain("doesn't carry Guest");
  expect(svg).not.toContain("plain cable");
});

test("a label moves off another cable's line, even when its own spot is on it", () => {
  const [m, p] = crossing(false);
  m.arrows[0]!.label = "after login";
  p.arrows[0]!.labelAt = { x: 100, y: 106 }; // default spot: baseline at y 100, on the horizontal guest lane
  const svg = renderSvg(m, p);
  const t = svg.match(/<text x="([\d.]+)" y="([\d.]+)"[^>]*>after login</)!;
  const r = labelRect(Number(t[1]), Number(t[2]), "after login");
  const onLane = r.y0 < 100 && r.y1 > 100 && r.x0 < 200 && r.x1 > 0;
  expect(onLane).toBe(false);
});

test("a label too wide to sit beside its line splits into two lines there, instead of moving away", () => {
  const node = (id: string): MNode => ({ id, kind: "client", style: "box", label: id, sub: [], children: [], tier: 0 });
  const s = "guests, after hotspot login";
  const half = textWidth("hotspot login", 12, true);
  // a vertical arrow at x 100 between two boxes: room on its right for half the label, not for all of it
  const right = 100 + 6 + half + 10;
  expect(right - 106).toBeLessThan(textWidth(s, 12, true));
  const svg = renderSvg(
    {
      title: "T",
      nodes: ["a", "b", "l", "r"].map(node),
      links: [],
      arrows: [{ id: "x", from: "a", to: "b", kind: "route", label: s }],
      vlans: [],
      trunks: [],
      legend: { mode: "off", add: [], remove: [], notes: [], position: "bottom" },
      jumps: "arc",
      hints: [],
      diags: [],
    },
    {
      width: 600,
      height: 300,
      boxes: new Map([
        ["l", { id: "l", x: 0, y: 0, w: 100 - 6 - half + 20, h: 300 }],
        ["r", { id: "r", x: right, y: 0, w: 200, h: 300 }],
      ]),
      links: [],
      arrows: [
        {
          id: "x",
          points: [
            { x: 100, y: 0 },
            { x: 100, y: 300 },
          ],
          labelAt: { x: 100, y: 150 },
        },
      ],
    },
  );
  const lines = [...svg.matchAll(/<text x="([\d.]+)" y="([\d.]+)" class="t"[^>]*>([^<]*)</g)];
  expect(lines.map((m) => m[3])).toEqual(["guests, after", "hotspot login"]);
  for (const m of lines) expect(Number(m[1])).toBeGreaterThanOrEqual(106);
});

test("a slice's dashed cut-off boxes get a legend entry; the full picture has none", async () => {
  const { sliceModel } = await import("../../src/model/slice");
  const full = loadModel(HOME);
  const r = sliceModel(full, { around: "core", depth: 0 });
  if ("error" in r) throw new Error(r.error);
  const legend = (m: Model) => async () => {
    const svg = renderSvg(m, await layout(m));
    return svg.slice(svg.indexOf('<g class="legend"'));
  };
  const sliced = await legend(r.model)();
  expect(sliced).toContain(">not in this slice<");
  expect(sliced).toContain('stroke-dasharray="4 3"');
  expect(await legend(full)()).not.toContain("not in this slice");
});
