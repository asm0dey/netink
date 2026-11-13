import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "netdraw-cli-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const run = (...a: string[]) => {
  const r = Bun.spawnSync(["bun", "src/cli.ts", ...a]);
  return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
};
const HOME = "examples/home/network.net";
const bad = join(dir, "bad.net");
writeFileSync(bad, "device a\ndevice b\nlink a.x -- b\n");

test("check home ok", () => {
  const r = run("check", "--file", HOME, "--json");
  expect(r.code).toBe(0);
  expect(JSON.parse(r.out).ok).toBe(true);
});
test("check bad dsl", () => {
  const r = run("check", "--file", bad, "--json");
  expect(r.code).toBe(1);
  const j = JSON.parse(r.out);
  expect(j.ok).toBe(false);
  expect(j.diags[0].line).toBe(3);
  expect(run("check", "--file", bad).err).toContain("bad.net:3: error:");
});
test("render -o writes svg", () => {
  const o = join(dir, "o.svg");
  const r = run("render", "--file", HOME, "-o", o, "--json");
  expect(r.code).toBe(0);
  expect(readFileSync(o, "utf8").startsWith("<svg")).toBe(true);
  const j = JSON.parse(r.out);
  expect(j.output).toBe(o);
  expect(j.width).toBeGreaterThan(0);
});
test("render to stdout", () => {
  const r = run("render", "--file", HOME);
  expect(r.code).toBe(0);
  expect(r.out.startsWith("<svg")).toBe(true);
});
test("render refuses on errors", () => {
  const r = run("render", "--file", bad, "--json");
  expect(r.code).toBe(1);
  expect(JSON.parse(r.out).ok).toBe(false);
});
test("show", () => {
  const links = JSON.parse(run("show", "links", "--file", HOME, "--json").out);
  expect(links.some((l: { from: string }) => l.from === "core/ether3")).toBe(true);
  expect(JSON.parse(run("show", "core", "--file", HOME, "--json").out).id).toBe("core");
  expect(run("show", "core", "--file", HOME).out).toContain("core/ether3");
  expect(JSON.parse(run("show", "vlans", "--file", HOME, "--json").out).length).toBeGreaterThan(0);
  expect(run("show", "nope", "--file", HOME, "--json").code).toBe(1);
});
test("usage errors exit 2", () => {
  const r = run("bogus", "--json");
  expect(r.code).toBe(2);
  expect(JSON.parse(r.out).hint).toBe("run netdraw --help");
  expect(run("check", "--bogus").code).toBe(2);
  expect(run("check", "--file").code).toBe(2);
});
test("missing file", () => {
  const r = run("check", "--file", join(dir, "none.net"), "--json");
  expect(r.code).toBe(1);
  expect(JSON.parse(r.out)).toMatchObject({ error: `cannot read ${join(dir, "none.net")}`, line: 0, hint: "pass --file or create ./network.net" });
});
test("help", () => {
  const r = run("--help");
  expect(r.code).toBe(0);
  expect(r.out).toContain("link <ep> (-- <ep>)+");
  expect(run("render", "--help").code).toBe(0);
});
