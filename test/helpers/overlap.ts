import { textWidth } from "../../src/layout/measure";
import type { Placed } from "../../src/types";

type R = { name: string; x0: number; y0: number; x1: number; y1: number };

const unesc = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
const attr = (a: string, n: string) => new RegExp(`(?:^|\\s)${n}="([^"]*)"`).exec(a)?.[1];
const hit = (a: R, b: R) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const inside = (a: R, b: R) => a.x0 >= b.x0 && a.x1 <= b.x1 && a.y0 >= b.y0 && a.y1 <= b.y1;
const show = (r: R) => `${r.name} [${r.x0},${r.y0},${r.x1},${r.y1}]`;

/** Overlaps in a rendered SVG: partial box/box, text/text, and text crossing a box border. Empty when clean. */
export function overlaps(svg: string, placed: Placed): string[] {
  const boxes: R[] = [...placed.boxes.values()].map((b) => ({
    name: `box ${b.id}`,
    x0: b.x,
    y0: b.y,
    x1: b.x + b.w,
    y1: b.y + b.h,
  }));
  const texts: R[] = [];
  for (const m of svg.matchAll(/<text\s([^>]*)>([\s\S]*?)<\/text>/g)) {
    const a = m[1]!,
      s = unesc(m[2]!.replace(/<[^>]*>/g, ""));
    const cls = attr(a, "class") ?? "";
    const size = Number(
      attr(a, "font-size") ?? (/\bh\b/.test(cls) ? 15 : /\bs\b/.test(cls) ? 12.5 : /\bt\b/.test(cls) ? 12 : 14),
    );
    const bold = /\b[ht]\b/.test(cls) || /^(700|600|bold)$/.test(attr(a, "font-weight") ?? "");
    const w = textWidth(s, size, bold),
      x = Number(attr(a, "x")),
      y = Number(attr(a, "y")),
      anchor = attr(a, "text-anchor");
    const x0 = anchor === "end" ? x - w : anchor === "middle" ? x - w / 2 : x;
    texts.push({ name: `text "${s}"`, x0, y0: y - size, x1: x0 + w, y1: y });
  }
  const out: string[] = [];
  const pairs = (rs: R[], ok: (a: R, b: R) => boolean) => {
    for (let i = 0; i < rs.length; i++)
      for (let j = i + 1; j < rs.length; j++)
        if (hit(rs[i]!, rs[j]!) && !ok(rs[i]!, rs[j]!)) out.push(`${show(rs[i]!)} overlaps ${show(rs[j]!)}`);
  };
  pairs(boxes, (a, b) => inside(a, b) || inside(b, a));
  pairs(texts, () => false);
  for (const t of texts)
    for (const b of boxes) if (hit(t, b) && !inside(t, b)) out.push(`${show(t)} crosses ${show(b)}`);
  return out;
}
