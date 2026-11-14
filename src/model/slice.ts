import type { MNode, Model } from "../types";
import { inPrefix } from "./addr";
import { closest } from "./check";
import { laneOfStyle } from "./style";

export type Slice = {
  view?: "combined" | "physical" | "vlans" | "routing";
  vlans?: string[];
  around?: string;
  depth?: number;
  path?: [string, string];
  address?: string;
};

const top = (id: string) => id.split("/")[0]!;
const walk = (ns: MNode[]): MNode[] => ns.flatMap((n) => [n, ...walk(n.children)]);

// physical view draws hardware only: no VLAN interface or router badge, and a node coloured by a VLAN falls back to the plain box
const plain = (n: MNode): MNode => ({
  ...n,
  style: laneOfStyle(n.style) === undefined ? n.style : "box",
  children: n.children.filter((c) => c.kind !== "iface" && c.kind !== "router").map(plain),
});

/** Keep the devices the slice asks for (spec §6, flags intersect); a cut-off neighbour linked to a kept one becomes a stub. */
export function sliceModel(model: Model, s: Slice): { model: Model } | { error: string; hint?: string } {
  const miss = (what: string, x: string, among: string[]) => {
    const c = closest(x, among);
    return { error: `unknown ${what} "${x}"`, ...(c ? { hint: `did you mean ${c}?` } : {}) };
  };
  let keep = new Set(model.nodes.map((n) => n.id));
  const known = walk(model.nodes).map((n) => n.id);
  const adj = new Map<string, Set<string>>();
  for (const l of model.links)
    for (const [a, b] of [
      [top(l.from), top(l.to)],
      [top(l.to), top(l.from)],
    ] as const)
      adj.set(a!, (adj.get(a!) ?? new Set()).add(b!));
  // links from `from` to every reachable top-level device
  const dist = (from: string) => {
    const d = new Map([[from, 0]]);
    for (let ring = [from]; ring.length; )
      ring = ring.flatMap((id) => [...(adj.get(id) ?? [])].filter((n) => !d.has(n) && d.set(n, d.get(id)! + 1)));
    return d;
  };
  if (s.around !== undefined) {
    if (!known.includes(s.around)) return miss("device", s.around, known);
    const near = new Set([...dist(top(s.around))].filter(([, d]) => d <= (s.depth ?? 1)).map(([id]) => id));
    keep = new Set([...keep].filter((id) => near.has(id)));
  }
  if (s.path) {
    for (const x of s.path) if (!known.includes(x)) return miss("device", x, known);
    const [a, b] = s.path.map(top) as [string, string];
    const [da, db] = [dist(a), dist(b)];
    if (!da.has(b)) return { error: `no path between ${s.path[0]} and ${s.path[1]}` };
    keep = new Set([...keep].filter((id) => da.has(id) && da.get(id)! + db.get(id)! === da.get(b)));
  }
  if (s.view === "routing")
    keep = new Set(
      [...keep].filter((id) => walk(model.nodes.filter((n) => n.id === id)).some((n) => n.kind === "router")),
    );
  // devices with a link or a node style on one of these VLANs
  const carrying = (vs: Set<string>) =>
    new Set([
      ...model.links.flatMap((l) => (l.lanes.some((x) => vs.has(x)) ? [top(l.from), top(l.to)] : [])),
      ...model.nodes.filter((n) => walk([n]).some((c) => vs.has(laneOfStyle(c.style) ?? ""))).map((n) => n.id),
    ]);
  let only: Set<string> | undefined;
  if (s.address !== undefined) {
    const x = s.address,
      near = (a: string) => inPrefix(a, x) || inPrefix(x, a);
    // a VLAN no link carries has no lane to draw, so an address in its subnet does not select it
    const vs = new Set(
      model.vlans
        .filter((v) => v.subnets.some(near) && model.links.some((l) => l.lanes.includes(v.name)))
        .map((v) => v.name),
    );
    const own = new Set([...model.nodes.filter((n) => n.addresses?.some(near)).map((n) => n.id), ...carrying(vs)]);
    if (!own.size) return { error: `nothing has an address in ${x}` };
    keep = new Set([...keep].filter((id) => own.has(id)));
    if (vs.size) only = vs;
  }
  if (s.vlans?.length) {
    const fromAddress = only;
    only = new Set();
    for (const x of s.vlans) {
      const v = model.vlans.find(
        (v) => v.name === x || (/^\d+$/.test(x) && v.ids !== "untagged" && v.ids.includes(+x)),
      );
      if (!v)
        return miss(
          "vlan",
          x,
          model.vlans.map((v) => v.name),
        );
      if (!model.links.some((l) => l.lanes.includes(v.name))) return { error: `VLAN ${x} is carried by no link` };
      only.add(v.name);
    }
    for (const v of fromAddress ?? []) only.add(v);
    const has = carrying(only);
    // a path keeps every device on it, carrying the VLAN or not
    if (!s.path) keep = new Set([...keep].filter((id) => has.has(id)));
  }
  if (!keep.size) return { error: "the slice is empty" };
  const sliced =
    (s.view ?? "combined") !== "combined" ||
    !!s.vlans?.length ||
    s.around !== undefined ||
    !!s.path ||
    s.address !== undefined;
  const stub = new Set(
    model.links.flatMap((l) => {
      const [a, b] = [top(l.from), top(l.to)];
      return keep.has(a) && !keep.has(b) ? [b] : keep.has(b) && !keep.has(a) ? [a] : [];
    }),
  );
  const phys = s.view === "physical",
    gone = new Set(
      phys
        ? walk(model.nodes)
            .filter((n) => n.kind === "iface")
            .map((n) => n.id)
        : [],
    );
  const drawn = (id: string) => keep.has(top(id)) || stub.has(top(id));
  // a cable to a dropped VLAN interface lands on its device instead
  const end = (id: string) => (stub.has(top(id)) || gone.has(id) ? top(id) : id);
  return {
    model: {
      ...model,
      ...(only ? { slice: { vlans: [...only] } } : {}),
      // a note is free text about the whole network: it may name what the slice or view leaves out
      legend: sliced ? { ...model.legend, notes: [] } : model.legend,
      nodes: model.nodes.flatMap((n) =>
        keep.has(n.id)
          ? [s.view === "physical" ? plain(n) : n]
          : stub.has(n.id)
            ? [{ id: n.id, kind: "device" as const, style: "stub", label: n.id, sub: [], children: [], tier: n.tier }]
            : [],
      ),
      links: model.links.flatMap((l) => {
        if (!drawn(l.from) || !drawn(l.to) || (stub.has(top(l.from)) && stub.has(top(l.to)))) return [];
        // inside one device a link is bridging or VLAN wiring, not a cable
        if (phys && top(l.from) === top(l.to)) return [];
        const lanes = s.view === "physical" ? ["wire"] : only ? l.lanes.filter((x) => only!.has(x)) : l.lanes;
        const { trunk, ...rest } = l;
        return [
          {
            ...(lanes.length === l.lanes.length && s.view !== "physical" ? l : rest),
            from: end(l.from),
            to: end(l.to),
            lanes: lanes.length ? lanes : [only ? "other" : "wire"],
          },
        ];
      }),
      arrows:
        s.view === "physical" || s.view === "vlans"
          ? []
          : model.arrows.filter((a) => keep.has(top(a.from)) && keep.has(top(a.to))),
      hints: model.hints.filter((h) =>
        (h.type === "near" ? [h.a, h.b] : h.type === "row" ? h.ids : [h.device]).every((i) => keep.has(top(i))),
      ),
    },
  };
}
