import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const notes = (tag: string) => Bun.spawnSync(["bash", "scripts/release-notes.sh", tag]);

test("release notes for v0.1.0", () => {
  const r = notes("v0.1.0");
  const out = r.stdout.toString();
  expect(r.exitCode).toBe(0);
  expect(out.trim().length).toBeGreaterThan(0);
  expect(out.split("\n").some((l) => l.startsWith("## "))).toBe(false);
});

test("non-semver tag is refused", () => {
  for (const t of ["v1", "0.1.0", "v0.1"]) expect(notes(t).exitCode).toBe(1);
});

test("missing changelog section is refused", () => {
  const r = notes("v9.9.9");
  expect(r.exitCode).toBe(1);
  expect(r.stderr.toString()).toContain("CHANGELOG.md");
});

test("workflow builds from the tag", () => {
  const w = readFileSync(".github/workflows/release.yml", "utf8");
  for (const s of [
    "tags:",
    "v*.*.*",
    "mise run test",
    "mise run build-all",
    "scripts/release-notes.sh",
    "dist/netink.1",
  ])
    expect(w).toContain(s);
  const secrets = w.match(/secrets\.\w+/g) ?? [];
  expect(secrets.every((s) => s === "secrets.GITHUB_TOKEN")).toBe(true);
});

test("LICENSE is MIT", () => {
  const l = readFileSync("LICENSE", "utf8");
  expect(l.startsWith("MIT License")).toBe(true);
  expect(l).toContain("Copyright (c) 2026 asm0dey");
});
