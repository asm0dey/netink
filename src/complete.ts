import { loadModel } from "./load";
import { NAMED } from "./model/style";
import { NOUNS, type Complete, type Noun } from "./edit/table";
import type { MNode } from "./types";

const COMMANDS = ["render", "check", "show", "import", "init", "completion"];
const FIXED: Partial<Record<Complete, string[]>> = {
  jumps: ["arc", "gap", "none"], side: ["top", "bottom", "left", "right"], "legend-mode": ["auto", "off"], "legend-position": ["bottom", "right"], color: Object.keys(NAMED),
};
const VALUE_FLAGS = ["file", "after", "before", "select-text", "in", "as", "o"];
const COMMON = ["file", "json", "after", "before", "select-text"];

/** Names the .net file defines; any failure to read it gives none. */
function names(file: string): { nodes: MNode[]; vlans: string[] } {
  try { const m = loadModel(file, { all: true }); return { nodes: m.nodes, vlans: m.vlans.map((v) => v.name) }; }
  catch { return { nodes: [], vlans: [] }; }
}
function find(ns: MNode[], id: string): MNode | undefined {
  for (const n of ns) { const f = n.id === id ? n : find(n.children, id); if (f) return f; }
}

/** Completion candidates for `words` (the arguments after `netdraw`; the last is the partial word). Never throws. */
export function complete(words: string[]): string[] {
  try { return run(words); } catch { return []; }
}

function run(all: string[]): string[] {
  // --file may come after the cursor; it is read from anywhere and taken out
  let file = "./network.net";
  const words: string[] = [];
  for (let i = 0; i < all.length; i++) {
    if (all[i] === "--file" && i < all.length - 1) file = all[++i]!;
    else if (all[i]!.startsWith("--file=")) file = all[i]!.slice(7);
    else words.push(all[i]!);
  }
  const cur = words.at(-1) ?? "", prior = words.slice(0, -1);
  // positionals and flag values among the words before the cursor
  const pos: string[] = [];
  let pending: string | undefined; // a flag waiting for its value
  for (const w of prior) {
    if (pending) { pending = undefined; continue; }
    if (w.startsWith("--")) { const n = w.slice(2); if (!n.includes("=") && (VALUE_FLAGS.includes(n) || NOUNS.some((x) => x.flags.some((f) => f.name === n && f.type === "string")))) pending = n; }
    else pos.push(w);
  }
  const out = (xs: string[]) => [...new Set(xs)].filter((x) => x.startsWith(cur));
  const first = NOUNS.map((n) => n.name.split(" ")[0]!);
  if (pos.length === 0 && !pending) return cur.startsWith("-") ? [] : out([...COMMANDS, ...first]);
  const w0 = pos[0]!;
  if (!first.includes(w0)) return [];
  const second = NOUNS.filter((n) => n.name.startsWith(w0 + " ")).map((n) => n.name.split(" ")[1]!);
  let noun: Noun | undefined = NOUNS.find((n) => n.name === w0);
  let rest = pos.slice(1);
  if (!noun || (second.length && (rest.length === 0 || second.includes(rest[0]!)))) {
    if (rest.length === 0 && !pending) return out([...second, ...(noun ? noun.verbs : [])]);
    noun = NOUNS.find((n) => n.name === `${w0} ${rest[0]}`) ?? noun;
    if (noun?.name.includes(" ")) rest = rest.slice(1);
  }
  if (!noun) return [];
  if (rest.length === 0 && !pending) return cur.startsWith("-") ? [] : out(noun.verbs);
  const args = rest.slice(1);
  const specs = [...(noun.block ? [{ name: "parent", complete: "parent" as Complete }] : []), ...noun.args];
  let src: Complete | undefined;
  if (pending) {
    src = noun.flags.find((f) => f.name === pending)?.complete ?? (pending === "in" ? "node" : undefined);
  } else if (!cur.startsWith("-")) {
    const s = specs[args.length] ?? (specs.at(-1) && "variadic" in specs.at(-1)! ? specs.at(-1) : undefined);
    src = s?.complete;
  }
  if (!pending && cur.startsWith("-")) {
    const fl = [...noun.flags.map((f) => f.name), ...(noun.name === "allow" ? ["in"] : []), ...COMMON];
    return out(fl.map((f) => `--${f}`));
  }
  if (!src) return [];
  if (src === "path") return [];
  const fixed = FIXED[src];
  if (fixed) return out(fixed);
  const { nodes, vlans } = names(file);
  if (src === "vlan") return out(vlans);
  if (src === "node") return out(nodes.map((n) => n.id));
  if (src === "parent") return out(nodes.flatMap((n) => [n.id, ...n.children.filter((c) => c.kind === "group").map((c) => c.id)]));
  // port: the children of the parent, named without it
  const pid = noun.block ? args[0] : undefined;
  const p = pid ? find(nodes, pid) : undefined;
  if (!p) return out(nodes.map((n) => n.id));
  return out(p.children.map((c) => c.id.slice(p.id.length + 1)));
}
