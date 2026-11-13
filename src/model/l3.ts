import type { MArrow, MNode } from "../types";
import type { Dev } from "./device";

const walk = (ns: MNode[]): MNode[] => ns.flatMap((n) => [n, ...walk(n.children)]);

/**
 * Routed/NAT arrows implied by one device's block (only with a `router` line), then its `allow` lines. DSL route/allow/hide are applied by buildModel.
 * `leases`: client node id → its lease address. An allow `to` names a client by id or by its lease address.
 */
export function deriveArrows(d: Dev, nodes: MNode[], leases: Map<string, string>): MArrow[] {
  const all = walk(nodes), byId = new Map(all.map((n) => [n.id, n]));
  const out: MArrow[] = [];
  const add = (kind: MArrow["kind"], from: string, to: string, label?: string) =>
    out.push({ id: `${kind}:${from}->${to}`, from, to, kind, ...(label ? { label } : {}) });
  const nameOf = new Map([...d.ref].map(([n, id]) => [id, n]));
  const router = byId.get(`${d.id}/router`);
  if (router) {
    const wan = byId.get(`${d.id}/wan`);
    // A WAN member leads to the internet when a default route uses it, or when it is `nat` (e.g. an LTE default route that is dynamic, not exported).
    const nat = new Set(d.wan.filter((w) => w.nat).map((w) => w.iface));
    const dist = (n: MNode) => d.wanRoutes.get(nameOf.get(n.id)!) ?? Infinity;
    const wans = (wan?.children ?? []).filter((n) => d.wanRoutes.has(nameOf.get(n.id)!) || nat.has(nameOf.get(n.id)!));
    const best = Math.min(...wans.map(dist));
    for (const n of wans) add("route", n.id, router.id, dist(n) === best && wans.filter((x) => dist(x) === best).length === 1 ? "to internet" : undefined);
    // The router reaches every drawn node outside the WAN list that carries an address: a bridge group or an interface chip.
    const lan = walk(d.node.children.filter((n) => n !== wan)).filter((n) => n.kind === "group" || n.kind === "iface");
    for (const n of lan) {
      const a = d.addresses.find((x) => x.iface === nameOf.get(n.id));
      if (a) add("route", router.id, n.id, a.flags.hotspot ? "guests, after hotspot login" : a.flags.lan ? "LAN" : undefined);
    }
  }
  for (const r of d.allows) {
    const from = d.ref.get(r.from), client = all.find((n) => n.kind === "client" && (n.id === r.to || leases.get(n.id) === r.to));
    if (from && client) add("allow", from, client.id, r.label ?? `${r.from} may reach ${client.label} (firewall)`);
  }
  return out;
}
