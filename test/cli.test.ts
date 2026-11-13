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
test("an unexpected throw is reported in the error shape, never as a stack trace", () => {
  // inject a crash outside every command's own error handling: the check result fails to serialise
  const pre = join(dir, "throw.ts");
  writeFileSync(pre, `const s = JSON.stringify; JSON.stringify = ((v: any, ...r: any[]) => { if (v && typeof v === "object" && "diags" in v) throw new Error("injected\\nsecond line"); return s(v, ...r); }) as typeof JSON.stringify;\n`);
  const go = (...a: string[]) => { const r = Bun.spawnSync(["bun", "--preload", pre, "src/cli.ts", ...a]); return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() }; };
  const j = go("check", "--file", HOME, "--json");
  expect(j.code).toBe(1);
  expect(JSON.parse(j.out)).toMatchObject({ error: "internal error: injected", file: HOME, line: 0 });
  expect(JSON.parse(j.out).hint).toBeString();
  expect(j.err).not.toContain(" at ");
  // human mode: `show` indents its tree with String.prototype.repeat
  writeFileSync(pre, `String.prototype.repeat = function () { throw new Error("injected"); };\n`);
  const t = go("show", "core", "--file", HOME);
  expect(t.code).toBe(1);
  expect(t.err).toStartWith("error: internal error: injected");
  expect(t.err).not.toContain(" at ");
});
test("render --json reports the SVG's own size, legend included", () => {
  const j = JSON.parse(run("render", "--file", HOME, "--json").out);
  const [, w, h] = j.svg.match(/^<svg [^>]*width="([\d.]+)" height="([\d.]+)"/);
  expect([j.width, j.height]).toEqual([Number(w), Number(h)]);
});
test("help lists the named colours", () => {
  expect(run("--help").out).toMatch(/colors: green, blue, orange, .*cyan/);
});

test("import prints a parseable core block", async () => {
  const { parseDsl } = await import("./../src/dsl/parse");
  const r = run("import", "examples/home/core.rsc", "--file", HOME);
  expect(r.code).toBe(0);
  expect(r.out.startsWith('device core model "hAP ax3" os "RouterOS 7.25.1"')).toBe(true);
  expect(parseDsl(r.out, "x").diags).toEqual([]);
});
test("import without an argument is exit 2", () => {
  expect(run("import").code).toBe(2);
});
test("ejected blocks replace their imports", async () => {
  const { loadModel } = await import("../src/load");
  const { layout } = await import("./../src/layout/elk");
  const { renderSvg } = await import("./../src/render/svg");
  const blocks = ["core", "ap1", "ap2", "lte"].map((n) => run("import", `examples/home/${n}.rsc`, "--file", HOME).out).join("");
  const lines = readFileSync(HOME, "utf8").split("\n");
  const i = lines.findIndex((l) => l.startsWith("imports"));
  const ej = join(dir, "ejected.net");
  writeFileSync(ej, [...lines.slice(0, i), blocks, ...lines.slice(i + 2)].join("\n"));
  const strip = (x: unknown): unknown => JSON.parse(JSON.stringify(x, (k, v) => (k === "line" || k === "file" || k === "diags" ? undefined : v)));
  const a = loadModel(HOME), b = loadModel(ej);
  expect(strip(b)).toEqual(strip(a));
  expect(renderSvg(b, await layout(b))).toBe(renderSvg(a, await layout(a)));
});
test("import with an extra argument is exit 2", () => {
  const r = run("import", "examples/home/core.rsc", "extra", "--json");
  expect(r.code).toBe(2);
  expect(JSON.parse(r.out).error).toBe("unexpected argument extra");
});
test("import --json prints ok, stmt and the translator diags", () => {
  const j = JSON.parse(run("import", "examples/home/ap2.rsc", "--file", HOME, "--json").out);
  expect(j.ok).toBe(true);
  expect(j.stmt.id).toBe("ap2");
  expect(j.diags.map((d: { message: string }) => d.message)).toContainEqual(expect.stringContaining("CAPsMAN radio"));
});
test("import --as renames the printed block", () => {
  expect(run("import", "examples/home/core.rsc", "--as", "gw", "--file", HOME).out.startsWith("device gw ")).toBe(true);
});
test("import translates alone without the .net file or when the .rsc is not among its imports", () => {
  expect(run("import", "examples/home/core.rsc", "--file", join(dir, "none.net")).out.startsWith("device core ")).toBe(true);
  const x = join(dir, "x.rsc");
  writeFileSync(x, readFileSync("examples/home/core.rsc"));
  const r = run("import", x, "--file", HOME);
  expect(r.code).toBe(0);
  expect(r.out.startsWith("device x ")).toBe(true);
});
test("import of a missing .rsc is exit 1 with the standard error shape", () => {
  const r = run("import", join(dir, "nope.rsc"), "--file", HOME, "--json");
  expect(r.code).toBe(1);
  expect(JSON.parse(r.out)).toEqual({ error: `cannot read ${join(dir, "nope.rsc")}`, file: join(dir, "nope.rsc"), line: 0, hint: "check the path" });
});

test("unknown flag exits 2 with json error", () => {
  const r = run("check", "--frob", "--json");
  expect(r.code).toBe(2);
  expect(JSON.parse(r.out)).toMatchObject({ error: expect.any(String), hint: expect.any(String) });
});
test("--as outside import exits 2", () => {
  expect(run("check", "--as", "x", "--file", HOME).code).toBe(2);
});
test("--help prints the grammar", () => {
  const r = run("--help");
  expect(r.out).toContain("netdraw render");
  expect(r.out.toLowerCase()).toContain("ids are [a-z0-9_-]+");
});
