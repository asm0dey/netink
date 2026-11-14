import type { VlanDef } from "../types";

/** Shared by the model, importer, renderer and parser: a leaf module. */
/** VLAN-derived node styles live under `vlan:<name>`, so a VLAN named like a built-in style (wan, dev, spare) cannot be drawn as one. */
export const vlanStyle = (name: string): string => `vlan:${name}`;
export const laneOfStyle = (style: string): string | undefined =>
  style.startsWith("vlan:") ? style.slice(5) : undefined;
/** A fallback style (guest/lan/lte) still takes the colours of a VLAN def of the same name. */
export const fallbackIn =
  (vlans: VlanDef[]) =>
  (name: string): string =>
    vlans.some((v) => v.name === name) ? vlanStyle(name) : name;

// shortcut: the physical radio is read from the name (wifi1-iot → wifi1) because facts keep no master-interface; upgrade if names diverge.
export const physOf = (n: string) => /^(cap-)?(wifi|wlan)\d+/.exec(n)?.[0] ?? n;

/** The theme's named colours: the only names `vlan … color` accepts (else a quoted "#rrggbb"). */
export const NAMED: Record<string, string> = {
  green: "#2E7D32",
  blue: "#1565C0",
  orange: "#E65100",
  red: "#C62828",
  purple: "#6A1B9A",
  teal: "#00838F",
  brown: "#6D4C41",
  pink: "#AD1457",
  grey: "#546E7A",
  gray: "#546E7A",
  amber: "#FF8F00",
  indigo: "#283593",
  cyan: "#0097A7",
};
