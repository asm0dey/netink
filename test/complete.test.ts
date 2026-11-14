import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { complete } from "../src/complete";

const run = (env: Record<string, string>, ...a: string[]) => {
  const r = Bun.spawnSync(["bun", "src/cli.ts", ...a], { env: { ...process.env, ...env } });
  return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
};
const DSL = "examples/home/network-dsl-only.net";

test("nouns at top", () => {
  const c = complete(["v"]);
  expect(c).toContain("vlan");
  expect(c).toContain("vlan-iface");
  expect(c).not.toContain("render");
});
test("verbs and two-word nouns", () => {
  expect(complete(["vlan", ""])).toEqual(["add", "set", "rm"]);
  expect(complete(["legend", "e"])).toEqual(["entry"]);
});
test("parent paths from file", () => {
  const c = complete(["ports", "add", "--file", DSL, ""]);
  expect(c).toContain("core");
  expect(c).toContain("ap2/br-guest");
});
test("vlan names for --untagged", () => {
  expect(complete(["ports", "add", "core/bridge", "ether2", "--untagged", "", "--file", DSL])).toContain("lan");
});
test("ports of the parent", () => {
  expect(complete(["ports", "set", "core/bridge", "", "--file", DSL]).length).toBeGreaterThan(0);
});
test("flags, colours and fixed sets", () => {
  expect(complete(["vlan", "add", "x", "--c"])).toEqual(["--color"]);
  expect(complete(["vlan", "add", "x", "--color", "re"])).toContain("red");
  expect(complete(["side", "set", "core", "g", ""])).toContain("top");
});
test("bad file never throws", () => {
  expect(complete(["device", "set", "--file", "/nonexistent", ""])).toEqual([]);
});
test("zsh script", () => {
  const r = run({ SHELL: "/bin/zsh" }, "completion");
  expect(r.code).toBe(0);
  expect(r.out).toContain("compdef");
  expect(r.out).toContain("netdraw");
});
test("end to end", () => {
  const r = run({}, "--get-yargs-completions", "vlan", "set", "--file", "examples/home/network.net", "");
  expect(r.code).toBe(0);
  expect(r.out.split("\n")).toContain("guest");
  const s = run({}, "--get-yargs-completions", "netdraw", "v");
  expect(s.code).toBe(0);
  expect(s.out.split("\n")).toContain("vlan");
});

test("port names are the parent's ports, not slices of ids", () => {
  const c = complete(["ports", "set", "core/bridge", "", "--file", DSL]);
  expect(c).toContain("ether2");
  expect(c).not.toContain("ridge");
  const d = complete(["ports", "set", "core", "", "--file", DSL]);
  expect(d).toContain("ether2");
  expect(d).not.toContain("router");
  expect(d).not.toContain("bridge");
});
test("the value after --file is a path: nothing", () => {
  expect(complete(["ports", "add", "--file", ""])).toEqual([]);
  expect(complete(["ports", "add", "--file=exa"])).toEqual([]);
  expect(complete(["ports", "add", "--file", "=", "exa"])).toEqual([]);
  expect(complete(["ports", "add", "--file", "="])).toEqual([]);
});
test("bash splits --file=x at the =", () => {
  expect(complete(["ports", "add", "--file", "=", DSL, ""])).toContain("ap2/br-guest");
});
test("the verb is checked", () => {
  expect(complete(["style", "jumps", ""])).toEqual([]);
  expect(complete(["style", "add", ""])).toEqual(["jumps"]);
  expect(complete(["style", "add", "jumps", ""])).toEqual(["arc", "gap", "none"]);
  expect(complete(["vlan", "bogus", ""])).toEqual([]);
});
test("--in takes a device", () => {
  expect(complete(["allow", "add", "--in", "", "--file", DSL])).toContain("core");
  expect(complete(["allow", "add", "--i"])).toEqual(["--in"]);
});
test("trunk names for --trunk", () => {
  const f = join(mkdtempSync(join(tmpdir(), "nd-")), "t.net");
  writeFileSync(f, "vlan a 10\ncloud x\ncloud y\ntrunk up vlans a\nlink x -- y trunk up\n");
  expect(complete(["link", "set", "x", "y", "--trunk", "", "--file", f])).toEqual(["up"]);
});
test("render slice flags complete VLAN names and device ids", () => {
  expect(complete(["render", "--file", DSL, "--vlan", ""])).toEqual(["lan", "guest", "lte"]);
  const c = complete(["render", "--around", "a", "--file", DSL]);
  expect(c).toContain("ap1");
  expect(c.every((x) => x.startsWith("a"))).toBe(true);
  expect(complete(["render", "--o", "x", ""])).toEqual([]);
});

test("render --view completes the views", () => {
  expect(complete(["render", "--view", ""])).toEqual(["combined", "physical", "vlans", "routing"]);
});
