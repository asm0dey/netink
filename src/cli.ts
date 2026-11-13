#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { existsSync, writeFileSync } from "node:fs";
import { loadModel } from "./model/build";
import { checkModel } from "./model/check";
import { layout } from "./layout/elk";
import { renderSvg } from "./render/svg";
import type { Diag, MNode, Model } from "./types";

const GRAMMAR = `DSL (line-oriented; '#' to end of line is a comment unless inside quotes; a line ending in ',' continues on the next line;
strings are "..." with \\" and \\\\ escapes):

  title "T"                      subtitle "T"
  imports rsc <path> as <id> (, <path> as <id>)*
  vlan <name> (untagged | <n>(,<n>)*) [color <c>] ["subnet"]
  cloud <id> ["label"]
  device <id> ["label"] [kind <role>] [model "m"] [note "n"]
  client <id> ["label"] [lease <ip>] [note "n"]
  link <ep> (-- <ep>)+ [vlans <name>(,<name>)*] [label "l"]     ep = id | id.port ; final ep may be id(, id)* (fan-out)
  note <target> "text"           place <a> near <b>      row <a>(, <b>)+
  <device>.side <group> = top|bottom|left|right
  legend auto|off | legend add <style> "text" | legend remove <entry> | legend note "text" | legend position bottom|right
  style jumps arc|gap|none
  route <a> -> <b> ["label"]     allow <a> -> <b> ["label"]     hide <target>

  'link a -- b -- c.p' expands to two links (a-b, b-c.p); 'link sw -- x, y' expands to sw-x and sw-y.
  Ids are [a-z0-9_-]+; child ids are parent/child (e.g. core/ether3, core/bridge).
  Paths in 'imports' are relative to the .net file.`;

const HELP = `netdraw - render network diagrams from a DSL plus optional MikroTik .rsc exports.

Usage:
  netdraw render [--file f] [-o out.svg] [--all] [--json]
      Write the SVG to -o, or to stdout without -o. Refuses (exit 1) when check reports errors; warnings do not block.
      --all   include everything the model would otherwise hide as spare/unused.
      --json  print {ok, output, width, height, warnings} (plus "svg" when no -o). On refusal: {ok:false, diags}.
  netdraw check [--file f] [--json]
      Exit 0 with no errors, 1 otherwise. Human output on stderr: file:line: level: message (hint).
      --json  print {ok, diags} to stdout.
  netdraw show [devices|links|vlans|<id>] [--file f] [--json]
      Print the merged model slice; with <id>, that node subtree (or link/arrow). --json prints the raw objects.
  netdraw --help | <command> --help

Common options:
  --file <f>   the DSL file (default ./network.net)
  --json       machine-readable output on stdout only (one JSON document)

Exit codes: 0 ok; 1 model/check errors or runtime failure; 2 usage error (unknown command, unknown flag, missing argument).
Errors in --json mode: {"error": string, "file": string, "line": number, "hint"?: string}; diagnostics use
{"level": "error"|"warning", "file", "line", "message", "hint"?}.
No command prompts interactively. Editing commands come in a later version.

${GRAMMAR}
`;

const OPTS = { file: { type: "string" }, json: { type: "boolean" }, all: { type: "boolean" }, o: { type: "string" }, help: { type: "boolean", short: "h" } } as const;
const out = (s: string) => process.stdout.write(s.endsWith("\n") ? s : s + "\n");
const err = (s: string) => process.stderr.write(s + "\n");
const fmt = (d: Diag) => `${d.file}:${d.line}: ${d.level}: ${d.message}${d.hint ? ` (${d.hint})` : ""}`;

function fail(json: boolean, code: number, e: { error: string; file?: string; line?: number; hint?: string }): number {
  const body = { error: e.error, file: e.file ?? "", line: e.line ?? 0, ...(e.hint ? { hint: e.hint } : {}) };
  if (json) out(JSON.stringify(body));
  else err(`error: ${e.error}${e.hint ? ` (${e.hint})` : ""}`);
  return code;
}

function walk(ns: MNode[], f: (n: MNode) => void): void { for (const n of ns) { f(n); walk(n.children, f); } }
function tree(n: MNode, depth = 0): string[] {
  const sub = n.sub.length ? `  [${n.sub.join("; ")}]` : "";
  return [`${"  ".repeat(depth)}${n.id} (${n.kind}) ${n.label}${sub}`, ...n.children.flatMap((c) => tree(c, depth + 1))];
}

function show(model: Model, what: string | undefined, json: boolean, file: string): number {
  let data: unknown, text: string[];
  if (what === undefined || what === "devices") {
    data = model.nodes;
    text = model.nodes.flatMap((n) => tree(n));
  } else if (what === "links") {
    data = model.links;
    text = model.links.map((l) => `${l.id}: ${l.from} -- ${l.to}  lanes: ${l.lanes.join(", ") || "-"}${l.label ? `  "${l.label}"` : ""}`);
  } else if (what === "vlans") {
    data = model.vlans;
    text = model.vlans.map((v) => `${v.name}: ${v.ids === "untagged" ? "untagged" : v.ids.join(",")}  ${v.color}${v.subnet ? `  ${v.subnet}` : ""}`);
  } else {
    let node: MNode | undefined;
    walk(model.nodes, (n) => { if (n.id === what) node = n; });
    const found = node ?? model.links.find((l) => l.id === what) ?? model.arrows.find((a) => a.id === what);
    if (!found) return fail(json, 1, { error: `no device, link or arrow with id ${what}`, file, hint: "run netdraw show devices|links to list ids" });
    data = found;
    text = node ? tree(node) : [JSON.stringify(found, null, 2)];
  }
  out(json ? JSON.stringify(data, null, 2) : text.join("\n"));
  return 0;
}

async function main(argv: string[]): Promise<number> {
  const json = argv.includes("--json");
  const [cmd, ...rest] = argv;
  if (cmd === undefined) { err(HELP); return fail(json, 2, { error: "missing command", hint: "run netdraw --help" }); }
  if (cmd === "--help" || cmd === "-h" || cmd === "help") { out(HELP); return 0; }
  if (!["render", "check", "show"].includes(cmd)) return fail(json, 2, { error: `unknown command ${cmd}`, hint: "run netdraw --help" });
  let v, positionals;
  try { ({ values: v, positionals } = parseArgs({ args: rest, options: OPTS, allowPositionals: true, strict: true })); }
  catch (e) { return fail(json, 2, { error: (e as Error).message.replace(/\s*If you want to use it as a positional.*$/, ""), hint: "run netdraw --help" }); }
  if (v.help) { out(HELP); return 0; }
  if (cmd !== "show" && positionals.length) return fail(json, 2, { error: `unexpected argument ${positionals[0]}`, hint: "run netdraw --help" });
  if (positionals.length > 1) return fail(json, 2, { error: `unexpected argument ${positionals[1]}`, hint: "run netdraw --help" });
  const file = v.file ?? "./network.net";
  if (!existsSync(file)) return fail(json, 1, { error: `cannot read ${file}`, file, hint: "pass --file or create ./network.net" });

  let model: Model;
  try { model = loadModel(file, { all: v.all ?? false }); }
  catch (e) { return fail(json, 1, { error: `cannot load ${file}: ${(e as Error).message.split("\n")[0]!.slice(0, 200)}`, file, hint: "check that the file and its imports are readable" }); }

  if (cmd === "show") return show(model, positionals[0], json, file);

  const diags = checkModel(model);
  const errors = diags.filter((d) => d.level === "error");
  if (cmd === "check" || errors.length) {
    if (json) out(JSON.stringify({ ok: errors.length === 0, diags }));
    else diags.forEach((d) => err(fmt(d)));
    return errors.length ? 1 : 0;
  }

  let svg: string, width: number, height: number;
  try {
    const placed = await layout(model);
    svg = renderSvg(model, placed);
    // the SVG's own size: the legend can make it larger than the layout
    const m = /^<svg [^>]*?width="([\d.]+)" height="([\d.]+)"/.exec(svg)!;
    width = Number(m[1]); height = Number(m[2]);
  } catch (e) {
    return fail(json, 1, { error: `layout failed: ${(e instanceof Error ? e.message : String(e)).split("\n")[0]!.slice(0, 200)}`, file, hint: "simplify the diagram (hide/row/place hints) and retry" });
  }
  const warnings = diags.filter((d) => d.level === "warning");
  if (v.o !== undefined) {
    try { writeFileSync(v.o, svg); }
    catch (e) { return fail(json, 1, { error: `cannot write ${v.o}: ${(e as Error).message.split("\n")[0]}`, file, hint: "check the output path is writable" }); }
  }
  if (json) out(JSON.stringify({ ok: true, output: v.o ?? null, width, height, warnings, ...(v.o === undefined ? { svg } : {}) }));
  else {
    warnings.forEach((d) => err(fmt(d)));
    if (v.o === undefined) process.stdout.write(svg);
  }
  return 0;
}

/** Last resort: any throw no command handled becomes the documented error shape, never a stack trace. */
async function run(argv: string[]): Promise<number> {
  try { return await main(argv); }
  catch (e) {
    const i = argv.indexOf("--file"), file = i >= 0 ? argv[i + 1] : argv.find((a) => a.startsWith("--file="))?.slice(7);
    const msg = (e instanceof Error ? e.message : String(e)).split("\n")[0]!.slice(0, 200);
    return fail(argv.includes("--json"), 1, { error: `internal error: ${msg}`, file: file ?? "", hint: "this is a netdraw bug; please report it with the input that triggers it" });
  }
}

process.exitCode = await run(process.argv.slice(2));
