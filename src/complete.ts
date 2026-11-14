import { existsSync } from "node:fs";
import { type Complete, NOUNS, type Noun } from "./edit/table";
import { loadModel } from "./load";
import { NAMED } from "./model/style";
import type { MNode } from "./types";

const COMMANDS = ["render", "check", "show", "import", "init", "completion"];
const FIXED: Partial<Record<Complete, string[]>> = {
  jumps: ["arc", "gap", "none"],
  side: ["top", "bottom", "left", "right"],
  "legend-mode": ["auto", "off"],
  "legend-position": ["bottom", "right"],
  color: Object.keys(NAMED),
  "style-key": ["jumps"],
};
// the flags every verb takes (see command.ts); the rest come from the table
const VALUE_FLAGS = new Set([
  "after",
  "before",
  "select-text",
  ...NOUNS.flatMap((n) => n.flags.filter((f) => f.type === "string").map((f) => f.name)),
]);
const COMMON = ["file", "json", "after", "before", "select-text"];
// render's slice flags take a value; the rest of render completes nothing
const RENDER: Record<string, "vlan" | "node" | "view"> = { vlan: "vlan", around: "node", view: "view" };

/** Names the .net file defines; any failure to read it gives none. */
function names(file: string): { nodes: MNode[]; vlans: string[]; trunks: string[] } {
  try {
    const m = loadModel(file, { all: true });
    return { nodes: m.nodes, vlans: m.vlans.map((v) => v.name), trunks: m.trunks.map((t) => t.name) };
  } catch {
    return { nodes: [], vlans: [], trunks: [] };
  }
}
function find(ns: MNode[], id: string): MNode | undefined {
  for (const n of ns) {
    const f = n.id === id ? n : find(n.children, id);
    if (f) return f;
  }
}

/** Completion candidates for `words` (the arguments after `netdraw`; the last is the partial word). Never throws. */
export function complete(words: string[]): string[] {
  try {
    return run(words);
  } catch {
    return [];
  }
}

function run(all: string[]): string[] {
  // --file may come after the cursor; it is read from anywhere and taken out
  let file = "./network.net";
  const words: string[] = [];
  // a last word that names no existing file is the path being typed; an existing one was typed before the cursor
  const typing = (v: string) => !existsSync(v);
  for (let i = 0; i < all.length; i++) {
    const w = all[i]!;
    if (w.startsWith("--file=")) {
      if (i === all.length - 1 && typing(w.slice(7))) return [];
      file = w.slice(7);
    } else if (w === "--file" && i < all.length - 1) {
      if (all[i + 1] === "=") i++; // bash splits --file=x at the =
      if (i === all.length - 1) return [];
      file = all[++i]!;
      if (i === all.length - 1 && typing(file)) return [];
    } else words.push(w);
  }
  const cur = words.at(-1) ?? "",
    prior = words.slice(0, -1);
  // positionals and flag values among the words before the cursor
  const pos: string[] = [];
  let pending: string | undefined; // a flag waiting for its value
  for (const w of prior) {
    if (pending) {
      pending = undefined;
      continue;
    }
    if (w.startsWith("--")) {
      const n = w.slice(2);
      if (!n.includes("=") && (VALUE_FLAGS.has(n) || (pos[0] === "render" && n in RENDER))) pending = n;
    } else pos.push(w);
  }
  const out = (xs: string[]) => [...new Set(xs)].filter((x) => x.startsWith(cur));
  const first = NOUNS.map((n) => n.name.split(" ")[0]!);
  if (pos.length === 0 && !pending) return cur.startsWith("-") ? [] : out([...COMMANDS, ...first]);
  const w0 = pos[0]!;
  if (w0 === "render") {
    const src = pending && RENDER[pending];
    if (!src) return [];
    if (src === "view") return out(["combined", "physical", "vlans", "routing"]);
    const { nodes, vlans } = names(file);
    return out(src === "vlan" ? vlans : nodes.map((n) => n.id));
  }
  if (!first.includes(w0)) return [];
  const second = NOUNS.filter((n) => n.name.startsWith(`${w0} `)).map((n) => n.name.split(" ")[1]!);
  let noun: Noun | undefined = NOUNS.find((n) => n.name === w0);
  let rest = pos.slice(1);
  if (!noun || (second.length && (rest.length === 0 || second.includes(rest[0]!)))) {
    if (rest.length === 0 && !pending) return out([...second, ...(noun ? noun.verbs : [])]);
    noun = NOUNS.find((n) => n.name === `${w0} ${rest[0]}`) ?? noun;
    if (noun?.name.includes(" ")) rest = rest.slice(1);
  }
  if (!noun) return [];
  if (rest.length === 0 && !pending) return cur.startsWith("-") ? [] : out(noun.verbs);
  if (!noun.verbs.includes(rest[0] as never)) return [];
  const args = rest.slice(1);
  const specs = [...(noun.block ? [{ name: "parent", complete: "parent" as Complete }] : []), ...noun.args];
  let src: Complete | undefined;
  if (pending) {
    src = noun.flags.find((f) => f.name === pending)?.complete;
  } else if (!cur.startsWith("-")) {
    const s = specs[args.length] ?? (specs.at(-1) && "variadic" in specs.at(-1)! ? specs.at(-1) : undefined);
    src = s?.complete;
  }
  if (!pending && cur.startsWith("-")) {
    const fl = [...noun.flags.map((f) => f.name), ...COMMON];
    return out(fl.map((f) => `--${f}`));
  }
  if (!src) return [];
  if (src === "path") return [];
  const fixed = FIXED[src];
  if (fixed) return out(fixed);
  const { nodes, vlans, trunks } = names(file);
  if (src === "vlan") return out(vlans);
  if (src === "trunk") return out(trunks);
  if (src === "node") return out(nodes.map((n) => n.id));
  if (src === "parent")
    return out(nodes.flatMap((n) => [n.id, ...n.children.filter((c) => c.kind === "group").map((c) => c.id)]));
  // port: the ports and interfaces under the parent, named as the DSL does (without the device id)
  const pid = noun.block ? args[0] : undefined;
  const p = pid ? find(nodes, pid) : undefined;
  if (!p) return out(nodes.map((n) => n.id));
  const leaves = (n: MNode): MNode[] =>
    n.children.flatMap((c) => (c.kind === "port" || c.kind === "iface" || c.kind === "radio" ? [c] : leaves(c)));
  return out(leaves(p).map((c) => c.id.slice(c.id.indexOf("/") + 1)));
}
