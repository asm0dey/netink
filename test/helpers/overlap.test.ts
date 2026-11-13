import { expect, test } from "bun:test";
import { layout } from "../../src/layout/elk";
import { loadModel } from "../../src/load";
import { renderSvg } from "../../src/render/svg";
import type { Placed } from "../../src/types";
import { overlaps } from "./overlap";

const placed = (...bs: [string, number, number, number, number][]): Placed => ({
  width: 500,
  height: 500,
  boxes: new Map(bs.map(([id, x, y, w, h]) => [id, { id, x, y, w, h }])),
  links: [],
  arrows: [],
});
const t = (x: number, y: number, s: string) => `<text x="${x}" y="${y}">${s}</text>`;

test("two texts at the same spot overlap", () => {
  expect(overlaps(t(10, 20, "a") + t(10, 20, "b"), placed())).toHaveLength(1);
});
test("partly overlapping boxes are reported, nested boxes are not", () => {
  expect(overlaps("", placed(["a", 0, 0, 100, 100], ["b", 50, 50, 100, 100]))).toHaveLength(1);
  expect(overlaps("", placed(["a", 0, 0, 100, 100], ["b", 10, 10, 20, 20]))).toEqual([]);
});
test("a text half across a box border is reported, one inside is not", () => {
  const p = placed(["a", 0, 0, 100, 100]);
  expect(overlaps(t(80, 50, "abcdefgh"), p)).toHaveLength(1);
  expect(overlaps(t(10, 50, "abc"), p)).toEqual([]);
});
test("text-anchor end and tspans are measured", () => {
  const p = placed(["a", 0, 0, 100, 100]);
  expect(overlaps('<text x="105" y="50" text-anchor="end">abcdefgh</text>', p)).toHaveLength(1);
  expect(overlaps('<text x="50" y="50" text-anchor="end">a<tspan class="s">b</tspan></text>', p)).toEqual([]);
});
test("home renders with no overlaps", async () => {
  const m = loadModel("examples/home/network.net"),
    p = await layout(m);
  expect(overlaps(renderSvg(m, p), p)).toEqual([]);
});
