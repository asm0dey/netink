import { readFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { parseDsl } from "../dsl/parse";
import { importRsc } from "../rsc/import";
import { closest } from "./check";
import { deriveArrows } from "./l3";
import type { DeviceFacts, Diag, MArrow, Endpoint, Hint, Iface, LegendSpec, MLink, MNode, Model, Stmt, VlanDef } from "../types";

type Opts = { all?: boolean; file?: string };
type NodeStmt = Extract<Stmt, { kind: "node" }>;
type LinkStmt = Extract<Stmt, { kind: "link" }>;
/** A resolved link endpoint. `dev` is set for ends inside an imported device. */
type End = { id: string; dev?: Dev; iface?: Iface; nodeType?: NodeStmt["type"] };
/** One chip per bridge and VLAN tag: radios on a `use-tag` get their own chip, apart from the bridge's untagged ones. */
type Radio = { id: string; bridge?: string; tag?: number; phys: string[]; ssids: string[]; ifaces: Iface[] };
type Dev = { id: string; f: DeviceFacts; node: MNode; ref: Map<string, string>; ifaceOf: Map<string, Iface>; radios: Radio[]; hasRouter: boolean;
  /** WAN member name → distance of the default route matched to it. */ wanRoutes: Map<string, number>;
  /** Port names pruned from the drawing (unlinked, router-less device); dropped from `ref`. */ hidden: Set<string> };

/** VLAN-derived node styles live under `vlan:<name>`, so a VLAN named like a built-in style (wan, dev, spare) cannot be drawn as one. */
export const vlanStyle = (name: string): string => `vlan:${name}`;
export const laneOfStyle = (style: string): string | undefined => style.startsWith("vlan:") ? style.slice(5) : undefined;
/** A fallback style (guest/lan/lte) still takes the colours of a VLAN def of the same name. */
const fallbackIn = (vlans: VlanDef[]) => (name: string): string => vlans.some((v) => v.name === name) ? vlanStyle(name) : name;
const mk = (id: string, kind: MNode["kind"], style: string, label: string, sub: string[] = [], tier = 0): MNode =>
  ({ id, kind, style, label, sub, children: [], tier });
const ID_RE = /^[a-z0-9_-]+$/;
const HIDDEN_HINT = "unlinked ports on devices without a router are hidden; use --all";
const isRadio = (i: Iface) => i.type === "wifi" || i.type === "wireless";
// shortcut: the physical radio is read from the name (wifi1-iot → wifi1) because facts keep no master-interface; upgrade if names diverge.
const physOf = (n: string) => n.match(/^(cap-)?(wifi|wlan)\d+/)?.[0] ?? n;
const ipNum = (ip: string) => ip.split(".").reduce((a, o) => a * 256 + Number(o), 0);
function inCidr(ip: string, cidr?: string): boolean {
  if (!cidr || !/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return false;
  const [net, len] = cidr.split("/");
  const size = 2 ** (32 - Number(len ?? 32));
  return Math.floor(ipNum(ip) / size) === Math.floor(ipNum(net!) / size);
}
const leaves = (n: MNode): MNode[] => (n.children.length ? n.children.flatMap(leaves) : [n]);
const walk = (ns: MNode[]): MNode[] => ns.flatMap((n) => [n, ...walk(n.children)]);

function collectRadios(id: string, f: DeviceFacts): Radio[] {
  const out: Radio[] = [];
  for (const i of f.ifaces) {
    if (!isRadio(i) || i.name.startsWith("cap-") || (f.lists.WAN ?? []).includes(i.name)) continue;
    let r = out.find((x) => x.bridge === i.bridge && x.tag === i.useTag);
    if (!r) out.push((r = { id: `${id}/radio${i.bridge ? "-" + i.bridge : ""}${i.useTag !== undefined ? "-tag" + i.useTag : ""}`, bridge: i.bridge, ...(i.useTag !== undefined ? { tag: i.useTag } : {}), phys: [], ssids: [], ifaces: [] }));
    r.ifaces.push(i);
    if (!r.phys.includes(physOf(i.name))) r.phys.push(physOf(i.name));
    if (i.ssid && !r.ssids.includes(i.ssid)) r.ssids.push(i.ssid);
  }
  return out;
}

/** CAPsMAN `cap-*` radios move to the imported device holding a radio with one of their MACs. */
function placeCaps(devs: { id: string; f: DeviceFacts; radios: Radio[] }[], warn: (file: string, msg: string, hint: string) => void) {
  for (const d of devs) {
    const caps = new Map<string, Iface[]>();
    for (const i of d.f.ifaces) if (isRadio(i) && i.name.startsWith("cap-")) caps.set(physOf(i.name), [...(caps.get(physOf(i.name)) ?? []), i]);
    for (const [phys, members] of caps) {
      const macs = members.flatMap((m) => [m.radioMac, m.mac]).filter((x): x is string => !!x).map((x) => x.toLowerCase());
      const radio = devs.filter((o) => o !== d).flatMap((o) => o.radios)
        .find((r) => r.ifaces.some((i) => [i.mac, i.radioMac].some((x) => x && macs.includes(x.toLowerCase()))));
      if (!radio) { warn(d.f.file, `${d.id}: CAPsMAN radio ${phys} matches no imported device's radio MAC (${macs.join(", ")}); not drawn`, "import the CAP's export so the radio lands in its box"); continue; }
      for (const m of members) if (m.ssid && !radio.ssids.includes(m.ssid)) radio.ssids.push(m.ssid);
    }
  }
}

function buildDevice(id: string, f: DeviceFacts, radios: Radio[], vlans: VlanDef[]): Dev {
  const fallback = fallbackIn(vlans);
  const ref = new Map<string, string>(), ifaceOf = new Map<string, Iface>(), wanRoutes = new Map<string, number>();
  const byName = new Map(f.ifaces.map((i) => [i.name, i]));
  const wan = f.lists.WAN ?? [];
  const lanIp = f.addresses.find((a) => (f.lists.LAN ?? []).includes(a.iface));
  const label = [id.toUpperCase(), f.model, lanIp?.cidr.split("/")[0], f.version && `RouterOS ${f.version}`].filter(Boolean).join(" · ");
  const node = mk(id, "device", "dev", label);
  const bridges = f.ifaces.filter((i) => i.type === "bridge" && !wan.includes(i.name));
  const addrOf = (n: string) => f.addresses.find((a) => a.iface === n)?.cidr;
  const hasRouter = f.masqueradeOutLists.length > 0 || bridges.filter((b) => addrOf(b.name)).length > 1;
  const add = (parent: MNode, n: MNode, i?: Iface) => { parent.children.push(n); if (i) { ref.set(i.name, n.id); ifaceOf.set(n.id, i); } };

  if (wan.length) {
    const g = mk(`${id}/wan`, "group", "wan", "WAN list", [], 1);
    const defaults = f.routes.filter((r) => r.dst === "0.0.0.0/0").sort((a, b) => a.distance - b.distance);
    const used = new Set<object>();
    const routeFor = (i: Iface) => {
      const sub = vlans.find((v) => v.ids !== "untagged" && i.vlanId !== undefined && v.ids.includes(i.vlanId))?.subnet;
      return defaults.find((r) => !used.has(r) && (r.gateway === i.name || inCidr(r.gateway, addrOf(i.name)) || inCidr(r.gateway, sub)));
    };
    const ifs = wan.map((n) => byName.get(n) ?? { name: n, type: "other" as const });
    const routes = new Map(ifs.map((i) => { const r = routeFor(i); if (r) used.add(r); return [i, r] as const; }));
    // shortcut: a WAN iface whose gateway is not in any known subnet takes the next unused default route by distance; upgrade if route→iface gets recorded in facts.
    for (const i of ifs) if (!routes.get(i)) { const r = defaults.find((x) => !used.has(x)); if (r) { used.add(r); routes.set(i, r); } }
    for (const i of ifs) {
      const r = routes.get(i), dhcp = f.dhcpClients.find((c) => c.iface === i.name);
      if (r) wanRoutes.set(i.name, r.distance);
      const sub = [r && `${r.comment ?? r.dst} · distance ${r.distance}`, dhcp && `DHCP ${dhcp.address ?? "client"}`].filter((s): s is string => !!s);
      // a WAN VLAN chip is styled by its VLAN def (render colours it like that lane)
      const vdef = vlans.find((v) => v.ids !== "untagged" && i.vlanId !== undefined && v.ids.includes(i.vlanId));
      const vstyle = vdef ? vlanStyle(vdef.name) : fallback("lte");
      add(g, mk(`${id}/${i.name}`, i.type === "vlan" ? "iface" : "port", i.type === "vlan" ? vstyle : "box", i.name, sub, 1), i);
    }
    node.children.push(g);
  }
  if (hasRouter) node.children.push(mk(`${id}/router`, "router", "router", "routing · NAT · firewall", [], 2));

  const groups = new Map<string, MNode>();
  for (const b of bridges) {
    const guest = f.hotspots.includes(b.name) || (f.lists.GUEST ?? []).includes(b.name);
    // a bridge is styled by the tagged VLAN its vlan-iface members belong to
    const def = vlans.find((v) => v.ids !== "untagged" && f.ifaces.some((i) => i.type === "vlan" && i.bridge === b.name && i.vlanId !== undefined && (v.ids as number[]).includes(i.vlanId)));
    // untagged def for a plain bridge; "guest"/"lan" only when no def applies
    const untagged = vlans.find((v) => v.ids === "untagged");
    const style = def ? vlanStyle(def.name) : guest ? fallback("guest") : untagged ? vlanStyle(untagged.name) : fallback("lan");
    const cidr = addrOf(b.name);
    const g = mk(`${id}/${b.name}`, "group", style, cidr ? `${b.name} · ${cidr}` : b.name, f.hotspots.includes(b.name) ? ["hotspot"] : [], 3);
    groups.set(b.name, g);
    node.children.push(g);
    ref.set(b.name, g.id);
  }
  // Ports first (their placement decides where vlan ifaces on top of them go), then vlan ifaces, then radios.
  const placed = new Map<string, MNode>();
  for (const i of f.ifaces) {
    if (wan.includes(i.name) || i.type === "bridge" || i.type === "vlan" || isRadio(i)) continue;
    if (i.type !== "ether" && !i.bridge) continue;
    const parent = (i.bridge && groups.get(i.bridge)) || node;
    add(parent, mk(`${id}/${i.name}`, "port", "port", i.name, [], 4), i);
    placed.set(i.name, parent);
  }
  for (const i of f.ifaces) {
    if (i.type !== "vlan" || wan.includes(i.name)) continue;
    const parent = (i.parent && (groups.get(i.parent) ?? placed.get(i.parent))) || node;
    add(parent, mk(`${id}/${i.name}`, "iface", "vif", i.name, [], 3), i);
  }
  for (const r of radios) {
    // a tagged chip names its interfaces (the physical radios are shared with the untagged chip) and takes its VLAN's style
    const def = r.tag !== undefined ? vlans.find((v) => v.ids !== "untagged" && v.ids.includes(r.tag!)) : undefined;
    const label = r.tag !== undefined ? `${r.ifaces.map((i) => i.name).join(" / ")} · use-tag ${r.tag}` : r.phys.join(" / ");
    const n = mk(r.id, "radio", def ? vlanStyle(def.name) : "port", label, r.ssids.length ? [r.ssids.join(" · ")] : [], 4);
    ((r.bridge && groups.get(r.bridge)) || node).children.push(n);
    for (const i of r.ifaces) ref.set(i.name, r.id);
  }
  return { id, f, node, ref, ifaceOf, radios, hasRouter, wanRoutes, hidden: new Set() };
}

export function buildModel(stmts: Stmt[], facts: Map<string, DeviceFacts>, opts: Opts = {}): Model {
  const file = opts.file ?? "";
  const diags: Diag[] = [];
  const err = (line: number, message: string, hint?: string) => diags.push({ level: "error", file, line, message, ...(hint ? { hint } : {}) });
  const of = <K extends Stmt["kind"]>(k: K) => stmts.filter((s): s is Extract<Stmt, { kind: K }> => s.kind === k);

  const vlans: VlanDef[] = of("vlan").map((v) => ({ name: v.name, ids: v.ids, color: v.color ?? "grey", ...(v.subnet ? { subnet: v.subnet } : {}) }));
  const vlanName = (id?: number) => vlans.find((v) => v.ids !== "untagged" && id !== undefined && v.ids.includes(id))?.name;
  const untagged = vlans.filter((v) => v.ids === "untagged").map((v) => v.name);

  const badId = (id: string, line: number) => { if (!ID_RE.test(id)) err(line, `bad id "${id}"`, "ids use a-z, 0-9, _ and -"); };
  for (const s of stmts) { if (s.kind === "node") badId(s.id, s.line); if (s.kind === "import") badId(s.as, s.line); }

  // Imported devices
  const seen = new Set<string>();
  const imports = of("import").filter((s) => {
    if (seen.has(s.as)) { err(s.line, `"${s.as}" is imported twice`, "give each import its own alias"); return false; }
    seen.add(s.as);
    if (facts.has(s.as)) return true;
    err(s.line, `no facts loaded for import "${s.as}"`);
    return false;
  });
  const pre = imports.map((s) => ({ id: s.as, f: facts.get(s.as)!, radios: collectRadios(s.as, facts.get(s.as)!) }));
  placeCaps(pre, (f, message, hint) => diags.push({ level: "warning", file: f, line: 0, message, hint }));
  const devs = new Map(pre.map((p) => [p.id, buildDevice(p.id, p.f, p.radios, vlans)]));

  // Nodes in declaration order
  const nodes: MNode[] = [], nodeType = new Map<string, NodeStmt["type"]>();
  const declaredLeases = new Set<string>(), leaseOf = new Map<string, string>();
  for (const s of stmts) {
    if (s.kind === "import" && imports.includes(s)) nodes.push(devs.get(s.as)!.node);
    if (s.kind !== "node") continue;
    const d = devs.get(s.id);
    if (d) { if (s.label) d.node.label = s.label; if (s.note) d.node.sub.push(s.note); continue; }
    if (nodeType.has(s.id)) { err(s.line, `duplicate node "${s.id}"`); continue; }
    nodeType.set(s.id, s.type);
    let label = s.label ?? s.id;
    const sub: string[] = [];
    if (s.lease) {
      const owner = [...devs.values()].find((x) => x.f.leases.some((l) => l.address === s.lease));
      const lease = owner?.f.leases.find((l) => l.address === s.lease);
      if (owner) declaredLeases.add(`${owner.id} ${s.lease}`);
      else diags.push({ level: "warning", file, line: s.line, message: `no imported device has a lease for ${s.lease}` });
      label = s.label ?? lease?.comment ?? s.lease;
      sub.push(s.lease);
    }
    if (s.note) sub.push(s.note);
    nodes.push(mk(s.id, s.type, s.type === "cloud" ? "cloud" : "box", label, sub));
    if (s.lease) leaseOf.set(s.id, s.lease);
  }
  if (opts.all) for (const d of devs.values()) for (const l of d.f.leases) {
    if (declaredLeases.has(`${d.id} ${l.address}`)) continue;
    declaredLeases.add(`${d.id} ${l.address}`);
    const base = `${d.id}-${l.address.replace(/\W/g, "-")}`;
    let id = base;
    for (let n = 2; nodeType.has(id) || devs.has(id); n++) id = `${base}-${n}`;
    nodeType.set(id, "client");
    nodes.push(mk(id, "client", "box", l.comment ?? l.address, [l.address]));
    leaseOf.set(id, l.address);
  }

  // Endpoints: ports first, so a bare device id can resolve to its single unlinked port.
  const links = of("link");
  const resolve = (e: Endpoint, line: number): End | "bare" | undefined => {
    const d = devs.get(e.node);
    if (d) {
      if (!e.port) return "bare";
      const id = d.ref.get(e.port);
      if (!id && d.hidden.has(e.port)) { err(line, `${e.node}.${e.port} is not drawn`, HIDDEN_HINT); return undefined; }
      if (!id) { const c = closest(e.port, d.ref.keys()); err(line, `${e.node} has no interface "${e.port}"`, c && `did you mean ${e.node}.${c}?`); return undefined; }
      return { id, dev: d, iface: d.ifaceOf.get(id) ?? d.f.ifaces.find((i) => i.name === e.port) };
    }
    if (!nodeType.has(e.node)) { const c = closest(e.node, [...nodeType.keys(), ...devs.keys()]); err(line, `unknown node "${e.node}"`, c ? `did you mean ${c}?` : "declare it with cloud, device or client, or import it"); return undefined; }
    if (e.port) { err(line, `"${e.node}" is not imported, so it has no port "${e.port}"`, `link ${e.node} without a port`); return undefined; }
    return { id: e.node, nodeType: nodeType.get(e.node) };
  };
  const ends = links.map((l) => l.path.map((e) => resolve(e, l.line)));
  const linked = new Set(ends.flat().filter((e): e is End => typeof e === "object").map((e) => e.id));
  ends.forEach((pair, k) => pair.forEach((e, j) => {
    if (e !== "bare") return;
    const name = links[k]!.path[j]!.node, d = devs.get(name)!;
    const free = leaves(d.node).filter((n) => n.kind === "port" && !linked.has(n.id));
    if (free.length !== 1) { err(links[k]!.line, `${name} has ${free.length} unlinked ports; name one`, `e.g. ${name}.${free[0]?.label ?? "ether1"}`); pair[j] = undefined; return; }
    linked.add(free[0]!.id);
    pair[j] = { id: free[0]!.id, dev: d, iface: d.ifaceOf.get(free[0]!.id) };
  }));

  for (const l of links) for (const name of l.vlans ?? [])
    if (!vlans.some((x) => x.name === name)) err(l.line, `unknown vlan "${name}"`, `declare it with vlan ${name} <ids>`);

  // Tagged-VLAN reachability. A link carries v iff, with that link removed, a consumer of v is reachable from
  // each end, walking other links and bridges that forward v. Ends without facts neither consume nor forward.
  const adj = new Map<string, { k: number; to: End }[]>();
  ends.forEach((pair, k) => {
    const [a, b] = pair as (End | undefined)[];
    if (a && b) for (const [x, y] of [[a, b], [b, a]] as const) adj.set(x.id, [...(adj.get(x.id) ?? []), { k, to: y }]);
  });
  const radioOf = (e: End) => e.dev?.radios.find((r) => r.id === e.id);
  const bridgeOf = (e: End) => radioOf(e)?.bridge ?? (e.iface?.type === "vlan" ? undefined : e.iface?.bridge);
  const byName = (d: Dev, n: string) => d.f.ifaces.find((x) => x.name === n);
  // shortcut: `/interface bridge vlan` rows are imported as `<port>.<id>` vlan ifaces; on a bridge port they are VLAN-table rows, not consumers. Upgrade if facts keep the table separately.
  const isTable = (d: Dev, x: Iface) => x.parent !== undefined && x.name === `${x.parent}.${x.vlanId}` && !!byName(d, x.parent)?.bridge;
  const consumes = (e: End, v: number): boolean => {
    const d = e.dev, i = e.iface;
    if (!d) return false;
    if (i?.type === "vlan") return i.vlanId === v;
    const r = radioOf(e), br = bridgeOf(e), port = r ? undefined : i?.name;
    if (r?.ifaces.some((x) => x.useTag === v)) return true;
    // on a vlan-filtering bridge, the bridge's own vlan iface reaches only ports listed for v
    const viaBridge = br !== undefined && (!byName(d, br)?.vlanFiltering || listed(e, v));
    return d.f.ifaces.some((x) => (x.type === "vlan" && x.vlanId === v && !isTable(d, x) && (x.parent === port || (viaBridge && x.parent === br)))
      || (br !== undefined && isRadio(x) && x.bridge === br && x.useTag === v));
  };
  const listed = (e: End, v: number) => {
    const r = radioOf(e);
    if (r) return r.ifaces.some((x) => x.useTag === v);
    const n = e.iface!.name;
    return e.iface!.useTag === v || e.dev!.f.ifaces.some((x) => x.type === "vlan" && x.parent === n && x.vlanId === v);
  };
  const siblings = (e: End, v: number): End[] => {
    const d = e.dev, br = bridgeOf(e);
    if (!d || br === undefined) return [];
    const filtering = byName(d, br)?.vlanFiltering;
    if (filtering && !listed(e, v)) return [];
    const ports = leaves(d.node).filter((n) => n.kind === "port" && d.ifaceOf.get(n.id)?.bridge === br).map((n) => ({ id: n.id, dev: d, iface: d.ifaceOf.get(n.id) }));
    const radios = d.radios.filter((r) => r.bridge === br).map((r) => ({ id: r.id, dev: d, iface: r.ifaces[0] }));
    return [...ports, ...radios].filter((x) => x.id !== e.id && (!filtering || listed(x, v)));
  };
  const reaches = (start: End, v: number, skip: number): boolean => {
    const seen = new Set([start.id]), queue = [start];
    for (let e = queue.shift(); e; e = queue.shift()) {
      if (!e.dev) continue;
      if (consumes(e, v)) return true;
      for (const n of [...siblings(e, v), ...(adj.get(e.id) ?? []).filter((x) => x.k !== skip).map((x) => x.to)])
        if (!seen.has(n.id)) { seen.add(n.id); queue.push(n); }
    }
    return false;
  };
  const member = (e: End) => !e.dev || !!e.iface?.bridge || !!radioOf(e);
  /** Lanes the facts imply for link k, and the tagged ids it carries (which vlan ifaces a trunk port feeds). */
  /** With `forCheck`, a fact-less end accepts every tagged id, so `inferred` judges only the ends we have facts for. */
  const infer = (a: End, b: End, k: number, forCheck = false): { lanes: string[]; ids: number[] } => {
    if (!a.dev && !b.dev) return { lanes: ["wire"], ids: [] };
    const all = [...new Set(vlans.flatMap((v) => (v.ids === "untagged" ? [] : v.ids)))].sort((x, y) => x - y);
    const ok = (e: End, v: number) => (forCheck && !e.dev) || reaches(e, v, k);
    const ids = all.filter((v) => ok(a, v) && ok(b, v));
    const lanes = vlans.filter((v) => (v.ids === "untagged" ? member(a) && member(b) : v.ids.some((id) => ids.includes(id)))).map((v) => v.name);
    return { lanes: lanes.length ? lanes : ["wire"], ids };
  };

  const out: MLink[] = [];
  const linkId = (from: string, to: string) => {
    let id = `${from}--${to}`;
    for (let n = 2; out.some((l) => l.id === id); n++) id = `${from}--${to}#${n}`;
    return id;
  };
  const push = (from: string, to: string, lanes: string[], line: number, label?: string) =>
    out.push({ id: linkId(from, to), from, to, lanes, ...(label ? { label } : {}), line });
  const trunkIds = new Map<string, Set<number>>();
  const portUse = new Map<string, number>();
  ends.forEach((pair, k) => {
    const [a, b] = pair as (End | undefined)[], l: LinkStmt = links[k]!;
    if (!a || !b) return;
    let r = infer(a, b, k), inferred: string[] | undefined;
    for (const e of [a, b]) if (e.dev && e.iface && !isRadio(e.iface)) { // radios legitimately take many client links
      if (portUse.has(e.id)) err(l.line, `${e.id} is already linked on line ${portUse.get(e.id)}`, "a port takes one link; use a switch or another port");
      else portUse.set(e.id, l.line);
    }
    if (l.vlans) {
      if (a.dev || b.dev) inferred = infer(a, b, k, true).lanes;
      const defs = vlans.filter((v) => l.vlans!.includes(v.name)); // unknown names were reported above
      r = { lanes: defs.length ? defs.map((v) => v.name) : ["wire"], ids: defs.flatMap((v) => (v.ids === "untagged" ? [] : v.ids)) };
    }
    for (const e of [a, b]) trunkIds.set(e.id, new Set([...(trunkIds.get(e.id) ?? []), ...r.ids]));
    push(a.id, b.id, r.lanes, l.line, l.label);
    if (inferred) out.at(-1)!.inferred = inferred;
  });

  // Internal links: trunk port → vlan iface it carries, vlan iface → the bridge it is a member of, uplink port → radio (no router).
  const importLine = new Map(imports.map((s) => [s.as, s.line]));
  for (const d of devs.values()) {
    const line = importLine.get(d.id)!;
    const vifs = d.f.ifaces.filter((i) => i.type === "vlan" && d.ref.has(i.name));
    for (const p of leaves(d.node).filter((n) => n.kind === "port" && linked.has(n.id))) {
      const i = d.ifaceOf.get(p.id)!;
      if ((d.f.lists.WAN ?? []).includes(i.name)) continue;
      const ids = trunkIds.get(p.id) ?? new Set();
      for (const v of vifs) {
        const name = vlanName(v.vlanId);
        if (name && ids.has(v.vlanId!) && (v.parent === i.name || (i.bridge && v.parent === i.bridge))) push(p.id, d.ref.get(v.name)!, [name], line);
      }
    }
    for (const v of vifs) {
      const g = v.bridge && d.ref.get(v.bridge);
      if (g && g !== d.ref.get(v.parent ?? "")) push(d.ref.get(v.name)!, g, [vlanName(v.vlanId) ?? "wire"], line);
    }
    const bridged = (r: Radio) => leaves(d.node).filter((n) => n.kind === "port" && linked.has(n.id) && !!r.bridge && d.ifaceOf.get(n.id)?.bridge === r.bridge);
    for (const r of d.radios) {
      if (r.tag !== undefined) { // a tagged chip ends that VLAN's lane of every trunk port on its bridge that carries the tag
        const name = vlanName(r.tag);
        if (name) for (const p of bridged(r)) if (trunkIds.get(p.id)?.has(r.tag)) push(p.id, r.id, [name], line);
      } else if (!d.hasRouter) {
        const up = bridged(r)[0];
        if (up) push(up.id, r.id, untagged.length ? untagged : ["wire"], line);
      }
    }
    const spare = (p: MNode) => p.kind === "port" && !linked.has(p.id) && !!d.ifaceOf.get(p.id)?.bridge && !(d.f.lists.WAN ?? []).includes(d.ifaceOf.get(p.id)!.name);
    // A router shows its free ports as spare; on a router-less device (an AP) they are noise unless --all.
    const prune = (n: MNode) => {
      n.children = n.children.filter((c) => { if (!spare(c)) return true; const name = d.ifaceOf.get(c.id)!.name; d.ref.delete(name); d.hidden.add(name); return false; });
      n.children.forEach(prune);
    };
    if (d.hasRouter || opts.all) for (const p of leaves(d.node)) { if (spare(p)) p.style = "spare"; }
    else prune(d.node);
  }

  const ids = new Set<string>();
  for (const n of walk(nodes)) {
    if (ids.has(n.id)) err(0, `duplicate node id "${n.id}"`, "rename the interface or node so ids stay unique");
    ids.add(n.id);
  }

  // Hints must name a known node (or a port of one)
  const known = new Set([...ids, ...nodeType.keys()]);
  const isHidden = (n: string) => { const [d, p] = n.split(".", 2) as [string, string | undefined]; return p !== undefined && !!devs.get(d)?.hidden.has(p); };
  for (const s of of("hint")) {
    const h = s.hint, names = h.type === "near" ? [h.a, h.b] : h.type === "row" ? h.ids : [h.device];
    for (const n of names) if (isHidden(n)) err(s.line, `${h.type === "near" ? "place" : h.type} names ${n}, which is not drawn`, HIDDEN_HINT);
    else if (!known.has(n) && !known.has(n.split(".")[0]!)) { const c = closest(n, known); err(s.line, `${h.type === "near" ? "place" : h.type} names unknown node "${n}"`, c ? `did you mean ${c}?` : undefined); }
  }

  // Notes
  for (const s of of("note")) {
    const [n, port] = s.target.split(".", 2) as [string, string | undefined];
    const id = port ? devs.get(n)?.ref.get(port) : n;
    const target = id && walk(nodes).find((x) => x.id === id);
    if (target) target.sub.push(s.text);
    else if (isHidden(s.target)) err(s.line, `note target "${s.target}" is not drawn`, HIDDEN_HINT);
    else err(s.line, `note target "${s.target}" not found`);
  }

  // Tiers: imported children are fixed by kind; other nodes by BFS — downstream of an imported device's LAN side (5 + hops), else from clouds.
  for (const d of devs.values()) {
    for (const g of d.node.children) if (g.kind === "group" && g.children.length) g.tier = Math.min(g.tier, ...g.children.map((c) => c.tier));
    d.node.tier = d.node.children.length ? Math.min(...d.node.children.map((c) => c.tier)) : 4;
  }
  const tier = new Map(walk(nodes).filter((n) => devs.has(n.id.split("/")[0]!)).map((n) => [n.id, n.tier]));
  const free = nodes.filter((n) => !devs.has(n.id));
  const nbrs = (id: string) => out.flatMap((l) => (l.from === id ? [l.to] : l.to === id ? [l.from] : []));
  const bfs = (seed: string[], start: number) => {
    let front = seed.filter((id) => !tier.has(id));
    for (let t = start; front.length; t++) {
      front.forEach((id) => tier.set(id, t));
      front = [...new Set(front.flatMap(nbrs))].filter((id) => !tier.has(id) && nodeType.get(id) !== "cloud").sort();
    }
  };
  free.filter((n) => n.kind === "cloud").forEach((n) => tier.set(n.id, 0));
  bfs(free.filter((n) => n.kind !== "cloud" && nbrs(n.id).some((x) => (tier.get(x) ?? -1) >= 3 && devs.has(x.split("/")[0]!))).map((n) => n.id), 5);
  const before = new Set(tier.keys());
  bfs([...new Set(free.filter((n) => n.kind === "cloud").flatMap((n) => nbrs(n.id)))].sort(), 1);
  // Upstream nodes (reached from clouds) sit strictly between the clouds (0) and the WAN chips (1): hop h of H becomes h/(H+1).
  const up = [...tier].filter(([id, t]) => !before.has(id));
  const hops = Math.max(0, ...up.map(([, t]) => t));
  for (const [id, t] of up) tier.set(id, t / (hops + 1));
  for (const n of free) n.tier = tier.get(n.id) ?? 5;
  for (const l of out) if ((tier.get(l.from) ?? 0) > (tier.get(l.to) ?? 0)) [l.from, l.to] = [l.to, l.from];

  // L3 arrows: derived per device, then DSL route/allow, then hide (arrow id or node id).
  const arrows: MArrow[] = [...devs.values()].flatMap((d) => deriveArrows(d.id, d.f, nodes, d.wanRoutes, leaseOf));
  const arrowEnd = (id: string, line: number) => {
    const [node, port] = id.split(".", 2) as [string, string | undefined];
    const r = resolve({ node, ...(port ? { port } : {}) }, line);
    return r === "bare" ? node : r?.id;
  };
  for (const s of stmts) {
    if (s.kind === "route" || s.kind === "allow") {
      const from = arrowEnd(s.from, s.line), to = arrowEnd(s.to, s.line);
      if (!from || !to) continue;
      const id = `${s.kind}:${from}->${to}`;
      if (!arrows.some((a) => a.id === id)) arrows.push({ id, from, to, kind: s.kind, ...(s.label ? { label: s.label } : {}) });
    }
  }
  const arrowTier = (id: string) => tier.get(id) ?? 0;
  // route arrows are double-headed, so tier order is free; allow is one-way (head on `to`) and keeps its direction
  for (const a of arrows) if (a.kind === "route" && arrowTier(a.from) > arrowTier(a.to)) [a.from, a.to] = [a.to, a.from];
  for (const s of of("hide")) {
    const t = s.target.replace(".", "/");
    const hit = arrows.filter((a) => a.id === s.target || a.from === t || a.to === t);
    if (!hit.length) err(s.line, `hide target "${s.target}" matches no arrow or node`, "use an arrow id like route:core/router->core/bridge or a node id");
    for (const a of hit) arrows.splice(arrows.indexOf(a), 1);
  }

  const legend: LegendSpec = { mode: "auto", add: [], remove: [], notes: [], position: "bottom" };
  for (const s of of("legend")) {
    if (s.op === "auto" || s.op === "off") legend.mode = s.op;
    else if (s.op === "add") legend.add.push({ style: s.style!, text: s.arg! });
    else if (s.op === "remove") legend.remove.push(s.arg!);
    else if (s.op === "note") legend.notes.push(s.arg!);
    else legend.position = s.arg as LegendSpec["position"];
  }
  // Hints reach layout in node-id form: `dev.port` → its port id, a side's group → `dev/group`.
  const ref = (n: string) => { const [d, p] = n.split(".", 2) as [string, string | undefined]; return p === undefined ? n : devs.get(d)?.ref.get(p) ?? `${d}/${p}`; };
  const normHint = (h: Hint): Hint => h.type === "near" ? { ...h, a: ref(h.a), b: ref(h.b) } : h.type === "row" ? { ...h, ids: h.ids.map(ref) }
    : { ...h, group: devs.get(h.device)?.ref.get(h.group) ?? `${h.device}/${h.group}` };
  const text = (k: "title" | "subtitle") => stmts.filter((s): s is Extract<Stmt, { text: string }> => s.kind === k).at(-1)?.text;
  const subtitle = text("subtitle");
  return {
    title: text("title") ?? "", ...(subtitle !== undefined ? { subtitle } : {}),
    nodes, links: out, arrows, vlans, legend,
    jumps: of("style").at(-1)?.value ?? "arc", hints: of("hint").map((s): Hint => normHint(s.hint)), diags, ...(opts.file !== undefined ? { file: opts.file } : {}),
  };
}

export function loadModel(file: string, opts: { all?: boolean } = {}): Model {
  const { stmts, diags } = parseDsl(readFileSync(file, "utf8"), file);
  const facts = new Map<string, DeviceFacts>();
  for (const s of stmts) {
    if (s.kind !== "import") continue;
    // not resolve(): relative imports keep relative paths in diagnostics
    const path = isAbsolute(s.file) ? s.file : join(dirname(file), s.file);
    let text: string;
    try { text = readFileSync(path, "utf8"); }
    catch { diags.push({ level: "error", file, line: s.line, message: `cannot read ${s.file}`, hint: "paths are relative to the .net file" }); continue; }
    const f = importRsc(text, path, s.as);
    facts.set(s.as, f);
    diags.push(...f.warnings);
  }
  const m = buildModel(stmts, facts, { ...opts, file });
  m.diags = [...diags, ...m.diags];
  return m;
}
