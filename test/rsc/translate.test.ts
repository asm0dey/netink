import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseDsl } from "../../src/dsl/parse";
import { printStmts } from "../../src/dsl/print";
import { importRsc } from "../../src/rsc/import";
import { translate } from "../../src/rsc/translate";
import type { DevItem, VlanDef } from "../../src/types";

const facts = (p: string, id: string) => importRsc(readFileSync(p, "utf8"), p, id);
const vlans: VlanDef[] = parseDsl(readFileSync("examples/home/network.net", "utf8"), "network.net").stmts
  .flatMap((s) => (s.kind === "vlan" ? [{ name: s.name, ids: s.ids, color: s.color ?? "grey", subnets: s.subnets }] : []));
const home = () => translate(["core", "ap1", "ap2", "lte"].map((id, k) => ({ id, line: k + 3, f: facts(`examples/home/${id}.rsc`, id) })), vlans);
const dev = (id: string) => home().stmts.find((s) => s.id === id)!;
const items = (id: string) => dev(id).items!;
const of = <K extends DevItem["kind"]>(xs: DevItem[], k: K) => xs.filter((x): x is Extract<DevItem, { kind: K }> => x.kind === k);
const bridge = (id: string, name: string) => of(items(id), "bridge").find((b) => b.name === name)!;

test("core: wan lines", () => {
  expect(of(items("core"), "wan")).toEqual([
    { line: 3, kind: "wan", iface: "ether1", route: "wan1-main", distance: 1, dhcp: true, nat: true },
    { line: 3, kind: "wan", iface: "vlan60-lte", on: "bridge", vlan: 60, route: "wan2-lte", distance: 2, dhcp: true, nat: true },
  ]);
  expect(dev("core")).toMatchObject({ kind: "node", type: "device", id: "core", line: 3, model: "hAP ax3", os: "RouterOS 7.25.1" });
});

test("core: router, two bridges, lan and hotspot flags", () => {
  expect(items("core").map((i) => i.kind)).toEqual(["wan", "wan", "router", "bridge", "bridge", "lease", "lease", "lease", "lease", "lease", "lease", "lease", "lease", "lease", "lease", "lease", "allow"]);
  expect(bridge("core", "bridge")).toMatchObject({ addresses: ["192.168.0.1/24"], lan: true });
  expect(bridge("core", "br-guest")).toMatchObject({ addresses: ["10.50.0.1/24"], guest: true, hotspot: true });
  expect(bridge("core", "br-guest").lan).toBeUndefined();
});

test("core: bridge radio lists member interfaces and SSIDs", () => {
  const b = bridge("core", "bridge");
  expect(b.items.map((i) => i.kind)).toEqual(["ports", "radio"]);
  expect(of(b.items, "ports")[0]).toMatchObject({ names: ["ether2", "ether3", "ether4", "ether5"], tagged: [] });
  expect(of(b.items, "radio")).toEqual([{ line: 3, kind: "radio", ifaces: ["wifi1", "wifi2", "wifi1-iot", "wifi1-5g", "wifi2-iot"], ssids: ["HomeNet", "HomeNet-IoT", "HomeNet-5"] }]);
  const g = bridge("core", "br-guest");
  expect(g.items.map((i) => i.kind)).toEqual(["vif", "vif", "radio"]);
  expect(of(g.items, "vif")[0]).toMatchObject({ name: "vlan50-guest", on: "bridge", vlan: 50, addresses: [] });
});

test("ap1: tagged radio chip", () => {
  expect(of(bridge("ap1", "bridgeLocal").items, "radio")).toContainEqual({ line: 4, kind: "radio", tag: 50, ifaces: ["wlan1-guest", "wlan2-guest"], ssids: ["HomeNet-Guest"] });
  expect(of(items("ap1"), "router")).toEqual([]);
});

test("lte: lan flag on a non-bridge vif", () => {
  expect(of(items("lte"), "vif")).toEqual([{ line: 6, kind: "vif", name: "vlan60", on: "ether1", vlan: 60, addresses: ["192.168.88.1/24"], lan: true }]);
  expect(of(items("lte"), "wan")).toEqual([{ line: 6, kind: "wan", iface: "lte1", nat: true }]);
  expect(of(items("lte"), "ports")).toEqual([{ line: 6, kind: "ports", names: ["ether1"], tagged: [] }]);
});

test("ap2: an address on an undrawn interface", () => {
  expect(of(items("ap2"), "address")).toEqual([{ line: 5, kind: "address", iface: "wg1", cidrs: ["192.168.19.1/24"] }]);
});

test("core: forward accept becomes an allow item", () => {
  expect(of(items("core"), "allow")).toEqual([{ line: 3, kind: "allow", from: "br-guest", to: "192.168.0.200", label: "printer" }]);
});

test("unmatched CAPsMAN radio warns", () => {
  const { diags } = home();
  expect(diags).toHaveLength(1);
  expect(diags[0]).toEqual({ level: "warning", file: "examples/home/core.rsc", line: 0,
    message: "core: CAPsMAN radio cap-wifi2 matches no imported device's radio MAC (02:00:00:00:00:12, 02:00:00:00:00:13); not drawn",
    hint: "import the CAP's export so the radio lands in its box" });
  // the matched cap-wifi1 lands its SSIDs on ap2's untagged radio
  expect(of(bridge("ap2", "bridge").items, "radio")[0]!.ssids).toEqual(["HomeNet", "HomeNet-IoT"]);
});

test("raw-export translates with no new warnings", () => {
  const f = facts("test/fixtures/raw-export.rsc", "raw");
  const { stmts, diags } = translate([{ id: "raw", line: 1, f }], vlans);
  // loadModel reported [] for this fixture before the translator existed
  expect([...f.warnings, ...diags]).toEqual([]);
  expect(stmts[0]!.items).toEqual([
    { line: 1, kind: "bridge", name: "bridge", addresses: [], filtering: true, items: [] },
    { line: 1, kind: "ports", names: ["ether4"], untagged: 10, tagged: [] },
    { line: 1, kind: "vif", name: "ether1.10", on: "ether1", vlan: 10, addresses: [] },
  ]);
});

test("bridge VLAN-table rows become tagged ids on their port", () => {
  const f = facts("test/fixtures/raw-export.rsc", "raw");
  f.ifaces.push({ name: "ether2", type: "ether", bridge: "bridge" }, { name: "ether3", type: "ether", bridge: "bridge" },
    { name: "ether2.10", type: "vlan", parent: "ether2", vlanId: 10 }, { name: "ether2.20", type: "vlan", parent: "ether2", vlanId: 20 },
    { name: "ether3.10", type: "vlan", parent: "ether3", vlanId: 10 });
  const b = of(translate([{ id: "raw", line: 1, f }], vlans).stmts[0]!.items!, "bridge")[0]!;
  expect(b.items).toEqual([
    { line: 1, kind: "ports", names: ["ether2"], tagged: [10, 20] },
    { line: 1, kind: "ports", names: ["ether3"], tagged: [10] },
  ]);
});

test("core translation prints as a parseable block", () => {
  const { stmts } = home();
  expect(parseDsl(printStmts(stmts), "t").diags).toEqual([]);
});
