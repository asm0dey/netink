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

test("options only, no command, exits 2", () => {
  const r = run("--json");
  expect(r.code).toBe(2);
  expect(JSON.parse(r.out)).toMatchObject({ error: "missing command", hint: "run netdraw --help" });
  expect(run("--file", HOME).code).toBe(2);
});
test("unknown command and flag messages", () => {
  expect(JSON.parse(run("bogus", "--json").out).error).toBe("unknown command bogus");
  expect(JSON.parse(run("check", "--frob", "--json").out).error).toBe("unknown flag --frob");
  expect(JSON.parse(run("check", "--frob", "--zap", "--json").out).error).toBe("unknown flags --frob, --zap");
  expect(JSON.parse(run("render", "extra", "--json").out).error).toBe("unexpected argument extra");
});
test("import without a path says what is missing", () => {
  const r = run("import", "--json");
  expect(r.code).toBe(2);
  expect(JSON.parse(r.out).error).toBe("missing argument: <file.rsc>");
});

// ---- editing commands ----
const fresh = (name: string, text?: string) => {
  const f = join(dir, name);
  rmSync(f, { force: true });
  if (text !== undefined) writeFileSync(f, text);
  return f;
};
test("init then add", () => {
  const f = fresh("init.net");
  expect(run("init", f).code).toBe(0);
  expect(readFileSync(f, "utf8")).toBe("");
  const r = run("device", "add", "d", "--label", "D", "--file", f, "--json");
  expect(r.code).toBe(0);
  expect(JSON.parse(r.out)).toMatchObject({ ok: true, file: f, line: 1, text: 'device d "D"', diags: [] });
  expect(readFileSync(f, "utf8")).toBe('device d "D"\n');
  // human mode: the written lines on stdout
  expect(run("vlan", "add", "home", "10", "--file", f).out).toBe("vlan home 10\n");
});
test("init refuses existing", () => {
  const f = fresh("twice.net");
  expect(run("init", f).code).toBe(0);
  const r = run("init", f, "--json");
  expect(r.code).toBe(1);
  expect(JSON.parse(r.out).error).toBe(`${f} exists`);
});
test("editing a missing file is exit 1 with a hint to init", () => {
  const r = run("vlan", "add", "a", "10", "--file", join(dir, "none.net"), "--json");
  expect(r.code).toBe(1);
  expect(JSON.parse(r.out).hint).toContain("netdraw init");
});
test("edit with missing import still writes", () => {
  const f = fresh("gone.net", "imports rsc gone.rsc as g\n");
  const r = run("vlan", "add", "a", "10", "--file", f, "--json");
  expect(r.code).toBe(0);
  expect(readFileSync(f, "utf8")).toBe("imports rsc gone.rsc as g\nvlan a 10\n");
  const j = JSON.parse(r.out);
  expect(j.diags.some((d: { level: string; message: string }) => d.level === "error" && d.message.includes("gone.rsc"))).toBe(true);
  expect(run("vlan", "add", "b", "20", "--file", f).err).toContain("gone.rsc");
});
test("usage errors exit 2, file untouched", () => {
  const f = fresh("usage.net", "vlan b 20\n");
  for (const a of [["frob", "add", "x"], ["vlan", "add", "a", "10", "--colour", "red"], ["vlan", "add", "a", "10", "--near", "b"], ["vlan", "add"], ["vlan"], ["vlan", "add", "a", "10", "extra"]]) {
    const r = run(...a, "--file", f, "--json");
    expect([a, r.code]).toEqual([a, 2]);
    expect(JSON.parse(r.out).hint).toBeString();
  }
  expect(JSON.parse(run("vlan", "add", "a", "10", "--colour", "red", "--file", f, "--json").out).error).toBe("unknown flag --colour");
  expect(readFileSync(f, "utf8")).toBe("vlan b 20\n");
});
test("--no-color clears; numbers stay strings", () => {
  const f = fresh("clear.net", "vlan a 10 color red\n");
  expect(run("vlan", "set", "a", "--no-color", "--file", f).code).toBe(0);
  expect(readFileSync(f, "utf8")).toBe("vlan a 10\n");
  expect(run("vlan", "set", "a", "010,20", "--subnet", "10.0.0.0/24,10.1.0.0/24", "--file", f).code).toBe(0);
  expect(readFileSync(f, "utf8")).toBe("vlan a 10, 20 subnet 10.0.0.0/24, 10.1.0.0/24\n");
});
test("ambiguous lists candidates", () => {
  const f = fresh("amb.net", "device a\ndevice b\nlink a -- b\nlink a -- b label \"x\"\n");
  const r = run("link", "rm", "a", "b", "--file", f, "--json");
  expect(r.code).toBe(1);
  expect(JSON.parse(r.out).candidates.length).toBe(2);
  expect(run("link", "rm", "a", "b", "--file", f).err).toContain(`${f}:4: link a -- b`);
});
test("block nouns, allow --in, legend subnouns, row, import noun", () => {
  const f = fresh("block.net", "device r\n");
  expect(run("ports", "add", "r", "ether2,ether3", "--tagged", "10,20", "--file", f).code).toBe(0);
  expect(run("allow", "add", "ether1", "10.0.0.9", "--in", "r", "--file", f).code).toBe(0);
  expect(run("legend", "entry", "add", "dashed", "trunk", "--file", f).code).toBe(0);
  expect(run("legend", "set", "--mode", "off", "--file", f).code).toBe(0);
  expect(run("row", "add", "r", "x", "--file", f).code).toBe(0);
  expect(run("import", "add", "core.rsc", "--as", "core", "--file", f).code).toBe(0);
  expect(run("vlan", "add", "b", "2", "--file", f).code).toBe(0);
  expect(run("vlan", "add", "a", "1", "--before", "b", "--file", f).code).toBe(0);
  expect(readFileSync(f, "utf8")).toBe('device r\n  ports ether2, ether3 tagged 10, 20\n  allow ether1 -> 10.0.0.9\nlegend add dashed "trunk"\nlegend off\nrow r, x\nimports rsc core.rsc as core\nvlan a 1\nvlan b 2\n');
  expect(run("vlan", "add", "c", "3", "--before", "b", "--after", "a", "--file", f).code).toBe(2);
});
test("help lists every noun", async () => {
  const { NOUNS } = await import("../src/edit/table");
  const r = run("--help");
  expect(r.out).not.toContain("Editing commands come in a later version");
  for (const n of NOUNS) expect(r.out).toContain(n.name);
  const v = run("vlan", "--help");
  expect(v.code).toBe(0);
  expect(v.out).toContain("add");
  expect(run("vlan", "add", "--help").out).toContain("--color");
});
test("parseEditArgv returns a request or a usage message, printing nothing", async () => {
  const { parseEditArgv } = await import("../src/edit/command");
  const r = parseEditArgv(["ports", "add", "core/bridge", "ether2,ether3", "--untagged", "10", "--no-horizon"]);
  expect("req" in r && { noun: r.req.noun.name, verb: r.req.verb, args: r.req.args }).toEqual({
    noun: "ports", verb: "add", args: { parent: "core/bridge", pos: ["ether2,ether3"], flags: { untagged: "10", horizon: false } } });
  const a = parseEditArgv(["allow", "set", "x", "y", "--in", "r", "--label", "l", "--after", "x z"]);
  expect("req" in a && a.req.args).toEqual({ parent: "r", pos: ["x", "y"], flags: { label: "l", after: "x z" } });
  expect(parseEditArgv(["legend", "note", "add", "hi"])).toMatchObject({ req: { verb: "add", args: { pos: ["hi"] } } });
  expect(parseEditArgv(["vlan", "add", "a", "--colour", "x"])).toEqual({ usage: "unknown flag --colour" });
  expect(parseEditArgv(["render"])).toHaveProperty("usage");
  expect(parseEditArgv(["vlan", "add", "a", "--help"])).toHaveProperty("usage");
});
test("a repeated flag: the last one wins", async () => {
  const { parseEditArgv } = await import("../src/edit/command");
  expect(parseEditArgv(["vlan", "set", "a", "--color", "red", "--color", "blue"])).toMatchObject({ req: { args: { flags: { color: "blue" } } } });
});
test("an edit keeps the file mode and writes through a symlink", async () => {
  const { chmodSync, lstatSync, statSync, symlinkSync } = await import("node:fs");
  const f = fresh("mode.net", "vlan a 1\n");
  chmodSync(f, 0o600);
  expect(run("vlan", "add", "b", "2", "--file", f).code).toBe(0);
  expect(statSync(f).mode & 0o777).toBe(0o600);
  const target = fresh("target.net", "vlan a 1\n"), link = fresh("link.net");
  symlinkSync(target, link);
  expect(run("vlan", "add", "b", "2", "--file", link).code).toBe(0);
  expect(lstatSync(link).isSymbolicLink()).toBe(true);
  expect(readFileSync(target, "utf8")).toBe("vlan a 1\nvlan b 2\n");
});

test("help is generated by yargs from the command definitions", async () => {
  const { NOUNS } = await import("../src/edit/table");
  expect(readFileSync("src/cli.ts", "utf8")).not.toContain("const HELP");
  const r = run("--help");
  expect(r.code).toBe(0);
  for (const c of ["render", "check", "show", "import", "init", "completion"]) expect(r.out).toMatch(new RegExp(`netdraw ${c}\\b.* {2,}\\S`));
  for (const n of NOUNS) expect(r.out).toContain(n.help.split(" ").slice(0, 2).join(" "));
  expect(r.out).toContain("Exit codes:");
  expect(r.out).toContain('{"error": string, "file": string, "line": number, "hint"?: string}');
  expect(r.out).toContain("--select-text");
  const c = run("check", "--help").out;
  for (const f of ["--file", "--json", "--all", "include spare/unused parts"]) expect(c).toContain(f);
  expect(run("vlan", "add", "--help").out).toContain('colour name or "#rrggbb"');
  const m = run();
  expect(m.code).toBe(2);
  expect(m.err).toContain("netdraw render");
  expect(m.err).toContain("error: missing command");
});
