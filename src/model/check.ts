import type { Diag, Model } from "../types";

function dist(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[b.length]!;
}

/** Closest candidate within edit distance 2 (ties: alphabetical), for "did you mean" hints. */
export function closest(name: string, candidates: Iterable<string>): string | undefined {
  let best: string | undefined, bd = 3;
  for (const c of [...candidates].sort()) {
    const d = dist(name, c);
    if (d < bd) { best = c; bd = d; }
  }
  return best;
}

/**
 * Model.diags (endpoint/port/hint/id errors are raised by buildModel, which still knows the DSL lines)
 * plus explicit-`vlans` vs inferred-lanes warnings; sorted by file, line, message.
 */
export function checkModel(model: Model): Diag[] {
  const file = model.file ?? "";
  const out = [...model.diags];
  for (const l of model.links) {
    if (!l.inferred) continue;
    const a = [...new Set(l.lanes)].sort(), b = [...new Set(l.inferred)].sort();
    if (a.join() === b.join()) continue;
    out.push({ level: "warning", file, line: l.line, message: `link ${l.from} -- ${l.to}: explicit vlans [${l.lanes.join(", ")}] disagree with inferred [${l.inferred.join(", ")}]`,
      hint: "an imported end does not carry the lanes you listed; check its vlan interfaces and bridge" });
  }
  const cmp = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);
  return out.sort((x, y) => cmp(x.file, y.file) || x.line - y.line || cmp(x.message, y.message));
}
