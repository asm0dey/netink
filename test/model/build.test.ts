import { expect, test } from "bun:test";
import { parseDsl } from "../../src/dsl/parse";
import { buildModel, loadModel } from "../../src/model/build";
import { importRsc } from "../../src/rsc/import";
import type { MNode, Model } from "../../src/types";

const HOME = "examples/home/network.net";
const all = (ns: MNode[]): MNode[] => ns.flatMap((n) => [n, ...all(n.children)]);
const node = (m: Model, id: string) => all(m.nodes).find((n) => n.id === id);
const link = (m: Model, a: string, b: string) => m.links.find((l) => (l.from === a && l.to === b) || (l.from === b && l.to === a));

test("core has wan, router, bridge, br-guest groups", () => {
  const m = loadModel(HOME);
  const core = node(m, "core")!;
  expect(core.children.map((c) => c.id)).toEqual(expect.arrayContaining(["core/wan", "core/router", "core/bridge", "core/br-guest"]));
  expect(node(m, "core/bridge")!.children.map((c) => c.id)).toContain("core/vlan50-guest");
});

test("ether3 link carries lan + guest", () => {
  const m = loadModel(HOME);
  expect(link(m, "core/ether3", "ap1/ether1")?.lanes).toEqual(["lan", "guest"]);
  expect(link(m, "core/ether4", "ap2/ether1")?.lanes).toEqual(["lan", "guest", "lte"]);
});

test("orientation", () => {
  const m = loadModel(HOME);
  expect(node(m, "core/vlan60-lte")!.tier).toBe(1);
  expect(node(m, "core/ether4")!.tier).toBe(4);
  expect(link(m, "core/vlan60-lte", "core/ether4")?.from).toBe("core/vlan60-lte");
  const tier = new Map(all(m.nodes).map((n) => [n.id, n.tier]));
  for (const l of m.links) expect(tier.get(l.from)!).toBeLessThanOrEqual(tier.get(l.to)!);
});

test("a node upstream of a WAN chip gets a tier between the clouds and the chip", () => {
  const m = loadModel(HOME);
  expect(node(m, "isp")!.tier).toBeGreaterThan(node(m, "internet")!.tier);
  expect(node(m, "isp")!.tier).toBeLessThan(node(m, "core/ether1")!.tier);
});

test("cap radios land on ap2", () => {
  const m = loadModel(HOME);
  expect(all(m.nodes).some((n) => n.id.startsWith("core/cap-"))).toBe(false);
  expect(all(node(m, "ap2")!.children).some((n) => n.kind === "radio")).toBe(true);
});

test("wire fallback", () => {
  const { stmts } = parseDsl("cloud a\ndevice b\nlink a -- b\n", "t.net");
  const m = buildModel(stmts, new Map());
  expect(m.links).toHaveLength(1);
  expect(m.links[0]!.lanes).toEqual(["wire"]);
});

test("leases opt-in", () => {
  const clients = (m: Model) => all(m.nodes).filter((n) => n.kind === "client");
  expect(clients(loadModel(HOME))).toHaveLength(5);
  expect(clients(loadModel(HOME, { all: true }))).toHaveLength(17);
});

test("deterministic", () => {
  expect(JSON.stringify(loadModel(HOME))).toBe(JSON.stringify(loadModel(HOME)));
});

test("home builds without errors; only the unmatched cap-wifi2 warns", () => {
  const m = loadModel(HOME);
  expect(m.diags.filter((d) => d.level === "error")).toEqual([]);
  expect(m.diags.map((d) => d.message)).toEqual([expect.stringContaining("cap-wifi2")]);
  expect(link(m, "mobile", "lte/lte1")?.lanes).toEqual(["wire"]);
  expect(node(m, "ap2")!.label).toBe("AP2 · hAP ac2 · RouterOS 7.25");
});

test("a plain device end carries only the untagged lane", () => {
  const m = loadModel(HOME);
  expect(link(m, "core/ether2", "switch")?.lanes).toEqual(["lan"]);
  expect(m.links.some((l) => l.from === "core/ether2" || l.to === "core/ether2" ? l.lanes.some((x) => x !== "lan") : false)).toBe(false);
  expect(link(m, "switch", "hub")?.lanes).toEqual(["wire"]);
  expect(link(m, "isp", "core/ether1")?.label).toBe("primary uplink");
  expect(link(m, "internet", "isp")?.label).toBeUndefined();
});

test("internal vif edges follow the ids both link ends carry", () => {
  const m = loadModel(HOME);
  expect(link(m, "core/vlan51-guest", "core/ether3")).toBeUndefined();
  expect(link(m, "core/vlan50-guest", "core/ether4")).toBeUndefined();
  for (const [a, b] of [["core/vlan50-guest", "core/ether3"], ["core/vlan51-guest", "core/ether4"], ["core/vlan60-lte", "core/ether4"]]) expect(link(m, a!, b!)).toBeDefined();
});

test("home node ids are unique; bridges styled by their VLAN", () => {
  const m = loadModel(HOME);
  const ids = all(m.nodes).map((n) => n.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(node(m, "ap2/br-guest")!.style).toBe("guest");
  expect(node(m, "core/br-guest")!.style).toBe("guest");
  expect(node(m, "core/bridge")!.style).toBe("lan");
});

const synth = (rsc: string, dsl: string, opts = {}) => {
  const { stmts } = parseDsl(dsl, "t.net");
  return buildModel(stmts, new Map([["x", importRsc(rsc, "x.rsc", "x")]]), opts);
};
const WAN = "/interface list add name=WAN\n";

test("a bridged WAN member is drawn only as its WAN chip", () => {
  const m = synth(WAN + "/interface bridge add name=br1\n/interface bridge port add bridge=br1 interface=ether1\n/interface list member add interface=br1 list=WAN\n", "imports rsc x.rsc as x\n", { all: true });
  expect(all(m.nodes).filter((n) => n.id === "x/br1").map((n) => n.kind)).toEqual(["port"]);
  expect(node(m, "x")!.children.map((c) => c.id)).toContain("x/ether1");
  expect(m.diags.filter((d) => d.level === "error")).toEqual([]);
});

test("a WAN radio is drawn only as its WAN chip; an unlinked WAN ether is not spare", () => {
  const m = synth(WAN + "/interface wireless set [ find default-name=wlan1 ] ssid=Up\n/interface list member add interface=wlan1 list=WAN\n/interface list member add interface=ether1 list=WAN\n", "imports rsc x.rsc as x\n");
  expect(all(m.nodes).filter((n) => n.id === "x/wlan1")).toHaveLength(1);
  expect(all(m.nodes).some((n) => n.kind === "radio")).toBe(false);
  expect(node(m, "x/ether1")!.style).toBe("box");
});

test("a repeated import alias is an error and drawn once", () => {
  const m = synth("/interface bridge add name=br1\n", "imports rsc x.rsc as x\nimports rsc y.rsc as x\n");
  expect(m.nodes.filter((n) => n.id === "x")).toHaveLength(1);
  expect(m.diags).toContainEqual(expect.objectContaining({ level: "error", line: 2 }));
});

test("--all lease ids never overwrite a declared id", () => {
  const m = synth("/ip dhcp-server lease add address=10.0.0.5 mac-address=02:00:00:00:00:01\n/ip dhcp-server lease add address=10.0.0.6 mac-address=02:00:00:00:00:02\n",
    'imports rsc x.rsc as x\nclient x-10-0-0-6 "Mine"\n', { all: true });
  const ids = all(m.nodes).map((n) => n.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(node(m, "x-10-0-0-6")!.label).toBe("Mine");
  expect(ids).toContain("x-10-0-0-6-2");
});

test("an unknown explicit vlan is an error, never a lane", () => {
  const { stmts } = parseDsl("cloud a\ndevice b\nlink a -- b vlans nope\n", "t.net");
  const m = buildModel(stmts, new Map());
  expect(m.links[0]!.lanes).toEqual(["wire"]);
  expect(m.diags).toContainEqual(expect.objectContaining({ level: "error", message: expect.stringContaining("nope") }));
});

test("lanes follow consumers reachable through transparent bridges", () => {
  const m = loadModel(HOME);
  expect(link(m, "core/ether3", "ap1/ether1")?.lanes).toEqual(["lan", "guest"]);
  expect(link(m, "core/ether4", "ap2/ether1")?.lanes).toEqual(["lan", "guest", "lte"]);
  expect(link(m, "core/ether2", "switch")?.lanes).toEqual(["lan"]);
  const t = link(m, "lte/ether1", "ap2/ether2")!;
  expect([t.lanes, t.inferred]).toEqual([["lte"], ["lte"]]);
  expect(link(m, "core/vlan50-guest", "core/ether3")).toBeDefined();
  expect(link(m, "core/vlan51-guest", "core/ether4")).toBeDefined();
  expect(link(m, "core/vlan60-lte", "core/ether4")).toBeDefined();
  expect(m.file).toBe(HOME);
});

test("a vlan-filtering bridge forwards a VLAN only between ports listed for it", () => {
  const sw = "/interface bridge add name=bridge vlan-filtering=yes\n" + [1, 2, 3].map((n) => `/interface bridge port add bridge=bridge interface=ether${n}`).join("\n")
    + "\n/interface bridge vlan add bridge=bridge tagged=ether1,ether2 vlan-ids=50\n";
  const up = "/interface bridge add name=bridge\n/interface bridge port add bridge=bridge interface=ether1\n/interface vlan add interface=bridge name=vlan50 vlan-id=50\n";
  const { stmts } = parseDsl('imports rsc s.rsc as s, a.rsc as a, b.rsc as b, c.rsc as c\nvlan lan untagged color green "10.0.0.0/24"\nvlan guest 50 color blue "10.50.0.0/24"\nlink a.ether1 -- s.ether1\nlink b.ether1 -- s.ether2\nlink c.ether1 -- s.ether3\n', "t.net");
  const m = buildModel(stmts, new Map([["s", importRsc(sw, "s.rsc", "s")], ...["a", "b", "c"].map((n) => [n, importRsc(up, `${n}.rsc`, n)] as const)]));
  expect(link(m, "a/ether1", "s/ether1")?.lanes).toEqual(["lan", "guest"]);
  expect(link(m, "c/ether1", "s/ether3")?.lanes).toEqual(["lan"]);
});

test("router-on-a-stick with vlan filtering: an access port gets no tagged lane", () => {
  const r = "/interface bridge add name=bridge vlan-filtering=yes\n/interface bridge port add bridge=bridge interface=ether1\n/interface bridge port add bridge=bridge interface=ether2\n"
    + "/interface vlan add interface=bridge name=vlan50 vlan-id=50\n/interface bridge vlan add bridge=bridge tagged=bridge,ether1 vlan-ids=50\n";
  const up = "/interface bridge add name=bridge\n/interface bridge port add bridge=bridge interface=ether1\n/interface vlan add interface=bridge name=vlan50 vlan-id=50\n";
  const { stmts } = parseDsl('imports rsc r.rsc as r, a.rsc as a, b.rsc as b\nvlan lan untagged color green "10.0.0.0/24"\nvlan guest 50 color blue "10.50.0.0/24"\nlink r.ether1 -- a.ether1\nlink r.ether2 -- b.ether1\n', "t.net");
  const m = buildModel(stmts, new Map([["r", importRsc(r, "r.rsc", "r")], ...["a", "b"].map((n) => [n, importRsc(up, `${n}.rsc`, n)] as const)]));
  expect(link(m, "r/ether1", "a/ether1")?.lanes).toEqual(["lan", "guest"]);
  expect(link(m, "r/ether2", "b/ether1")?.lanes).toEqual(["lan"]);
  expect(link(m, "r/vlan50", "r/ether1")).toBeDefined();
  expect(link(m, "r/vlan50", "r/ether2")).toBeUndefined();
});

test("router-less devices hide unlinked physical ports unless --all", () => {
  const ports = (m: Model) => all(node(m, "ap1")!.children).filter((n) => n.kind === "port").map((n) => n.id).sort();
  expect(ports(loadModel(HOME))).toEqual(["ap1/ether1"]);
  expect(ports(loadModel(HOME, { all: true }))).toEqual(["ap1/ether1", "ap1/ether2", "ap1/ether3", "ap1/ether4", "ap1/ether5"]);
  expect(node(loadModel(HOME), "core/ether5")!.style).toBe("spare");
});

test("hint references are normalised to node ids", () => {
  const m = synth("/interface bridge add name=br1\n/interface bridge port add bridge=br1 interface=ether2\n",
    "imports rsc x.rsc as x\ndevice y\nplace y near x.ether2\nrow x.ether2, y\nx.side br1 = top\n");
  expect(m.hints).toEqual([{ type: "near", a: "y", b: "x/ether2" }, { type: "row", ids: ["x/ether2", "y"] }, { type: "side", device: "x", group: "x/br1", side: "top" }]);
});

const dsl = (src: string, opts = {}) => buildModel(parseDsl(src, "t.net").stmts, new Map(), opts);

test("an allow arrow keeps its DSL direction even when it points up the tiers", () => {
  const m = dsl("cloud c\ndevice d\nlink c -- d\nallow d -> c\nroute d -> c\n");
  expect(m.arrows.find((a) => a.kind === "allow")).toMatchObject({ from: "d", to: "c" });
});

test("an absolute imports path is read as is", () => {
  const { mkdtempSync, writeFileSync, rmSync } = require("node:fs"), { tmpdir } = require("node:os"), { join, resolve } = require("node:path");
  const dir = mkdtempSync(join(tmpdir(), "netdraw-abs-"));
  try {
    writeFileSync(join(dir, "n.net"), `imports rsc ${resolve("examples/home/lte.rsc")} as lte\n`);
    const m = loadModel(join(dir, "n.net"));
    expect(m.diags.filter((d) => d.level === "error")).toEqual([]);
    expect(node(m, "lte")).toBeDefined();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a route, note or hint naming a hidden AP port is a check error that points at --all", () => {
  const facts = new Map([["ap1", importRsc(require("node:fs").readFileSync("examples/home/ap1.rsc", "utf8"), "ap1.rsc", "ap1")]]);
  const src = "imports rsc ap1.rsc as ap1\ndevice x\nlink x -- ap1.ether1\nroute x -> ap1.ether2\nnote ap1.ether2 \"n\"\nplace x near ap1.ether2\n";
  const m = buildModel(parseDsl(src, "t.net").stmts, facts);
  const hint = "unlinked ports on devices without a router are hidden; use --all";
  expect(m.diags.filter((d) => d.level === "error").map((d) => [d.line, d.hint]).sort()).toEqual([[4, hint], [5, hint], [6, hint]]);
  expect(m.arrows.some((a) => a.to === "ap1/ether2")).toBe(false);
  const shown = buildModel(parseDsl(src, "t.net").stmts, facts, { all: true });
  expect(shown.diags.filter((d) => d.level === "error")).toEqual([]);
});

test("radios on a use-tag get their own chip in that VLAN's style; the trunk's lane ends on it", () => {
  const m = loadModel(HOME);
  const radios = all(node(m, "ap1")!.children).filter((n) => n.kind === "radio");
  expect(radios.map((r) => [r.id, r.label, r.style, r.sub])).toEqual([
    ["ap1/radio-bridgeLocal", "wlan1 / wlan2", "port", ["HomeNet · HomeNet-IoT"]],
    ["ap1/radio-bridgeLocal-tag50", "wlan1-guest / wlan2-guest · use-tag 50", "guest", ["HomeNet-Guest"]],
  ]);
  expect(link(m, "ap1/ether1", "ap1/radio-bridgeLocal")?.lanes).toEqual(["lan"]);
  expect(link(m, "ap1/ether1", "ap1/radio-bridgeLocal-tag50")?.lanes).toEqual(["guest"]);
  expect(link(m, "core/ether3", "ap1/ether1")?.lanes).toEqual(["lan", "guest"]);
});
