import { physOf } from "../model/style";
import type { DevItem, DeviceFacts, Diag, IfFlags, Iface, Stmt, VlanDef } from "../types";

type NodeStmt = Extract<Stmt, { kind: "node" }>;
type Route = DeviceFacts["routes"][number];
/** One chip per bridge and VLAN tag: radios on a `use-tag` get their own chip, apart from the bridge's untagged ones. */
type Radio = { bridge?: string; tag?: number; ssids: string[]; ifaces: Iface[] };

const isRadio = (i: Iface) => i.type === "wifi" || i.type === "wireless";
const ipNum = (ip: string) => ip.split(".").reduce((a, o) => a * 256 + Number(o), 0);
function inCidr(ip: string, cidr?: string): boolean {
  if (!cidr || !/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return false;
  const [net, len] = cidr.split("/");
  const size = 2 ** (32 - Number(len ?? 32));
  return Math.floor(ipNum(ip) / size) === Math.floor(ipNum(net!) / size);
}

function collectRadios(f: DeviceFacts): Radio[] {
  const out: Radio[] = [];
  for (const i of f.ifaces) {
    if (!isRadio(i) || i.name.startsWith("cap-") || (f.lists.WAN ?? []).includes(i.name)) continue;
    let r = out.find((x) => x.bridge === i.bridge && x.tag === i.useTag);
    if (!r)
      out.push((r = { bridge: i.bridge, ...(i.useTag !== undefined ? { tag: i.useTag } : {}), ssids: [], ifaces: [] }));
    r.ifaces.push(i);
    if (i.ssid && !r.ssids.includes(i.ssid)) r.ssids.push(i.ssid);
  }
  return out;
}

/** CAPsMAN `cap-*` radios move to the imported device holding a radio with one of their MACs. */
function placeCaps(
  devs: { id: string; f: DeviceFacts; radios: Radio[] }[],
  warn: (file: string, msg: string, hint: string) => void,
) {
  for (const d of devs) {
    const caps = new Map<string, Iface[]>();
    for (const i of d.f.ifaces)
      if (isRadio(i) && i.name.startsWith("cap-")) caps.set(physOf(i.name), [...(caps.get(physOf(i.name)) ?? []), i]);
    for (const [phys, members] of caps) {
      const macs = members
        .flatMap((m) => [m.radioMac, m.mac])
        .filter((x): x is string => !!x)
        .map((x) => x.toLowerCase());
      const radio = devs
        .filter((o) => o !== d)
        .flatMap((o) => o.radios)
        .find((r) => r.ifaces.some((i) => [i.mac, i.radioMac].some((x) => x && macs.includes(x.toLowerCase()))));
      if (!radio) {
        warn(
          d.f.file,
          `${d.id}: CAPsMAN radio ${phys} matches no imported device's radio MAC (${macs.join(", ")}); not drawn`,
          "import the CAP's export so the radio lands in its box",
        );
        continue;
      }
      for (const m of members) if (m.ssid && !radio.ssids.includes(m.ssid)) radio.ssids.push(m.ssid);
    }
  }
}

const bridgesOf = (f: DeviceFacts) =>
  f.ifaces.filter((i) => i.type === "bridge" && !(f.lists.WAN ?? []).includes(i.name));
const addrOf = (f: DeviceFacts, n: string) => f.addresses.find((a) => a.iface === n)?.cidr;
const hasRouter = (f: DeviceFacts) =>
  f.masqueradeOutLists.length > 0 || bridgesOf(f).filter((b) => addrOf(f, b.name)).length > 1;

/** The default route matched to each WAN member, aligned with `lists.WAN`. */
function wanRoutes(f: DeviceFacts, vlans: VlanDef[]): { iface: Iface; route?: Route }[] {
  const byName = new Map(f.ifaces.map((i) => [i.name, i]));
  const defaults = f.routes.filter((r) => r.dst === "0.0.0.0/0").sort((a, b) => a.distance - b.distance);
  const used = new Set<object>();
  const routeFor = (i: Iface) => {
    const sub =
      vlans.find((v) => v.ids !== "untagged" && i.vlanId !== undefined && v.ids.includes(i.vlanId))?.subnets ?? [];
    return defaults.find(
      (r) =>
        !used.has(r) &&
        (r.gateway === i.name || inCidr(r.gateway, addrOf(f, i.name)) || sub.some((c) => inCidr(r.gateway, c))),
    );
  };
  const out = (f.lists.WAN ?? []).map((n) => ({
    iface: byName.get(n) ?? { name: n, type: "other" as const },
    route: undefined as Route | undefined,
  }));
  for (const w of out) {
    w.route = routeFor(w.iface);
    if (w.route) used.add(w.route);
  }
  // shortcut: a WAN iface whose gateway is not in any known subnet takes the next unused default route by distance; upgrade if route→iface gets recorded in facts.
  for (const w of out)
    if (!w.route) {
      const r = defaults.find((x) => !used.has(x));
      if (r) {
        used.add(r);
        w.route = r;
      }
    }
  return out;
}

const singleHost = (a?: string) => (a && /^\d+\.\d+\.\d+\.\d+(\/32)?$/.test(a) ? a.replace(/\/32$/, "") : undefined);

function items(line: number, f: DeviceFacts, radios: Radio[], vlans: VlanDef[]): DevItem[] {
  const wan = f.lists.WAN ?? [];
  const byName = new Map(f.ifaces.map((i) => [i.name, i]));
  const bridges = bridgesOf(f),
    isBridge = (n?: string) => !!n && bridges.some((b) => b.name === n);
  const flags = (n: string): IfFlags =>
    ({
      ...((f.lists.LAN ?? []).includes(n) ? { lan: true } : {}),
      ...(f.hotspots.includes(n) || (f.lists.GUEST ?? []).includes(n) ? { guest: true } : {}),
      ...(f.hotspots.includes(n) ? { hotspot: true } : {}),
    }) as IfFlags;
  const cidrs = (n: string) => f.addresses.filter((a) => a.iface === n).map((a) => a.cidr);
  const out: DevItem[] = [];

  // shortcut: a WAN vlan member that is also a bridge member is emitted only as its wan line (wan has no bridge spelling), so it loses its vif→bridge internal link; upgrade if a wan line learns a bridge.
  for (const { iface: i, route: r } of wanRoutes(f, vlans)) {
    const dhcp = f.dhcpClients.find((c) => c.iface === i.name);
    out.push({
      line,
      kind: "wan",
      iface: i.name,
      ...(i.type === "vlan"
        ? { ...(i.parent !== undefined ? { on: i.parent } : {}), ...(i.vlanId !== undefined ? { vlan: i.vlanId } : {}) }
        : {}),
      ...(r ? { route: r.comment ?? r.dst, distance: r.distance } : {}),
      ...(dhcp ? { dhcp: dhcp.address ?? true } : {}),
      ...(f.masqueradeOutLists.some((l) => (f.lists[l] ?? []).includes(i.name)) ? { nat: true } : {}),
    });
  }
  if (hasRouter(f)) out.push({ line, kind: "router" });

  // Ports: non-WAN, not bridge/vlan/radio, non-ether only when bridged. Bridge VLAN-table rows are tagged ids on their port.
  const ports = f.ifaces.filter(
    (i) =>
      !wan.includes(i.name) &&
      i.type !== "bridge" &&
      i.type !== "vlan" &&
      !isRadio(i) &&
      (i.type === "ether" || !!i.bridge),
  );
  const portNames = new Set(ports.map((p) => p.name));
  // shortcut: `/interface bridge vlan` rows are imported as `<port>.<id>` vlan ifaces; on a bridged port with a ports line they are table rows. Upgrade if facts keep the table separately.
  // shortcut: a VLAN-table row on a port with no ports line (a WAN or unbridged parent) falls back to a vif and so counts as a VLAN consumer; upgrade if facts keep the table separately.
  const isTable = (x: Iface) =>
    x.parent !== undefined &&
    x.name === `${x.parent}.${x.vlanId}` &&
    !!byName.get(x.parent)?.bridge &&
    portNames.has(x.parent);
  // shortcut: a non-WAN vlan iface without a vlan-id has no vif spelling and is not drawn; upgrade if exports without vlan-id turn up.
  const vifs = f.ifaces.filter(
    (i) => i.type === "vlan" && i.vlanId !== undefined && !wan.includes(i.name) && !isTable(i),
  );
  const portLines = (ps: Iface[]): DevItem[] => {
    const lines: Extract<DevItem, { kind: "ports" }>[] = [];
    for (const p of ps) {
      const tagged = f.ifaces
        .filter((x) => x.type === "vlan" && x.parent === p.name && isTable(x))
        .map((x) => x.vlanId!);
      const it = {
        line,
        kind: "ports" as const,
        names: [p.name],
        ...(p.useTag !== undefined ? { untagged: p.useTag } : {}),
        tagged,
        ...(p.horizon !== undefined ? { horizon: p.horizon } : {}),
      };
      const last = lines.at(-1);
      if (last && last.untagged === it.untagged && last.horizon === it.horizon && last.tagged.join() === tagged.join())
        last.names.push(p.name);
      else lines.push(it);
    }
    return lines;
  };
  // shortcut: horizon on a vif or radio has no spelling and is dropped (the builder reads horizon only on ports); upgrade if lane inference starts to use it there.
  const vifLine = (i: Iface): DevItem => ({
    line,
    kind: "vlan-iface",
    name: i.name,
    ...(i.parent !== undefined ? { on: i.parent } : {}),
    vlan: i.vlanId!,
    addresses: cidrs(i.name),
    ...flags(i.name),
  });
  const radioLine = (r: Radio): DevItem => ({
    line,
    kind: "radio",
    ifaces: r.ifaces.map((i) => i.name),
    ...(r.tag !== undefined ? { tag: r.tag } : {}),
    ssids: r.ssids,
  });
  const inside =
    (b?: string) =>
    <T extends { bridge?: string }>(x: T) =>
      b === undefined ? !isBridge(x.bridge) : x.bridge === b;

  for (const b of bridges) {
    const here = inside(b.name);
    out.push({
      line,
      kind: "bridge",
      name: b.name,
      addresses: cidrs(b.name),
      ...(b.vlanFiltering ? { filtering: true } : {}),
      ...flags(b.name),
      items: [
        ...portLines(ports.filter(here)),
        ...vifs.filter(here).map(vifLine),
        ...radios.filter(here).map(radioLine),
      ],
    });
  }
  const top = inside(undefined);
  out.push(...portLines(ports.filter(top)), ...vifs.filter(top).map(vifLine), ...radios.filter(top).map(radioLine));

  const onLine = new Set([...bridges.map((b) => b.name), ...vifs.map((v) => v.name)]);
  const addrIfaces = [...new Set(f.addresses.map((a) => a.iface))].filter((n) => !onLine.has(n));
  for (const n of addrIfaces) out.push({ line, kind: "address", iface: n, cidrs: cidrs(n), ...flags(n) });
  for (const l of f.leases)
    out.push({ line, kind: "lease", address: l.address, ...(l.comment !== undefined ? { comment: l.comment } : {}) });

  // deriveArrows draws nothing for a router-less device, so its forward accepts become no allow lines.
  if (hasRouter(f))
    for (const r of f.forwardAccepts) {
      const to = singleHost(r.dstAddress);
      if (!to) continue;
      const from = r.inList ? (f.lists[r.inList] ?? []) : r.inIface ? [r.inIface] : [];
      const label = r.comment?.includes(":") ? r.comment.slice(r.comment.indexOf(":") + 1).trim() : r.comment?.trim();
      for (const b of bridges)
        if (from.includes(b.name)) out.push({ line, kind: "allow", from: b.name, to, ...(label ? { label } : {}) });
    }
  return out;
}

/** RouterOS facts → one `device` block per import, in input order. CAPsMAN radios are matched across all of them. */
export function translate(
  devs: { id: string; line: number; f: DeviceFacts }[],
  vlans: VlanDef[],
): { stmts: NodeStmt[]; diags: Diag[] } {
  const diags: Diag[] = [];
  const pre = devs.map((d) => ({ ...d, radios: collectRadios(d.f) }));
  placeCaps(pre, (file, message, hint) => diags.push({ level: "warning", file, line: 0, message, hint }));
  const stmts = pre.map(
    (d): NodeStmt => ({
      line: d.line,
      kind: "node",
      type: "device",
      id: d.id,
      ...(d.f.model !== undefined ? { model: d.f.model } : {}),
      ...(d.f.version !== undefined ? { os: `RouterOS ${d.f.version}` } : {}),
      items: items(d.line, d.f, d.radios, vlans),
    }),
  );
  return { stmts, diags };
}
