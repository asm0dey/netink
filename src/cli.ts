#!/usr/bin/env bun
import yargs, { type Argv } from "yargs";
import { hideBin } from "yargs/helpers";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { loadModel } from "./load";
import { parseDsl } from "./dsl/parse";
import { printStmts } from "./dsl/print";
import { importRsc } from "./rsc/import";
import { translate } from "./rsc/translate";
import { checkModel } from "./model/check";
import { layout } from "./layout/elk";
import { NAMED } from "./model/style";
import { renderSvg } from "./render/svg";
import type { DeviceFacts, Diag, MNode, Model, VlanDef } from "./types";

const GRAMMAR = `DSL (line-oriented; '#' to end of line is a comment unless inside quotes; a line ending in ',' continues on the next line;
strings are "..." with \\" and \\\\ escapes):

  title "T"                      subtitle "T"
  imports rsc <path> as <id> (, <path> as <id>)*
  vlan <name> (untagged | <n>(,<n>)*) [color <c>] [subnet <cidr>(, <cidr>)*]   c = a name below, or quoted hex "#rrggbb"
  cloud <id> ["label"]
  device <id> ["label"] [kind <role>] [model "m"] [os "o"] [note "n"]
    indented blocks (two spaces per level) under a device; names are local, "quoted" allowed:
      wan <if> [on <parent> vlan <n>] [route "name"] [distance <n>] [dhcp [<addr>]] [nat]
      router
      bridge <name> [address <cidr>(, <cidr>)*] [lan] [guest] [hotspot] [filtering]   (children indented again: ports, vlan-iface, radio)
      ports <p>(, <p>)* [untagged <vlan>] [tagged <vlan>(, <vlan>)*] [horizon <n>]     <vlan> = name or id
      vlan-iface <name> [on <parent>] vlan <n> [address <cidr>(, <cidr>)*] [lan] [guest] [hotspot]
      radio <if>(, <if>)* [tag <n>] [ssid <s>(, <s>)*]
      address <if> <cidr>(, <cidr>)* [lan] [guest] [hotspot]
      lease <addr> ["comment"]
      allow <if> -> <addr-or-id> ["label"]
  client <id> ["label"] [lease <ip>] [note "n"]
  link <ep> (-- <ep>)+ [vlans <name>(,<name>)*] [label "l"]     ep = id | id.port ; final ep may be id(, id)* (fan-out)
  note <target> "text"           place <a> near <b>      row <a>(, <b>)+
  <device>.side <group> = top|bottom|left|right
  legend auto|off | legend add <style> "text" | legend remove <entry> | legend note "text" | legend position bottom|right
  style jumps arc|gap|none
  route <a> -> <b> ["label"]     allow <a> -> <b> ["label"]     hide <target>

  'link a -- b -- c.p' expands to two links (a-b, b-c.p); 'link sw -- x, y' expands to sw-x and sw-y.
  colors: ${Object.keys(NAMED).join(", ")}
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
  netdraw import <file.rsc> [--as <id>] [--file f] [--json]
      Print the device block for a router export, ready to paste into the .net file in place of its import.
      With --file (default ./network.net) present, all its imports are translated together and the block of the one
      resolving to <file.rsc> is printed; otherwise the .rsc is translated alone, id = --as or its basename.
      --json  print {ok, stmt, diags}.
  netdraw --help | <command> --help

Common options:
  --file <f>   the DSL file (default ./network.net)
  --json       machine-readable output on stdout only (one JSON document)

Exit codes: 0 ok; 1 model/check errors or runtime failure; 2 usage error (unknown command, unknown flag, missing argument).
Errors in --json mode: {"error": string, "file": string, "line": number, "hint"?: string}; diagnostics use
{"level": "error"|"warning", "file", "line", "message", "hint"?}.
No command prompts interactively. Editing commands come in a later version.`;

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
    text = model.vlans.map((v) => `${v.name}: ${v.ids === "untagged" ? "untagged" : v.ids.join(",")}  ${v.color}${v.subnets.length ? `  ${v.subnets.join(", ")}` : ""}`);
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

function importCmd(rsc: string | undefined, as: string | undefined, file: string, json: boolean): number {
  if (!rsc) return fail(json, 2, { error: "missing argument: <file.rsc>", hint: "run netdraw --help" });
  const read = (p: string) => { try { return readFileSync(p, "utf8"); } catch { return undefined; } };
  const abs = resolve(rsc);
  const net = existsSync(file) ? parseDsl(readFileSync(file, "utf8"), file).stmts : [];
  const vlans: VlanDef[] = net.flatMap((v) => (v.kind === "vlan" ? [{ name: v.name, ids: v.ids, color: v.color ?? "grey", subnets: v.subnets }] : []));
  const devs: { id: string; line: number; f: DeviceFacts }[] = [];
  let target = -1;
  for (const s of net) {
    if (s.kind !== "import") continue;
    const path = isAbsolute(s.file) ? s.file : join(dirname(file), s.file);
    const text = read(path);
    if (text === undefined) continue; // an unreadable sibling only costs its CAPsMAN radios
    if (resolve(path) === abs && target < 0) target = devs.length;
    devs.push({ id: s.as, line: s.line, f: importRsc(text, path, s.as) });
  }
  if (target < 0) {
    const text = read(rsc);
    if (text === undefined) return fail(json, 1, { error: `cannot read ${rsc}`, file: rsc, hint: "check the path" });
    const id = as ?? basename(rsc).replace(/\.rsc$/, "");
    devs.length = 0;
    devs.push({ id, line: 0, f: importRsc(text, rsc, id) });
    target = 0;
  }
  const t = translate(devs, vlans);
  const stmt = { ...t.stmts[target]!, ...(as ? { id: as } : {}) };
  if (json) out(JSON.stringify({ ok: true, stmt, diags: t.diags }));
  else { t.diags.forEach((d) => err(fmt(d))); out(printStmts([stmt])); }
  return 0;
}

type Args = { file: string; json: boolean; as?: string; all?: boolean; o?: string; what?: string; rsc?: string };
class Usage extends Error {}
let crash: unknown; // an error a handler threw, rethrown to run()
let exit = 0; // the running command's exit code, set by its handler

/** The one parser; handlers set `exit`. Validation errors become exit 2 in the documented error shape. */
export function cli(argv: string[]): Argv {
  const json = argv.includes("--json");
  const go = (f: (a: Args) => number | Promise<number>) => async (a: unknown) => {
    try { exit = await f(a as Args); } catch (e) { crash = e; } // a rejection would escape to the runtime as unhandled
  };
  return yargs(argv)
    .scriptName("netdraw").usage(HELP).epilogue(GRAMMAR).wrap(null)
    .strict().exitProcess(false).version(false).alias("h", "help")
    .option("file", { type: "string", default: "./network.net", requiresArg: true, global: true })
    .option("json", { type: "boolean", default: false, global: true })
    .option("as", { type: "string", requiresArg: true, global: true })
    .option("all", { type: "boolean", global: true })
    .option("o", { type: "string", requiresArg: true, global: true })
    .demandCommand(1)
    .fail((msg, e) => {
      msg = msg || e?.message || "usage error";
      let m: RegExpExecArray | null;
      if (msg.startsWith("Not enough non-option arguments")) { err(HELP); msg = "missing command"; }
      else if ((m = /^Unknown arguments?: (.*)$/.exec(msg))) {
        const names = m[1]!.split(", ");
        const isFlag = (n: string) => argv.some((x) => x === `--${n}` || x === `-${n}` || x.startsWith(`--${n}=`));
        const flags = names.filter(isFlag);
        const first = argv.find((x) => !x.startsWith("-"));
        msg = flags.length ? `unknown flag${flags.length > 1 ? "s" : ""} ${flags.map((n) => (n.length > 1 ? "--" : "-") + n).join(", ")}`
          : names[0] === first ? `unknown command ${first}` : `unexpected argument ${names[0]}`;
      }
      exit = fail(json, 2, { error: msg, hint: "run netdraw --help" });
      throw new Usage(msg);
    })
    .command("render", false, {}, go((a) => render(a, "render")))
    .command("check", false, {}, go((a) => render(a, "check")))
    .command("show [what]", false, (y) => y.positional("what", { type: "string" }), go((a) => withModel(a, (m) => show(m, a.what, a.json, a.file))))
    .command("import [rsc]", false, (y) => y.positional("rsc", { type: "string" }), go((a) => importCmd(a.rsc, a.as, a.file, a.json)));
}

function withModel(a: Args, f: (m: Model) => number | Promise<number>): number | Promise<number> {
  const { file, json } = a;
  if (a.as !== undefined) return fail(json, 2, { error: "--as only applies to import", hint: "run netdraw --help" });
  if (!existsSync(file)) return fail(json, 1, { error: `cannot read ${file}`, file, hint: "pass --file or create ./network.net" });
  let model: Model;
  try { model = loadModel(file, { all: a.all ?? false }); }
  catch (e) { return fail(json, 1, { error: `cannot load ${file}: ${(e as Error).message.split("\n")[0]!.slice(0, 200)}`, file, hint: "check that the file and its imports are readable" }); }
  return f(model);
}

function render(a: Args, cmd: "render" | "check"): number | Promise<number> {
  return withModel(a, async (model) => {
    const { file, json } = a;
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
    if (a.o !== undefined) {
      try { writeFileSync(a.o, svg); }
      catch (e) { return fail(json, 1, { error: `cannot write ${a.o}: ${(e as Error).message.split("\n")[0]}`, file, hint: "check the output path is writable" }); }
    }
    if (json) out(JSON.stringify({ ok: true, output: a.o ?? null, width, height, warnings, ...(a.o === undefined ? { svg } : {}) }));
    else {
      warnings.forEach((d) => err(fmt(d)));
      if (a.o === undefined) process.stdout.write(svg);
    }
    return 0;
  });
}

async function main(argv: string[]): Promise<number> {
  if (argv[0] === "help") argv = ["--help"];
  exit = 0; crash = undefined;
  try { await cli(argv).parseAsync(); }
  catch (e) { if (!(e instanceof Usage)) throw e; }
  if (crash) throw crash;
  return exit;
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

process.exitCode = await run(hideBin(process.argv));
