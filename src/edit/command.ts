import yargs, { type Argv } from "yargs";
import type { EditRequest } from "./edit";
import { NOUNS, type Args, type Noun, type Verb } from "./table";

/** Parser settings the CLI and parseEditArgv share: values stay the strings typed (`--vlan 10` is "10", `010` keeps its zero). */
export const base = (argv: string[]): Argv => yargs(argv).strict().exitProcess(false).version(false).wrap(null)
  .parserConfiguration({ "parse-numbers": false, "parse-positional-numbers": false })
  .option("file", { type: "string", default: "./network.net", requiresArg: true, global: true, describe: "the DSL file" })
  .option("json", { type: "boolean", default: false, global: true, describe: "machine-readable output on stdout (one JSON document)" });

/** yargs's validation message in netdraw's words. */
export function usageMessage(msg: string, argv: string[]): string {
  if (msg.startsWith("Not enough non-option arguments")) return "missing argument";
  const m = /^Unknown arguments?: (.*)$/.exec(msg);
  if (!m) return msg;
  const names = m[1]!.split(", ");
  const isFlag = (n: string) => argv.some((x) => x === `--${n}` || x === `-${n}` || x === `--no-${n}` || x.startsWith(`--${n}=`));
  const flags = names.filter(isFlag);
  const first = argv.find((x) => !x.startsWith("-"));
  return flags.length ? `unknown flag${flags.length > 1 ? "s" : ""} ${flags.map((n) => (n.length > 1 ? "--" : "-") + n).join(", ")}`
    : names[0] === first ? `unknown command ${first}` : `unexpected argument ${names[0]}`;
}

export type OnEdit = (req: EditRequest, argv: Record<string, unknown>) => void | Promise<void>;
/** A top-level command that shares its word with a noun (`import <file.rsc>` next to `import add`). */
export type Plain = { cmd: string; desc: string; builder: (y: Argv) => Argv; handler: (argv: Record<string, unknown>) => void | Promise<void> };

const COMMON = ["after", "before", "select-text"];

/** The request one verb command's parsed argv stands for. */
function request(noun: Noun, verb: Verb, a: Record<string, unknown>): EditRequest {
  const pos = noun.args.flatMap((p) => { const v = a[p.name]; return v === undefined ? [] : Array.isArray(v) ? v.map(String) : [String(v)]; });
  const flags: Args["flags"] = {};
  for (const n of [...noun.flags.map((f) => f.name).filter((n) => !(noun.name === "allow" && n === "in")), ...COMMON]) { // `--in` is the parent, not a flag
    const v = a[n];
    if (v !== undefined) flags[n] = (Array.isArray(v) ? v.at(-1) : v) as string | boolean; // a repeated flag: the last one wins
  }
  // `allow` is the only noun whose parent is optional: `--in <device>` puts it inside that block
  const parent = noun.block ? a.parent : noun.name === "allow" ? a.in : undefined;
  return { noun, verb, args: { ...(parent !== undefined ? { parent: String(parent) } : {}), pos, flags } };
}

function verbs(y: Argv, noun: Noun, onEdit: OnEdit): Argv {
  const pos = [...(noun.block ? [{ name: "parent" }] : []), ...noun.args];
  for (const verb of noun.verbs) {
    const usage = [verb, ...pos.map((p) => {
      const n = p.name + ("variadic" in p && p.variadic ? ".." : "");
      return "optional" in p && p.optional ? `[${n}]` : `<${n}>`;
    })].join(" ");
    y.command(usage, `${verb} ${noun.name}`, (z: Argv): Argv => {
      for (const f of noun.flags) z.option(f.name, { type: f.type, describe: f.help, ...(f.type === "string" ? { requiresArg: true } : {}) });
      return z
        .option("after", { type: "string", requiresArg: true, describe: "insert after this sibling (its key)" })
        .option("before", { type: "string", requiresArg: true, describe: "insert before this sibling (its key)" })
        .option("select-text", { type: "string", requiresArg: true, describe: "of several matches, the one whose source contains this text" })
        .conflicts("after", "before");
    }, (a: Record<string, unknown>) => onEdit(request(noun, verb, a), a));
  }
  return y;
}

/** One command per noun word (two-word nouns as `legend <sub>`), one subcommand per verb; each verb handler calls `onEdit`. */
export function registerEditCommands(y: Argv, onEdit: OnEdit, plain: Record<string, Plain> = {}): Argv {
  for (const w of new Set(NOUNS.map((n) => n.name.split(" ")[0]!))) {
    const own = NOUNS.filter((n) => n.name.split(" ")[0] === w), p = plain[w];
    y.command(p?.cmd ?? w, [...(p ? [p.desc] : []), ...own.map((n) => n.help)].join("\n"), (z: Argv): Argv => {
      for (const n of own) {
        const sub = n.name.split(" ")[1];
        if (sub) z.command(sub, n.help, (s: Argv) => verbs(s, n, onEdit).demandCommand(1, `missing verb: ${n.verbs.join("|")}`));
        else verbs(z, n, onEdit);
      }
      return p ? p.builder(z) : z.demandCommand(1, `missing verb: run netdraw ${w} --help`);
    }, p?.handler);
  }
  return y;
}

class Usage extends Error {}

/** One editing command line (argv after `netdraw`) as a request, with the CLI's definitions; runs nothing and prints nothing. */
export function parseEditArgv(argv: string[]): { req: EditRequest } | { usage: string } {
  let req: EditRequest | undefined;
  try {
    const y = base(argv).help(false).demandCommand(1, "missing command")
      .fail((msg, e) => { throw new Usage(usageMessage(msg || e?.message || "usage error", argv)); });
    registerEditCommands(y, (r) => { req = r; }).parse();
  } catch (e) {
    if (e instanceof Usage) return { usage: e.message };
    throw e;
  }
  return req ? { req } : { usage: "not an editing command" };
}
