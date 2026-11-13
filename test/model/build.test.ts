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
  const m = synth(WAN + "/interface bridge add name=br1\n/interface bridge port add bridge=br1 interface=ether1\n/interface list member add interface=br1 list=WAN\n", "imports rsc x.rsc as x\n");
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
