import { expect, test } from "bun:test";
import { manPage } from "../src/man";
import { NOUNS } from "../src/edit/table";
import { GRAMMAR } from "../src/help";

const run = (...a: string[]) => {
  const r = Bun.spawnSync(["bun", "src/cli.ts", ...a]);
  return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
};

test("man page structure", () => {
  const m = manPage();
  expect(m.startsWith("netdraw(1) --")).toBe(true);
  for (const h of ["## SYNOPSIS", "## COMMANDS", "## EDITING COMMANDS", "## EXIT STATUS"]) expect(m).toContain(h);
  for (const c of ["render", "check", "show", "import", "init", "completion"]) expect(m).toContain(c);
  for (const n of NOUNS) expect(m).toContain(n.help);
  expect(m).toContain(GRAMMAR);
});
test("__man prints it, hidden from --help", () => {
  const r = run("__man");
  expect(r.code).toBe(0);
  expect(r.out.trimEnd()).toBe(manPage().trimEnd());
  expect(run("--help").out + run("--help").err).not.toContain("__man");
});
