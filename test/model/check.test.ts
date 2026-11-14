import { expect, test } from "bun:test";
import { parseDsl } from "../../src/dsl/parse";
import { buildModel, loadModel } from "../../src/load";
import { checkModel } from "../../src/model/check";
import { importRsc } from "../../src/rsc/import";
import type { Diag } from "../../src/types";

const RSC = () =>
  [1, 2, 3]
    .map((n) => `/interface bridge port add bridge=bridge interface=ether${n}`)
    .join("\n")
    .replace(/^/, "/interface bridge add name=bridge\n");
const quiet = (d: Diag[]) => d.filter((x) => !/carried by no link|has no links/.test(x.message));
function check(dsl: string) {
  const { stmts } = parseDsl(dsl, "t.net");
  const facts = new Map(
    stmts.filter((s) => s.kind === "import").map((s) => [s.as, importRsc(RSC(), `${s.as}.rsc`, s.as)] as const),
  );
  return quiet(checkModel(buildModel(stmts, facts, { file: "t.net" })));
}
const HEAD = `imports rsc core.rsc as core, ap1.rsc as ap1\nvlan lan untagged color green "10.0.0.0/24"\nvlan guest 50 color blue "10.50.0.0/24"\n`;

test("home example has no errors", () => {
  expect(checkModel(loadModel("examples/home/network.net")).filter((d) => d.level === "error")).toEqual([]);
});

test("missing port gets a did-you-mean hint, reported once", () => {
  const d = check(`${HEAD}link core.ether9 -- ap1.ether1\n`).filter((x) => x.level === "error");
  expect(d).toHaveLength(1);
  expect(d[0]).toMatchObject({ line: 4, file: "t.net" });
  expect(d[0]!.hint).toMatch(/did you mean core\.ether\d/);
});

test("unknown node suggests the closest id", () => {
  const d = check(`${HEAD}cloud internet\nlink internet -- core.ether1\nlink internat -- ap1.ether1\n`);
  expect(d.filter((x) => x.level === "error").map((x) => x.hint)).toEqual(["did you mean internet?"]);
});

test("port on two links is an error", () => {
  const d = check(`${HEAD}client a\nclient b\nlink core.ether3 -- a\nlink core.ether3 -- b\n`).filter(
    (x) => x.level === "error",
  );
  expect(d).toHaveLength(1);
  expect(d[0]!.line).toBe(7);
});

test("hint naming an unknown node is an error", () => {
  const d = check(`${HEAD}place ghost near core\n`).filter((x) => x.level === "error");
  expect(d).toHaveLength(1);
  expect(d[0]).toMatchObject({ line: 4 });
  expect(d[0]!.message).toContain("ghost");
});

test("bad node id is an error on its line", () => {
  const d = check(`${HEAD}client Bad_Id\n`).filter((x) => x.level === "error");
  expect(d.map((x) => x.line)).toEqual([4]);
});

test("explicit vlans the imported end doesn't carry warn, naming both sets", () => {
  const d = check(`${HEAD}link core.ether2 -- ap1.ether1 vlans guest\n`).filter((x) => x.level === "warning");
  expect(d).toHaveLength(1);
  expect(d[0]!.message).toContain("[guest]");
  expect(d[0]!.message).toContain("inferred [lan]");
});

test("output is sorted by line", () => {
  const d = check(`${HEAD}place ghost near core\nlink core.ether9 -- ap1.ether1\nclient Bad\n`);
  expect(d.map((x) => x.line)).toEqual([...d.map((x) => x.line)].sort((a, b) => a - b));
});

test("home check: only the cap-wifi2 warning, no errors", () => {
  const d = checkModel(loadModel("examples/home/network.net"));
  expect(d.filter((x) => x.level === "error")).toEqual([]);
  expect(d.filter((x) => x.level === "warning").map((x) => x.message)).toEqual([expect.stringContaining("cap-wifi2")]);
});

test("check takes the file from the model", () => {
  const d = check(`${HEAD}link core.ether2 -- ap1.ether1 vlans guest\n`).filter((x) => x.level === "warning");
  expect(d[0]!.file).toBe("t.net");
});

test("explicit vlans on a radio link through a transparent bridge do not warn", () => {
  const rsc =
    "/interface bridge add name=bridge\n/interface bridge port add bridge=bridge interface=ether1\n/interface vlan add interface=bridge name=vlan50 vlan-id=50\n/interface wifi set [ find default-name=wifi1 ] datapath.bridge=bridge\n";
  const { stmts } = parseDsl(
    'imports rsc x.rsc as x, y.rsc as y\nvlan lan untagged color green "10.0.0.0/24"\nvlan guest 50 color blue "10.50.0.0/24"\nlink x.wifi1 -- y.ether1 vlans lan,guest\n',
    "t.net",
  );
  const facts = new Map(["x", "y"].map((n) => [n, importRsc(rsc, `${n}.rsc`, n)] as const));
  const m = buildModel(stmts, facts, { file: "t.net" });
  expect(m.links[0]!.inferred).toEqual(["lan", "guest"]);
  expect(checkModel(m).filter((x) => x.level === "warning")).toEqual([]);
});

const CORE50 =
  "/interface bridge add name=bridge\n/interface bridge port add bridge=bridge interface=ether1\n/interface vlan add interface=bridge name=vlan50 vlan-id=50\n";
const one = (dsl: string) => {
  const { stmts } = parseDsl(
    'imports rsc core.rsc as core\nvlan lan untagged color green "10.0.0.0/24"\nvlan guest 50 color blue "10.50.0.0/24"\nvlan lte 60 color orange "10.60.0.0/24"\ndevice x\n' +
      dsl,
    "t.net",
  );
  return quiet(
    checkModel(buildModel(stmts, new Map([["core", importRsc(CORE50, "core.rsc", "core")]]), { file: "t.net" })),
  ).filter((d) => d.level === "warning");
};

test("explicit vlans toward a fact-less end do not warn when the imported end carries them", () => {
  expect(one("link core.ether1 -- x vlans lan,guest\n")).toEqual([]);
});

test("explicit vlans the imported end does not carry still warn toward a fact-less end", () => {
  expect(one("link core.ether1 -- x vlans lan,lte\n")).toHaveLength(1);
});

const dev = (body: string, vlan = `vlan guest 50 color blue subnet 10.50.0.0/24\n`) => `${vlan}device d\n${body}`;
test("address outside its VLAN's subnets warns", () => {
  const w = check(dev(`  vlan-iface v50 vlan 50 address 10.99.0.1/24\n`)).filter((x) => x.level === "warning");
  expect(w).toHaveLength(1);
  expect(w[0]).toMatchObject({ line: 3 });
  expect(w[0]!.message).toContain("10.99.0.1/24");
  expect(w[0]!.message).toContain("10.50.0.0/24");
});
test("address inside its VLAN's subnets is quiet", () => {
  expect(check(dev(`  vlan-iface v50 vlan 50 address 10.50.0.1/24, 2001:db8::1/64\n`))).toEqual([]);
});
test("same address on two interfaces warns", () => {
  const w = check(
    dev(`  vlan-iface v50 vlan 50 address 10.50.0.1/24\n  vlan-iface v51 vlan 51 address 10.50.0.1/16\n`),
  ).filter((x) => x.level === "warning");
  expect(w.filter((x) => x.message.includes("already used"))).toHaveLength(1);
  expect(w.find((x) => x.message.includes("already used"))).toMatchObject({ line: 4 });
  expect(w[0]!.message).toContain("d.v50");
});
test("bridge address outside the VLAN its style came from warns", () => {
  const w = check(dev(`  bridge br address 10.99.0.1/24\n    vlan-iface v50 vlan 50\n`)).filter(
    (x) => x.level === "warning",
  );
  expect(w).toHaveLength(1);
  expect(w[0]).toMatchObject({ line: 3 });
});

const W = (dsl: string) =>
  checkModel(buildModel(parseDsl(dsl, "t.net").stmts, new Map(), { file: "t.net" })).map(
    (d) => `${d.line} ${d.message}`,
  );

test("warns on a VLAN no link or node style uses, and on an unlinked device", () => {
  expect(
    W(
      'vlan a 10 color red "10.0.0.0/24"\nvlan b 20 color blue "10.1.0.0/24"\ncloud net\ndevice d\ndevice e\nlink net -- d vlans a\n',
    ),
  ).toEqual(["2 vlan b is defined but carried by no link", "5 device e has no links"]);
});

test("warns once about a size over 200 devices", () => {
  const dsl = Array.from({ length: 201 }, (_, i) => `device d${i}\nlink d${i} -- d${i === 0 ? 1 : 0}\n`).join("");
  expect(W(dsl).filter((m) => m.includes("layout may be slow"))).toEqual([
    "0 201 devices: layout may be slow; render a slice (--around, --vlan)",
  ]);
});

test.each([
  "examples/home/network.net",
  "examples/home/network-dsl-only.net",
  "test/fixtures/scale/network.net",
  "test/fixtures/netbox/network.net",
])("%s: no usage warnings", (f) => {
  expect(checkModel(loadModel(f)).filter((d) => /carried by no link|has no links|layout may/.test(d.message))).toEqual(
    [],
  );
});
