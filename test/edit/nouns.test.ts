import { expect, test } from "bun:test";
import { parseDsl } from "../../src/dsl/parse";
import { edit, type EditResult } from "../../src/edit/edit";
import { NOUNS, nounOf, type Args, type Verb } from "../../src/edit/table";

const run = (text: string, noun: string, verb: Verb, pos: string[] = [], flags: Args["flags"] = {}): EditResult => {
  const n = NOUNS.find((x) => x.name === noun);
  if (!n) throw new Error(`no noun ${noun}`);
  return edit(text, "t.net", { noun: n, verb, args: { pos, flags } });
};
const ok = (r: EditResult) => {
  if (!r.ok) throw new Error(`edit failed: ${r.error}`);
  return r.text;
};
const errors = (text: string) => parseDsl(text, "t.net").diags.filter((d) => d.level === "error");
type Step = [string[], Args["flags"]?];
/** add -> set -> rm leaves `base` as it was (set is optional: legend entries have none). */
function round(noun: string, base: string, add: Step, set: Step | undefined, rm: Step) {
  const added = ok(run(base, noun, "add", add[0], add[1]));
  expect(added).not.toBe(base);
  expect(errors(added)).toEqual([]);
  let cur = added;
  if (set) {
    cur = ok(run(added, noun, "set", set[0], set[1]));
    expect(cur).not.toBe(added);
    expect(errors(cur)).toEqual([]);
  }
  expect(ok(run(cur, noun, "rm", rm[0], rm[1]))).toBe(base);
}
const B = "device a\ndevice b\nclient c\n";

test("title and subtitle", () => {
  round("title", B, [["T"]], [["U"]], [[]]);
  round("subtitle", B, [["T"]], [["U"]], [[]]);
});
test("title set rewrites the last of two", () => {
  expect(ok(run('title "A"\ntitle "B"\n', "title", "set", ["C"]))).toBe('title "A"\ntitle "C"\n');
});
test("import", () => round("import", B, [["a.rsc"], { as: "x" }], [["b.rsc"], { as: "x" }], [[], { as: "x" }]));
test("import rm one of an `imports a as x, b as y` line", () => {
  expect(ok(run("imports rsc a.rsc as x, b.rsc as y\n", "import", "rm", [], { as: "x" }))).toBe(
    "imports rsc b.rsc as y\n",
  );
});
test("vlan", () => round("vlan", B, [["v", "10"], { color: "red" }], [["v"], { subnet: "10.0.0.0/24" }], [["v"]]));
test("device cloud client", () => {
  round(
    "device",
    B,
    [["d"], { label: "D", kind: "router", model: "m", os: "o", note: "n" }],
    [["d"], { label: false, kind: "switch" }],
    [["d"]],
  );
  round("cloud", B, [["w"], { label: "WAN" }], [["w"], { label: "Net" }], [["w"]]);
  round("client", B, [["k"], { label: "K", lease: "dhcp", note: "n" }], [["k"], { lease: false }], [["k"]]);
});
test("device add over an existing id is refused; set keeps the block", () => {
  expect(run(B, "device", "add", ["a"]).ok).toBe(false);
  expect(ok(run("device a\n  router\n", "device", "set", ["a"], { label: "A" }))).toBe('device a "A"\n  router\n');
});
test("link", () =>
  round(
    "link",
    B,
    [["a", "b"], { vlans: "x,y", label: "L" }],
    [["b", "a"], { vlans: false, label: "M" }],
    [["a", "b"]],
  ));
test("note", () => round("note", B, [["a", "hi"]], [["a", "yo"]], [["a", "yo"]]));
test("note set with several notes needs --select-text", () => {
  const t = 'device a\nnote a "1"\nnote a "2"\n';
  expect(run(t, "note", "set", ["a", "X"]).ok).toBe(false);
  expect(ok(run(t, "note", "set", ["a", "X"], { "select-text": "2" }))).toBe('device a\nnote a "1"\nnote a "X"\n');
  expect(ok(run(t, "note", "rm", ["a", "1"]))).toBe('device a\nnote a "2"\n');
});
test("place, row, side", () => {
  round("place", B, [["a"], { near: "b" }], [["a"], { near: "c" }], [["a"]]);
  round("row", B, [["a", "b"]], [["a", "a", "b", "c"]], [["a"]]);
  round("side", B, [["a", "g", "left"]], [["a", "g", "top"]], [["a", "g"]]);
});
test("legend settings", () => {
  const off = ok(run(B, "legend", "set", [], { mode: "off" }));
  expect(off).toBe(B + "legend off\n");
  expect(ok(run(off, "legend", "set", [], { mode: "auto" }))).toBe(B + "legend auto\n");
  expect(ok(run(off, "legend", "set", [], { position: "right" }))).toBe(off + "legend position right\n");
  expect(ok(run(off, "legend", "rm", ["mode"]))).toBe(B);
  expect(run(off, "legend", "set", [], { mode: "x" }).ok).toBe(false);
});
test("legend set --mode off rewrites the last `legend auto`", () => {
  expect(ok(run("legend auto\nlegend position right\n", "legend", "set", [], { mode: "off" }))).toBe(
    "legend off\nlegend position right\n",
  );
});
test("legend entry, hide, note", () => {
  round("legend entry", B, [["solid", "Wired"]], undefined, [["solid", "Wired"]]);
  round("legend hide", B, [["Wired"]], undefined, [["Wired"]]);
  round("legend note", B, [["hello"]], undefined, [["hello"]]);
});
test("style", () => {
  round("style", B, [["jumps", "arc"]], [["jumps", "gap"]], [["jumps"]]);
  expect(ok(run(B, "style", "set", ["jumps", "none"]))).toBe(B + "style jumps none\n");
  expect(run(B, "style", "add", ["jumps", "zig"]).ok).toBe(false);
});
test("route, allow, hide", () => {
  round("route", B, [["a", "b"], { label: "wan" }], [["a", "b"], { label: false }], [["a", "b"]]);
  round("allow", B, [["a", "b"]], [["a", "b"], { label: "x" }], [["a", "b"]]);
  round("hide", B, [["a"]], undefined, [["a"]]);
});
test("newline in a value is refused", () => {
  const r = run("", "device", "add", ["d"], { label: "a\nb" });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error).toBe("values cannot contain a newline");
});
test("escaping round-trips", () => {
  const label = 'a "b" \\ #c';
  const t = ok(run("", "device", "add", ["d"], { label }));
  const n = parseDsl(t, "t.net").stmts[0]!;
  expect(n.kind === "node" && n.label).toBe(label);
});
test("unparseable ids are refused rather than written", () => {
  expect(run("", "device", "add", ["a b"]).ok).toBe(false);
  expect(run("", "link", "add", ["a", "b c"]).ok).toBe(false);
});
test("link rm from a chain", () => {
  const t = 'cloud a\ndevice b\ndevice c\nlink a -- b -- c label "L"\n';
  const r = ok(run(t, "link", "rm", ["a", "b"]));
  expect(r.split("\n")[3]).toBe('link b -- c label "L"');
  expect(parseDsl(r, "t.net").stmts.filter((s) => s.kind === "link")).toHaveLength(1);
});
test("link rm from a fan-out", () => {
  expect(ok(run("device sw\ndevice x\ndevice y\nlink sw -- x, y\n", "link", "rm", ["sw", "y"]))).toBe(
    "device sw\ndevice x\ndevice y\nlink sw -- x\n",
  );
});
test("parallel links need --select-text", () => {
  const t = 'device a\ndevice b\nlink a -- b label "1"\nlink a -- b label "2"\n';
  const r = run(t, "link", "rm", ["a", "b"]);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.candidates).toHaveLength(2);
  expect(ok(run(t, "link", "rm", ["a", "b"], { "select-text": "2" }))).toBe(
    'device a\ndevice b\nlink a -- b label "1"\n',
  );
});
test("rm device refused while referenced", () => {
  const r = run('device d\nnote d "x"\n', "device", "rm", ["d"]);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error).toContain("line 2");
});
test("every noun resolves by name; legend alone is the settings noun", () => {
  for (const n of NOUNS) expect(nounOf(n.name.split(" "))?.noun).toBe(n);
  expect(nounOf(["legend", "set"])?.noun.name).toBe("legend");
});
test("device add refuses an id any node already has", () => {
  const r = run("cloud a\n", "device", "add", ["a"]);
  expect(r.ok).toBe(false);
  expect(run("cloud a\n", "device", "set", ["a"], { label: "x" }).ok).toBe(false); // set/rm still by type
});
test("note add --after names a note by target and text", () => {
  const t = 'device a\nnote a "x"\nnote a "y"\n';
  expect(ok(run(t, "note", "add", ["a", "z"], { after: "a x" }))).toBe(
    'device a\nnote a "x"\nnote a "z"\nnote a "y"\n',
  );
});
test("legend set takes --mode and --position together", () => {
  expect(ok(run("legend auto\n", "legend", "set", [], { mode: "off", position: "right" }))).toBe(
    "legend off\nlegend position right\n",
  );
  expect(ok(run(B, "legend", "set", [], { mode: "off", position: "right" }))).toBe(
    B + "legend off\nlegend position right\n",
  );
});
test("link add refuses an empty port", () => {
  expect(run("", "link", "add", ["a.", "b"]).ok).toBe(false);
  expect(run("", "link", "add", ["a", ".p"]).ok).toBe(false);
});
