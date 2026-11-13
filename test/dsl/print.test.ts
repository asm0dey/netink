import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseDsl } from "../../src/dsl/parse";
import { printStmts } from "../../src/dsl/print";
import type { DevItem, Stmt } from "../../src/types";

/** Deep copy without `line` (recursively, items included) or undefined values. */
const strip = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(strip)
  : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).filter(([k, x]) => k !== "line" && x !== undefined).map(([k, x]) => [k, strip(x)]))
  : v;

const roundTrip = (s: Stmt[]) => {
  const text = printStmts(s);
  const r = parseDsl(text, "t");
  expect(r.diags).toEqual([]);
  expect(strip(r.stmts)).toEqual(strip(s));
  return text;
};

const L = 0;
const items: DevItem[] = [
  { line: L, kind: "router" },
  { line: L, kind: "wan", iface: "ether1", on: "bond1", vlan: 7, route: "isp", distance: 2, dhcp: "192.0.2.5/24", nat: true },
  { line: L, kind: "wan", iface: "wan2", dhcp: true },
  { line: L, kind: "bridge", name: "bridge main", addresses: ["192.168.0.1/24", "2001:db8::1/64"], filtering: true, lan: true, guest: true, hotspot: true, items: [
    { line: L, kind: "ports", names: ["ether2", "ether 3"], untagged: "lan", tagged: ["guest", 60], horizon: 5 },
    { line: L, kind: "vif", name: "vlan50", on: "bridge main", vlan: 50, addresses: ["10.50.0.1/24"], guest: true },
    { line: L, kind: "radio", ifaces: ["wifi1", "wifi2"], tag: 50, ssids: ["Home Net", "guest"] },
  ] },
  { line: L, kind: "ports", names: ["ether5"], tagged: [] },
  { line: L, kind: "address", iface: "lo", cidrs: ["203.0.113.1/32", "203.0.113.2/32"], lan: true, hotspot: true },
  { line: L, kind: "lease", address: "192.168.0.10", comment: "NAS \"main\"" },
  { line: L, kind: "lease", address: "192.168.0.11" },
  { line: L, kind: "allow", from: "wan2", to: "lan", label: "failover" },
  { line: L, kind: "allow", from: "a", to: "b" },
];

const all: Stmt[] = [
  { line: L, kind: "title", text: 'Home "net" \\ x' },
  { line: L, kind: "subtitle", text: "sub" },
  { line: L, kind: "import", file: "core.rsc", as: "core" },
  { line: L, kind: "import", file: "ap1.rsc", as: "ap1" },
  { line: L, kind: "vlan", name: "lan", ids: "untagged", color: "green", subnets: ["192.168.0.0/24", "2001:db8::/64"] },
  { line: L, kind: "vlan", name: "guest", ids: [50, 51], color: "#12ab34", subnets: [] },
  { line: L, kind: "vlan", name: "plain", ids: [9], subnets: [] },
  { line: L, kind: "node", type: "cloud", id: "internet", label: "Internet" },
  { line: L, kind: "node", type: "device", id: "core", label: "Core router", role: "router", note: "n", model: "CCR", os: "RouterOS 7", items },
  { line: L, kind: "node", type: "device", id: "bare" },
  { line: L, kind: "node", type: "client", id: "hub", label: "Hub", lease: "192.168.0.130", note: "fwd" },
  { line: L, kind: "link", path: [{ node: "core", port: "ether1" }, { node: "isp" }], vlans: ["lan", "guest"], label: "uplink" },
  { line: L, kind: "link", path: [{ node: "a" }, { node: "b" }] },
  { line: L, kind: "note", target: "core.ether1", text: "CAKE shaping" },
  { line: L, kind: "hint", hint: { type: "near", a: "lte", b: "isp" } },
  { line: L, kind: "hint", hint: { type: "row", ids: ["ap1", "ap2", "ap3"] } },
  { line: L, kind: "hint", hint: { type: "side", device: "core", group: "ports", side: "left" } },
  { line: L, kind: "legend", op: "auto" },
  { line: L, kind: "legend", op: "off" },
  { line: L, kind: "legend", op: "add", style: "lan", arg: "Wired" },
  { line: L, kind: "legend", op: "remove", arg: "guest" },
  { line: L, kind: "legend", op: "note", arg: "a note" },
  { line: L, kind: "legend", op: "position", arg: "right" },
  { line: L, kind: "style", key: "jumps", value: "gap" },
  { line: L, kind: "route", from: "a", to: "b", label: "default" },
  { line: L, kind: "allow", from: "a", to: "b" },
  { line: L, kind: "hide", target: "core.ether9" },
];

test("round-trip every statement kind", () => {
  roundTrip(all);
});

test("round-trip examples/home/network.net", () => {
  const { stmts, diags } = parseDsl(readFileSync("examples/home/network.net", "utf8"), "network.net");
  expect(diags).toEqual([]);
  roundTrip(stmts);
});

test("name with a space is quoted", () => {
  const text = printStmts([{ line: L, kind: "node", type: "device", id: "d", items: [{ line: L, kind: "bridge", name: "my br", addresses: [], items: [] }] }]);
  expect(text).toContain('bridge "my br"');
});

test("links print one per statement, imports one per line", () => {
  const text = printStmts([
    { line: L, kind: "link", path: [{ node: "a" }, { node: "b" }] },
    { line: L, kind: "link", path: [{ node: "a" }, { node: "c" }] },
    { line: L, kind: "import", file: "x.rsc", as: "x" },
    { line: L, kind: "import", file: "y.rsc", as: "y" },
  ]);
  expect(text).toBe("link a -- b\nlink a -- c\nimports rsc x.rsc as x\nimports rsc y.rsc as y\n");
});
