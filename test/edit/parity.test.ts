import { expect, test } from "bun:test";
import { NOUNS } from "../../src/edit/table";
import type { DevItem, Hint, Stmt } from "../../src/types";

// Each Record breaks `mise run typecheck` when a kind is added to src/types.ts without a line here.
type Legend = Extract<Stmt, { kind: "legend" }>["op"];
type NodeType = Extract<Stmt, { kind: "node" }>["type"];
const stmts: Record<Stmt["kind"], true> = {
  title: true,
  subtitle: true,
  import: true,
  vlan: true,
  node: true,
  link: true,
  note: true,
  hint: true,
  legend: true,
  style: true,
  route: true,
  allow: true,
  hide: true,
};
const items: Record<DevItem["kind"], true> = {
  wan: true,
  router: true,
  bridge: true,
  ports: true,
  "vlan-iface": true,
  radio: true,
  address: true,
  lease: true,
  allow: true,
};
const nodes: Record<NodeType, true> = { device: true, cloud: true, client: true };
const hints: Record<Hint["type"], true> = { near: true, row: true, side: true };
const legends: Record<Legend, true> = { auto: true, off: true, add: true, remove: true, note: true, position: true };

const bare = [
  "title",
  "subtitle",
  "import",
  "vlan",
  "link",
  "note",
  "style",
  "route",
  "allow",
  "hide",
] as const satisfies readonly Stmt["kind"][];
const KINDS = [
  ...bare.filter((k) => stmts[k]),
  ...Object.keys(nodes).map((t) => `node:${t}`),
  ...Object.keys(hints).map((t) => `hint:${t}`),
  ...Object.keys(legends).map((o) => `legend:${o}`),
  ...Object.keys(items).map((k) => `item:${k}`),
];
const SET = new Set(["legend:auto", "legend:off", "legend:position"]);

test("kind lists cover every Stmt kind", () => {
  const seen = new Set<string>(bare);
  for (const k of ["node", "hint", "legend"]) seen.add(k);
  expect([...seen].sort()).toEqual(Object.keys(stmts).sort());
});

test("every statement kind has a noun with the right verbs", () => {
  for (const k of KINDS) {
    const noun = NOUNS.find((n) => n.covers.includes(k));
    expect(noun, `no noun covers ${k}`).toBeDefined();
    expect(noun!.verbs, `${k} verbs`).toContain(SET.has(k) ? "set" : "add");
    expect(noun!.verbs, `${k} verbs`).toContain("rm");
  }
});

test("no noun covers an unknown kind", () => {
  const known = new Set(KINDS);
  for (const n of NOUNS) for (const c of n.covers) expect(known.has(c), `${n.name} covers unknown ${c}`).toBe(true);
});
