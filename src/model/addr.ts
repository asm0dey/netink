export type Cidr = { v: 4 | 6; net: bigint; len: number };
type Addr = { v: 4 | 6; addr: bigint; len: number };

function v4(s: string): bigint | undefined {
  const p = s.split(".");
  if (p.length !== 4 || !p.every((x) => /^\d{1,3}$/.test(x) && +x <= 255)) return undefined;
  return p.reduce((a, x) => (a << 8n) | BigInt(x), 0n);
}

/** `::` shorthand and zero groups; no zone ids, no embedded IPv4. */
function v6(s: string): bigint | undefined {
  if (!/^[0-9a-fA-F:]+$/.test(s)) return undefined;
  const halves = s.split("::");
  if (halves.length > 2) return undefined;
  const groups = (h: string) => (h === "" ? [] : h.split(":"));
  const head = groups(halves[0]!), tail = halves.length === 2 ? groups(halves[1]!) : [];
  const fill = 8 - head.length - tail.length;
  if (halves.length === 1 ? fill !== 0 : fill < 1) return undefined;
  const all = [...head, ...Array<string>(halves.length === 2 ? fill : 0).fill("0"), ...tail];
  if (!all.every((g) => /^[0-9a-fA-F]{1,4}$/.test(g))) return undefined;
  return all.reduce((a, g) => (a << 16n) | BigInt(`0x${g}`), 0n);
}

function parse(s: string): Addr | undefined {
  const [a, l, ...rest] = s.split("/");
  if (a === undefined || rest.length) return undefined;
  const v: 4 | 6 = a.includes(":") ? 6 : 4, bits = v === 4 ? 32 : 128;
  const addr = v === 4 ? v4(a) : v6(a);
  if (addr === undefined) return undefined;
  if (l === undefined) return { v, addr, len: bits };
  return /^\d{1,3}$/.test(l) && +l <= bits ? { v, addr, len: +l } : undefined;
}

/** The prefix a CIDR string names (host bits cleared); a bare address is a host prefix. */
export function parseCidr(s: string): Cidr | undefined {
  const a = parse(s);
  if (!a) return undefined;
  const shift = BigInt((a.v === 4 ? 32 : 128) - a.len);
  return { v: a.v, net: (a.addr >> shift) << shift, len: a.len };
}

/** Does `addr` (with or without `/len`) fall inside `prefix`? Different families never match. */
export function inPrefix(addr: string, prefix: string): boolean {
  const a = parse(addr), p = parseCidr(prefix);
  if (!a || !p || a.v !== p.v) return false;
  const shift = BigInt((p.v === 4 ? 32 : 128) - p.len);
  return a.addr >> shift === p.net >> shift;
}

/** Family-tagged address value without the prefix length, for equality. */
export const addrKey = (s: string): string | undefined => { const a = parse(s); return a && `${a.v}:${a.addr}`; };
