import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { layout } from "../../src/layout/elk";
import { loadModel } from "../../src/load";
import { renderSvg } from "../../src/render/svg";

const RSC = "examples/home/network.net";
const DSL = "examples/home/network-dsl-only.net";
const strip = (x: unknown): unknown =>
  JSON.parse(JSON.stringify(x, (k, v) => (k === "line" || k === "file" || k === "diags" ? undefined : v)));

test("DSL-only home equals rsc home", async () => {
  const a = loadModel(RSC),
    b = loadModel(DSL);
  expect(strip(b)).toEqual(strip(a));
  const svg = renderSvg(b, await layout(b));
  expect(svg).toBe(renderSvg(a, await layout(a)));
  expect(svg).toBe(readFileSync("test/fixtures/home.golden.svg", "utf8"));
  expect(b.diags).toEqual([]);
  expect(readFileSync(DSL, "utf8")).not.toMatch(/^imports|\.rsc/m);
});
