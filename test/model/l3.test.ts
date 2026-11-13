import { expect, test } from "bun:test";
import { parseDsl } from "../../src/dsl/parse";
import { buildModel, loadModel } from "../../src/model/build";
import type { Model } from "../../src/types";

const HOME = "examples/home/network.net";
const mine = (m: Model, dev: string) => m.arrows.filter((a) => a.from.startsWith(dev + "/") || a.to.startsWith(dev + "/"));

test("core: 4 route arrows + 1 allow arrow", () => {
  const m = loadModel(HOME);
  const core = mine(m, "core");
  const routes = core.filter((a) => a.kind === "route");
  expect(routes.map((a) => [a.from, a.to, a.label])).toEqual([
    ["core/ether1", "core/router", "to internet"],
    ["core/vlan60-lte", "core/router", undefined],
    ["core/router", "core/bridge", "LAN"],
    ["core/router", "core/br-guest", "guests, after hotspot login"],
  ]);
  const allows = core.filter((a) => a.kind === "allow");
  expect(allows).toEqual([{ id: "allow:core/br-guest->printer", from: "core/br-guest", to: "printer", kind: "allow", label: "printer" }]);
});

test("lte: masquerade out of WAN makes lte1 the internet route; the router reaches the addressed vlan60 chip", () => {
  const lte = mine(loadModel(HOME), "lte");
  expect(lte.map((a) => [a.kind, a.from, a.to, a.label])).toEqual([
    ["route", "lte/lte1", "lte/router", "to internet"],
    ["route", "lte/router", "lte/vlan60", "LAN"],
  ]);
});

test("router-less APs get no arrows", () => {
  const m = loadModel(HOME);
  expect([...mine(m, "ap1"), ...mine(m, "ap2")]).toEqual([]);
});

test("DSL route/allow add arrows; hide removes by arrow id or node id", () => {
  const src = (extra: string) => `${parseSrc}\n${extra}\n`;
  const parseSrc = "cloud a\ndevice b\nclient c\nlink a -- b\nlink b -- c";
  const build = (extra: string) => { const { stmts } = parseDsl(src(extra), "t.net"); return buildModel(stmts, new Map(), { file: "t.net" }); };
  const m = build('route a -> b "x"\nallow b -> c');
  expect(m.arrows).toEqual([
    { id: "route:a->b", from: "a", to: "b", kind: "route", label: "x" },
    { id: "allow:b->c", from: "b", to: "c", kind: "allow" },
  ]);
  expect(build('route a -> b\nhide route:a->b').arrows).toEqual([]);
  expect(build('route a -> b\nallow b -> c\nhide b').arrows).toEqual([]);
  const bad = build("hide nope");
  expect(bad.diags.find((d) => d.level === "error")).toMatchObject({ line: 6, message: expect.stringContaining("nope") });
});


test("allow to an unleased address draws nothing", () => {
  const src = (lease: string) => `device r\n  router\n  bridge lan address 10.0.0.1/24\n  ${lease}\n  allow lan -> 10.0.0.9 "x"\nclient c lease 10.0.0.8\nallow r.lan -> 10.0.0.9\n`;
  const m = buildModel(parseDsl(src("lease 10.0.0.8"), "t.net").stmts, new Map());
  expect(m.diags).toEqual([]);
  expect(m.arrows.filter((a) => a.kind === "allow")).toEqual([]);
  const ok = buildModel(parseDsl(src("lease 10.0.0.9").replace("lease 10.0.0.8\nallow", "lease 10.0.0.9\nallow"), "t.net").stmts, new Map());
  expect(ok.arrows.filter((a) => a.kind === "allow")).toEqual([{ id: "allow:r/lan->c", from: "r/lan", to: "c", kind: "allow", label: "x" }]);
});

test("an allow line from an unknown interface is an error with a did-you-mean", () => {
  const m = buildModel(parseDsl("device r\n  router\n  bridge lan address 10.0.0.1/24\n  lease 10.0.0.9\n  allow lna -> 10.0.0.9\nclient c lease 10.0.0.9\n", "t.net").stmts, new Map());
  expect(m.diags).toEqual([{ level: "error", file: "", line: 5, message: 'r has no interface "lna"', hint: "did you mean lan?" }]);
  expect(m.arrows.filter((a) => a.kind === "allow")).toEqual([]);
});

test("an allow line to a client id draws the arrow", () => {
  const m = buildModel(parseDsl('device r\n  router\n  bridge lan address 10.0.0.1/24\n  lease 10.0.0.9\n  allow lan -> c "x"\nclient c lease 10.0.0.9\n', "t.net").stmts, new Map());
  expect(m.diags).toEqual([]);
  expect(m.arrows.filter((a) => a.kind === "allow")).toEqual([{ id: "allow:r/lan->c", from: "r/lan", to: "c", kind: "allow", label: "x" }]);
});

test("an allow line to an unknown id is an error at its line with a did-you-mean", () => {
  const m = buildModel(parseDsl('device r\n  router\n  bridge lan address 10.0.0.1/24\n  lease 10.0.0.9\n  allow lan -> cc "x"\nclient c lease 10.0.0.9\n', "t.net").stmts, new Map());
  expect(m.diags).toEqual([{ level: "error", file: "", line: 5, message: 'allow to unknown client "cc"', hint: "did you mean c?" }]);
  expect(m.arrows.filter((a) => a.kind === "allow")).toEqual([]);
});
