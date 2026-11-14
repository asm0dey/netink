import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, normalize } from "node:path";
import { BLOCK, KEYWORDS } from "../src/dsl/parse";
import { GRAMMAR } from "../src/help";
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
  // shortcut: docs that don't exist yet are skipped; Task 7 removes the skip
  for (const doc of ["README.md", "docs/dsl.md", "docs/cli.md"].filter((d) => existsSync(d)))
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
