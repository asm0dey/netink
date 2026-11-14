import type { Diag, Endpoint, Hint, Iface, LegendSpec, MArrow, MLink, MNode, Model, Stmt, VlanDef } from "../types";
import { parseCidr } from "./addr";
import { addressDiags, closest, usageDiags } from "./check";
import { buildDevice, type Dev, mk, type Radio } from "./device";
import { deriveArrows } from "./l3";

export type Opts = { all?: boolean; file?: string };
type NodeStmt = Extract<Stmt, { kind: "node" }>;
type LinkStmt = Extract<Stmt, { kind: "link" }>;
/** A resolved link endpoint. `dev` is set for ends inside a device with block lines. */
type End = { id: string; dev?: Dev; iface?: Iface; nodeType?: NodeStmt["type"] };

const ID_RE = /^[a-z0-9_-]+$/;
// lane names the renderer draws with its own style
const RESERVED = new Set(["wire", "trunk", "route", "allow", "other"]);
const IPV4_RE = /^\d+\.\d+\.\d+\.\d+$/;
const HIDDEN_HINT = "unlinked ports on devices without a router are hidden; use --all";
const leaves = (n: MNode): MNode[] => (n.children.length ? n.children.flatMap(leaves) : [n]);
const walk = (ns: MNode[]): MNode[] => ns.flatMap((n) => [n, ...walk(n.children)]);
export const vlanDefs = (stmts: Stmt[]): VlanDef[] =>
  stmts.flatMap((v) =>
    v.kind === "vlan" ? [{ name: v.name, ids: v.ids, color: v.color ?? "grey", subnets: v.subnets }] : [],
  );

export function buildFromStmts(stmts: Stmt[], opts: Opts = {}): Model {
  const file = opts.file ?? "";
  const diags: Diag[] = [];
  const err = (line: number, message: string, hint?: string) =>
    diags.push({ level: "error", file, line, message, ...(hint ? { hint } : {}) });
  const of = <K extends Stmt["kind"]>(k: K) => stmts.filter((s): s is Extract<Stmt, { kind: K }> => s.kind === k);

  const vlans = vlanDefs(stmts);
  const vlanName = (id?: number) =>
    vlans.find((v) => v.ids !== "untagged" && id !== undefined && v.ids.includes(id))?.name;
  const untagged = vlans.filter((v) => v.ids === "untagged").map((v) => v.name);

  const badId = (id: string, line: number) => {
    if (!ID_RE.test(id)) err(line, `bad id "${id}"`, "ids use a-z, 0-9, _ and -");
  };
  for (const s of stmts) {
    if (s.kind === "node") badId(s.id, s.line);
    if (s.kind === "import") badId(s.as, s.line);
  }

  // Devices with block lines; a later `device` line on the same id without them overrides its label and note.
  const devs = new Map<string, Dev>(),
    blocks = new Set<Stmt>();
  for (const s of stmts)
    if (s.kind === "node" && s.items && !devs.has(s.id)) {
      devs.set(s.id, buildDevice(s, vlans, err));
      blocks.add(s);
    }

  diags.push(...addressDiags(devs.values(), vlans, file));

  // Nodes in declaration order
  const nodes: MNode[] = [],
    nodeType = new Map<string, NodeStmt["type"]>();
  const declaredLeases = new Set<string>(),
    leaseOf = new Map<string, string>();
  // a client's own lease is enough; an unmatched one is only suspicious when some device lists its leases
  const listsLeases = [...devs.values()].some((d) => d.leases.length);
  for (const s of stmts) {
    if (s.kind !== "node") continue;
    if (blocks.has(s)) {
      const d = devs.get(s.id)!,
        own = [...d.addresses.map((a) => a.cidr), ...d.leases.map((l) => l.address)];
      if (own.length) d.node.addresses = own;
      nodes.push(d.node);
      continue;
    }
    const d = devs.get(s.id);
    if (d && !s.items) {
      if (s.label) d.node.label = s.label;
      if (s.note) d.node.sub.push(s.note);
      continue;
    }
    if (d) {
      err(s.line, `duplicate node "${s.id}"`);
      continue;
    }
    if (nodeType.has(s.id)) {
      err(s.line, `duplicate node "${s.id}"`);
      continue;
    }
    nodeType.set(s.id, s.type);
    let label = s.label ?? s.id;
    const sub: string[] = [];
    if (s.lease) {
      const owner = [...devs.values()].find((x) => x.leases.some((l) => l.address === s.lease));
      const lease = owner?.leases.find((l) => l.address === s.lease);
      if (owner) declaredLeases.add(`${owner.id} ${s.lease}`);
      else if (listsLeases)
        diags.push({ level: "warning", file, line: s.line, message: `no device has a lease for ${s.lease}` });
      label = s.label ?? lease?.comment ?? s.lease;
      sub.push(s.lease);
    }
    if (s.note) sub.push(s.note);
    nodes.push({
      ...mk(s.id, s.type, s.type === "cloud" ? "cloud" : "box", label, sub),
      ...(s.lease ? { addresses: [s.lease] } : {}),
    });
    if (s.lease) leaseOf.set(s.id, s.lease);
  }
  if (opts.all)
    for (const d of devs.values())
      for (const l of d.leases) {
        if (declaredLeases.has(`${d.id} ${l.address}`)) continue;
        declaredLeases.add(`${d.id} ${l.address}`);
        const base = `${d.id}-${l.address.replace(/\W/g, "-")}`;
        let id = base;
        for (let n = 2; nodeType.has(id) || devs.has(id); n++) id = `${base}-${n}`;
        nodeType.set(id, "client");
        nodes.push({ ...mk(id, "client", "box", l.comment ?? l.address, [l.address]), addresses: [l.address] });
        leaseOf.set(id, l.address);
      }

  // Endpoints: ports first, so a bare device id can resolve to its single unlinked port.
  const links = of("link");
  const resolve = (e: Endpoint, line: number): End | "bare" | undefined => {
    const d = devs.get(e.node);
    if (d) {
      if (!e.port) return "bare";
      const id = d.ref.get(e.port);
      if (!id && d.hidden.has(e.port)) {
        err(line, `${e.node}.${e.port} is not drawn`, HIDDEN_HINT);
        return undefined;
      }
      if (!id) {
        const c = closest(e.port, d.ref.keys());
        err(line, `${e.node} has no interface "${e.port}"`, c && `did you mean ${e.node}.${c}?`);
        return undefined;
      }
      return { id, dev: d, iface: d.ifaceOf.get(id) ?? d.ifaces.find((i) => i.name === e.port) };
    }
    if (!nodeType.has(e.node)) {
      const c = closest(e.node, [...nodeType.keys(), ...devs.keys()]);
      err(line, `unknown node "${e.node}"`, c ? `did you mean ${c}?` : "declare it with cloud, device or client");
      return undefined;
    }
    if (e.port) {
      err(
        line,
        `"${e.node}" has no device block, so it has no port "${e.port}"`,
        `add a block under "device ${e.node}" listing ${e.port}, or link ${e.node} without a port`,
      );
      return undefined;
    }
    return { id: e.node, nodeType: nodeType.get(e.node) };
  };
  const ends = links.map((l) => l.path.map((e) => resolve(e, l.line)));
  const linked = new Set(
    ends
      .flat()
      .filter((e): e is End => typeof e === "object")
      .map((e) => e.id),
  );
  ends.forEach((pair, k) => {
    pair.forEach((e, j) => {
      if (e !== "bare") return;
      const name = links[k]!.path[j]!.node,
        d = devs.get(name)!;
      const free = leaves(d.node).filter((n) => n.kind === "port" && !linked.has(n.id));
      if (free.length !== 1) {
        err(
          links[k]!.line,
          `${name} has ${free.length} unlinked ports; name one`,
          `e.g. ${name}.${free[0]?.label ?? "ether1"}`,
        );
        pair[j] = undefined;
        return;
      }
      linked.add(free[0]!.id);
      pair[j] = { id: free[0]!.id, dev: d, iface: d.ifaceOf.get(free[0]!.id) };
    });
  });

  for (const v of of("vlan"))
    if (RESERVED.has(v.name))
      err(
        v.line,
        `vlan "${v.name}" clashes with a drawing style`,
        "that name is reserved for a drawing style; rename the vlan",
      );
  for (const t of of("trunk"))
    if (RESERVED.has(t.name))
      err(
        t.line,
        `trunk "${t.name}" clashes with a drawing style`,
        "that name is reserved for a drawing style; rename the trunk set",
      );
  const trunks = of("trunk").map((t) => ({ name: t.name, vlans: t.vlans, line: t.line }));
  trunks.forEach((t, i) => {
    if (trunks.findIndex((x) => x.name === t.name) < i)
      err(t.line, `duplicate trunk "${t.name}"`, "give each trunk set one definition");
    if (vlans.some((v) => v.name === t.name))
      err(t.line, `trunk "${t.name}" clashes with vlan "${t.name}"`, "use a different name");
    for (const name of t.vlans)
      if (!vlans.some((x) => x.name === name))
        err(t.line, `unknown vlan "${name}"`, `declare it with vlan ${name} <ids>`);
  });
  for (const l of links)
    if (l.trunk && !trunks.some((t) => t.name === l.trunk)) {
      const c = closest(
        l.trunk,
        trunks.map((t) => t.name),
      );
      err(
        l.line,
        `unknown trunk "${l.trunk}"`,
        c ? `did you mean ${c}?` : `declare it with trunk ${l.trunk} vlans <name>, ...`,
      );
    }
  for (const l of links)
    for (const name of l.vlans ?? [])
      if (!vlans.some((x) => x.name === name))
        err(l.line, `unknown vlan "${name}"`, `declare it with vlan ${name} <ids>`);

  // Tagged-VLAN reachability. A link carries v iff, with that link removed, a consumer of v is reachable from
  // each end, walking other links and bridges that forward v. Ends outside a device block neither consume nor forward.
  const adj = new Map<string, { k: number; to: End }[]>();
  ends.forEach((pair, k) => {
    const [a, b] = pair as (End | undefined)[];
    if (a && b)
      for (const [x, y] of [
        [a, b],
        [b, a],
      ] as const)
        adj.set(x.id, [...(adj.get(x.id) ?? []), { k, to: y }]);
  });
  const radioOf = (e: End) => e.dev?.radios.find((r) => r.id === e.id);
  const bridgeOf = (e: End) => radioOf(e)?.bridge ?? (e.iface?.type === "vlan" ? undefined : e.iface?.bridge);
  const byName = (d: Dev, n: string) => d.ifaces.find((x) => x.name === n);
  const isRadio = (x?: Iface) => x?.type === "wifi";
  const consumes = (e: End, v: number): boolean => {
    const d = e.dev,
      i = e.iface;
    if (!d) return false;
    if (i?.type === "vlan") return i.vlanId === v;
    const r = radioOf(e),
      br = bridgeOf(e),
      port = r ? undefined : i?.name;
    if (r?.ifaces.some((x) => x.useTag === v)) return true;
    // on a vlan-filtering bridge, the bridge's own vlan iface reaches only ports listed for v
    const viaBridge = br !== undefined && (!byName(d, br)?.vlanFiltering || listed(e, v));
    return d.ifaces.some(
      (x) =>
        (x.type === "vlan" &&
          x.vlanId === v &&
          !d.table.has(x.name) &&
          (x.parent === port || (viaBridge && x.parent === br))) ||
        (br !== undefined && isRadio(x) && x.bridge === br && x.useTag === v),
    );
  };
  const listed = (e: End, v: number) => {
    const r = radioOf(e);
    if (r) return r.ifaces.some((x) => x.useTag === v);
    const n = e.iface!.name;
    return e.iface!.useTag === v || e.dev!.ifaces.some((x) => x.type === "vlan" && x.parent === n && x.vlanId === v);
  };
  const siblings = (e: End, v: number): End[] => {
    const d = e.dev,
      br = bridgeOf(e);
    if (!d || br === undefined) return [];
    const filtering = byName(d, br)?.vlanFiltering;
    if (filtering && !listed(e, v)) return [];
    const ports = leaves(d.node)
      .filter((n) => n.kind === "port" && d.ifaceOf.get(n.id)?.bridge === br)
      .map((n) => ({ id: n.id, dev: d, iface: d.ifaceOf.get(n.id) }));
    const radios = d.radios.filter((r) => r.bridge === br).map((r) => ({ id: r.id, dev: d, iface: r.ifaces[0] }));
    return [...ports, ...radios].filter((x) => x.id !== e.id && (!filtering || listed(x, v)));
  };
  const reaches = (start: End, v: number, skip: number): boolean => {
    const seen = new Set([start.id]),
      queue = [start];
    for (let e = queue.shift(); e; e = queue.shift()) {
      if (!e.dev) continue;
      if (consumes(e, v)) return true;
      for (const n of [...siblings(e, v), ...(adj.get(e.id) ?? []).filter((x) => x.k !== skip).map((x) => x.to)])
        if (!seen.has(n.id)) {
          seen.add(n.id);
          queue.push(n);
        }
    }
    return false;
  };
  const member = (e: End) => !e.dev || !!e.iface?.bridge || !!radioOf(e);
  /** Lanes the device blocks imply for link k, and the tagged ids it carries (which vlan ifaces a trunk port feeds). */
  /** With `forCheck`, an end outside a device block accepts every tagged id, so `inferred` judges only the ends with blocks. */
  const infer = (a: End, b: End, k: number, forCheck = false): { lanes: string[]; ids: number[] } => {
    if (!a.dev && !b.dev) return { lanes: ["wire"], ids: [] };
    const all = [...new Set(vlans.flatMap((v) => (v.ids === "untagged" ? [] : v.ids)))].sort((x, y) => x - y);
    const ok = (e: End, v: number) => (forCheck && !e.dev) || reaches(e, v, k);
    const ids = all.filter((v) => ok(a, v) && ok(b, v));
    const lanes = vlans
      .filter((v) => (v.ids === "untagged" ? member(a) && member(b) : v.ids.some((id) => ids.includes(id))))
      .map((v) => v.name);
    return { lanes: lanes.length ? lanes : ["wire"], ids };
  };

  const out: MLink[] = [];
  const linkId = (from: string, to: string) => {
    let id = `${from}--${to}`;
    for (let n = 2; out.some((l) => l.id === id); n++) id = `${from}--${to}#${n}`;
    return id;
  };
  const push = (from: string, to: string, lanes: string[], line: number, label?: string, trunk?: string) =>
    out.push({ id: linkId(from, to), from, to, lanes, ...(label ? { label } : {}), ...(trunk ? { trunk } : {}), line });
  const trunkIds = new Map<string, Set<number>>();
  const portUse = new Map<string, number>();
  ends.forEach((pair, k) => {
    const [a, b] = pair as (End | undefined)[],
      l: LinkStmt = links[k]!;
    if (!a || !b) return;
    let r = infer(a, b, k),
      inferred: string[] | undefined;
    for (const e of [a, b])
      if (e.dev && e.iface && !isRadio(e.iface)) {
        // radios legitimately take many client links
        if (portUse.has(e.id))
          err(
            l.line,
            `${e.id} is already linked on line ${portUse.get(e.id)}`,
            "a port takes one link; use a switch or another port",
          );
        else portUse.set(e.id, l.line);
      }
    const explicit = l.vlans ?? trunks.find((t) => t.name === l.trunk)?.vlans;
    if (explicit) {
      if (a.dev || b.dev) inferred = infer(a, b, k, true).lanes;
      const defs = vlans.filter((v) => explicit.includes(v.name)); // unknown names were reported above
      r = {
        lanes: defs.length ? defs.map((v) => v.name) : ["wire"],
        ids: defs.flatMap((v) => (v.ids === "untagged" ? [] : v.ids)),
      };
    }
    for (const e of [a, b]) trunkIds.set(e.id, new Set([...(trunkIds.get(e.id) ?? []), ...r.ids]));
    push(a.id, b.id, r.lanes, l.line, l.label, l.trunk);
    if (inferred) out.at(-1)!.inferred = inferred;
  });

  // Internal links: trunk port → vlan iface it carries, vlan iface → the bridge it is a member of, uplink port → radio (no router).
  for (const d of devs.values()) {
    const line = d.line,
      wanNames = new Set(d.wan.map((w) => w.iface));
    const vifs = d.ifaces.filter((i) => i.type === "vlan" && d.ref.has(i.name));
    for (const p of leaves(d.node).filter((n) => n.kind === "port" && linked.has(n.id))) {
      const i = d.ifaceOf.get(p.id)!;
      if (wanNames.has(i.name)) continue;
      const ids = trunkIds.get(p.id) ?? new Set();
      for (const v of vifs) {
        const name = vlanName(v.vlanId);
        if (name && ids.has(v.vlanId!) && (v.parent === i.name || (i.bridge && v.parent === i.bridge)))
          push(p.id, d.ref.get(v.name)!, [name], line);
      }
    }
    for (const v of vifs) {
      const g = v.bridge && d.ref.get(v.bridge);
      if (g && g !== d.ref.get(v.parent ?? "")) push(d.ref.get(v.name)!, g, [vlanName(v.vlanId) ?? "wire"], line);
    }
    const bridged = (r: Radio) =>
      leaves(d.node).filter(
        (n) => n.kind === "port" && linked.has(n.id) && !!r.bridge && d.ifaceOf.get(n.id)?.bridge === r.bridge,
      );
    for (const r of d.radios) {
      if (r.tag !== undefined) {
        // a tagged chip ends that VLAN's lane of every trunk port on its bridge that carries the tag
        const name = vlanName(r.tag);
        if (name) for (const p of bridged(r)) if (trunkIds.get(p.id)?.has(r.tag)) push(p.id, r.id, [name], line);
      } else if (!d.hasRouter) {
        const up = bridged(r)[0];
        if (up) push(up.id, r.id, untagged.length ? untagged : ["wire"], line);
      }
    }
    const spare = (p: MNode) =>
      p.kind === "port" &&
      !linked.has(p.id) &&
      !!d.ifaceOf.get(p.id)?.bridge &&
      !wanNames.has(d.ifaceOf.get(p.id)!.name);
    // A router shows its free ports as spare; on a router-less device (an AP) they are noise unless --all.
    const prune = (n: MNode) => {
      n.children = n.children.filter((c) => {
        if (!spare(c)) return true;
        const name = d.ifaceOf.get(c.id)!.name;
        d.ref.delete(name);
        d.hidden.add(name);
        return false;
      });
      n.children.forEach(prune);
    };
    if (d.hasRouter || opts.all)
      for (const p of leaves(d.node)) {
        if (spare(p)) p.style = "spare";
      }
    else prune(d.node);
  }

  const ids = new Set<string>();
  for (const n of walk(nodes)) {
    if (ids.has(n.id)) err(0, `duplicate node id "${n.id}"`, "rename the interface or node so ids stay unique");
    ids.add(n.id);
  }

  // Hints must name a known node (or a port of one)
  const known = new Set([...ids, ...nodeType.keys()]);
  const isHidden = (n: string) => {
    const [d, p] = n.split(".", 2) as [string, string | undefined];
    return p !== undefined && !!devs.get(d)?.hidden.has(p);
  };
  for (const s of of("hint")) {
    const h = s.hint,
      names = h.type === "near" ? [h.a, h.b] : h.type === "row" ? h.ids : [h.device];
    for (const n of names)
      if (isHidden(n))
        err(s.line, `${h.type === "near" ? "place" : h.type} names ${n}, which is not drawn`, HIDDEN_HINT);
      else if (!known.has(n) && !known.has(n.split(".")[0]!)) {
        const c = closest(n, known);
        err(
          s.line,
          `${h.type === "near" ? "place" : h.type} names unknown node "${n}"`,
          c ? `did you mean ${c}?` : undefined,
        );
      }
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
    for (const g of d.node.children)
      if (g.kind === "group" && g.children.length) g.tier = Math.min(g.tier, ...g.children.map((c) => c.tier));
    d.node.tier = d.node.children.length ? Math.min(...d.node.children.map((c) => c.tier)) : 4;
  }
  const tier = new Map(
    walk(nodes)
      .filter((n) => devs.has(n.id.split("/")[0]!))
      .map((n) => [n.id, n.tier]),
  );
  const free = nodes.filter((n) => !devs.has(n.id));
  const nbrs = (id: string) => out.flatMap((l) => (l.from === id ? [l.to] : l.to === id ? [l.from] : []));
  const bfs = (seed: string[], start: number) => {
    let front = seed.filter((id) => !tier.has(id));
    for (let t = start; front.length; t++) {
      front.forEach((id) => {
        tier.set(id, t);
      });
      front = [...new Set(front.flatMap(nbrs))].filter((id) => !tier.has(id) && nodeType.get(id) !== "cloud").sort();
    }
  };
  free
    .filter((n) => n.kind === "cloud")
    .forEach((n) => {
      tier.set(n.id, 0);
    });
  bfs(
    free
      .filter(
        (n) => n.kind !== "cloud" && nbrs(n.id).some((x) => (tier.get(x) ?? -1) >= 3 && devs.has(x.split("/")[0]!)),
      )
      .map((n) => n.id),
    5,
  );
  const before = new Set(tier.keys());
  bfs([...new Set(free.filter((n) => n.kind === "cloud").flatMap((n) => nbrs(n.id)))].sort(), 1);
  // Upstream nodes (reached from clouds) sit strictly between the clouds (0) and the WAN chips (1): hop h of H becomes h/(H+1).
  const up = [...tier].filter(([id]) => !before.has(id));
  const hops = Math.max(0, ...up.map(([, t]) => t));
  for (const [id, t] of up) tier.set(id, t / (hops + 1));
  for (const n of free) n.tier = tier.get(n.id) ?? 5;
  for (const l of out) if ((tier.get(l.from) ?? 0) > (tier.get(l.to) ?? 0)) [l.from, l.to] = [l.to, l.from];

  // L3 arrows: derived per device, then DSL route/allow, then hide (arrow id or node id).
  // An allow line's `from` must name something drawn in its device; deriveArrows skips the ones that do not.
  // Its `to` is a client id or an address; an address nobody leases draws nothing.
  const clients = [...nodeType].filter(([, t]) => t === "client").map(([id]) => id);
  for (const d of devs.values())
    for (const a of d.allows) {
      if (!parseCidr(a.to) && !clients.includes(a.to)) {
        const c = closest(a.to, clients);
        err(a.line, `allow to unknown client "${a.to}"`, c ? `did you mean ${c}?` : "name a client id or an address");
      }
      if (d.ref.has(a.from)) continue;
      if (d.hidden.has(a.from)) err(a.line, `allow from ${d.id}.${a.from}, which is not drawn`, HIDDEN_HINT);
      else {
        const c = closest(a.from, d.ref.keys());
        err(a.line, `${d.id} has no interface "${a.from}"`, c && `did you mean ${c}?`);
      }
    }
  const arrows: MArrow[] = [...devs.values()].flatMap((d) => deriveArrows(d, nodes, leaseOf));
  const client = (addr: string) => walk(nodes).find((n) => n.kind === "client" && leaseOf.get(n.id) === addr)?.id;
  const arrowEnd = (id: string, line: number) => {
    // an address end is the client leased it; without one the arrow is dropped silently
    if (IPV4_RE.test(id)) return client(id);
    const [node, port] = id.split(".", 2) as [string, string | undefined];
    const r = resolve({ node, ...(port ? { port } : {}) }, line);
    return r === "bare" ? node : r?.id;
  };
  for (const s of stmts) {
    if (s.kind === "route" || s.kind === "allow") {
      const from = arrowEnd(s.from, s.line),
        to = arrowEnd(s.to, s.line);
      if (!from || !to) continue;
      const id = `${s.kind}:${from}->${to}`;
      if (!arrows.some((a) => a.id === id))
        arrows.push({ id, from, to, kind: s.kind, ...(s.label ? { label: s.label } : {}) });
    }
  }
  const arrowTier = (id: string) => tier.get(id) ?? 0;
  // route arrows are double-headed, so tier order is free; allow is one-way (head on `to`) and keeps its direction
  for (const a of arrows)
    if (a.kind === "route" && arrowTier(a.from) > arrowTier(a.to)) [a.from, a.to] = [a.to, a.from];
  for (const s of of("hide")) {
    const t = s.target.replace(".", "/");
    const hit = arrows.filter((a) => a.id === s.target || a.from === t || a.to === t);
    if (!hit.length)
      err(
        s.line,
        `hide target "${s.target}" matches no arrow or node`,
        "use an arrow id like route:core/router->core/bridge or a node id",
      );
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
  const ref = (n: string) => {
    const [d, p] = n.split(".", 2) as [string, string | undefined];
    return p === undefined ? n : (devs.get(d)?.ref.get(p) ?? `${d}/${p}`);
  };
  const normHint = (h: Hint): Hint =>
    h.type === "near"
      ? { ...h, a: ref(h.a), b: ref(h.b) }
      : h.type === "row"
        ? { ...h, ids: h.ids.map(ref) }
        : { ...h, group: devs.get(h.device)?.ref.get(h.group) ?? `${h.device}/${h.group}` };
  const text = (k: "title" | "subtitle") =>
    stmts.filter((s): s is Extract<Stmt, { text: string }> => s.kind === k).at(-1)?.text;
  const subtitle = text("subtitle");
  return {
    title: text("title") ?? "",
    ...(subtitle !== undefined ? { subtitle } : {}),
    nodes,
    links: out,
    arrows,
    vlans,
    trunks: trunks.map(({ name, vlans }) => ({ name, vlans })),
    legend,
    jumps: of("style").at(-1)?.value ?? "arc",
    hints: of("hint").map((s): Hint => normHint(s.hint)),
    diags,
    usage: usageDiags(stmts, nodes, out, file),
    ...(opts.file !== undefined ? { file: opts.file } : {}),
  };
}
