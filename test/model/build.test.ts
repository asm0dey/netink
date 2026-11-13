import { expect, test } from "bun:test";
import { parseDsl } from "../../src/dsl/parse";
import { buildModel, loadModel } from "../../src/load";
import { importRsc } from "../../src/rsc/import";
import type { MNode, Model } from "../../src/types";

const HOME = "examples/home/network.net";
const all = (ns: MNode[]): MNode[] => ns.flatMap((n) => [n, ...all(n.children)]);
const node = (m: Model, id: string) => all(m.nodes).find((n) => n.id === id);
const link = (m: Model, a: string, b: string) =>
  m.links.find((l) => (l.from === a && l.to === b) || (l.from === b && l.to === a));

test("core has wan, router, bridge, br-guest groups", () => {
  const m = loadModel(HOME);
  const core = node(m, "core")!;
  expect(core.children.map((c) => c.id)).toEqual(
    expect.arrayContaining(["core/wan", "core/router", "core/bridge", "core/br-guest"]),
  );
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
  expect(
    m.links.some((l) =>
      l.from === "core/ether2" || l.to === "core/ether2" ? l.lanes.some((x) => x !== "lan") : false,
    ),
  ).toBe(false);
  expect(link(m, "switch", "hub")?.lanes).toEqual(["wire"]);
  expect(link(m, "isp", "core/ether1")?.label).toBe("primary uplink");
  expect(link(m, "internet", "isp")?.label).toBeUndefined();
});

test("internal vlan-iface edges follow the ids both link ends carry", () => {
  const m = loadModel(HOME);
  expect(link(m, "core/vlan51-guest", "core/ether3")).toBeUndefined();
  expect(link(m, "core/vlan50-guest", "core/ether4")).toBeUndefined();
  for (const [a, b] of [
    ["core/vlan50-guest", "core/ether3"],
    ["core/vlan51-guest", "core/ether4"],
    ["core/vlan60-lte", "core/ether4"],
  ])
    expect(link(m, a!, b!)).toBeDefined();
});

test("home node ids are unique; bridges styled by their VLAN", () => {
  const m = loadModel(HOME);
  const ids = all(m.nodes).map((n) => n.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(node(m, "ap2/br-guest")!.style).toBe("vlan:guest");
  expect(node(m, "core/br-guest")!.style).toBe("vlan:guest");
  expect(node(m, "core/bridge")!.style).toBe("vlan:lan");
});

const synth = (rsc: string, dsl: string, opts = {}) => {
  const { stmts } = parseDsl(dsl, "t.net");
  return buildModel(stmts, new Map([["x", importRsc(rsc, "x.rsc", "x")]]), opts);
};
const WAN = "/interface list add name=WAN\n";

test("a bridged WAN member is drawn only as its WAN chip", () => {
  const m = synth(
    WAN +
      "/interface bridge add name=br1\n/interface bridge port add bridge=br1 interface=ether1\n/interface list member add interface=br1 list=WAN\n",
    "imports rsc x.rsc as x\n",
    { all: true },
  );
  expect(
    all(m.nodes)
      .filter((n) => n.id === "x/br1")
      .map((n) => n.kind),
  ).toEqual(["port"]);
  expect(node(m, "x")!.children.map((c) => c.id)).toContain("x/ether1");
  expect(m.diags.filter((d) => d.level === "error")).toEqual([]);
});

test("a WAN radio is drawn only as its WAN chip; an unlinked WAN ether is not spare", () => {
  const m = synth(
    WAN +
      "/interface wireless set [ find default-name=wlan1 ] ssid=Up\n/interface list member add interface=wlan1 list=WAN\n/interface list member add interface=ether1 list=WAN\n",
    "imports rsc x.rsc as x\n",
  );
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
  const m = synth(
    "/ip dhcp-server lease add address=10.0.0.5 mac-address=02:00:00:00:00:01\n/ip dhcp-server lease add address=10.0.0.6 mac-address=02:00:00:00:00:02\n",
    'imports rsc x.rsc as x\nclient x-10-0-0-6 "Mine"\n',
    { all: true },
  );
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
  const sw =
    "/interface bridge add name=bridge vlan-filtering=yes\n" +
    [1, 2, 3].map((n) => `/interface bridge port add bridge=bridge interface=ether${n}`).join("\n") +
    "\n/interface bridge vlan add bridge=bridge tagged=ether1,ether2 vlan-ids=50\n";
  const up =
    "/interface bridge add name=bridge\n/interface bridge port add bridge=bridge interface=ether1\n/interface vlan add interface=bridge name=vlan50 vlan-id=50\n";
  const { stmts } = parseDsl(
    'imports rsc s.rsc as s, a.rsc as a, b.rsc as b, c.rsc as c\nvlan lan untagged color green "10.0.0.0/24"\nvlan guest 50 color blue "10.50.0.0/24"\nlink a.ether1 -- s.ether1\nlink b.ether1 -- s.ether2\nlink c.ether1 -- s.ether3\n',
    "t.net",
  );
  const m = buildModel(
    stmts,
    new Map([
      ["s", importRsc(sw, "s.rsc", "s")],
      ...["a", "b", "c"].map((n) => [n, importRsc(up, `${n}.rsc`, n)] as const),
    ]),
  );
  expect(link(m, "a/ether1", "s/ether1")?.lanes).toEqual(["lan", "guest"]);
  expect(link(m, "c/ether1", "s/ether3")?.lanes).toEqual(["lan"]);
});

test("router-on-a-stick with vlan filtering: an access port gets no tagged lane", () => {
  const r =
    "/interface bridge add name=bridge vlan-filtering=yes\n/interface bridge port add bridge=bridge interface=ether1\n/interface bridge port add bridge=bridge interface=ether2\n" +
    "/interface vlan add interface=bridge name=vlan50 vlan-id=50\n/interface bridge vlan add bridge=bridge tagged=bridge,ether1 vlan-ids=50\n";
  const up =
    "/interface bridge add name=bridge\n/interface bridge port add bridge=bridge interface=ether1\n/interface vlan add interface=bridge name=vlan50 vlan-id=50\n";
  const { stmts } = parseDsl(
    'imports rsc r.rsc as r, a.rsc as a, b.rsc as b\nvlan lan untagged color green "10.0.0.0/24"\nvlan guest 50 color blue "10.50.0.0/24"\nlink r.ether1 -- a.ether1\nlink r.ether2 -- b.ether1\n',
    "t.net",
  );
  const m = buildModel(
    stmts,
    new Map([["r", importRsc(r, "r.rsc", "r")], ...["a", "b"].map((n) => [n, importRsc(up, `${n}.rsc`, n)] as const)]),
  );
  expect(link(m, "r/ether1", "a/ether1")?.lanes).toEqual(["lan", "guest"]);
  expect(link(m, "r/ether2", "b/ether1")?.lanes).toEqual(["lan"]);
  expect(link(m, "r/vlan50", "r/ether1")).toBeDefined();
  expect(link(m, "r/vlan50", "r/ether2")).toBeUndefined();
});

test("router-less devices hide unlinked physical ports unless --all", () => {
  const ports = (m: Model) =>
    all(node(m, "ap1")!.children)
      .filter((n) => n.kind === "port")
      .map((n) => n.id)
      .sort();
  expect(ports(loadModel(HOME))).toEqual(["ap1/ether1"]);
  expect(ports(loadModel(HOME, { all: true }))).toEqual([
    "ap1/ether1",
    "ap1/ether2",
    "ap1/ether3",
    "ap1/ether4",
    "ap1/ether5",
  ]);
  expect(node(loadModel(HOME), "core/ether5")!.style).toBe("spare");
});

test("hint references are normalised to node ids", () => {
  const m = synth(
    "/interface bridge add name=br1\n/interface bridge port add bridge=br1 interface=ether2\n",
    "imports rsc x.rsc as x\ndevice y\nplace y near x.ether2\nrow x.ether2, y\nx.side br1 = top\n",
  );
  expect(m.hints).toEqual([
    { type: "near", a: "y", b: "x/ether2" },
    { type: "row", ids: ["x/ether2", "y"] },
    { type: "side", device: "x", group: "x/br1", side: "top" },
  ]);
});

const dsl = (src: string, opts = {}) => buildModel(parseDsl(src, "t.net").stmts, new Map(), opts);

test("an allow arrow keeps its DSL direction even when it points up the tiers", () => {
  const m = dsl("cloud c\ndevice d\nlink c -- d\nallow d -> c\nroute d -> c\n");
  expect(m.arrows.find((a) => a.kind === "allow")).toMatchObject({ from: "d", to: "c" });
});

test("an absolute imports path is read as is", () => {
  const { mkdtempSync, writeFileSync, rmSync } = require("node:fs"),
    { tmpdir } = require("node:os"),
    { join, resolve } = require("node:path");
  const dir = mkdtempSync(join(tmpdir(), "netdraw-abs-"));
  try {
    writeFileSync(join(dir, "n.net"), `imports rsc ${resolve("examples/home/lte.rsc")} as lte\n`);
    const m = loadModel(join(dir, "n.net"));
    expect(m.diags.filter((d) => d.level === "error")).toEqual([]);
    expect(node(m, "lte")).toBeDefined();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a route, note or hint naming a hidden AP port is a check error that points at --all", () => {
  const facts = new Map([
    ["ap1", importRsc(require("node:fs").readFileSync("examples/home/ap1.rsc", "utf8"), "ap1.rsc", "ap1")],
  ]);
  const src =
    'imports rsc ap1.rsc as ap1\ndevice x\nlink x -- ap1.ether1\nroute x -> ap1.ether2\nnote ap1.ether2 "n"\nplace x near ap1.ether2\n';
  const m = buildModel(parseDsl(src, "t.net").stmts, facts);
  const hint = "unlinked ports on devices without a router are hidden; use --all";
  expect(
    m.diags
      .filter((d) => d.level === "error")
      .map((d) => [d.line, d.hint])
      .sort(),
  ).toEqual([
    [4, hint],
    [5, hint],
    [6, hint],
  ]);
  expect(m.arrows.some((a) => a.to === "ap1/ether2")).toBe(false);
  const shown = buildModel(parseDsl(src, "t.net").stmts, facts, { all: true });
  expect(shown.diags.filter((d) => d.level === "error")).toEqual([]);
});

test("radios on a use-tag get their own chip in that VLAN's style; the trunk's lane ends on it", () => {
  const m = loadModel(HOME);
  const radios = all(node(m, "ap1")!.children).filter((n) => n.kind === "radio");
  expect(radios.map((r) => [r.id, r.label, r.style, r.sub])).toEqual([
    ["ap1/radio-bridgeLocal", "wlan1 / wlan2", "port", ["HomeNet · HomeNet-IoT"]],
    ["ap1/radio-bridgeLocal-tag50", "wlan1-guest / wlan2-guest · use-tag 50", "vlan:guest", ["HomeNet-Guest"]],
  ]);
  expect(link(m, "ap1/ether1", "ap1/radio-bridgeLocal")?.lanes).toEqual(["lan"]);
  expect(link(m, "ap1/ether1", "ap1/radio-bridgeLocal-tag50")?.lanes).toEqual(["guest"]);
  expect(link(m, "core/ether3", "ap1/ether1")?.lanes).toEqual(["lan", "guest"]);
});

test.each(["wan", "dev", "spare"])("a bridge on a VLAN named %s gets style vlan:%s", (name) => {
  const rsc =
    "/interface bridge add name=bridge\n/interface bridge add name=br70\n/interface bridge port add bridge=bridge interface=ether1\n/interface vlan add interface=bridge name=vlan70 vlan-id=70\n/interface bridge port add bridge=br70 interface=vlan70\n";
  const m = synth(rsc, `imports rsc x.rsc as x\nvlan ${name} 70 color cyan "10.70.0.0/24"\n`);
  expect(node(m, "x/br70")!.style).toBe(`vlan:${name}`);
});

test("fallback styles take a same-named VLAN def's style, else stay built-in", () => {
  const rsc =
    "/ip hotspot add interface=br70\n/interface bridge add name=br70\n/interface bridge add name=bridge\n/interface bridge port add bridge=bridge interface=ether1\n";
  const wan =
    "/interface list add name=WAN\n/interface list member add list=WAN interface=vlan9\n/interface vlan add interface=ether1 name=vlan9 vlan-id=9\n";
  const style = (m: Model, id: string) => node(m, id)!.style;
  const withDefs = synth(
    rsc,
    'imports rsc x.rsc as x\nvlan guest 50 color blue "10.50.0.0/24"\nvlan lan 51 color green "10.51.0.0/24"\n',
  );
  expect(style(withDefs, "x/br70")).toBe("vlan:guest");
  expect(style(withDefs, "x/bridge")).toBe("vlan:lan");
  const none = synth(rsc, "imports rsc x.rsc as x\n");
  expect(style(none, "x/br70")).toBe("guest");
  expect(style(none, "x/bridge")).toBe("lan");
  expect(style(synth(wan, 'imports rsc x.rsc as x\nvlan lte 52 color orange "10.52.0.0/24"\n'), "x/vlan9")).toBe(
    "vlan:lte",
  );
  expect(style(synth(wan, "imports rsc x.rsc as x\n"), "x/vlan9")).toBe("lte");
});

test("hand-written AP block behaves like an imported router-less AP", () => {
  const src =
    "device sw\ndevice ap\n  bridge br\n    ports ether1, ether2\n    radio wlan1 ssid X\nlink sw -- ap.ether1\n";
  const ids = (m: Model) => all(m.nodes).map((n) => n.id);
  const m = dsl(src);
  expect(m.diags).toEqual([]);
  expect(ids(m)).not.toContain("ap/ether2");
  expect(ids(dsl(src, { all: true }))).toContain("ap/ether2");
  expect(m.links.some((l) => l.from === "ap/ether1" && l.to === "ap/radio-br")).toBe(true);
});

test("internals on an imported id is an error", () => {
  const m = synth("/interface bridge add name=br1\n", "imports rsc x.rsc as x\ndevice x\n  router\n");
  expect(m.diags).toContainEqual({
    level: "error",
    file: "",
    line: 2,
    message: '"x" is imported; its internals come from x.rsc',
    hint: "run netdraw import x.rsc to get an editable block",
  });
});

test("tagged names an unknown vlan", () => {
  const m = dsl("device sw\n  bridge br\n    ports ether1 tagged nope\n");
  expect(m.diags).toContainEqual(expect.objectContaining({ level: "error", line: 3, message: 'unknown vlan "nope"' }));
});

test("a quoted name with / or % is escaped in its id and linked by its name", () => {
  const m = dsl('device sw\n  ports "ge-0/0/0", "a%b"\ndevice x\nlink sw.ge-0/0/0 -- x\n');
  expect(m.diags).toEqual([]);
  expect(node(m, "sw/ge-0%2F0%2F0")!.label).toBe("ge-0/0/0");
  expect(node(m, "sw/a%25b")).toBeDefined();
  expect(link(m, "sw/ge-0%2F0%2F0", "x")).toBeDefined();
});

test("radio lines on one bridge and tag merge into one chip", () => {
  const m = dsl("device ap\n  bridge br\n    radio wlan1 ssid A\n    radio wlan2 ssid B\n");
  expect(m.diags).toEqual([]);
  expect(
    all(m.nodes)
      .filter((n) => n.kind === "radio")
      .map((n) => [n.id, n.label, n.sub]),
  ).toEqual([["ap/radio-br", "wlan1 / wlan2", ["A · B"]]]);
});

const dslModel = (src: string) => buildModel(parseDsl(src, "t.net").stmts, new Map(), { file: "t.net" });
test("second address becomes a sub-line", () => {
  const m = dslModel("device d\n  bridge br address 192.168.0.1/24, 2001:db8::1/64\n    ports ether1\n");
  expect(node(m, "d/br")).toMatchObject({ label: "br · 192.168.0.1/24", sub: ["2001:db8::1/64"] });
});
test("IPv6-only bridge and vlan", () => {
  const m = dslModel(
    'vlan g 50 subnet 2001:db8:50::/64\ndevice d model "X"\n  bridge br lan address 2001:db8:50::1/64\n    vlan-iface v50 vlan 50 address 2001:db8:50::2/64\n',
  );
  expect(node(m, "d/br")!.label).toBe("br · 2001:db8:50::1/64");
  expect(node(m, "d")!.label).toBe("D · X");
  expect(m.diags).toEqual([]);
});
test("a name declared twice in a block is an error at its second line", () => {
  const m = dslModel("device d\n  ports ether1\n  vlan-iface ether1 vlan 5\n");
  expect(m.diags).toEqual([
    {
      level: "error",
      file: "t.net",
      line: 3,
      message: 'd declares "ether1" twice',
      hint: "first declared on line 2; give each interface one name",
    },
  ]);
});
test("a bridge label takes its first IPv4 address", () => {
  const m = dslModel("device d\n  bridge br address 2001:db8::1/64, 192.168.0.1/24\n    ports ether1\n");
  expect(node(m, "d/br")).toMatchObject({ label: "br · 192.168.0.1/24", sub: ["2001:db8::1/64"] });
});
test("diagnostics do not assume internals come from imports", () => {
  const m = dslModel("client c lease 10.0.0.9\ndevice x\nlink x.p -- nowhere\ndevice y\n  lease 10.0.0.1\n");
  expect(m.diags).toEqual([
    { level: "warning", file: "t.net", line: 1, message: "no device has a lease for 10.0.0.9" },
    {
      level: "error",
      file: "t.net",
      line: 3,
      message: '"x" has no device block, so it has no port "p"',
      hint: 'add a block under "device x" listing p, or link x without a port',
    },
    {
      level: "error",
      file: "t.net",
      line: 3,
      message: 'unknown node "nowhere"',
      hint: "declare it with cloud, device or client",
    },
  ]);
});
test("router label names NAT only when a wan line has nat", () => {
  expect(node(dslModel("device d\n  router\n  bridge br\n    ports ether2\n"), "d/router")!.label).toBe(
    "routing · firewall",
  );
  expect(node(dslModel("device d\n  wan ether1 nat\n  router\n"), "d/router")!.label).toBe("routing · NAT · firewall");
});
test("address lines show on their port and vlan-iface chips, except the one already in the device label", () => {
  const m = dslModel(
    "device d\n  wan ether1\n  ports eth0\n  vlan-iface v9 on eth0 vlan 9\n  vlan-iface v8 on eth0 vlan 8 address 10.8.0.1/24 lan\n  address eth0 10.0.0.1/30, 2001:db8::1/64\n  address v9 10.9.0.1/24\n  address ether1 203.0.113.2/30\n",
  );
  expect(node(m, "d/eth0")!.sub).toEqual(["10.0.0.1/30", "2001:db8::1/64"]);
  expect(node(m, "d/v9")!.sub).toEqual(["10.9.0.1/24"]);
  expect(node(m, "d/v8")!.sub).toEqual([]);
  expect(node(m, "d/ether1")!.sub).toEqual(["203.0.113.2/30"]);
});
test("a client lease needs no device lease line when no device lists leases", () => {
  const m = dslModel(
    'device r\n  bridge br address 10.0.0.1/24 lan\n    ports ether2\nclient nas "NAS" lease 10.0.0.50\nlink r.ether2 -- nas\n',
  );
  expect(m.diags).toEqual([]);
  expect(node(m, "nas")).toMatchObject({ label: "NAS", sub: ["10.0.0.50"] });
});

const TR = "vlan a 10\nvlan b 20\ncloud x\ncloud y\n";
const diagsOf = (src: string) => buildModel(parseDsl(src, "t.net").stmts, new Map()).diags;
test("a trunk set resolves to its vlans as the link's lanes", () => {
  const m = buildModel(parseDsl(`${TR}trunk up vlans a, b\nlink x -- y trunk up\n`, "t.net").stmts, new Map());
  expect(m.diags).toEqual([]);
  expect(m.links[0]).toMatchObject({ lanes: ["a", "b"], trunk: "up" });
  expect(m.trunks).toEqual([{ name: "up", vlans: ["a", "b"] }]);
});
test("trunk errors: unknown trunk, unknown vlan, name clash", () => {
  expect(diagsOf(`${TR}trunk up vlans a\nlink x -- y trunk upp\n`)).toContainEqual(
    expect.objectContaining({ level: "error", line: 6, message: 'unknown trunk "upp"', hint: "did you mean up?" }),
  );
  expect(diagsOf(`${TR}trunk up vlans a, zz\n`)).toContainEqual(
    expect.objectContaining({ level: "error", line: 5, message: 'unknown vlan "zz"' }),
  );
  expect(diagsOf(`${TR}trunk a vlans b\n`)).toContainEqual(
    expect.objectContaining({ level: "error", line: 5, message: 'trunk "a" clashes with vlan "a"' }),
  );
});
