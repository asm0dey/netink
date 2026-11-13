import type { DeviceFacts, MArrow, MNode } from "../types";

const walk = (ns: MNode[]): MNode[] => ns.flatMap((n) => [n, ...walk(n.children)]);
const singleHost = (a?: string) => (a && /^\d+\.\d+\.\d+\.\d+(\/32)?$/.test(a) ? a.replace(/\/32$/, "") : undefined);

/**
 * Routed/NAT and firewall-allow arrows implied by one imported device's facts. DSL route/allow/hide are applied by buildModel.
 * `wanRoutes`: WAN member name → distance of the default route buildDevice matched to it. `leases`: client node id → its lease address.
 */
export function deriveArrows(device: string, f: DeviceFacts, nodes: MNode[], wanRoutes: Map<string, number>, leases: Map<string, string>): MArrow[] {
  const all = walk(nodes), byId = new Map(all.map((n) => [n.id, n]));
  const router = byId.get(`${device}/router`);
  if (!router) return [];
  const out: MArrow[] = [];
  const add = (kind: MArrow["kind"], from: string, to: string, label?: string) =>
    out.push({ id: `${kind}:${from}->${to}`, from, to, kind, ...(label ? { label } : {}) });
  const dev = byId.get(device)!;
  const wan = byId.get(`${device}/wan`);
  const nameOf = (n: MNode) => n.id.slice(device.length + 1);
  // A WAN member leads to the internet when a default route uses it, or when the device masquerades out of a list holding it (e.g. an LTE default route that is dynamic, not exported).
  const masq = (name: string) => f.masqueradeOutLists.some((l) => (f.lists[l] ?? []).includes(name));
  const dist = (n: MNode) => wanRoutes.get(nameOf(n)) ?? Infinity;
  const wans = (wan?.children ?? []).filter((n) => wanRoutes.has(nameOf(n)) || masq(nameOf(n)));
  const best = Math.min(...wans.map(dist));
  for (const n of wans) add("route", n.id, router.id, dist(n) === best && wans.filter((x) => dist(x) === best).length === 1 ? "to internet" : undefined);
  // The router reaches every drawn node outside the WAN list that carries an address: a bridge group or an interface chip.
  const lan = walk(dev.children.filter((n) => n !== wan)).filter((n) => n.kind === "group" || n.kind === "iface");
  for (const n of lan) {
    const name = nameOf(n);
    if (!f.addresses.some((a) => a.iface === name)) continue;
    const label = f.hotspots.includes(name) ? "guests, after hotspot login" : (f.lists.LAN ?? []).includes(name) ? "LAN" : undefined;
    add("route", router.id, n.id, label);
  }
  const groups = dev.children.filter((g) => g.kind === "group" && g !== wan);
  for (const r of f.forwardAccepts) {
    const dst = singleHost(r.dstAddress);
    if (!dst) continue;
    const from = r.inList ? new Set(f.lists[r.inList] ?? []) : new Set(r.inIface ? [r.inIface] : []);
    const client = all.find((n) => n.kind === "client" && leases.get(n.id) === dst);
    if (!client) continue;
    for (const g of groups.filter((g) => from.has(nameOf(g)))) {
      const note = r.comment?.includes(":") ? r.comment.slice(r.comment.indexOf(":") + 1).trim() : r.comment?.trim();
      add("allow", g.id, client.id, note || `${nameOf(g)} may reach ${client.label} (firewall)`);
    }
  }
  return out;
}
