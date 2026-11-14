import type { MNode, Model } from "../types";
import { closest } from "./check";
import { laneOfStyle } from "./style";

export type Slice = {
  view?: "combined" | "physical" | "vlans" | "routing";
  vlans?: string[];
  around?: string;
  depth?: number;
};

const top = (id: string) => id.split("/")[0]!;
const walk = (ns: MNode[]): MNode[] => ns.flatMap((n) => [n, ...walk(n.children)]);

/** Keep the devices the slice asks for (spec §6, flags intersect); a cut-off neighbour linked to a kept one becomes a stub. */
export function sliceModel(model: Model, s: Slice): { model: Model } | { error: string; hint?: string } {
  if (s.view && s.view !== "combined") return { error: `view ${s.view} is not supported` };
  const miss = (what: string, x: string, among: string[]) => {
    const c = closest(x, among);
    return { error: `unknown ${what} "${x}"`, ...(c ? { hint: `did you mean ${c}?` } : {}) };
  };
  let keep = new Set(model.nodes.map((n) => n.id));
  if (s.around !== undefined) {
    const known = walk(model.nodes).map((n) => n.id);
    if (!known.includes(s.around)) return miss("device", s.around, known);
    const adj = new Map<string, Set<string>>();
    for (const l of model.links)
      for (const [a, b] of [
        [top(l.from), top(l.to)],
        [top(l.to), top(l.from)],
      ] as const)
        adj.set(a!, (adj.get(a!) ?? new Set()).add(b!));
    let ring = [top(s.around)];
    const near = new Set(ring);
    for (let d = 0; d < (s.depth ?? 1); d++)
      ring = ring.flatMap((id) => [...(adj.get(id) ?? [])].filter((n) => !near.has(n) && near.add(n)));
    keep = new Set([...keep].filter((id) => near.has(id)));
  }
  let only: Set<string> | undefined;
  if (s.vlans?.length) {
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
    const has = new Set([
      ...model.links.flatMap((l) => (l.lanes.some((x) => only!.has(x)) ? [top(l.from), top(l.to)] : [])),
      ...model.nodes.filter((n) => walk([n]).some((c) => only!.has(laneOfStyle(c.style) ?? ""))).map((n) => n.id),
    ]);
    keep = new Set([...keep].filter((id) => has.has(id)));
  }
  if (!keep.size) return { error: "the slice is empty" };
  const stub = new Set(
    model.links.flatMap((l) => {
      const [a, b] = [top(l.from), top(l.to)];
      return keep.has(a) && !keep.has(b) ? [b] : keep.has(b) && !keep.has(a) ? [a] : [];
    }),
  );
  const drawn = (id: string) => keep.has(top(id)) || stub.has(top(id));
  const end = (id: string) => (stub.has(top(id)) ? top(id) : id);
  return {
    model: {
      ...model,
      nodes: model.nodes.flatMap((n) =>
        keep.has(n.id)
          ? [n]
          : stub.has(n.id)
            ? [{ id: n.id, kind: "device" as const, style: "stub", label: n.id, sub: [], children: [], tier: n.tier }]
            : [],
      ),
      links: model.links.flatMap((l) => {
        if (!drawn(l.from) || !drawn(l.to) || (stub.has(top(l.from)) && stub.has(top(l.to)))) return [];
        const lanes = only ? l.lanes.filter((x) => only!.has(x)) : l.lanes;
        const { trunk, ...rest } = l;
        return [
          {
            ...(lanes.length === l.lanes.length ? l : rest),
            from: end(l.from),
            to: end(l.to),
            lanes: lanes.length ? lanes : ["wire"],
          },
        ];
      }),
      arrows: model.arrows.filter((a) => keep.has(top(a.from)) && keep.has(top(a.to))),
      hints: model.hints.filter((h) =>
        (h.type === "near" ? [h.a, h.b] : h.type === "row" ? h.ids : [h.device]).every((i) => keep.has(top(i))),
      ),
    },
  };
}
