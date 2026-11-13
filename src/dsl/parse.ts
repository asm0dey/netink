import { NAMED } from "../model/style";
import type { DevItem, Diag, Endpoint, Stmt, VlanRef } from "../types";

type Tok = { t: "w" | "s" | "p"; v: string }; // word, string, punctuation (, =)

class DslError extends Error {
  constructor(
    msg: string,
    public hint?: string,
  ) {
    super(msg);
  }
}

const KEYWORDS = [
  "title",
  "subtitle",
  "imports",
  "vlan",
  "cloud",
  "device",
  "client",
  "link",
  "note",
  "place",
  "row",
  "legend",
  "style",
  "route",
  "allow",
  "hide",
  "<device>.side",
];

/** Index of the `#` that starts a trailing comment (outside quotes), or -1. */
export function commentStart(line: string): number {
  let inStr = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "#") return i;
  }
  return -1;
}

/** Strip a trailing comment (outside quotes) and trailing whitespace. */
function stripComment(line: string): string {
  const i = commentStart(line);
  return (i < 0 ? line : line.slice(0, i)).trimEnd();
}

function tokenize(s: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i]!;
    if (/\s/.test(c)) i++;
    else if (c === "," || c === "=") {
      out.push({ t: "p", v: c });
      i++;
    } else if (c === '"') {
      let v = "";
      i++;
      for (;;) {
        if (i >= s.length) throw new DslError("unterminated string", 'close the string with a "');
        if (s[i] === "\\" && i + 1 < s.length) {
          v += s[i + 1];
          i += 2;
        } else if (s[i] === '"') {
          i++;
          break;
        } else v += s[i++];
      }
      out.push({ t: "s", v });
    } else {
      const m = /^[^\s,="]+/.exec(s.slice(i))!;
      out.push({ t: "w", v: m[0] });
      i += m[0].length;
    }
  }
  return out;
}

class Cur {
  i = 0;
  constructor(public toks: Tok[]) {}
  peek() {
    return this.toks[this.i];
  }
  done() {
    return this.i >= this.toks.length;
  }
  word(what: string): string {
    const t = this.toks[this.i];
    if (t?.t !== "w") throw new DslError(`expected ${what}`);
    this.i++;
    return t.v;
  }
  str(what: string): string {
    const t = this.toks[this.i];
    if (t?.t !== "s") throw new DslError(`expected quoted ${what}`);
    this.i++;
    return t.v;
  }
  isStr() {
    return this.peek()?.t === "s";
  }
  isWord(v?: string) {
    const t = this.peek();
    return !!t && t.t === "w" && (v === undefined || t.v === v);
  }
  isP(v: string) {
    const t = this.peek();
    return !!t && t.t === "p" && t.v === v;
  }
  expectWord(v: string) {
    if (!this.isWord(v)) throw new DslError(`expected "${v}"`);
    this.i++;
  }
  expectP(v: string) {
    if (!this.isP(v)) throw new DslError(`expected "${v}"`);
    this.i++;
  }
  /** word (, word)* */
  list(what: string): string[] {
    const r = [this.word(what)];
    while (this.isP(",")) {
      this.i++;
      r.push(this.word(what));
    }
    return r;
  }
  end() {
    if (!this.done()) throw new DslError(`unexpected "${this.peek()!.v}"`);
  }
}

const ep = (w: string): Endpoint => {
  const d = w.indexOf(".");
  return d < 0 ? { node: w } : { node: w.slice(0, d), port: w.slice(d + 1) };
};

/** `color` value: a theme name, or a quoted #rgb / #rrggbb (unquoted, `#` would start a comment). */
function color(c: Cur): string {
  if (c.isStr()) {
    const v = c.str("color"),
      m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
    if (!m) throw new DslError(`bad hex color "${v}"`, 'use "#rrggbb", or a name without quotes');
    return m[1]!.length === 3 ? `#${[...m[1]!].map((x) => x + x).join("")}` : v;
  }
  if (c.done()) throw new DslError("expected color", 'quote hex colours: color "#ff0000"');
  const v = c.word("color");
  if (!(v.toLowerCase() in NAMED))
    throw new DslError(`unknown color "${v}"`, `valid: ${Object.keys(NAMED).join(", ")}, or a quoted "#rrggbb"`);
  return v;
}

/** key/value options after a node's id/label; each key takes a string except where noted. */
function opts(c: Cur, keys: Record<string, "w" | "s">): Record<string, string> {
  const r: Record<string, string> = {};
  while (!c.done()) {
    const k = c.word("option");
    if (!(k in keys)) throw new DslError(`unknown option "${k}"`, `valid options: ${Object.keys(keys).join(", ")}`);
    r[k] = keys[k] === "s" ? c.str(k) : c.word(k);
  }
  return r;
}

function parseLine(kw: string, c: Cur, line: number): Stmt[] {
  const side = /^(.+)\.side$/.exec(kw);
  if (side) {
    const group = c.word("group");
    c.expectP("=");
    const s = c.word("side");
    if (!["top", "bottom", "left", "right"].includes(s))
      throw new DslError(`bad side "${s}"`, "use top, bottom, left or right");
    c.end();
    return [{ line, kind: "hint", hint: { type: "side", device: side[1]!, group, side: s as "top" } }];
  }
  switch (kw) {
    case "title":
    case "subtitle": {
      const text = c.str("text");
      c.end();
      return [{ line, kind: kw, text }];
    }
    case "imports": {
      c.expectWord("rsc");
      const r: Stmt[] = [];
      do {
        if (r.length) c.expectP(",");
        const file = c.word("path");
        c.expectWord("as");
        r.push({ line, kind: "import", file, as: c.word("id") });
      } while (c.isP(","));
      c.end();
      return r;
    }
    case "vlan": {
      const name = c.word("vlan name");
      let ids: number[] | "untagged";
      if (c.isWord("untagged")) {
        c.i++;
        ids = "untagged";
      } else
        ids = c.list("vlan id").map((n) => {
          if (!/^\d+$/.test(n)) throw new DslError(`bad vlan id "${n}"`);
          return Number(n);
        });
      const s: Stmt = { line, kind: "vlan", name, ids, subnets: [] };
      while (!c.done()) {
        if (c.isWord("color")) {
          c.i++;
          s.color = color(c);
        } else if (c.isWord("subnet")) {
          c.i++;
          s.subnets.push(...c.list("subnet"));
        } else s.subnets.push(c.str("subnet")); // legacy bare string
      }
      return [s];
    }
    case "cloud":
    case "device":
    case "client": {
      const id = c.word("id");
      const label = c.isStr() ? c.str("label") : undefined;
      const o = opts(
        c,
        kw === "client"
          ? { lease: "w", note: "s" }
          : kw === "device"
            ? { kind: "w", model: "s", os: "s", note: "s" }
            : {},
      );
      return [
        {
          line,
          kind: "node",
          type: kw,
          id,
          label,
          role: o.kind,
          note: o.note,
          lease: o.lease,
          model: o.model,
          ...(o.os !== undefined ? { os: o.os } : {}),
        },
      ];
    }
    case "link": {
      const path: Endpoint[] = [ep(c.word("endpoint"))];
      const fan: string[] = [];
      c.expectWord("--");
      for (;;) {
        const w = c.word("endpoint");
        if (c.isP(",")) {
          fan.push(w);
          c.i++;
          continue;
        }
        if (fan.length) {
          fan.push(w);
          break;
        }
        path.push(ep(w));
        if (c.isWord("--")) c.i++;
        else break;
      }
      let vlans: string[] | undefined, label: string | undefined;
      while (!c.done()) {
        if (c.isWord("vlans")) {
          c.i++;
          vlans = c.list("vlan name");
        } else if (c.isWord("label")) {
          c.i++;
          label = c.str("label");
        } else throw new DslError(`unexpected "${c.peek()!.v}"`, 'link options: vlans <name>,..., label "text"');
      }
      const mk = (p: Endpoint[], lbl?: string): Stmt => ({ line, kind: "link", path: p, vlans, label: lbl });
      const last = path[path.length - 1]!;
      // a chain's label belongs to its last pair; each fan-out pair keeps it
      const chain = pairs(path).map((p, i, a) => mk(p, fan.length || i < a.length - 1 ? undefined : label));
      return [...chain, ...fan.map((f) => mk([last, ep(f)], label))];
    }
    case "note": {
      const target = c.word("target"),
        text = c.str("text");
      c.end();
      return [{ line, kind: "note", target, text }];
    }
    case "place": {
      const a = c.word("id");
      c.expectWord("near");
      const b = c.word("id");
      c.end();
      return [{ line, kind: "hint", hint: { type: "near", a, b } }];
    }
    case "row": {
      const ids = c.list("id");
      c.end();
      if (ids.length < 2) throw new DslError("row needs at least two ids");
      return [{ line, kind: "hint", hint: { type: "row", ids } }];
    }
    case "legend": {
      const op = c.word("legend op");
      if (op === "auto" || op === "off") {
        c.end();
        return [{ line, kind: "legend", op }];
      }
      if (op === "add") {
        const style = c.word("style"),
          arg = c.str("text");
        c.end();
        return [{ line, kind: "legend", op, style, arg }];
      }
      if (op === "note") {
        const arg = c.str("text");
        c.end();
        return [{ line, kind: "legend", op, arg }];
      }
      if (op === "remove") {
        const arg = c.isStr() ? c.str("entry") : c.word("entry");
        c.end();
        return [{ line, kind: "legend", op, arg }];
      }
      if (op === "position") {
        const arg = c.word("position");
        if (arg !== "bottom" && arg !== "right") throw new DslError(`bad position "${arg}"`, "use bottom or right");
        c.end();
        return [{ line, kind: "legend", op, arg }];
      }
      throw new DslError(`unknown legend op "${op}"`, "valid: auto, off, add, remove, note, position");
    }
    case "style": {
      const key = c.word("key");
      if (key !== "jumps") throw new DslError(`unknown style "${key}"`, "valid: jumps");
      const value = c.word("value");
      if (value !== "arc" && value !== "gap" && value !== "none")
        throw new DslError(`bad jumps value "${value}"`, "use arc, gap or none");
      c.end();
      return [{ line, kind: "style", key, value }];
    }
    case "route":
    case "allow": {
      const from = c.word("id");
      c.expectWord("->");
      const to = c.word("id");
      const label = c.isStr() ? c.str("label") : undefined;
      c.end();
      return [{ line, kind: kw, from, to, label }];
    }
    case "hide": {
      const target = c.word("target");
      c.end();
      return [{ line, kind: "hide", target }];
    }
  }
  throw new DslError(`unknown keyword "${kw}"`, `valid keywords: ${KEYWORDS.join(", ")}`);
}

const FLAGS = ["lan", "guest", "hotspot"] as const;
const IP_RE = /^(\d+\.\d+\.\d+\.\d+|[0-9a-f]*:[0-9a-f:.]*)(\/\d+)?$/i;

/** A block name: a word or a quoted string. */
const nm = (c: Cur, what: string) => (c.isStr() ? c.str(what) : c.word(what));
const nmList = (c: Cur, what: string) => {
  const r = [nm(c, what)];
  while (c.isP(",")) {
    c.i++;
    r.push(nm(c, what));
  }
  return r;
};
const int = (c: Cur, what: string) => {
  const w = c.word(what);
  if (!/^\d+$/.test(w)) throw new DslError(`bad ${what} "${w}"`);
  return Number(w);
};
const vref = (c: Cur): VlanRef => {
  const w = nm(c, "vlan");
  return /^\d+$/.test(w) ? Number(w) : w;
};

/** One device-block line (keyword already read). */
function parseItem(kw: string, c: Cur, line: number): DevItem {
  const flags: { lan?: true; guest?: true; hotspot?: true } = {};
  const flag = () => {
    for (const f of FLAGS)
      if (c.isWord(f)) {
        c.i++;
        flags[f] = true;
        return true;
      }
    return false;
  };
  const bad = () => new DslError(`unexpected "${c.peek()!.v}"`);
  switch (kw) {
    case "wan": {
      const it: Extract<DevItem, { kind: "wan" }> = { line, kind: "wan", iface: nm(c, "interface") };
      while (!c.done()) {
        if (c.isWord("on")) {
          c.i++;
          it.on = nm(c, "parent");
        } else if (c.isWord("vlan")) {
          c.i++;
          it.vlan = int(c, "vlan id");
        } else if (c.isWord("route")) {
          c.i++;
          it.route = nm(c, "route");
        } else if (c.isWord("distance")) {
          c.i++;
          it.distance = int(c, "distance");
        } else if (c.isWord("dhcp")) {
          c.i++;
          const a = c.peek();
          if (a?.t === "w" && IP_RE.test(a.v)) {
            c.i++;
            it.dhcp = a.v;
          } else it.dhcp = true;
        } else if (c.isWord("nat")) {
          c.i++;
          it.nat = true;
        } else throw bad();
      }
      return it;
    }
    case "router":
      c.end();
      return { line, kind: "router" };
    case "bridge": {
      const it: Extract<DevItem, { kind: "bridge" }> = {
        line,
        kind: "bridge",
        name: nm(c, "bridge name"),
        addresses: [],
        items: [],
      };
      while (!c.done()) {
        if (c.isWord("address")) {
          c.i++;
          it.addresses.push(...c.list("address"));
        } else if (c.isWord("filtering")) {
          c.i++;
          it.filtering = true;
        } else if (!flag()) throw bad();
      }
      return Object.assign(it, flags);
    }
    case "ports": {
      const it: Extract<DevItem, { kind: "ports" }> = { line, kind: "ports", names: nmList(c, "port"), tagged: [] };
      while (!c.done()) {
        if (c.isWord("untagged")) {
          c.i++;
          it.untagged = vref(c);
        } else if (c.isWord("tagged")) {
          c.i++;
          it.tagged.push(vref(c));
          while (c.isP(",")) {
            c.i++;
            it.tagged.push(vref(c));
          }
        } else if (c.isWord("horizon")) {
          c.i++;
          it.horizon = int(c, "horizon");
        } else throw bad();
      }
      return it;
    }
    case "vlan-iface": {
      const it: Extract<DevItem, { kind: "vlan-iface" }> = {
        line,
        kind: "vlan-iface",
        name: nm(c, "interface"),
        vlan: -1,
        addresses: [],
      };
      let seen = false;
      while (!c.done()) {
        if (c.isWord("on")) {
          c.i++;
          it.on = nm(c, "parent");
        } else if (c.isWord("vlan")) {
          c.i++;
          it.vlan = int(c, "vlan id");
          seen = true;
        } else if (c.isWord("address")) {
          c.i++;
          it.addresses.push(...c.list("address"));
        } else if (!flag()) throw bad();
      }
      if (!seen) throw new DslError("vlan-iface needs a vlan", "vlan-iface <name> [on <parent>] vlan <n>");
      return Object.assign(it, flags);
    }
    case "radio": {
      const it: Extract<DevItem, { kind: "radio" }> = {
        line,
        kind: "radio",
        ifaces: nmList(c, "interface"),
        ssids: [],
      };
      while (!c.done()) {
        if (c.isWord("tag")) {
          c.i++;
          it.tag = int(c, "tag");
        } else if (c.isWord("ssid")) {
          c.i++;
          it.ssids.push(...nmList(c, "ssid"));
        } else throw bad();
      }
      return it;
    }
    case "address": {
      const it: Extract<DevItem, { kind: "address" }> = {
        line,
        kind: "address",
        iface: nm(c, "interface"),
        cidrs: c.list("address"),
      };
      while (!c.done()) if (!flag()) throw bad();
      return Object.assign(it, flags);
    }
    case "lease": {
      const address = c.word("address");
      const comment = c.isStr() ? c.str("comment") : undefined;
      c.end();
      return { line, kind: "lease", address, ...(comment !== undefined ? { comment } : {}) };
    }
    default: {
      // allow
      const from = nm(c, "interface");
      c.expectWord("->");
      const to = nm(c, "target");
      const label = c.isStr() ? c.str("label") : undefined;
      c.end();
      return { line, kind: "allow", from, to, ...(label !== undefined ? { label } : {}) };
    }
  }
}

const BLOCK = ["wan", "router", "bridge", "ports", "vlan-iface", "radio", "address", "lease", "allow"];
const NESTED = ["ports", "vlan-iface", "radio"];

/** Consecutive endpoint pairs of a chain. */
const pairs = (path: Endpoint[]): Endpoint[][] => path.slice(1).map((e, i) => [path[i]!, e]);

/** 1-based source lines of a statement: `line` first, `head` last of its own text, `end` last incl. indented children. */
export type Span = { line: number; head: number; end: number };

export function parseDsl(
  text: string,
  file: string,
): { stmts: Stmt[]; diags: Diag[]; spans: Map<Stmt | DevItem, Span> } {
  const stmts: Stmt[] = [];
  const spans = new Map<Stmt | DevItem, Span>();
  let devSpan: Span | undefined, bridgeSpan: Span | undefined;
  const diags: Diag[] = [];
  const lines = text.split(/\r?\n/);
  // the last level-0 device's item list, and its last level-1 bridge
  let dev: Extract<Stmt, { kind: "node" }> | undefined, bridge: Extract<DevItem, { kind: "bridge" }> | undefined;
  for (let n = 0; n < lines.length; n++) {
    const line = n + 1;
    const lead = /^[ \t]*/.exec(lines[n]!)![0];
    let src = stripComment(lines[n]!);
    // shortcut: a comment-only line after a trailing comma ends the continuation (it reads as empty), upgrade if that bites
    while (src.endsWith(",") && n + 1 < lines.length) src += ` ${stripComment(lines[++n]!).trim()}`;
    if (!src.trim()) continue;
    const head = n + 1;
    try {
      const c = new Cur(tokenize(src));
      const kw = c.word("keyword");
      if (!lead) {
        dev = bridge = devSpan = bridgeSpan = undefined;
        const out = parseLine(kw, c, line);
        const sp: Span = { line, head, end: head };
        for (const o of out) spans.set(o, sp);
        const last = out[out.length - 1];
        if (last?.kind === "node" && last.type === "device") {
          dev = last;
          devSpan = sp;
        }
        stmts.push(...out);
        continue;
      }
      if (lead.includes("\t") || lead.length % 2)
        throw new DslError("bad indentation", "indent block lines with two spaces");
      const level = lead.length / 2;
      if (!BLOCK.includes(kw)) throw new DslError(`${kw} is not a block line`, "unindent it");
      if (level > 2) throw new DslError("block nested too deep", "blocks nest two levels: device, then bridge");
      if (!dev) throw new DslError(`${kw} must be inside a device block`, "indent it under a device line");
      if (level === 1) {
        const it = parseItem(kw, c, line);
        dev.items ??= [];
        dev.items.push(it);
        bridge = it.kind === "bridge" ? it : undefined;
        bridgeSpan = { line, head, end: head };
        spans.set(it, bridgeSpan);
        devSpan!.end = head;
      } else {
        if (!bridge)
          throw new DslError(
            `${kw} is indented under something that is not a bridge`,
            "only bridge lines take indented children",
          );
        if (!NESTED.includes(kw))
          throw new DslError(`${kw} cannot be inside a bridge`, "a bridge holds ports, vlan-iface and radio lines");
        const it = parseItem(kw, c, line);
        bridge.items.push(it);
        spans.set(it, { line, head, end: head });
        bridgeSpan!.end = devSpan!.end = head;
      }
    } catch (e) {
      if (!(e instanceof DslError)) throw e;
      diags.push({ level: "error", file, line, message: e.message, ...(e.hint ? { hint: e.hint } : {}) });
    }
  }
  return { stmts, diags, spans };
}
