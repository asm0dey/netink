#!/usr/bin/env bun
import {
  chmodSync,
  existsSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import type { Argv } from "yargs";
import { hideBin } from "yargs/helpers";
import { complete } from "./complete";
import { parseDsl } from "./dsl/parse";
import { printStmts } from "./dsl/print";
import { base, registerEditCommands, usageMessage } from "./edit/command";
import { type Candidate, type EditRequest, edit } from "./edit/edit";
import { NOUNS } from "./edit/table";
import { DESC, EPILOGUE, GRAMMAR } from "./help";
import { layout } from "./layout/elk";
import { loadModel } from "./load";
import { manPage } from "./man";
import { parseCidr } from "./model/addr";
import { checkModel } from "./model/check";
import { collapseSiblings } from "./model/collapse";
import { sliceModel } from "./model/slice";
import { renderSvg } from "./render/svg";
import { importRsc } from "./rsc/import";
import { translate } from "./rsc/translate";
import type { DeviceFacts, Diag, MNode, Model, VlanDef } from "./types";

const out = (s: string) => process.stdout.write(s.endsWith("\n") ? s : `${s}\n`);
const err = (s: string) => process.stderr.write(`${s}\n`);
const fmt = (d: Diag) => `${d.file}:${d.line}: ${d.level}: ${d.message}${d.hint ? ` (${d.hint})` : ""}`;

function fail(
  json: boolean,
  code: number,
  e: { error: string; file?: string; line?: number; hint?: string; candidates?: Candidate[] },
): number {
  const body = {
    error: e.error,
    file: e.file ?? "",
    line: e.line ?? 0,
    ...(e.hint ? { hint: e.hint } : {}),
    ...(e.candidates ? { candidates: e.candidates } : {}),
  };
  if (json) out(JSON.stringify(body));
  else {
    err(
      `${body.file && body.line ? `${body.file}:${body.line}: ` : ""}error: ${e.error}${e.hint ? ` (${e.hint})` : ""}`,
    );
    e.candidates?.forEach((c) => {
      err(`${body.file}:${c.line}: ${c.text}`);
    });
  }
  return code;
}

function walk(ns: MNode[], f: (n: MNode) => void): void {
  for (const n of ns) {
    f(n);
    walk(n.children, f);
  }
}
function tree(n: MNode, depth = 0): string[] {
  const sub = n.sub.length ? `  [${n.sub.join("; ")}]` : "";
  return [
    `${"  ".repeat(depth)}${n.id} (${n.kind}) ${n.label}${sub}`,
    ...n.children.flatMap((c) => tree(c, depth + 1)),
  ];
}

function show(model: Model, what: string | undefined, json: boolean, file: string): number {
  let data: unknown, text: string[];
  if (what === undefined || what === "devices") {
    data = model.nodes;
    text = model.nodes.flatMap((n) => tree(n));
  } else if (what === "links") {
    data = model.links;
    text = model.links.map(
      (l) => `${l.id}: ${l.from} -- ${l.to}  lanes: ${l.lanes.join(", ") || "-"}${l.label ? `  "${l.label}"` : ""}`,
    );
  } else if (what === "vlans") {
    data = model.vlans;
    text = model.vlans.map(
      (v) =>
        `${v.name}: ${v.ids === "untagged" ? "untagged" : v.ids.join(",")}  ${v.color}${v.subnets.length ? `  ${v.subnets.join(", ")}` : ""}`,
    );
  } else if (what === "trunks") {
    data = model.trunks;
    text = model.trunks.map((t) => `${t.name}: ${t.vlans.join(", ")}`);
  } else {
    let node: MNode | undefined;
    walk(model.nodes, (n) => {
      if (n.id === what) node = n;
    });
    const found = node ?? model.links.find((l) => l.id === what) ?? model.arrows.find((a) => a.id === what);
    if (!found)
      return fail(json, 1, {
        error: `no device, link or arrow with id ${what}`,
        file,
        hint: "run netink show devices|links to list ids",
      });
    data = found;
    text = node ? tree(node) : [JSON.stringify(found, null, 2)];
  }
  out(json ? JSON.stringify(data, null, 2) : text.join("\n"));
  return 0;
}

function importCmd(rsc: string | undefined, as: string | undefined, file: string, json: boolean): number {
  if (!rsc) return fail(json, 2, { error: "missing argument: <file.rsc>", hint: "run netink --help" });
  const read = (p: string) => {
    try {
      return readFileSync(p, "utf8");
    } catch {
      return undefined;
    }
  };
  const abs = resolve(rsc);
  const net = existsSync(file) ? parseDsl(readFileSync(file, "utf8"), file).stmts : [];
  const vlans: VlanDef[] = net.flatMap((v) =>
    v.kind === "vlan" ? [{ name: v.name, ids: v.ids, color: v.color ?? "grey", subnets: v.subnets }] : [],
  );
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
  else {
    t.diags.forEach((d) => {
      err(fmt(d));
    });
    out(printStmts([stmt]));
  }
  return 0;
}

const COMPLETE_FIRST = new Set([
  "render",
  "check",
  "show",
  "import",
  "init",
  "completion",
  ...NOUNS.map((n) => n.name.split(" ")[0]!),
]);

type Args = {
  file: string;
  json: boolean;
  as?: string;
  all?: boolean;
  collapse?: boolean;
  view?: "combined" | "physical" | "vlans" | "routing";
  vlan?: string[];
  around?: string;
  depth?: number;
  o?: string;
  what?: string;
  rsc?: string;
  path?: string | string[];
  address?: string;
};
class Usage extends Error {}
let crash: unknown; // an error a handler threw, rethrown to run()
let exit = 0; // the running command's exit code, set by its handler

/** The one parser; handlers set `exit`. Validation errors become exit 2 in the documented error shape. */
export function cli(argv: string[]): Argv {
  const json = argv.includes("--json");
  const go = (f: (a: Args) => number | Promise<number>) => async (a: unknown) => {
    try {
      exit = await f(a as Args);
    } catch (e) {
      crash = e;
    } // a rejection would escape to the runtime as unhandled
  };
  const all = { type: "boolean", describe: "include spare/unused parts" } as const;
  const y = base(argv)
    .scriptName("netink")
    .usage(
      "netink - render network diagrams from a DSL plus optional MikroTik .rsc exports.\n\nUsage: netink <command> [options]",
    )
    .epilogue(EPILOGUE)
    .alias("h", "help")
    .wrap(Math.min(130, process.stdout.columns ?? 120))
    .demandCommand(1, "missing command")
    .fail((msg, e) => {
      msg = usageMessage(msg || e?.message || "usage error", argv);
      if (msg === "missing command") y.showHelp((t) => err(t));
      exit = fail(json, 2, { error: msg, hint: "run netink --help" });
      throw new Usage(msg);
    })
    // yargs's script calls back with `--get-yargs-completions <words>`; the first word is the program name
    .completion("completion", DESC.completion, () => {
      const w = argv.slice(argv.indexOf("--get-yargs-completions") + 1);
      return complete(w.length > 1 && !COMPLETE_FIRST.has(w[0]!) ? w.slice(1) : w);
    })
    .command(
      "render",
      DESC.render,
      (y) =>
        y
          .option("all", all)
          .option("collapse", {
            type: "boolean",
            default: true,
            describe: "merge identical leaf siblings into one box (--no-collapse draws each)",
          })
          .option("o", { type: "string", requiresArg: true, describe: "output SVG file (default: stdout)" })
          .option("view", {
            choices: ["combined", "physical", "vlans", "routing"] as const,
            describe: "physical: wires only; vlans: no route arrows; routing: routers only",
          })
          .option("vlan", {
            type: "string",
            array: true,
            requiresArg: true,
            describe: "keep devices carrying this VLAN (name or id; repeatable)",
          })
          .option("around", { type: "string", requiresArg: true, describe: "keep devices near this device" })
          .option("depth", { type: "number", describe: "links from --around to keep (default 1)" })
          .option("path", {
            type: "string",
            array: true,
            nargs: 2,
            describe: "keep devices on any shortest path between two devices",
          })
          .option("address", {
            type: "string",
            requiresArg: true,
            describe: "keep devices with an address in or around this IP or prefix, and VLANs whose subnet it meets",
          })
          .check((a) => {
            if (a.path && a.path.length !== 2) throw new Error("--path takes exactly two devices");
            if (a.address !== undefined && !parseCidr(a.address))
              throw new Error(`--address "${a.address}" is not an IP address or prefix`);
            // thrown, not returned: yargs would call .fail() again for the Usage error .fail() throws
            if (a.depth !== undefined && (!Number.isInteger(a.depth) || a.depth < 0))
              throw new Error("--depth must be a whole number, 0 or more");
            if (a.depth !== undefined && a.around === undefined) throw new Error("--depth needs --around");
            return true;
          }),
      go((a) => render(a, "render")),
    )
    .command(
      "check",
      DESC.check,
      (y) => y.option("all", all),
      go((a) => render(a, "check")),
    )
    .command(
      "show [what]",
      DESC.show,
      (y) =>
        y
          .positional("what", { type: "string", describe: "devices | links | vlans | trunks | an id" })
          .option("all", all),
      go((a) => withModel(a, (m) => show(m, a.what, a.json, a.file))),
    )
    .command(
      "init [path]",
      DESC.init,
      (y) => y.positional("path", { type: "string", describe: "the file to create" }),
      go((a) => init((a.path as string | undefined) ?? a.file, a.json)),
    )
    .command("__man", false, {}, () => {
      out(manPage());
    }); // hidden: the man page source, see the man task
  return registerEditCommands(y, (req, a) => go((x) => editCmd(req, x.file, x.json))(a), {
    import: {
      cmd: "import [rsc]",
      desc: DESC.import,
      builder: (y) => y.option("as", { type: "string", requiresArg: true, describe: "the id of the printed device" }),
      handler: go((a) => importCmd(a.rsc, a.as, a.file, a.json)),
    },
  });
}

function init(file: string, json: boolean): number {
  try {
    writeFileSync(file, "", { flag: "wx" });
  } catch (e) {
    const exists = (e as NodeJS.ErrnoException).code === "EEXIST";
    return fail(json, 1, {
      error: exists ? `${file} exists` : `cannot create ${file}: ${(e as Error).message.split("\n")[0]}`,
      file,
      ...(exists ? { hint: "edit it with netink <noun> add ..." } : {}),
    });
  }
  if (json) out(JSON.stringify({ ok: true, file }));
  return 0;
}

/** Edit `file` in place (atomic temp + rename), then check what was written; check's findings never undo the write. */
function editCmd(req: EditRequest, file: string, json: boolean): number {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return fail(json, 1, { error: `cannot read ${file}`, file, hint: "pass --file, or create it with netink init" });
  }
  const r = edit(text, file, req);
  if (!r.ok) return fail(json, 1, { error: r.error, file, line: r.line, hint: r.hint, candidates: r.candidates });
  // through a symlink to its target, keeping the target's mode (a private file stays private)
  const real = realpathSync(file),
    tmp = join(dirname(real), `.${basename(real)}.${process.pid}.tmp`);
  try {
    writeFileSync(tmp, r.text);
    chmodSync(tmp, statSync(real).mode);
    renameSync(tmp, real);
  } catch (e) {
    rmSync(tmp, { force: true });
    return fail(json, 1, {
      error: `cannot write ${file}: ${(e as Error).message.split("\n")[0]}`,
      file,
      hint: "check the file's directory is writable",
    });
  }
  let diags: Diag[];
  try {
    // "has no links" / "carried by no link" are expected mid-build, one command at a time: check and render still say it
    diags = checkModel({ ...loadModel(file), usage: [] });
  } catch (e) {
    diags = [
      {
        level: "error",
        file,
        line: 0,
        message: `cannot load ${file}: ${(e as Error).message.split("\n")[0]!.slice(0, 200)}`,
      },
    ];
  }
  if (json) out(JSON.stringify({ ok: true, file, line: r.line, text: r.written, diags }));
  else {
    if (r.written) out(r.written);
    diags.forEach((d) => {
      err(fmt(d));
    });
  }
  return 0;
}

function withModel(a: Args, f: (m: Model) => number | Promise<number>): number | Promise<number> {
  const { file, json } = a;
  if (!existsSync(file))
    return fail(json, 1, { error: `cannot read ${file}`, file, hint: "pass --file or create ./network.net" });
  let model: Model;
  try {
    model = loadModel(file, { all: a.all ?? false });
  } catch (e) {
    return fail(json, 1, {
      error: `cannot load ${file}: ${(e as Error).message.split("\n")[0]!.slice(0, 200)}`,
      file,
      hint: "check that the file and its imports are readable",
    });
  }
  return f(model);
}

function render(a: Args, cmd: "render" | "check"): number | Promise<number> {
  return withModel(a, async (model) => {
    const { file, json } = a;
    const diags = checkModel(model);
    const errors = diags.filter((d) => d.level === "error");
    if (cmd === "check" || errors.length) {
      if (json) out(JSON.stringify({ ok: errors.length === 0, diags }));
      else
        diags.forEach((d) => {
          err(fmt(d));
        });
      return errors.length ? 1 : 0;
    }
    const sliced = sliceModel(model, {
      view: a.view,
      vlans: a.vlan,
      around: a.around,
      depth: a.depth,
      path: a.path as [string, string] | undefined,
      address: a.address,
    });
    if ("error" in sliced) return fail(json, 1, { ...sliced, file });
    let svg: string, width: number, height: number;
    try {
      const drawn = a.collapse === false ? sliced.model : collapseSiblings(sliced.model);
      svg = renderSvg(drawn, await layout(drawn));
      // the SVG's own size: the legend can make it larger than the layout
      const m = /^<svg [^>]*?width="([\d.]+)" height="([\d.]+)"/.exec(svg)!;
      width = Number(m[1]);
      height = Number(m[2]);
    } catch (e) {
      return fail(json, 1, {
        error: `layout failed: ${(e instanceof Error ? e.message : String(e)).split("\n")[0]!.slice(0, 200)}`,
        file,
        hint: "simplify the diagram (hide/row/place hints) and retry",
      });
    }
    const warnings = diags.filter((d) => d.level === "warning");
    if (a.o !== undefined) {
      try {
        writeFileSync(a.o, svg);
      } catch (e) {
        return fail(json, 1, {
          error: `cannot write ${a.o}: ${(e as Error).message.split("\n")[0]}`,
          file,
          hint: "check the output path is writable",
        });
      }
    }
    if (json)
      out(
        JSON.stringify({
          ok: true,
          output: a.o ?? null,
          width,
          height,
          warnings,
          ...(a.o === undefined ? { svg } : {}),
        }),
      );
    else {
      warnings.forEach((d) => {
        err(fmt(d));
      });
      if (a.o === undefined) process.stdout.write(svg);
    }
    return 0;
  });
}

async function main(argv: string[]): Promise<number> {
  if (argv[0] === "help") {
    const topic = argv.slice(1).find((a) => !a.startsWith("-"));
    if (topic === "dsl") return (out(GRAMMAR), 0);
    if (topic !== undefined)
      return fail(argv.includes("--json"), 2, { error: `unknown help topic ${topic}`, hint: "run netink help dsl" });
    argv = ["--help"];
  }
  exit = 0;
  crash = undefined;
  try {
    await cli(argv).parseAsync();
  } catch (e) {
    if (!(e instanceof Usage)) throw e;
  }
  if (crash) throw crash;
  return exit;
}

/** Last resort: any throw no command handled becomes the documented error shape, never a stack trace. */
async function run(argv: string[]): Promise<number> {
  try {
    return await main(argv);
  } catch (e) {
    const i = argv.indexOf("--file"),
      file = i >= 0 ? argv[i + 1] : argv.find((a) => a.startsWith("--file="))?.slice(7);
    const msg = (e instanceof Error ? e.message : String(e)).split("\n")[0]!.slice(0, 200);
    return fail(argv.includes("--json"), 1, {
      error: `internal error: ${msg}`,
      file: file ?? "",
      hint: "this is a netink bug; please report it with the input that triggers it",
    });
  }
}

process.exitCode = await run(hideBin(process.argv));
