import { commentStart } from "../dsl/parse";

/** Physical lines with their terminators, so untouched bytes round-trip. */
const pieces = (text: string) => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
const eolOf = (text: string) => (text.includes("\r\n") ? "\r\n" : "\n");
const body = (p: string) => p.replace(/\r?\n$/, "");

/** The `# ...` tail of a line, outside quotes. */
export function commentOf(line: string): string | undefined {
  const l = body(line);
  const i = commentStart(l);
  return i < 0 ? undefined : l.slice(i);
}

/** Replace 1-based inclusive lines from..to; the first old line's trailing comment moves to the first new line. */
export function replaceLines(text: string, from: number, to: number, lines: string[]): string {
  const ps = pieces(text);
  const eol = eolOf(text);
  const old = ps.slice(from - 1, to);
  const first = body(old[0] ?? "");
  const ci = commentStart(first);
  const out = [...lines];
  if (ci >= 0 && out.length) {
    const code = first.slice(0, ci);
    out[0] += code.slice(code.trimEnd().length) + first.slice(ci);
  }
  const lastOld = old[old.length - 1];
  const noEnd = lastOld !== undefined && !lastOld.endsWith("\n");
  const ins = out.map((l, i) => (noEnd && i === out.length - 1 ? l : l + eol));
  return [...ps.slice(0, from - 1), ...ins, ...ps.slice(to)].join("");
}

/** Insert lines after 1-based line `after` (0 = top; past the end appends). */
export function insertAfter(text: string, after: number, lines: string[]): string {
  const ps = pieces(text);
  const eol = eolOf(text);
  const at = Math.min(after, ps.length);
  const head = ps.slice(0, at);
  const last = head[head.length - 1];
  if (last !== undefined && !last.endsWith("\n")) head[head.length - 1] = last + eol;
  return [...head, ...lines.map((l) => l + eol), ...ps.slice(at)].join("");
}
