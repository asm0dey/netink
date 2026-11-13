import type { Diag, Model, VlanDef } from "../types";
import { addrKey, inPrefix, parseCidr } from "./addr";
import { laneOfStyle } from "./style";
import type { Dev } from "./device";

function dist(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++)
      row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[b.length]!;
}

/** Closest candidate within edit distance 2 (ties: alphabetical), for "did you mean" hints. */
export function closest(name: string, candidates: Iterable<string>): string | undefined {
  let best: string | undefined,
    bd = 3;
  for (const c of [...candidates].sort()) {
    const d = dist(name, c);
    if (d < bd) {
      best = c;
      bd = d;
    }
  }
  return best;
}

/** Warnings for addresses outside their VLAN's subnets and for one address on two interfaces. */
export function addressDiags(devs: Iterable<Dev>, vlans: VlanDef[], file: string): Diag[] {
  const out: Diag[] = [],
    first = new Map<string, string>();
  const warn = (line: number, message: string) => out.push({ level: "warning", file, line, message });
  for (const d of devs)
    for (const a of d.addresses) {
      const key = addrKey(a.cidr),
        at = `${d.id}.${a.iface}`;
      if (key !== undefined) {
        const prev = first.get(key);
        if (prev !== undefined) warn(a.line, `address ${a.cidr} on ${at} is already used on ${prev}`);
        else first.set(key, at);
      }
      const i = d.ifaces.find((x) => x.name === a.iface);
      // a vlan interface belongs to the VLAN of its id; a bridge to the VLAN its style came from
      const def =
        i?.type === "vlan" && i.vlanId !== undefined
          ? vlans.find((v) => v.ids !== "untagged" && v.ids.includes(i.vlanId!))
          : i?.type === "bridge"
            ? vlans.find(
                (v) => v.name === laneOfStyle(d.node.children.find((n) => n.id === d.ref.get(a.iface))?.style ?? ""),
              )
            : undefined;
      const fam = parseCidr(a.cidr)?.v,
        subnets = (def?.subnets ?? []).filter((s) => parseCidr(s)?.v === fam);
      if (def && subnets.length && !subnets.some((s) => inPrefix(a.cidr, s)))
        warn(a.line, `address ${a.cidr} on ${at} is outside vlan ${def.name} subnets ${subnets.join(", ")}`);
    }
  return out;
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
    const a = [...new Set(l.lanes)].sort(),
      b = [...new Set(l.inferred)].sort();
    if (a.join() === b.join()) continue;
    out.push({
      level: "warning",
      file,
      line: l.line,
      message: `link ${l.from} -- ${l.to}: explicit vlans [${l.lanes.join(", ")}] disagree with inferred [${l.inferred.join(", ")}]`,
      hint: "an imported end does not carry the lanes you listed; check its vlan interfaces and bridge",
    });
  }
  const cmp = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);
  return out.sort((x, y) => cmp(x.file, y.file) || x.line - y.line || cmp(x.message, y.message));
}
