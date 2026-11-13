import { expect, test } from "bun:test";
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
