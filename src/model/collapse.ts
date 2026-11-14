import type { MLink, MNode, Model } from "../types";
import { idRuns } from "./ids";

const rest = (n: MNode) =>
  n.label.toLowerCase().startsWith(n.id.toLowerCase()) ? n.label.slice(n.id.length) : n.label;

/** "cfroom" + ["101", "102", ...] → "cfroom101–114"; ids without a plain trailing number stay a list. */
function ranges(ids: string[]): string[] {
  const by = new Map<string, number[]>(),
    out: string[] = [];
  for (const id of ids) {
    const m = /^(.*?)(\d+)$/.exec(id);
    if (m && String(Number(m[2])) === m[2]) by.set(m[1]!, [...(by.get(m[1]!) ?? []), Number(m[2])]);
    else out.push(id);
  }
  for (const [p, ns] of by) out.push(...idRuns(ns).map((r) => p + r));
  return out;
}

/** ≥3 identical top-level leaf devices on one endpoint become one node (spec §5); anything that differs stays apart. */
export function collapseSiblings(model: Model): Model {
  const touching = (id: string) => model.links.filter((l) => l.from === id || l.to === id);
  const groups = new Map<string, { n: MNode; l: MLink }[]>();
  // an arrow endpoint or hinted device keeps its own box, so neither can vanish into a group
  const pinned = new Set([
    ...model.arrows.flatMap((a) => [a.from, a.to]),
    ...model.hints.flatMap((h) => (h.type === "near" ? [h.a, h.b] : h.type === "row" ? h.ids : [h.device])),
  ]);
  for (const n of model.nodes) {
    if (pinned.has(n.id) || n.children.length || (n.kind !== "device" && n.kind !== "client")) continue;
    const ls = touching(n.id);
    if (ls.length !== 1) continue;
    const l = ls[0]!,
      parent = l.from === n.id ? l.to : l.from;
    if (parent === n.id) continue;
    const key = JSON.stringify([parent, l.from === n.id, l.lanes, l.trunk, l.label, n.kind, n.style, n.sub, rest(n)]);
    groups.set(key, [...(groups.get(key) ?? []), { n, l }]);
  }
  const into = new Map<string, string>(), // member id → merged id
    merged = new Map<string, MNode>(), // first member id → merged node
    links = new Map<string, MLink>(); // first member's link id → merged link
  for (const g of groups.values()) {
    if (g.length < 3) continue;
    const ids = g.map((x) => x.n.id),
      first = g[0]!,
      id = `${ids[0]}..${ids.at(-1)}`,
      prefix = ids
        .reduce((a, b) => {
          let i = 0;
          while (i < a.length && a[i] === b[i]) i++;
          return a.slice(0, i);
        }, ids[0]!)
        .replace(/[-_.\d]+$/, ""),
      tail = rest(first.n).trim();
    for (const i of ids) into.set(i, id);
    merged.set(
      ids[0]!,
      Object.assign({}, first.n, {
        id,
        label: `${ids.length}× ${prefix ? [prefix, tail].filter(Boolean).join(" ") : tail || "devices"}`,
        sub: [ranges(ids).join(", "), ...first.n.sub],
        members: ids,
      }),
    );
    links.set(first.l.id, {
      ...first.l,
      from: first.l.from === first.n.id ? id : first.l.from,
      to: first.l.to === first.n.id ? id : first.l.to,
    });
  }
  if (!into.size) return model;
  const named = (...ids: string[]) => ids.some((i) => into.has(i));
  return {
    ...model,
    nodes: model.nodes.flatMap((n) => (merged.get(n.id) ? [merged.get(n.id)!] : into.has(n.id) ? [] : [n])),
    links: model.links.flatMap((l) => (links.has(l.id) ? [links.get(l.id)!] : named(l.from, l.to) ? [] : [l])),
  };
}
