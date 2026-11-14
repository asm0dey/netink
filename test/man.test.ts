import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { NOUNS } from "../src/edit/table";
import { demote, manPage } from "../src/man";

const run = (...a: string[]) => {
  const r = Bun.spawnSync(["bun", "src/cli.ts", ...a]);
  return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
};

test("man page structure", () => {
  const m = manPage();
  expect(m.startsWith("netink(1) --")).toBe(true);
  for (const h of ["## SYNOPSIS", "## COMMANDS", "## EDITING COMMANDS", "## EXIT STATUS"]) expect(m).toContain(h);
  for (const c of ["render", "check", "show", "import", "init", "completion"]) expect(m).toContain(c);
  for (const n of NOUNS) expect(m).toContain(n.help);
  // the man page nests dsl.md under its "## DSL" heading, two levels down; code blocks are untouched
  const doc = readFileSync("docs/dsl.md", "utf8").trim();
  expect(m).toContain(demote(doc));
  expect(demote("# a\n```net\n# c\n```")).toBe("### a\n```net\n# c\n```");
  for (const f of ["--view", "--path"]) expect(m).toContain(f);
});
test("__man prints it, hidden from --help", () => {
  const r = run("__man");
  expect(r.code).toBe(0);
  expect(r.out.trimEnd()).toBe(manPage().trimEnd());
  expect(run("--help").out + run("--help").err).not.toContain("__man");
});
