import type { DevItem, Iface, IfFlags, MNode, Stmt, VlanDef, VlanRef } from "../types";
import { parseCidr } from "./addr";
import { fallbackIn, physOf, vlanStyle } from "./style";

type NodeStmt = Extract<Stmt, { kind: "node" }>;
/** One radio chip: a `radio` line. */
export type Radio = { id: string; bridge?: string; tag?: number; ifaces: Iface[] };
export type Dev = {
  id: string;
  line: number;
  node: MNode;
  ref: Map<string, string>;
  ifaceOf: Map<string, Iface>;
  radios: Radio[];
  hasRouter: boolean;
  /** The neutral interface table the block lines describe; `table` names its `<port>.<id>` rows from `tagged`, which are not VLAN consumers. */
  ifaces: Iface[];
  table: Set<string>;
  wan: Extract<DevItem, { kind: "wan" }>[];
  addresses: { iface: string; cidr: string; flags: IfFlags; line: number }[];
  leases: { address: string; comment?: string }[];
  allows: Extract<DevItem, { kind: "allow" }>[];
  /** WAN member name → distance of its default route. */ wanRoutes: Map<string, number>;
  /** Port names pruned from the drawing (unlinked, router-less device); dropped from `ref`. */ hidden: Set<string>;
};

export const mk = (
  id: string,
  kind: MNode["kind"],
  style: string,
  label: string,
  sub: string[] = [],
  tier = 0,
): MNode => ({ id, kind, style, label, sub, children: [], tier });
/** A block name in a node id: `/` would split the id, so it is `%2F`, and `%` is `%25`. */
export const esc = (name: string) => name.replace(/%/g, "%25").replace(/\//g, "%2F");
const flagsOf = (x: IfFlags): IfFlags =>
  ({
    ...(x.lan ? { lan: true } : {}),
    ...(x.guest ? { guest: true } : {}),
    ...(x.hotspot ? { hotspot: true } : {}),
  }) as IfFlags;

/** A `device` statement with block lines → its box, chips and the neutral table lane inference reads. */
export function buildDevice(
  s: NodeStmt,
  vlans: VlanDef[],
  err: (line: number, message: string, hint?: string) => void = () => {},
): Dev {
  const id = s.id,
    items = s.items ?? [],
    fallback = fallbackIn(vlans);
  const child = (name: string) => `${id}/${esc(name)}`;
  const ref = new Map<string, string>(),
    ifaceOf = new Map<string, Iface>(),
    wanRoutes = new Map<string, number>(),
    table = new Set<string>();
  const ifaces: Iface[] = [],
    addresses: Dev["addresses"] = [],
    radios: Radio[] = [];
  // A local name is declared once; a repeat is reported at its own line and skipped, so it never doubles a node id.
  const declared = new Map<string, number>();
  const claim = (name: string, line: number) => {
    const first = declared.get(name);
    if (first === undefined) {
      declared.set(name, line);
      return true;
    }
    err(line, `${id} declares "${name}" twice`, `first declared on line ${first}; give each interface one name`);
    return false;
  };
  const wan = items.filter((i): i is Extract<DevItem, { kind: "wan" }> => i.kind === "wan" && claim(i.iface, i.line));
  const wanNames = new Set(wan.map((w) => w.iface));
  const bridges: Extract<DevItem, { kind: "bridge" }>[] = [];
  const ids = (r: VlanRef, line: number): number[] => {
    if (typeof r === "number") return [r];
    const def = vlans.find((v) => v.name === r);
    if (!def) {
      err(line, `unknown vlan "${r}"`, `declare it with vlan ${r} <ids>`);
      return [];
    }
    return def.ids === "untagged" ? [] : def.ids;
  };

  // The neutral table, in document order; radio items become chips after it.
  /** One chip per (bridge, tag): radio lines sharing both merge, members and SSIDs in document order. */
  const radioItems: { bridge?: string; tag?: number; names: string[]; ssids: string[]; rows: Iface[] }[] = [];
  for (const w of wan) {
    ifaces.push(
      w.vlan !== undefined
        ? { name: w.iface, type: "vlan", ...(w.on !== undefined ? { parent: w.on } : {}), vlanId: w.vlan }
        : { name: w.iface, type: "other" },
    );
    if (w.route !== undefined || w.distance !== undefined) wanRoutes.set(w.iface, w.distance ?? Infinity);
  }
  const lines = (xs: DevItem[], bridge?: string) => {
    for (const it of xs) {
      const br = bridge !== undefined ? { bridge } : {};
      if (it.kind === "bridge") {
        if (!claim(it.name, it.line)) continue;
        bridges.push(it);
        ifaces.push({ name: it.name, type: "bridge", ...(it.filtering ? { vlanFiltering: true } : {}) });
        for (const c of it.addresses) addresses.push({ iface: it.name, cidr: c, flags: flagsOf(it), line: it.line });
        lines(it.items, it.name);
      } else if (it.kind === "ports") {
        const untagged = it.untagged !== undefined ? ids(it.untagged, it.line)[0] : undefined;
        const tagged = it.tagged.flatMap((r) => ids(r, it.line));
        for (const p of it.names) {
          if (!claim(p, it.line)) continue;
          ifaces.push({
            name: p,
            type: "ether",
            ...br,
            ...(untagged !== undefined ? { useTag: untagged } : {}),
            ...(it.horizon !== undefined ? { horizon: it.horizon } : {}),
          });
          for (const v of tagged) {
            ifaces.push({ name: `${p}.${v}`, type: "vlan", parent: p, vlanId: v });
            table.add(`${p}.${v}`);
          }
        }
      } else if (it.kind === "vlan-iface") {
        if (!claim(it.name, it.line)) continue;
        ifaces.push({
          name: it.name,
          type: "vlan",
          ...(it.on !== undefined ? { parent: it.on } : {}),
          vlanId: it.vlan,
          ...br,
        });
        for (const c of it.addresses) addresses.push({ iface: it.name, cidr: c, flags: flagsOf(it), line: it.line });
      } else if (it.kind === "radio") {
        const rows: Iface[] = it.ifaces
          .filter((n) => claim(n, it.line))
          .map((n) => ({ name: n, type: "wifi", ...br, ...(it.tag !== undefined ? { useTag: it.tag } : {}) }));
        ifaces.push(...rows);
        let r = radioItems.find((x) => x.bridge === bridge && x.tag === it.tag);
        if (!r) {
          r = { ...br, ...(it.tag !== undefined ? { tag: it.tag } : {}), names: [], ssids: [], rows: [] };
          radioItems.push(r);
        }
        for (const row of rows) {
          r.names.push(row.name);
          r.rows.push(row);
        }
        for (const x of it.ssids) if (!r.ssids.includes(x)) r.ssids.push(x);
      } else if (it.kind === "address")
        for (const c of it.cidrs) addresses.push({ iface: it.iface, cidr: c, flags: flagsOf(it), line: it.line });
    }
  };
  lines(items);
  const byName = new Map<string, Iface>();
  for (const i of ifaces) if (!byName.has(i.name)) byName.set(i.name, i);

  const lanIp = addresses.find((a) => a.flags.lan && parseCidr(a.cidr)?.v === 4);
  const label = s.label ?? [id.toUpperCase(), s.model, lanIp?.cidr.split("/")[0], s.os].filter(Boolean).join(" · ");
  const node = mk(id, "device", "dev", label, s.note ? [s.note] : []);
  const addrsOf = (n: string) => addresses.filter((a) => a.iface === n).map((a) => a.cidr);
  // a chip lists its addresses, minus the one the device label already shows
  const chipAddrs = (n: string) => addrsOf(n).filter((c) => c !== lanIp?.cidr);
  const hasRouter = items.some((i) => i.kind === "router");
  const add = (parent: MNode, n: MNode, i?: Iface) => {
    parent.children.push(n);
    if (i) {
      ref.set(i.name, n.id);
      ifaceOf.set(n.id, i);
    }
  };

  if (wan.length) {
    const g = mk(`${id}/wan`, "group", "wan", "WAN", [], 1);
    for (const w of wan) {
      const sub = [
        w.route !== undefined || w.distance !== undefined
          ? [w.route, w.distance !== undefined && `distance ${w.distance}`].filter(Boolean).join(" · ")
          : undefined,
        w.dhcp !== undefined ? `DHCP ${w.dhcp === true ? "client" : w.dhcp}` : undefined,
        ...chipAddrs(w.iface),
      ].filter((x): x is string => !!x);
      // a WAN VLAN chip is styled by its VLAN def (render colours it like that lane)
      const vdef = vlans.find((v) => v.ids !== "untagged" && w.vlan !== undefined && v.ids.includes(w.vlan));
      const vstyle = vdef ? vlanStyle(vdef.name) : fallback("lte");
      const isVlan = w.vlan !== undefined;
      add(
        g,
        mk(child(w.iface), isVlan ? "iface" : "port", isVlan ? vstyle : "box", w.iface, sub, 1),
        byName.get(w.iface),
      );
    }
    node.children.push(g);
  }
  if (hasRouter)
    node.children.push(
      mk(
        `${id}/router`,
        "router",
        "router",
        wan.some((w) => w.nat) ? "routing · NAT · firewall" : "routing · firewall",
        [],
        2,
      ),
    );

  const groups = new Map<string, MNode>();
  for (const b of bridges) {
    // a bridge is styled by the tagged VLAN its vlan-iface members belong to
    const def = vlans.find(
      (v) =>
        v.ids !== "untagged" &&
        ifaces.some(
          (i) =>
            i.type === "vlan" &&
            i.bridge === b.name &&
            i.vlanId !== undefined &&
            (v.ids as number[]).includes(i.vlanId),
        ),
    );
    // untagged def for a plain bridge; "guest"/"lan" only when no def applies
    const untagged = vlans.find((v) => v.ids === "untagged");
    const style = def
      ? vlanStyle(def.name)
      : b.guest
        ? fallback("guest")
        : untagged
          ? vlanStyle(untagged.name)
          : fallback("lan");
    // the first IPv4 address stays in the label, else the first address; the rest become sub-lines
    const all = addrsOf(b.name),
      v4 = all.find((c) => parseCidr(c)?.v === 4) ?? all[0];
    const [cidr, ...more] = v4 === undefined ? [] : [v4, ...all.filter((c) => c !== v4)];
    const g = mk(
      child(b.name),
      "group",
      style,
      cidr ? `${b.name} · ${cidr}` : b.name,
      [...more, ...(b.hotspot ? ["hotspot"] : [])],
      3,
    );
    groups.set(b.name, g);
    node.children.push(g);
    ref.set(b.name, g.id);
  }
  // Ports first (their placement decides where vlan ifaces on top of them go), then vlan ifaces, then radios.
  const placed = new Map<string, MNode>();
  for (const i of ifaces) {
    if (i.type !== "ether" || wanNames.has(i.name)) continue;
    const parent = (i.bridge && groups.get(i.bridge)) || node;
    add(parent, mk(child(i.name), "port", "port", i.name, chipAddrs(i.name), 4), i);
    placed.set(i.name, parent);
  }
  for (const i of ifaces) {
    if (i.type !== "vlan" || wanNames.has(i.name)) continue;
    const parent =
      (i.parent && (groups.get(i.parent) ?? placed.get(i.parent))) || (i.bridge && groups.get(i.bridge)) || node;
    add(parent, mk(child(i.name), "iface", "vif", i.name, chipAddrs(i.name), 3), i);
  }
  for (const { bridge, tag, names, ssids, rows } of radioItems) {
    const r: Radio = {
      id: `${id}/radio${bridge !== undefined ? `-${esc(bridge)}` : ""}${tag !== undefined ? `-tag${tag}` : ""}`,
      ...(bridge !== undefined ? { bridge } : {}),
      ...(tag !== undefined ? { tag } : {}),
      ifaces: rows,
    };
    radios.push(r);
    // a tagged chip names its interfaces (the physical radios are shared with the untagged chip) and takes its VLAN's style
    const def = r.tag !== undefined ? vlans.find((v) => v.ids !== "untagged" && v.ids.includes(r.tag!)) : undefined;
    const label =
      r.tag !== undefined ? `${names.join(" / ")} · use-tag ${r.tag}` : [...new Set(names.map(physOf))].join(" / ");
    const n = mk(r.id, "radio", def ? vlanStyle(def.name) : "port", label, ssids.length ? [ssids.join(" · ")] : [], 4);
    ((bridge !== undefined && groups.get(bridge)) || node).children.push(n);
    for (const i of names) ref.set(i, r.id);
  }
  const leases = items.flatMap((i) =>
    i.kind === "lease" ? [{ address: i.address, ...(i.comment !== undefined ? { comment: i.comment } : {}) }] : [],
  );
  const allows = items.filter((i): i is Extract<DevItem, { kind: "allow" }> => i.kind === "allow");
  return {
    id,
    line: s.line,
    node,
    ref,
    ifaceOf,
    radios,
    hasRouter,
    ifaces,
    table,
    wan,
    addresses,
    leases,
    allows,
    wanRoutes,
    hidden: new Set(),
  };
}
