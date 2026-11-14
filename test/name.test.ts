import { expect, test } from "bun:test";

test("old name is gone outside history", () => {
  const r = Bun.spawnSync(["git", "grep", "-il", "netdraw", "--", ".", ":!docs/superpowers", ":!test/name.test.ts"]);
  expect(r.stdout.toString()).toBe("");
});

test("--help names netink", () => {
  const out = Bun.spawnSync(["bun", "src/cli.ts", "--help"]).stdout.toString();
  expect(out).toContain("netink <command>");
  expect(out).not.toContain("netdraw");
});
