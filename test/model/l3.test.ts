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

test("other devices: lte gets no arrows", () => {
  expect(mine(loadModel(HOME), "lte")).toEqual([]);
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

