import type { DevItem, Stmt, VlanRef } from "../types";

export type Verb = "add" | "set" | "rm";
export type Complete = "node" | "parent" | "port" | "vlan" | "color" | "path" | "jumps" | "side" | "legend-mode" | "legend-position" | "style-key";
export type Arg = { name: string; optional?: true; variadic?: true; complete?: Complete }; // variadic: the rest of the words (row)
export type Flag = { name: string; type: "string" | "boolean"; clearable?: true; complete?: Complete; help: string };
export type Args = { verb?: Verb; parent?: string; pos: string[]; flags: Record<string, string | boolean | undefined> };
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
  each?(a: Args): Args[];  // one command that is really several edits (legend --mode with --position)
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

/** A name the parser reads back as one bare word (the printer quotes anything else, which `word` positions reject). */
const ident = (s: string | undefined, what: string): string => {
  if (s === undefined) throw new Error(`missing ${what}`);
  if (!/^[A-Za-z0-9_.:/-]+$/.test(s)) throw new Error(`bad ${what} "${s}": use letters, digits and _ . : / -`);
  return s;
};
/** A bare word printed as-is: no whitespace, comma, `=`, quote or `#`. */
const bare = (s: string | undefined, what: string): string => {
  if (s === undefined) throw new Error(`missing ${what}`);
  if (!/^[^\s,="#]+$/.test(s)) throw new Error(`bad ${what} "${s}"`);
  return s;
};
const flat = (xs: string[]) => xs.flatMap(csv);
const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const pick = <T extends string>(s: string | undefined, ok: readonly T[], what: string): T => {
  if (!ok.includes(s as T)) throw new Error(`bad ${what} "${s ?? ""}": use ${ok.join(", ")}`);
  return s as T;
};
const SIDES = ["top", "bottom", "left", "right"] as const;
const JUMPS = ["arc", "gap", "none"] as const;
const clearable = (name: string, help: string): Flag => ({ name, type: "string", clearable: true, help });

const textNoun = (kind: "title" | "subtitle"): Noun => ({
  name: kind, block: false, covers: [kind], verbs: ["add", "set", "rm"], last: true, args: [{ name: "text", optional: true }], flags: [],
  help: `${kind} add|set|rm [text]`,
  match: (t) => t.kind === kind,
  make(a) {
    if (a.pos[0] === undefined) throw new Error(`${kind} add needs the text`);
    return { line: 0, kind, text: a.pos[0] };
  },
  apply(t, a) {
    if (a.pos[0] === undefined) throw new Error(`${kind} set needs the new text`);
    return t.kind === kind ? [{ ...t, text: a.pos[0] }] : [t];
  },
});

const importNoun: Noun = {
  name: "import", block: false, covers: ["import"], verbs: ["add", "set", "rm"], args: [{ name: "path", optional: true, complete: "path" }],
  flags: [{ name: "as", type: "string", help: "the id the import is known by (required)" }],
  help: "import add|set|rm [path] --as <id>",
  match(t, a) {
    return t.kind === "import" && t.as === bare(str(a.flags.as), "--as id");
  },
  make(a) {
    if (a.pos[0] === undefined) throw new Error("import add needs the path");
    return { line: 0, kind: "import", file: bare(a.pos[0], "path"), as: bare(str(a.flags.as), "--as id") };
  },
  apply(t, a) {
    if (a.pos[0] === undefined) throw new Error("import set needs the new path");
    return t.kind === "import" ? [{ ...t, file: bare(a.pos[0], "path") }] : [t];
  },
};

type FieldSpec = { flag: string; field: string; help: string; word?: true };
const NODE_FIELDS: FieldSpec[] = [
  { flag: "label", field: "label", help: "display label" },
  { flag: "kind", field: "role", help: "role, e.g. router or switch", word: true },
  { flag: "model", field: "model", help: "hardware model" },
  { flag: "os", field: "os", help: "operating system" },
  { flag: "note", field: "note", help: "free-form note" },
  { flag: "lease", field: "lease", help: "DHCP lease address", word: true },
];
const nodeNoun = (type: "device" | "cloud" | "client", flags: string[]): Noun => {
  const fields = NODE_FIELDS.filter((f) => flags.includes(f.flag));
  const noun: Noun = {
    name: type, block: false, covers: [`node:${type}`], verbs: ["add", "set", "rm"], show: "devices", args: [{ name: "id", complete: "node" }],
    flags: fields.map((f) => clearable(f.flag, f.help)),
    help: `${type} add|set|rm <id>${fields.map((f) => ` [--${f.flag} v]`).join("")}`,
    // an id is the key across device/cloud/client, so add collides with any type
    match: (t, a) => t.kind === "node" && (a.verb === "add" || t.type === type) && t.id === a.pos[0],
    make: (a) => noun.apply({ line: 0, kind: "node", type, id: ident(a.pos[0], "id") }, a)[0]!,
    apply(t, a) {
      const n: Record<string, unknown> = { ...t };
      for (const f of fields) {
        const v = a.flags[f.flag];
        if (v === false) delete n[f.field];
        else if (typeof v === "string") n[f.field] = f.word ? bare(v, `--${f.flag}`) : v;
      }
      return [n as Target];
    },
  };
  return noun;
};

const endpoint = (e: { node: string; port?: string }) => (e.port ? `${e.node}.${e.port}` : e.node);
const ends = (a: Args) => [bare(a.pos[0], "first endpoint"), bare(a.pos[1], "second endpoint")];
const link: Noun = {
  name: "link", block: false, covers: ["link"], verbs: ["add", "set", "rm"], repeatable: true, show: "links",
  args: [{ name: "a", complete: "port" }, { name: "b", complete: "port" }],
  flags: [clearable("vlans", "vlan names, comma-separated"), clearable("label", "link label")],
  help: "link add|set|rm <a> <b> [--vlans a,b] [--label text]",
  match(t, a) {
    if (t.kind !== "link" || t.path.length !== 2) return false;
    const [p, q] = [a.pos[0], a.pos[1]];
    const is = (e: { node: string; port?: string }, s: string | undefined) => endpoint(e) === s || e.node === s;
    return (is(t.path[0]!, p) && is(t.path[1]!, q)) || (is(t.path[0]!, q) && is(t.path[1]!, p));
  },
  make(a) {
    const [x, y] = ends(a);
    const ep = (w: string) => {
      const d = w.indexOf(".");
      if (d === 0 || d === w.length - 1) throw new Error(`empty ${d ? "port" : "node"} in "${w}"`);
      return d < 0 ? { node: w } : { node: w.slice(0, d), port: w.slice(d + 1) };
    };
    return link.apply({ line: 0, kind: "link", path: [ep(x!), ep(y!)] }, a)[0]!;
  },
  apply(t, a) {
    if (t.kind !== "link") return [t];
    const l = { ...t };
    const { vlans, label } = a.flags;
    if (vlans === false) delete l.vlans; else if (typeof vlans === "string") l.vlans = csv(vlans).map((v) => bare(v, "vlan name"));
    if (label === false) delete l.label; else if (typeof label === "string") l.label = label;
    return [l];
  },
};

const note: Noun = {
  name: "note", block: false, covers: ["note"], verbs: ["add", "set", "rm"], repeatable: true,
  args: [{ name: "target", complete: "node" }, { name: "text", optional: true }], flags: [],
  help: "note add|set|rm <target> [text]   (several notes: narrow with --select-text)",
  // rm/add name the note by its text; set's text is the new one, so the caller narrows with --select-text
  match: (t, a) => t.kind === "note" && t.target === a.pos[0] && (a.verb === "set" || a.pos[1] === undefined || t.text === a.pos[1]),
  make(a) {
    if (a.pos[1] === undefined) throw new Error("note add needs the text");
    return { line: 0, kind: "note", target: bare(a.pos[0], "target"), text: a.pos[1] };
  },
  apply(t, a) {
    if (a.pos[1] === undefined) throw new Error("note set needs the new text");
    return t.kind === "note" ? [{ ...t, text: a.pos[1] }] : [t];
  },
};

const place: Noun = {
  name: "place", block: false, covers: ["hint:near"], verbs: ["add", "set", "rm"], args: [{ name: "a", complete: "node" }],
  flags: [{ name: "near", type: "string", complete: "node", help: "the device to sit next to" }],
  help: "place add|set|rm <a> [--near <b>]",
  match: (t, a) => t.kind === "hint" && t.hint.type === "near" && t.hint.a === a.pos[0],
  make(a) {
    if (str(a.flags.near) === undefined) throw new Error("place add needs --near <b>");
    return { line: 0, kind: "hint", hint: { type: "near", a: bare(a.pos[0], "id"), b: bare(str(a.flags.near), "--near id") } };
  },
  apply(t, a) {
    if (t.kind !== "hint" || t.hint.type !== "near") return [t];
    if (str(a.flags.near) === undefined) throw new Error("place set needs --near <b>");
    return [{ ...t, hint: { ...t.hint, b: bare(str(a.flags.near), "--near id") } }];
  },
};

const rowIds = (xs: string[]) => {
  const ids = flat(xs).map((x) => bare(x, "id"));
  if (ids.length < 2) throw new Error("a row needs at least two ids");
  return ids;
};
const row: Noun = {
  name: "row", block: false, covers: ["hint:row"], verbs: ["add", "set", "rm"], args: [{ name: "ids", variadic: true, complete: "node" }],
  flags: [], help: "row add <ids...> | row set <first-id> <new ids...> | row rm <first-id>",
  match: (t, a) => t.kind === "hint" && t.hint.type === "row" && t.hint.ids[0] === flat(a.pos)[0],
  make: (a) => ({ line: 0, kind: "hint", hint: { type: "row", ids: rowIds(a.pos) } }),
  apply: (t, a) => (t.kind === "hint" && t.hint.type === "row" ? [{ ...t, hint: { type: "row", ids: rowIds(a.pos.slice(1)) } }] : [t]),
};

const side: Noun = {
  name: "side", block: false, covers: ["hint:side"], verbs: ["add", "set", "rm"],
  args: [{ name: "device", complete: "node" }, { name: "group" }, { name: "side", optional: true, complete: "side" }], flags: [],
  help: "side add|set|rm <device> <group> [top|bottom|left|right]",
  match: (t, a) => t.kind === "hint" && t.hint.type === "side" && t.hint.device === a.pos[0] && t.hint.group === a.pos[1],
  make: (a) => ({ line: 0, kind: "hint", hint: { type: "side", device: bare(a.pos[0], "device"), group: bare(a.pos[1], "group"), side: pick(a.pos[2], SIDES, "side") } }),
  apply: (t, a) => (t.kind === "hint" && t.hint.type === "side" ? [{ ...t, hint: { ...t.hint, side: pick(a.pos[2], SIDES, "side") } }] : [t]),
};

const MODES = ["auto", "off"] as const, POSITIONS = ["bottom", "right"] as const;
/** Which setting a `legend` command names: `rm` says it, `set` says it by flag. */
const setting = (a: Args): "mode" | "position" => {
  const [m, p] = [str(a.flags.mode), str(a.flags.position)];
  if (a.verb === "rm" || a.pos[0] !== undefined) return pick(a.pos[0], ["mode", "position"] as const, "setting");
  if (m === undefined && p === undefined) throw new Error("legend set needs --mode or --position");
  return m !== undefined ? "mode" : "position";
};
const legend: Noun = {
  name: "legend", block: false, covers: ["legend:auto", "legend:off", "legend:position"], verbs: ["set", "rm"], last: true, upsert: true,
  args: [{ name: "setting", optional: true }],
  flags: [{ name: "mode", type: "string", complete: "legend-mode", help: "auto or off" }, { name: "position", type: "string", complete: "legend-position", help: "bottom or right" }],
  each: (a) => (str(a.flags.mode) !== undefined && str(a.flags.position) !== undefined
    ? [{ ...a, flags: { ...a.flags, position: undefined } }, { ...a, flags: { ...a.flags, mode: undefined } }] : [a]),
  help: "legend set --mode auto|off | --position bottom|right; legend rm mode|position",
  match: (t, a) => t.kind === "legend" && (setting(a) === "mode" ? t.op === "auto" || t.op === "off" : t.op === "position"),
  make: (a) => legend.apply({ line: 0, kind: "legend", op: "auto" }, a)[0]!,
  apply(t, a) {
    if (t.kind !== "legend") return [t];
    return setting(a) === "mode" ? [{ line: t.line, kind: "legend", op: pick(str(a.flags.mode), MODES, "mode") }]
      : [{ line: t.line, kind: "legend", op: "position", arg: pick(str(a.flags.position), POSITIONS, "position") }];
  },
};

const legendNoun = (name: string, op: "add" | "remove" | "note", args: Arg[], covers: string, help: string): Noun => ({
  name, block: false, covers: [covers], verbs: ["add", "rm"], repeatable: true, args, flags: [], help,
  match: (t, a) => t.kind === "legend" && t.op === op && (op === "add" ? t.style === a.pos[0] && t.arg === a.pos[1] : t.arg === a.pos[0]),
  make(a) {
    const arg = a.pos[op === "add" ? 1 : 0];
    if (arg === undefined) throw new Error(`${name} add needs ${args.map((x) => `<${x.name}>`).join(" ")}`);
    return op === "add" ? { line: 0, kind: "legend", op, style: bare(a.pos[0], "style"), arg } : { line: 0, kind: "legend", op, arg };
  },
  apply: (t) => [t],
});
const legendEntry = legendNoun("legend entry", "add", [{ name: "style" }, { name: "text" }], "legend:add", "legend entry add|rm <style> <text>");
const legendHide = legendNoun("legend hide", "remove", [{ name: "entry" }], "legend:remove", "legend hide add|rm <entry>");
const legendNote = legendNoun("legend note", "note", [{ name: "text" }], "legend:note", "legend note add|rm <text>");

const style: Noun = {
  name: "style", block: false, covers: ["style"], verbs: ["add", "set", "rm"], upsert: true,
  args: [{ name: "key", complete: "style-key" }, { name: "value", optional: true, complete: "jumps" }], flags: [],
  help: "style add|set|rm jumps [arc|gap|none]",
  match: (t, a) => t.kind === "style" && t.key === a.pos[0],
  make(a) {
    pick(a.pos[0], ["jumps"] as const, "style key");
    return { line: 0, kind: "style", key: "jumps", value: pick(a.pos[1], JUMPS, "jumps value") };
  },
  apply: (t, a) => (t.kind === "style" ? [{ ...t, value: pick(a.pos[1], JUMPS, "jumps value") }] : [t]),
};

const arrowNoun = (kind: "route" | "allow"): Noun => ({
  // `allow` also serves the in-block form: with a parent (`--in <device>`) the pool is that device's items
  name: kind, block: false, covers: kind === "allow" ? [kind, "item:allow"] : [kind], verbs: ["add", "set", "rm"], args: [{ name: "from", complete: "node" }, { name: "to", complete: "node" }],
  flags: [clearable("label", "arrow label"), ...(kind === "allow" ? [{ name: "in", type: "string" as const, complete: "node" as const, help: "the device whose block holds the line" }] : [])], help: `${kind} add|set|rm <from> <to> [--label text]`,
  match: (t, a) => t.kind === kind && t.from === a.pos[0] && t.to === a.pos[1],
  make: (a) => arrowNoun(kind).apply({ line: 0, kind, from: bare(a.pos[0], "from"), to: bare(a.pos[1], "to") }, a)[0]!,
  apply(t, a) {
    if (t.kind !== kind) return [t];
    const r = { ...t }, label = a.flags.label;
    if (label === false) delete r.label; else if (typeof label === "string") r.label = label;
    return [r];
  },
});

const hide: Noun = {
  name: "hide", block: false, covers: ["hide"], verbs: ["add", "rm"], args: [{ name: "target", complete: "node" }], flags: [],
  help: "hide add|rm <target>",
  match: (t, a) => t.kind === "hide" && t.target === a.pos[0],
  make: (a) => ({ line: 0, kind: "hide", target: bare(a.pos[0], "target") }),
  apply: (t) => [t],
};

// ---- device-block lines (need a parent: `device` or `device/bridge`) ----
const num = (s: string | undefined, what: string): number => {
  if (s === undefined || !/^\d+$/.test(s)) throw new Error(`bad ${what} "${s ?? ""}": use a whole number`);
  return Number(s);
};
const vref = (s: string): VlanRef => (/^\d+$/.test(s) ? Number(s) : ident(s, "vlan"));
const boolFlag = (name: string, help: string): Flag => ({ name, type: "boolean", clearable: true, help });
const strFlag = (name: string, help: string, complete?: Complete): Flag => ({ name, type: "string", clearable: true, ...(complete ? { complete } : {}), help });
const IF_FLAGS = ["lan", "guest", "hotspot"];
/** Apply the given flags to `o`: a string/number flag sets (or, cleared, deletes) its field; a boolean sets `true` or deletes. */
function setFields(o: Record<string, unknown>, a: Args, specs: [flag: string, field: string, conv?: (s: string) => unknown][]) {
  for (const [flag, field, conv] of specs) {
    const v = a.flags[flag];
    if (v === false) delete o[field];
    else if (v === true) o[field] = true;
    else if (typeof v === "string") o[field] = conv ? conv(v) : v;
  }
}
const names = (s: string | undefined, what: string) => {
  const xs = csv(s ?? "").map((x) => ident(x, what));
  if (!xs.length) throw new Error(`missing ${what}`);
  return xs;
};
const addrs = (s: string) => csv(s).map((x) => bare(x, "address"));
const kindOf = (kind: DevItem["kind"]) => (t: Target) => "kind" in t && t.kind === kind;

type Item<K extends DevItem["kind"]> = Extract<DevItem, { kind: K }>;
/** `ports`/`radio` lines: matched by any named port/iface; rm drops just those; set on part of a line moves them to a new line right after. */
const listNoun = <K extends "ports" | "radio">(kind: K, field: K extends "ports" ? "names" : "ifaces", flags: Flag[], fill: (it: Item<K>, a: Args) => void, help: string): Noun => {
  const get = (t: Target) => (t as unknown as Record<string, string[]>)[field]!;
  const named = (a: Args) => names(a.pos[0], kind === "ports" ? "port" : "interface");
  const noun: Noun = {
    name: kind, block: true, covers: [`item:${kind}`], verbs: ["add", "set", "rm"], args: [{ name: kind === "ports" ? "names" : "ifaces", complete: "port" }], flags, help,
    match: (t, a) => kindOf(kind)(t) && named(a).some((n) => get(t).includes(n)),
    make: (a) => {
      const it = (kind === "ports" ? { line: 0, kind, names: [], tagged: [] } : { line: 0, kind, ifaces: [], ssids: [] }) as unknown as Item<K>;
      (it as Record<string, unknown>)[field] = named(a);
      fill(it, a);
      return it;
    },
    apply(t, a) {
      const hit = named(a), rest = get(t).filter((n) => !hit.includes(n));
      const moved = { ...t, [field]: get(t).filter((n) => hit.includes(n)) } as unknown as Item<K>;
      fill(moved, a);
      if (!rest.length) return [moved];
      return Object.keys(a.flags).some((k) => a.flags[k] !== undefined) ? [{ ...t, [field]: rest } as Target, moved] : [t];
    },
    remove(t, a) {
      const rest = get(t).filter((n) => !named(a).includes(n));
      return rest.length ? [{ ...t, [field]: rest } as Target] : [];
    },
  };
  return noun;
};

const wan: Noun = {
  name: "wan", block: true, covers: ["item:wan"], verbs: ["add", "set", "rm"], args: [{ name: "iface", complete: "port" }],
  flags: [strFlag("on", "parent interface"), strFlag("vlan", "vlan id"), strFlag("route", "route name"), strFlag("distance", "route distance"),
    boolFlag("dhcp", "DHCP client"), { name: "dhcp-address", type: "string", help: "DHCP address" }, boolFlag("nat", "masquerade")],
  help: "wan add|set|rm <parent> <iface> [--on i] [--vlan n] [--route r] [--distance n] [--dhcp] [--dhcp-address a] [--nat]",
  match: (t, a) => t.kind === "wan" && t.iface === a.pos[0],
  make: (a) => wan.apply({ line: 0, kind: "wan", iface: ident(a.pos[0], "interface") }, a)[0]!,
  apply(t, a) {
    if (t.kind !== "wan") return [t];
    const w = { ...t } as Record<string, unknown>;
    setFields(w, a, [["on", "on", (s) => ident(s, "--on")], ["vlan", "vlan", (s) => num(s, "vlan id")], ["route", "route", (s) => ident(s, "--route")],
      ["distance", "distance", (s) => num(s, "distance")], ["nat", "nat"]]);
    if (a.flags.dhcp === false) delete w.dhcp;
    else if (a.flags.dhcp === true && w.dhcp === undefined) w.dhcp = true;
    if (typeof a.flags["dhcp-address"] === "string") w.dhcp = bare(a.flags["dhcp-address"], "--dhcp-address");
    return [w as Target];
  },
};

const router: Noun = {
  name: "router", block: true, covers: ["item:router"], verbs: ["add", "rm"], args: [], flags: [], help: "router add|rm <parent>",
  match: kindOf("router"), make: () => ({ line: 0, kind: "router" }), apply: (t) => [t],
};

const bridge: Noun = {
  name: "bridge", block: true, covers: ["item:bridge"], verbs: ["add", "set", "rm"], args: [{ name: "name" }],
  flags: [strFlag("address", "addresses, comma-separated"), ...["lan", "guest", "hotspot", "filtering"].map((f) => boolFlag(f, f))],
  help: "bridge add|set|rm <device> <name> [--address a,b] [--lan] [--guest] [--hotspot] [--filtering]",
  match: (t, a) => t.kind === "bridge" && t.name === a.pos[0],
  make: (a) => bridge.apply({ line: 0, kind: "bridge", name: ident(a.pos[0], "name"), addresses: [], items: [] }, a)[0]!,
  apply(t, a) {
    if (t.kind !== "bridge") return [t];
    const b = { ...t } as Record<string, unknown>;
    if (a.flags.address === false) b.addresses = [];
    setFields(b, a, [["address", "addresses", addrs], ["filtering", "filtering"], ...IF_FLAGS.map((f): [string, string] => [f, f])]);
    return [b as Target];
  },
};

const ports = listNoun("ports", "names", [strFlag("untagged", "untagged vlan", "vlan"), strFlag("tagged", "tagged vlans, comma-separated", "vlan"), strFlag("horizon", "split-horizon group")],
  (it, a) => {
    const o = it as unknown as Record<string, unknown>;
    if (a.flags.tagged === false) o.tagged = [];
    setFields(o, a, [["untagged", "untagged", vref], ["tagged", "tagged", (s) => csv(s).map(vref)], ["horizon", "horizon", (s) => num(s, "horizon")]]);
  }, "ports add|set|rm <parent> <names> [--untagged v] [--tagged a,b] [--horizon n]");

const radio = listNoun("radio", "ifaces", [strFlag("tag", "vlan tag"), strFlag("ssid", "ssids, comma-separated")],
  (it, a) => {
    const o = it as unknown as Record<string, unknown>;
    if (a.flags.ssid === false) o.ssids = [];
    setFields(o, a, [["tag", "tag", (s) => num(s, "tag")], ["ssid", "ssids", csv]]);
  }, "radio add|set|rm <parent> <ifaces> [--tag n] [--ssid a,b]");

const vlanIface: Noun = {
  name: "vlan-iface", block: true, covers: ["item:vlan-iface"], verbs: ["add", "set", "rm"], args: [{ name: "name" }],
  flags: [strFlag("vlan", "vlan id (required on add)"), strFlag("on", "parent interface"), strFlag("address", "addresses, comma-separated"), ...IF_FLAGS.map((f) => boolFlag(f, f))],
  help: "vlan-iface add|set|rm <parent> <name> --vlan n [--on i] [--address a,b] [--lan] [--guest] [--hotspot]",
  match: (t, a) => t.kind === "vlan-iface" && t.name === a.pos[0],
  make(a) {
    if (typeof a.flags.vlan !== "string") throw new Error("vlan-iface add needs --vlan <n>");
    return vlanIface.apply({ line: 0, kind: "vlan-iface", name: ident(a.pos[0], "name"), vlan: 0, addresses: [] }, a)[0]!;
  },
  apply(t, a) {
    if (t.kind !== "vlan-iface") return [t];
    const v = { ...t } as Record<string, unknown>;
    if (a.flags.vlan === false) throw new Error("a vlan-iface always has a vlan");
    if (a.flags.address === false) v.addresses = [];
    setFields(v, a, [["vlan", "vlan", (s) => num(s, "vlan id")], ["on", "on", (s) => ident(s, "--on")], ["address", "addresses", addrs], ...IF_FLAGS.map((f): [string, string] => [f, f])]);
    return [v as Target];
  },
};

const address: Noun = {
  name: "address", block: true, covers: ["item:address"], verbs: ["add", "set", "rm"], args: [{ name: "iface", complete: "port" }, { name: "cidrs", optional: true }],
  flags: IF_FLAGS.map((f) => boolFlag(f, f)), help: "address add|set|rm <parent> <iface> <cidrs> [--lan] [--guest] [--hotspot]",
  match: (t, a) => t.kind === "address" && t.iface === a.pos[0],
  make(a) {
    if (a.pos[1] === undefined) throw new Error("address add needs the cidrs (a,b)");
    return address.apply({ line: 0, kind: "address", iface: ident(a.pos[0], "interface"), cidrs: [] }, a)[0]!;
  },
  apply(t, a) {
    if (t.kind !== "address") return [t];
    const o = { ...t } as Record<string, unknown>;
    if (a.pos[1] !== undefined) o.cidrs = addrs(a.pos[1]);
    setFields(o, a, IF_FLAGS.map((f): [string, string] => [f, f]));
    return [o as Target];
  },
};

const lease: Noun = {
  name: "lease", block: true, covers: ["item:lease"], verbs: ["add", "set", "rm"], args: [{ name: "address" }, { name: "comment", optional: true }], flags: [],
  help: "lease add|set|rm <parent> <address> [comment]",
  match: (t, a) => t.kind === "lease" && t.address === a.pos[0],
  make: (a) => ({ line: 0, kind: "lease", address: bare(a.pos[0], "address"), ...(a.pos[1] !== undefined ? { comment: a.pos[1] } : {}) }),
  apply(t, a) {
    if (a.pos[1] === undefined) throw new Error("lease set needs the new comment");
    return t.kind === "lease" ? [{ ...t, comment: a.pos[1] }] : [t];
  },
};

export const NOUNS: Noun[] = [
  textNoun("title"), textNoun("subtitle"), importNoun, vlan,
  nodeNoun("device", ["label", "kind", "model", "os", "note"]), nodeNoun("cloud", ["label"]), nodeNoun("client", ["label", "lease", "note"]),
  link, note, place, row, side, legend, legendEntry, legendHide, legendNote, style, arrowNoun("route"), arrowNoun("allow"), hide,
  wan, router, bridge, ports, vlanIface, radio, address, lease,
];

/** The noun named by the leading words, longest name first ("legend entry" before "legend"). */
export const nounOf = (words: string[]): { noun: Noun; rest: string[] } | undefined => {
  let best: { noun: Noun; rest: string[] } | undefined, len = 0;
  for (const noun of NOUNS) {
    const w = noun.name.split(" ");
    if (w.length > len && w.every((x, i) => words[i] === x)) { best = { noun, rest: words.slice(w.length) }; len = w.length; }
  }
  return best;
};
