import { expect, test } from "bun:test";
import { parseDsl } from "../../src/dsl/parse";

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
  expect(stmts.filter((s) => s.kind === "link").length).toBe(8);
  const guest = stmts.find((s) => s.kind === "vlan" && s.name === "guest");
  expect(guest).toMatchObject({ ids: [50, 51], color: "blue", subnet: "10.50.0.0/24" });
  const imports = stmts.filter((s) => s.kind === "import");
  expect(imports.map((s) => s.kind === "import" && s.as)).toEqual(["core", "ap1", "ap2", "lte"]);
  expect(stmts.find((s) => s.kind === "node" && s.id === "switch")).toMatchObject({ role: "switch", label: "Cisco switch" });
});

test("link endpoint with port", () => {
  const { stmts, diags } = parseDsl('link core.ether3 -- ap1.ether1 vlans lan,guest label "x"', "f");
  expect(diags).toEqual([]);
  expect(stmts[0]).toMatchObject({
    kind: "link",
    path: [{ node: "core", port: "ether3" }, { node: "ap1", port: "ether1" }],
    vlans: ["lan", "guest"],
    label: "x",
  });
});

test("unknown keyword", () => {
  const { stmts, diags } = parseDsl('title "a"\n\nfrobnicate x\nsubtitle "b"', "f");
  expect(diags.length).toBe(1);
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
