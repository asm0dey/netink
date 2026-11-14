import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/** A fenced code block; `line` is the 1-based line of the opening fence. */
export type Block = { lang: string; info: string; body: string; line: number };

const CLI = resolve(import.meta.dir, "../../src/cli.ts");

export function blocks(md: string): Block[] {
  const out: Block[] = [],
    lines = md.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /^```(\S*)\s*(.*)$/.exec(lines[i]!);
    if (!m) continue;
    const start = i,
      body: string[] = [];
    while (++i < lines.length && !/^```\s*$/.test(lines[i]!)) body.push(lines[i]!);
    out.push({ lang: m[1]!, info: m[2]!.trim(), body: body.join("\n"), line: start + 1 });
  }
  return out;
}

/** The lines outside fenced blocks, each with its 1-based line number. */
const prose = (md: string) => {
  let fenced = false;
  return md.split("\n").flatMap((text, i) => {
    if (/^```/.test(text)) fenced = !fenced;
    else if (!fenced) return [{ text, n: i + 1 }];
    return [];
  });
};
const codes = (s: string) => [...s.matchAll(/`([^`]+)`/g)].map((m) => m[1]!);
const level = (s: string) => /^(#{1,6})\s/.exec(s)?.[1]?.length;

/** Every `x` inside a heading line. */
export function headingCodes(md: string): Set<string> {
  return new Set(prose(md).flatMap((l) => (level(l.text) ? codes(l.text) : [])));
}

/** Heading code → the text under that heading, up to the next heading of the same or higher level. */
export function sections(md: string): Map<string, string> {
  const ls = prose(md),
    out = new Map<string, string>();
  ls.forEach((l, i) => {
    const lv = level(l.text);
    if (!lv) return;
    const end = ls.findIndex((x, j) => j > i && (level(x.text) ?? 9) <= lv);
    const lines = md.split("\n").slice(l.n, end < 0 ? undefined : ls[end]!.n - 1);
    for (const c of codes(l.text)) if (!out.has(c)) out.set(c, lines.join("\n"));
  });
  return out;
}

/** Relative link and image targets (markdown links, src/srcset/href attributes), fragments stripped. */
export function relLinks(md: string): string[] {
  const text = prose(md)
    .map((l) => l.text.replace(/`[^`]*`/g, ""))
    .join("\n");
  const raw = [
    ...[...text.matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)].map((m) => m[1]!),
    ...[...text.matchAll(/\b(?:src|srcset|href)="([^"]+)"/g)].map((m) => m[1]!.split(/\s/)[0]!),
  ];
  return raw.filter((t) => !/^[a-z][a-z0-9+.-]*:/i.test(t) && !t.startsWith("#")).map((t) => t.split("#")[0]!);
}

/** Split a shell-style command line, honouring '…' and "…" (with \" and \\ inside double quotes). */
function argv(s: string): string[] {
  const out: string[] = [];
  let cur: string | undefined;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (/\s/.test(c)) {
      if (cur !== undefined) out.push(cur);
      cur = undefined;
    } else if (c === "'") {
      const j = s.indexOf("'", i + 1);
      if (j < 0) throw new Error("unterminated '");
      cur = (cur ?? "") + s.slice(i + 1, j);
      i = j;
    } else if (c === '"') {
      cur ??= "";
      for (i++; i < s.length && s[i] !== '"'; i++) cur += s[i] === "\\" && /["\\]/.test(s[i + 1] ?? "") ? s[++i] : s[i];
      if (i >= s.length) throw new Error('unterminated "');
    } else cur = (cur ?? "") + c;
  }
  if (cur !== undefined) out.push(cur);
  return out;
}

const tidy = (s: string) =>
  s
    .split("\n")
    .map((l) => l.trimEnd())
    .join("\n")
    .replace(/\n+$/, "");

async function netink(args: string[], cwd: string) {
  const p = Bun.spawn(["bun", CLI, ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { code: await p.exited, out, err };
}

/** Run a doc's `net` and `console` blocks (and write any block with `file=<name>`) in order in one fresh temp dir; failure messages `<file>:<line>: <what>`. */
export async function runExamples(file: string): Promise<string[]> {
  const dir = mkdtempSync(join(tmpdir(), "netink-docs-")),
    fails: string[] = [];
  const firstLine = (s: string) => s.trim().split("\n")[0] ?? "";
  for (const b of blocks(readFileSync(file, "utf8"))) {
    const named = /(?:^|\s)file=(\S+)/.exec(b.info)?.[1];
    // any block with file=<name> is written for later blocks (e.g. an .rsc export); only net blocks are checked
    if (named && b.lang !== "net") writeFileSync(join(dir, named), `${b.body}\n`);
    if (b.lang === "net") {
      const name = named ?? "network.net";
      writeFileSync(join(dir, name), `${b.body}\n`);
      const r = await netink(["check", "--file", name], dir);
      if (r.code !== 0) fails.push(`${file}:${b.line}: check ${name}: exit ${r.code}: ${firstLine(r.err + r.out)}`);
    } else if (b.lang === "console") {
      const lines = b.body.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const m = /^\$ netink(?:\s+(.*))?$/.exec(lines[i]!);
        if (!m) {
          if (lines[i]!.startsWith("$ ")) fails.push(`${file}:${b.line + 1 + i}: not a netink command: ${lines[i]}`);
          continue;
        }
        const at = b.line + 1 + i,
          expected: string[] = [];
        while (i + 1 < lines.length && !lines[i + 1]!.startsWith("$ ")) expected.push(lines[++i]!);
        const cmd = m[1] ?? "",
          exit = /\s#\s*exit\s+(\d+)\s*$/.exec(cmd),
          want = exit ? Number(exit[1]) : 0;
        const r = await netink(argv(exit ? cmd.slice(0, exit.index) : cmd), dir);
        if (r.code !== want)
          fails.push(`${file}:${at}: netink ${cmd}: exit ${r.code}, expected ${want}: ${firstLine(r.err + r.out)}`);
        else if (tidy(r.out) !== tidy(expected.join("\n")))
          fails.push(
            `${file}:${at}: netink ${cmd}: stdout differs:\n--- expected\n${tidy(expected.join("\n"))}\n--- got\n${tidy(r.out)}`,
          );
      }
    }
  }
  return fails;
}
