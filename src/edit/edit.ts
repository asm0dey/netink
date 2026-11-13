import { parseDsl, type Span } from "../dsl/parse";
import { printItems, printStmts } from "../dsl/print";
import type { DevItem, Stmt } from "../types";
import { insertAfter, replaceLines } from "./text";
import type { Args, Noun, Target, Verb } from "./table";

export type EditRequest = { noun: Noun; verb: Verb; args: Args };
export type Candidate = { line: number; text: string };
export type EditResult =
  | { ok: true; text: string; line: number; written: string }   // written: the new statement's lines ("" for rm); line: its first line (rm: the removed line)
  | { ok: false; error: string; line?: number; hint?: string; candidates?: Candidate[] };
type Fail = Extract<EditResult, { ok: false }>;

/** Canonical lines of `ts` at `level` (0 = top-level statements); `own` drops children, for rewriting a statement's own lines only. */
function print(ts: Target[], level: number, own: boolean): string[] {
  if (level === 0) return printStmts((ts as Stmt[]).map((s) => (own && s.kind === "node" ? { ...s, items: undefined } : s))).split("\n").slice(0, -1);
  return printItems((ts as DevItem[]).map((t) => (own && t.kind === "bridge" ? { ...t, items: [] } : t)), level);
}

/** Pure in-place edit of DSL `text`: every byte outside the edited statement is kept. */
export function edit(text: string, file: string, req: EditRequest): EditResult {
  const { noun, verb, args } = req;
  const values = [args.parent, ...args.pos, ...Object.values(args.flags)];
  if (values.some((v) => typeof v === "string" && /[\r\n]/.test(v))) return { ok: false, error: "values cannot contain a newline" };
  const { stmts, diags, spans } = parseDsl(text, file);
  const err = diags.find((d) => d.level === "error");
  if (err) return { ok: false, error: `${file} has parse errors; fix them first`, line: err.line };
  const src = text.split(/\r?\n/);
  const sourceOf = (sp: Span) => src.slice(sp.line - 1, sp.head).map((l) => l.trim()).join(" ");
  const cand = (t: Target): Candidate => ({ line: spans.get(t)!.line, text: src[spans.get(t)!.line - 1]!.trim() });

  // the siblings this noun's statements live among, their print level, and where a new one goes by default
  let pool: Target[] = stmts, level = 0, end = (text.match(/[^\n]*\n|[^\n]+$/g) ?? []).length;
  if (noun.block) {
    const [d, b] = (args.parent ?? "").split("/");
    const dev = stmts.find((s): s is Extract<Stmt, { kind: "node" }> => s.kind === "node" && s.type === "device" && s.id === d);
    const parent = b === undefined ? dev : dev?.items?.find((i) => i.kind === "bridge" && i.name === b);
    if (!parent) return { ok: false, error: `no device or bridge "${args.parent ?? ""}"`, hint: "run netdraw show devices" };
    pool = parent.kind === "node" ? parent.items ?? [] : parent.kind === "bridge" ? parent.items : [];
    level = parent.kind === "node" ? 1 : 2;
    end = spans.get(parent)!.end;
  }

  /** The one sibling `a` names, or why there is not exactly one. */
  const locate = (a: Args, sel?: string): { t: Target; sp: Span } | Fail => {
    let ms = pool.filter((t) => noun.match(t, a));
    if (sel !== undefined) ms = ms.filter((t) => sourceOf(spans.get(t)!).includes(sel));
    const key = [noun.name, ...(args.parent ? [args.parent] : []), ...a.pos].join(" ");
    if (!ms.length) return { ok: false, error: `no ${key}`, hint: `run netdraw show${noun.show ? " " + noun.show : ""} to list them` };
    const same = verb === "rm" && new Set(ms.map((t) => print([t], level, false).join("\n"))).size === 1;
    if (ms.length > 1 && !same) return { ok: false, error: `${ms.length} statements match ${key}`, hint: "narrow it with --select-text", candidates: ms.map(cand) };
    return { t: ms[0]!, sp: spans.get(ms[0]!)! };
  };
  const sel = typeof args.flags["select-text"] === "string" ? args.flags["select-text"] : undefined;

  try {
    if (verb === "add") {
      const t = noun.make(args);
      const lines = print([t], level, false);
      const ms = pool.filter((x) => noun.match(x, args));
      if (ms.length && (!noun.repeatable || ms.some((x) => print([x], level, false).join("\n") === lines.join("\n"))))
        return { ok: false, error: `${noun.name} already exists`, line: spans.get(ms[0]!)!.line, hint: `use netdraw ${noun.name} set to change it` };
      let at = end;
      for (const where of ["after", "before"] as const) {
        const k = args.flags[where];
        if (typeof k !== "string") continue;
        const r = locate({ parent: args.parent, pos: k.split(/\s+/).filter(Boolean), flags: {} });
        if ("ok" in r) return r;
        at = where === "after" ? r.sp.end : r.sp.line - 1;
      }
      return { ok: true, text: insertAfter(text, at, lines), line: at + 1, written: lines.join("\n") };
    }

    const r = locate(args, sel);
    if ("ok" in r) return r;
    const { t, sp } = r;
    const members = pool.filter((x) => spans.get(x) === sp);
    if (verb === "set") {
      const lines = print(members.flatMap((x) => (x === t ? noun.apply(t, args) : [x])), level, true);
      return { ok: true, text: replaceLines(text, sp.line, sp.head, lines), line: sp.line, written: lines.join("\n") };
    }
    if (t.kind === "node") {
      const refs = stmts.filter((s) => refersTo(s, t.id));
      if (refs.length) {
        const lines = [...new Set(refs.map((s) => spans.get(s)!.line))];
        return { ok: false, error: `cannot remove ${t.type} ${t.id}: referenced on line${lines.length > 1 ? "s" : ""} ${lines.join(", ")}`,
          line: sp.line, hint: "remove or change those lines first", candidates: lines.map((l) => ({ line: l, text: src[l - 1]!.trim() })) };
      }
    }
    const rest = members.filter((x) => x !== t);
    // indented comment lines right after a block's last child still belong to it
    let last = sp.end;
    if (sp.end > sp.head) while (/^[ \t]+#/.test(src[last] ?? "")) last++;
    const out = rest.length ? replaceLines(text, sp.line, sp.head, print(rest, level, true)) : replaceLines(text, sp.line, last, []);
    return { ok: true, text: out, line: sp.line, written: "" };
  } catch (e) {
    if (!(e instanceof Error)) throw e;
    return { ok: false, error: e.message };
  }
}

/** Whether `s` names node `id`, or something inside it (`id.port`, `id/child`). */
function refersTo(s: Stmt, id: string): boolean {
  const hit = (v: string) => v === id || v.startsWith(id + ".") || v.startsWith(id + "/");
  switch (s.kind) {
    case "link": return s.path.some((e) => hit(e.node));
    case "note":
    case "hide": return hit(s.target);
    case "route":
    case "allow": return hit(s.from) || hit(s.to);
    case "hint": {
      const h = s.hint;
      return h.type === "near" ? hit(h.a) || hit(h.b) : h.type === "row" ? h.ids.some(hit) : hit(h.device);
    }
    default: return false;
  }
}
