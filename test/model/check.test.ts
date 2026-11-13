import { expect, test } from "bun:test";
import { parseDsl } from "../../src/dsl/parse";
import { buildModel, loadModel } from "../../src/model/build";
import { checkModel } from "../../src/model/check";
import { importRsc } from "../../src/rsc/import";

const RSC = () => [1, 2, 3].map((n) => `/interface bridge port add bridge=bridge interface=ether${n}`).join("\n").replace(/^/, "/interface bridge add name=bridge\n");
function check(dsl: string) {
  const { stmts } = parseDsl(dsl, "t.net");
  const facts = new Map(stmts.filter((s) => s.kind === "import").map((s) => [s.as, importRsc(RSC(), `${s.as}.rsc`, s.as)] as const));
  return checkModel(buildModel(stmts, facts, { file: "t.net" }), "t.net");
}
const HEAD = `imports rsc core.rsc as core, ap1.rsc as ap1\nvlan lan untagged color green "10.0.0.0/24"\nvlan guest 50 color blue "10.50.0.0/24"\n`;

test("home example has no errors", () => {
  expect(checkModel(loadModel("examples/home/network.net")).filter((d) => d.level === "error")).toEqual([]);
});

test("missing port gets a did-you-mean hint, reported once", () => {
  const d = check(HEAD + "link core.ether9 -- ap1.ether1\n").filter((x) => x.level === "error");
  expect(d).toHaveLength(1);
  expect(d[0]).toMatchObject({ line: 4, file: "t.net" });
  expect(d[0]!.hint).toMatch(/did you mean core\.ether\d/);
});

test("unknown node suggests the closest id", () => {
  const d = check(HEAD + "cloud internet\nlink internet -- core.ether1\nlink internat -- ap1.ether1\n");
  expect(d.filter((x) => x.level === "error").map((x) => x.hint)).toEqual(["did you mean internet?"]);
});

test("port on two links is an error", () => {
  const d = check(HEAD + "client a\nclient b\nlink core.ether3 -- a\nlink core.ether3 -- b\n").filter((x) => x.level === "error");
  expect(d).toHaveLength(1);
  expect(d[0]!.line).toBe(7);
});

test("hint naming an unknown node is an error", () => {
  const d = check(HEAD + "place ghost near core\n").filter((x) => x.level === "error");
  expect(d).toHaveLength(1);
  expect(d[0]).toMatchObject({ line: 4 });
  expect(d[0]!.message).toContain("ghost");
});

test("bad node id is an error on its line", () => {
  const d = check(HEAD + "client Bad_Id\n").filter((x) => x.level === "error");
  expect(d.map((x) => x.line)).toEqual([4]);
});

test("explicit vlans the imported end doesn't carry warn, naming both sets", () => {
  const d = check(HEAD + "link core.ether2 -- ap1.ether1 vlans guest\n").filter((x) => x.level === "warning");
  expect(d).toHaveLength(1);
  expect(d[0]!.message).toContain("[guest]");
  expect(d[0]!.message).toContain("inferred [lan]");
});

test("output is sorted by line", () => {
  const d = check(HEAD + "place ghost near core\nlink core.ether9 -- ap1.ether1\nclient Bad\n");
  expect(d.map((x) => x.line)).toEqual([...d.map((x) => x.line)].sort((a, b) => a - b));
});
