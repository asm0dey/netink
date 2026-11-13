import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";

const imports = (f: string) => [...readFileSync(f, "utf8").matchAll(/from "([^"]+)"/g)].map((m) => m[1]!);
const model = readdirSync("src/model")
  .filter((f) => f.endsWith(".ts"))
  .map((f) => f.slice(0, -3));

test("src/model is a leaf layer: no rsc, render, dsl or layout imports", () => {
  for (const f of model)
    expect(
      imports(`src/model/${f}.ts`).filter((i) => /\.\.\/(rsc|render|dsl|layout)/.test(i)),
      f,
    ).toEqual([]);
});

test("src/dsl/parse.ts does not import render", () => {
  expect(imports("src/dsl/parse.ts").filter((i) => i.includes("../render"))).toEqual([]);
});

test("no two src/model files import each other", () => {
  const dep = (a: string, b: string) => imports(`src/model/${a}.ts`).includes(`./${b}`);
  for (const a of model) for (const b of model) if (a < b) expect(dep(a, b) && dep(b, a), `${a} <-> ${b}`).toBe(false);
});
