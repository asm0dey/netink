import type { DevItem, IfFlags, Stmt, VlanRef } from "../types";

/** A quoted string: `\` and `"` escaped. */
const q = (s: string) => `"${s.replace(/[\\"]/g, "\\$&")}"`;
/** A name: bare when it is a plain word, quoted otherwise. */
const nm = (s: string | number) => (/^[A-Za-z0-9_.:/-]+$/.test(String(s)) ? String(s) : q(String(s)));
const list = (xs: (string | number)[], f: (x: string | number) => string = String) => xs.map(f).join(", ");
const flags = (it: IfFlags) => (["lan", "guest", "hotspot"] as const).filter((f) => it[f]);
const ref = (v: VlanRef) => nm(v);

function item(it: DevItem): string {
  const p: (string | undefined)[] = [it.kind];
  switch (it.kind) {
    case "wan":
      p.push(nm(it.iface), it.on && `on ${nm(it.on)}`, it.vlan !== undefined ? `vlan ${it.vlan}` : undefined, it.route && `route ${nm(it.route)}`,
        it.distance !== undefined ? `distance ${it.distance}` : undefined, it.dhcp === true ? "dhcp" : it.dhcp ? `dhcp ${it.dhcp}` : undefined, it.nat ? "nat" : undefined);
      break;
    case "router": break;
    case "bridge":
      p.push(nm(it.name), it.addresses.length ? `address ${list(it.addresses)}` : undefined, it.filtering ? "filtering" : undefined, ...flags(it));
      break;
    case "ports":
      p.push(list(it.names, nm), it.untagged !== undefined ? `untagged ${ref(it.untagged)}` : undefined,
        it.tagged.length ? `tagged ${list(it.tagged, (v) => ref(v))}` : undefined, it.horizon !== undefined ? `horizon ${it.horizon}` : undefined);
      break;
    case "vif":
      p.push(nm(it.name), it.on && `on ${nm(it.on)}`, `vlan ${it.vlan}`, it.addresses.length ? `address ${list(it.addresses)}` : undefined, ...flags(it));
      break;
    case "radio":
      p.push(list(it.ifaces, nm), it.tag !== undefined ? `tag ${it.tag}` : undefined, it.ssids.length ? `ssid ${list(it.ssids, nm)}` : undefined);
      break;
    case "address": p.push(nm(it.iface), list(it.cidrs), ...flags(it)); break;
    case "lease": p.push(it.address, it.comment !== undefined ? q(it.comment) : undefined); break;
    case "allow": p.push(nm(it.from), "->", nm(it.to), it.label !== undefined ? q(it.label) : undefined); break;
  }
  return p.filter((x) => x !== undefined).join(" ");
}

/** Device-block lines at `indent` levels (two spaces each); bridge children follow their bridge one level deeper. */
export function printItems(items: DevItem[], indent: number): string[] {
  const pad = "  ".repeat(indent);
  return items.flatMap((it) => [pad + item(it), ...(it.kind === "bridge" ? printItems(it.items, indent + 1) : [])]);
}

function stmt(s: Stmt): string[] {
  switch (s.kind) {
    case "title":
    case "subtitle": return [`${s.kind} ${q(s.text)}`];
    case "import": return [`imports rsc ${s.file} as ${s.as}`];
    case "vlan":
      return [["vlan", nm(s.name), s.ids === "untagged" ? "untagged" : list(s.ids),
        s.color && `color ${s.color.startsWith("#") ? q(s.color) : s.color}`, s.subnets.length ? `subnet ${list(s.subnets)}` : undefined].filter(Boolean).join(" ")];
    case "node": {
      const o = [s.label !== undefined ? q(s.label) : undefined, s.role && `kind ${s.role}`, s.model !== undefined ? `model ${q(s.model)}` : undefined,
        s.os !== undefined ? `os ${q(s.os)}` : undefined, s.lease && `lease ${s.lease}`, s.note !== undefined ? `note ${q(s.note)}` : undefined];
      return [[s.type, nm(s.id), ...o].filter(Boolean).join(" "), ...printItems(s.items ?? [], 1)];
    }
    case "link":
      return [["link", s.path.map((e) => (e.port ? `${e.node}.${e.port}` : e.node)).join(" -- "),
        s.vlans?.length ? `vlans ${list(s.vlans)}` : undefined, s.label !== undefined ? `label ${q(s.label)}` : undefined].filter(Boolean).join(" ")];
    case "note": return [`note ${s.target} ${q(s.text)}`];
    case "hint": {
      const h = s.hint;
      return [h.type === "near" ? `place ${h.a} near ${h.b}` : h.type === "row" ? `row ${list(h.ids)}` : `${h.device}.side ${h.group} = ${h.side}`];
    }
    case "legend":
      return [["legend", s.op, s.op === "add" ? s.style : undefined, s.arg === undefined ? undefined : s.op === "position" ? s.arg : q(s.arg)].filter(Boolean).join(" ")];
    case "style": return [`style ${s.key} ${s.value}`];
    case "route":
    case "allow": return [`${s.kind} ${s.from} -> ${s.to}${s.label !== undefined ? " " + q(s.label) : ""}`];
    case "hide": return [`hide ${s.target}`];
  }
}

/** Canonical DSL text: one statement per line, device blocks indented two spaces per level. */
export function printStmts(stmts: Stmt[]): string {
  return stmts.flatMap(stmt).map((l) => l + "\n").join("");
}
