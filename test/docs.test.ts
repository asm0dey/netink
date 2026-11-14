import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, normalize } from "node:path";
import { BLOCK, KEYWORDS } from "../src/dsl/parse";
import { NOUNS } from "../src/edit/table";
import { DESC, GRAMMAR } from "../src/help";
import { layout } from "../src/layout/elk";
import { loadModel } from "../src/load";
import { renderSvg } from "../src/render/svg";
import { blocks, headingCodes, relLinks, runExamples, sections } from "./helpers/docs";

const dsl = () => readFileSync("docs/dsl.md", "utf8");
const keywords = [...KEYWORDS.map((k) => (k === "<device>.side" ? ".side" : k)), ...BLOCK];
// a heading's code names keyword k when its first word is k (`<device>.side` names .side)
const heads = (md: string) => [...headingCodes(md)].map((c) => c.split(" ")[0]!.replace(/^<device>/, ""));
const word = (k: string) => new RegExp(`(^|[^\\w.-])${k.replace(/[.]/g, "\\.")}(?![\\w-])`, "m");

test("every DSL keyword has a heading in dsl.md", () => {
  const h = heads(dsl());
  expect(keywords.filter((k) => !h.includes(k))).toEqual([]);
});

test("help dsl card and dsl.md cover the same keywords", () => {
  const h = heads(dsl());
  const inCard = keywords.filter((k) => word(k).test(GRAMMAR));
  const inDoc = keywords.filter((k) => h.includes(k));
  expect(inCard).toEqual(inDoc);
});

test("dsl.md examples run", async () => {
  expect(await runExamples("docs/dsl.md")).toEqual([]);
}, 60_000);

test("example failures name file and line", async () => {
  const f = join(mkdtempSync(join(tmpdir(), "netink-doc-")), "bad.md");
  writeFileSync(f, "# x\n\n```console\n$ netink check --file nope.net\n```\n");
  const r = await runExamples(f);
  expect(r).toHaveLength(1);
  expect(r[0]).toMatch(/^.*\.md:\d+: /);
  expect(r[0]).toContain("exit 1");
});

test("relative links resolve to tracked files", () => {
  const tracked = new Set(Bun.spawnSync(["git", "ls-files"]).stdout.toString().split("\n"));
  const bad: string[] = [];
  for (const doc of ["README.md", "docs/dsl.md", "docs/cli.md"])
    for (const l of relLinks(readFileSync(doc, "utf8"))) {
      if (l.startsWith("../../releases")) continue;
      const p = normalize(join(dirname(doc), l));
      if (!tracked.has(p)) bad.push(`${doc}: ${l}`);
    }
  expect(bad).toEqual([]);
});

test("doc helpers read headings, sections, blocks and links", () => {
  const md = [
    "# `a` top",
    'x [l](docs/x.md#frag) ![i](../i.svg) [w](https://e.org) [h](#a) <img src="logo.svg">',
    "## `b`",
    "```net file=n.net",
    "# `c` not a heading [n](no.md)",
    "```",
    "# `d`",
  ].join("\n");
  expect([...headingCodes(md)]).toEqual(["a", "b", "d"]);
  expect(sections(md).get("b")).toBe("```net file=n.net\n# `c` not a heading [n](no.md)\n```");
  expect(sections(md).get("a")).toContain("## `b`");
  expect(blocks(md)).toEqual([{ lang: "net", info: "file=n.net", body: "# `c` not a heading [n](no.md)", line: 4 }]);
  expect(relLinks(md)).toEqual(["docs/x.md", "../i.svg", "logo.svg"]);
});

const cli = () => readFileSync("docs/cli.md", "utf8");
const GLOBAL = ["--file", "--json", "--version", "--help"];
// the section for a command or noun: its heading code is `name` or `netink name`
const section = (md: string, name: string) => sections(md).get(name) ?? sections(md).get(`netink ${name}`);

test("every command and noun has a heading in cli.md", () => {
  const h = headingCodes(cli());
  const names = [...Object.keys(DESC), "help", ...NOUNS.map((n) => n.name)];
  expect(names.filter((n) => !h.has(n) && !h.has(`netink ${n}`))).toEqual([]);
});

test("every flag is documented in its section", () => {
  const md = cli(),
    missing: string[] = [];
  const need = (name: string, flags: string[]) => {
    const s = section(md, name) ?? "";
    // a code span that starts with the flag: `--vlan` or `--vlan <v>`
    for (const f of flags) if (!new RegExp(`\`${f}[\` =]`).test(s)) missing.push(`${name}: ${f}`);
  };
  for (const cmd of Object.keys(DESC).filter((c) => c !== "completion")) {
    const help = Bun.spawnSync(["bun", "src/cli.ts", cmd, "--help"]).stdout.toString();
    need(
      cmd,
      [...new Set(help.match(/--[a-z][a-z-]*/g) ?? [])].filter((f) => !GLOBAL.includes(f)),
    );
  }
  for (const n of NOUNS) need(n.name, [...n.flags.map((f) => `--${f.name}`), "--after", "--before", "--select-text"]);
  for (const f of ["--file", "--json", "--version"]) if (!md.includes(`\`${f}\``)) missing.push(`global: ${f}`);
  expect(missing).toEqual([]);
});

test("cli.md examples run", async () => {
  expect(await runExamples("docs/cli.md")).toEqual([]);
}, 120_000);

const QUICK = "examples/quickstart/network.net";

// Regenerate after an intended render change: mise run render-quickstart
test("quickstart svg is current", async () => {
  const m = loadModel(QUICK);
  expect(renderSvg(m, await layout(m))).toBe(await Bun.file("examples/quickstart/network.svg").text());
});

test("README shows the quickstart source", () => {
  const net = blocks(readFileSync("README.md", "utf8")).find((b) => b.lang === "net");
  expect(net?.body.trim()).toBe(readFileSync(QUICK, "utf8").trim());
});

test("README examples run", async () => {
  expect(await runExamples("README.md")).toEqual([]);
}, 60_000);
