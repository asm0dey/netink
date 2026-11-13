import type { DevItem, Stmt } from "../types";

export type Verb = "add" | "set" | "rm";
export type Complete = "node" | "parent" | "port" | "vlan" | "color" | "path" | "jumps" | "side" | "legend-mode" | "legend-position";
export type Arg = { name: string; optional?: true; complete?: Complete };
export type Flag = { name: string; type: "string" | "boolean"; clearable?: true; complete?: Complete; help: string };
export type Args = { parent?: string; pos: string[]; flags: Record<string, string | boolean | undefined> };
export type Target = Stmt | DevItem;
export type Noun = {
  name: string;            // "vlan", "legend entry"
  block: boolean;          // true: requires a parent (device or device/bridge); any noun given `parent` edits that block's items
  covers: string[];        // kinds it edits, e.g. "vlan", "node:device", "hint:near", "legend:add", "item:ports"
  verbs: Verb[];
  args: Arg[];             // positionals after the parent
  flags: Flag[];           // noun-specific; --file --json --after --before --select-text are common
  repeatable?: true;       // several statements may share a key (see spec "Kinds that can repeat")
  help: string;            // one usage line for --help
  show?: string;           // the `netdraw show` slice that lists candidates, e.g. "vlans"
  last?: true;             // set/rm act on the last of several matches (title, subtitle: the one the model uses)
  upsert?: true;           // set with no match adds `make(a)` (settings: legend, style)
  match(t: Target, a: Args): boolean;
  make(a: Args): Target;                 // add; throws an Error with a user-facing message on bad input
  apply(t: Target, a: Args): Target[];   // set; may return 2 (ports split); a cleared flag arrives as flags[name] === false
  remove?(t: Target, a: Args): Target[]; // rm of part of a statement (one port off a ports line); [] or absent deletes it
};

/** `10,20` or `untagged`. */
function vlanIds(s: string): number[] | "untagged" {
  if (s === "untagged") return s;
  return s.split(",").map((x) => {
    if (!/^\d+$/.test(x.trim())) throw new Error(`bad vlan id "${x.trim()}"`);
    return Number(x);
  });
}
const csv = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

const vlan: Noun = {
  name: "vlan", block: false, covers: ["vlan"], verbs: ["add", "set", "rm"], show: "vlans",
  args: [{ name: "name", complete: "vlan" }, { name: "ids", optional: true }],
  flags: [
    { name: "color", type: "string", clearable: true, complete: "color", help: "colour name or \"#rrggbb\"" },
    { name: "subnet", type: "string", clearable: true, help: "subnets, comma-separated" },
  ],
  help: "vlan add|set|rm <name> [ids] [--color c] [--subnet a,b]",
  match: (t, a) => t.kind === "vlan" && t.name === a.pos[0],
  make(a) {
    if (a.pos[1] === undefined) throw new Error("vlan add needs ids (10,20 or untagged)");
    return vlan.apply({ line: 0, kind: "vlan", name: a.pos[0]!, ids: [], subnets: [] }, a)[0]!;
  },
  apply(t, a) {
    if (t.kind !== "vlan") return [t];
    const v = { ...t };
    if (a.pos[1] !== undefined) v.ids = vlanIds(a.pos[1]);
    const { color, subnet } = a.flags;
    if (color === false) delete v.color; else if (typeof color === "string") v.color = color;
    if (subnet === false) v.subnets = []; else if (typeof subnet === "string") v.subnets = csv(subnet);
    return [v];
  },
};

export const NOUNS: Noun[] = [vlan];

/** The noun named by the leading words, longest name first ("legend entry" before "legend"). */
export const nounOf = (words: string[]): { noun: Noun; rest: string[] } | undefined => {
  let best: { noun: Noun; rest: string[] } | undefined, len = 0;
  for (const noun of NOUNS) {
    const w = noun.name.split(" ");
    if (w.length > len && w.every((x, i) => words[i] === x)) { best = { noun, rest: words.slice(w.length) }; len = w.length; }
  }
  return best;
};
