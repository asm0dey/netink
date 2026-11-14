import { expect, test } from "bun:test";
import { parseDsl } from "../../src/dsl/parse";
import type { DevItem, Stmt } from "../../src/types";

const HOME = `# network.net
title "Home network"
subtitle "VLANs, Wi-Fi and LTE failover"
imports rsc core.rsc as core, ap1.rsc as ap1,
            ap2.rsc as ap2, lte.rsc as lte

vlan lan   untagged color green  "192.168.0.0/24"
vlan guest 50,51    color blue   "10.50.0.0/24"
vlan lte   60       color orange "192.168.88.0/24"

cloud internet "Internet"
device isp "ISP box"
device switch "Cisco switch" kind switch
client hub "Hub .130" note "fwd WAN:18080"

link internet -- isp -- core.ether1  label "primary uplink"
link core.ether2 -- switch
link core.ether3 -- ap1.ether1       # VLANs inferred from rsc
link core.ether4 -- ap2.ether1
link lte.ether1  -- ap2.ether2       vlans lte  label "tagged 60"
link switch -- hub, pi2

note core.ether1 "CAKE shaping"
place lte near isp
row ap1, ap2

legend auto
legend note "Failover: when 9.9.9.9 stops answering via ether1, wan2-lte takes over."`;

test("parses the home sketch", () => {
  const { stmts, diags } = parseDsl(HOME, "network.net");
  expect(diags).toEqual([]);
  expect(stmts.filter((s) => s.kind === "link")).toHaveLength(8);
  const guest = stmts.find((s) => s.kind === "vlan" && s.name === "guest");
  expect(guest).toMatchObject({ ids: [50, 51], color: "blue", subnets: ["10.50.0.0/24"] });
  const imports = stmts.filter((s) => s.kind === "import");
  expect(imports.map((s) => s.kind === "import" && s.as)).toEqual(["core", "ap1", "ap2", "lte"]);
  expect(stmts.find((s) => s.kind === "node" && s.id === "switch")).toMatchObject({
    role: "switch",
    label: "Cisco switch",
  });
});

test("link endpoint with port", () => {
  const { stmts, diags } = parseDsl('link core.ether3 -- ap1.ether1 vlans lan,guest label "x"', "f");
  expect(diags).toEqual([]);
  expect(stmts[0]).toMatchObject({
    kind: "link",
    path: [
      { node: "core", port: "ether3" },
      { node: "ap1", port: "ether1" },
    ],
    vlans: ["lan", "guest"],
    label: "x",
  });
});

test("unknown keyword", () => {
  const { stmts, diags } = parseDsl('title "a"\n\nfrobnicate x\nsubtitle "b"', "f");
  expect(diags).toHaveLength(1);
  expect(diags[0]).toMatchObject({ level: "error", line: 3, file: "f" });
  expect(diags[0]!.hint).toContain("link");
  expect(stmts.map((s) => s.kind)).toEqual(["title", "subtitle"]);
});

test("unterminated string", () => {
  const { diags } = parseDsl('title "abc', "f");
  expect(diags).toMatchObject([{ level: "error", line: 1 }]);
});

test("side hint", () => {
  const { stmts } = parseDsl("core.side wan = top", "f");
  expect(stmts[0]).toMatchObject({ kind: "hint", hint: { type: "side", device: "core", group: "wan", side: "top" } });
});

test("chained link label goes on the last pair only", () => {
  const { stmts } = parseDsl('link a -- b -- c label "x"', "f");
  expect(stmts.map((s) => (s.kind === "link" ? s.label : "?"))).toEqual([undefined, "x"]);
});

test("vlan colours: a named theme colour or a quoted hex; anything else is an error naming the valid ones", () => {
  const vlan = (src: string) => parseDsl(src, "t.net");
  expect(vlan('vlan a 10 color "#FF0000" "10.0.0.0/24"\n').stmts[0]).toMatchObject({
    color: "#FF0000",
    subnets: ["10.0.0.0/24"],
  });
  expect(vlan('vlan a 10 color "#f00"\n').stmts[0]).toMatchObject({ color: "#ff0000" });
  expect(vlan("vlan a 10 color teal\n").stmts[0]).toMatchObject({ color: "teal" });
  const unknown = vlan("vlan a 10 color mauve\n").diags[0]!;
  expect(unknown.message).toBe('unknown color "mauve"');
  expect(unknown.hint).toContain("green, blue, orange");
  expect(vlan('vlan a 10 color "red"\n').diags[0]!.message).toBe('bad hex color "red"');
  expect(vlan("vlan a 10 color #ff0000\n").diags[0]!.hint).toContain('color "#ff0000"');
});

const CORE = `vlan lan   untagged color green  subnet 192.168.0.0/24
device core model "hAP ax3" os "RouterOS 7.16"
  wan ether1     route "wan1-main" distance 1 dhcp
  wan vlan60-lte on bridge vlan 60 route "wan2-lte" distance 2 dhcp nat
  router
  bridge bridge address 192.168.0.1/24 lan
    ports ether2, ether5
    ports ether3, ether4 tagged 50, 60
    radio wifi1, wifi2, wifi1-iot, wifi1-5g, wifi2-iot ssid HomeNet, HomeNet-IoT, HomeNet-5
  # a comment keeps the block open

  bridge br-guest address 10.50.0.1/24 guest hotspot
    vlan-iface vlan50 on bridge vlan 50
    radio wifi1-guest, wifi2-guest ssid Guest
  address vlan50 2001:db8:50::1
  lease 192.168.0.200 "Printer"
  lease 192.168.0.28 "TV"
allow core.br-guest -> 192.168.0.200 "printer"
`;
const err = (src: string) => parseDsl(src, "f").diags;

test("device block parses into items", () => {
  const { stmts, diags } = parseDsl(CORE, "f");
  expect(diags).toEqual([]);
  const dev = stmts.find((s) => s.kind === "node")!;
  if (dev.kind !== "node") throw 0;
  expect(dev).toMatchObject({ model: "hAP ax3", os: "RouterOS 7.16" });
  const items = dev.items!;
  expect(items.map((i) => i.kind)).toEqual(["wan", "wan", "router", "bridge", "bridge", "address", "lease", "lease"]);
  expect(items[1]).toMatchObject({ on: "bridge", vlan: 60, distance: 2, dhcp: true, nat: true });
  const b = items[3]!;
  if (b.kind !== "bridge") throw 0;
  expect(b).toMatchObject({ addresses: ["192.168.0.1/24"], lan: true });
  expect(b.items.map((i) => i.kind)).toEqual(["ports", "ports", "radio"]);
  expect(b.items[1]).toMatchObject({ tagged: [50, 60] });
  const r = b.items[2]!;
  if (r.kind !== "radio") throw 0;
  expect([r.ifaces.length, r.ssids.length]).toEqual([5, 3]);
  expect(stmts.at(-1)).toMatchObject({ kind: "allow" });
});

test("dhcp takes an optional address; allow is a device item", () => {
  const { stmts, diags } = parseDsl('device d\n  wan e1 dhcp 203.0.113.5/24 nat\n  allow e1 -> 192.168.0.5 "x"\n', "f");
  expect(diags).toEqual([]);
  const d = stmts[0]!;
  expect(d.kind === "node" && d.items).toMatchObject([
    { dhcp: "203.0.113.5/24", nat: true },
    { kind: "allow", from: "e1", to: "192.168.0.5", label: "x" },
  ]);
});

test("quoted port name", () => {
  const { stmts, diags } = parseDsl('device d\n  ports "ge-0/0/0", ge-0/0/1 untagged lan\n', "f");
  expect(diags).toEqual([]);
  const d = stmts[0]!;
  expect(d.kind === "node" && d.items![0]).toMatchObject({ names: ["ge-0/0/0", "ge-0/0/1"], untagged: "lan" });
});

test("vlan subnets: list and legacy string", () => {
  const a = parseDsl(
    'vlan g 50 subnet 10.50.0.0/24, 2001:db8:50::/64\nvlan l untagged "192.168.0.0/24"\nvlan n 5\n',
    "f",
  );
  expect(a.diags).toEqual([]);
  expect(a.stmts.map((s) => s.kind === "vlan" && s.subnets)).toEqual([
    ["10.50.0.0/24", "2001:db8:50::/64"],
    ["192.168.0.0/24"],
    [],
  ]);
});

test("indentation errors", () => {
  for (const src of ["device d\n\trouter\n", "device d\n   router\n"]) {
    expect(err(src)).toMatchObject([{ line: 2, hint: "indent block lines with two spaces" }]);
  }
  expect(err("cloud c\n  ports a\n")).toMatchObject([{ line: 2, message: "ports must be inside a device block" }]);
  expect(err("device d\n  wan e1\n    ports a\n")).toHaveLength(1);
  expect(err("device d\n    ports a\n")).toHaveLength(1);
  expect(err("device d\n  link a -- b\n")).toMatchObject([{ hint: "unindent it" }]);
});

test("continuation line is not a block line", () => {
  const { stmts, diags } = parseDsl("imports rsc a.rsc as a,\n            b.rsc as b\n", "f");
  expect(diags).toEqual([]);
  expect(stmts.filter((s) => s.kind === "import")).toHaveLength(2);
});

test("comment and blank lines inside a block keep the block open", () => {
  const { stmts, diags } = parseDsl("device d\n  bridge b\n\n# c\n    ports a\n  # c\n    ports b\n", "f");
  expect(diags).toEqual([]);
  const b = stmts[0]!.kind === "node" && stmts[0]!.items![0]!;
  expect(b && b.kind === "bridge" && b.items.length).toBe(2);
});

const spanOf = (t: string) => {
  const r = parseDsl(t, "x.net");
  return { ...r, sp: (o: Stmt | DevItem) => r.spans.get(o) };
};

test("spans cover continuations", () => {
  const r = spanOf("imports rsc a.rsc as a,\n  b.rsc as b\n");
  expect(r.stmts).toHaveLength(2);
  for (const s of r.stmts) expect(r.sp(s)).toEqual({ line: 1, head: 2, end: 2 });
});

test("device span covers block", () => {
  const r = spanOf("device d\n  bridge br\n    ports e1\n  # c\n  lease 10.0.0.1\nvlan x 1\n");
  const d = r.stmts[0] as Extract<Stmt, { kind: "node" }>;
  const [br, lease] = d.items!;
  expect(r.sp(d)).toEqual({ line: 1, head: 1, end: 5 });
  expect(r.sp(br!)).toEqual({ line: 2, head: 2, end: 3 });
  expect(r.sp((br as Extract<DevItem, { kind: "bridge" }>).items[0]!)).toEqual({ line: 3, head: 3, end: 3 });
  expect(r.sp(lease!)).toEqual({ line: 5, head: 5, end: 5 });
  expect(r.sp(r.stmts[1]!)).toEqual({ line: 6, head: 6, end: 6 });
});

test("trailing comment line after block is outside it", () => {
  const r = spanOf("device d\n  router\n# x\n");
  expect(r.sp(r.stmts[0]!)?.end).toBe(2);
});

test("trunk statement and link trunk option", () => {
  const { stmts, diags } = parseDsl("trunk up vlans a, b\nlink x -- y trunk up", "f");
  expect(diags).toEqual([]);
  expect(stmts[0]).toMatchObject({ kind: "trunk", name: "up", vlans: ["a", "b"] });
  expect(stmts[1]).toMatchObject({ kind: "link", trunk: "up" });
  expect((stmts[1] as { vlans?: string[] }).vlans).toBeUndefined();
});
test("a link with both vlans and trunk is refused", () => {
  const { diags } = parseDsl("link x -- y vlans a trunk up", "f");
  expect(diags[0]).toMatchObject({ level: "error", hint: "use either vlans or trunk" });
});
