import type { DeviceFacts, MArrow, MNode, Stmt } from "../types";

const walk = (ns: MNode[]): MNode[] => ns.flatMap((n) => [n, ...walk(n.children)]);
const singleHost = (a?: string) => (a && /^\d+\.\d+\.\d+\.\d+(\/32)?$/.test(a) ? a.replace(/\/32$/, "") : undefined);

/** Routed/NAT and firewall-allow arrows implied by one imported device's facts. DSL route/allow/hide are applied by buildModel. */
export function deriveArrows(device: string, f: DeviceFacts, nodes: MNode[], _stmts: Stmt[]): MArrow[] {
  const all = walk(nodes), byId = new Map(all.map((n) => [n.id, n]));
  const router = byId.get(`${device}/router`);
  if (!router) return [];
  const out: MArrow[] = [];
  const add = (kind: MArrow["kind"], from: string, to: string, label?: string) =>
    out.push({ id: `${kind}:${from}->${to}`, from, to, kind, ...(label ? { label } : {}) });
  const dev = byId.get(device)!;
  const wan = byId.get(`${device}/wan`);
  // shortcut: a WAN chip "has a route" when its sub text carries "distance N" (written by buildDevice); upgrade if facts record route→iface.
  const dist = (n: MNode) => Number(n.sub.join(" ").match(/distance (\d+)/)?.[1] ?? NaN);
  const wans = (wan?.children ?? []).filter((n) => !Number.isNaN(dist(n)));
  const best = Math.min(...wans.map(dist));
  for (const n of wans) add("route", n.id, router.id, dist(n) === best && wans.filter((x) => dist(x) === best).length === 1 ? "to internet" : undefined);
  const groups = dev.children.filter((g) => g.kind === "group" && g.style !== "wan");
  const nameOf = (g: MNode) => g.id.slice(device.length + 1);
  for (const g of groups) {
    const name = nameOf(g);
    if (!f.addresses.some((a) => a.iface === name)) continue;
    const label = f.hotspots.includes(name) ? "guests, after hotspot login" : (f.lists.LAN ?? []).includes(name) ? "LAN" : undefined;
    add("route", router.id, g.id, label);
  }
  for (const r of f.forwardAccepts) {
    const dst = singleHost(r.dstAddress);
    if (!dst) continue;
    const from = r.inList ? new Set(f.lists[r.inList] ?? []) : new Set(r.inIface ? [r.inIface] : []);
    const client = all.find((n) => n.kind === "client" && n.sub.includes(dst));
    if (!client) continue;
    for (const g of groups.filter((g) => from.has(nameOf(g)))) {
      const note = r.comment?.includes(":") ? r.comment.slice(r.comment.indexOf(":") + 1).trim() : r.comment?.trim();
      add("allow", g.id, client.id, note || `${nameOf(g)} may reach ${client.label} (firewall)`);
    }
  }
  return out;
}
