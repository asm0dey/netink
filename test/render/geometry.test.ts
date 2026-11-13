import { expect, test } from "bun:test";
import { jumpPath, laneOffset, lanesFor } from "../../src/render/geometry";

const L = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];

test("laneOffset at a right-angle bend", () => {
  expect(laneOffset(L, 7)).toEqual([{ x: 0, y: 7 }, { x: 93, y: 7 }, { x: 93, y: 100 }]);
});

test("laneOffset mitres a diagonal bend: offset lines stay at distance d", () => {
  const out = laneOffset([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 100 }], 10);
  expect(out[0]).toEqual({ x: 0, y: 10 });
  // the mitre point lies on both offset lines: y = 10 and the diagonal shifted by 10 along (-1,1)/√2
  expect(out[1]!.y).toBeCloseTo(10);
  expect((out[1]!.y - out[1]!.x) / Math.SQRT2).toBeCloseTo(-100 / Math.SQRT2 + 10);
});

test("laneOffset of a straight run is a plain shift", () => {
  expect(laneOffset([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }], -7)).toEqual([{ x: 0, y: -7 }, { x: 50, y: -7 }, { x: 100, y: -7 }]);
});

test("lanesFor centres lanes 7 px apart and collapses more than 4 into a trunk", () => {
  const two = lanesFor(L, ["a", "b"]);
  expect(two.map((l) => l.lane)).toEqual(["a", "b"]);
  expect(two[0]!.points[0]).toEqual({ x: 0, y: -3.5 });
  expect(two[1]!.points[0]).toEqual({ x: 0, y: 3.5 });
  const five = lanesFor(L, ["a", "b", "c", "d", "e"]);
  expect(five).toEqual([{ lane: "trunk", points: L }]);
});

test("jumpPath arcs a horizontal segment over a vertical crosser", () => {
  const h = [{ x: 0, y: 50 }, { x: 100, y: 50 }];
  expect(jumpPath(h, [{ x: 50, y1: 0, y2: 100 }], 5, "arc")).toBe("M0,50 L45,50 A5,5 0 0 1 55,50 L100,50");
  expect(jumpPath(h, [{ x: 4, y1: 0, y2: 100 }], 5, "arc")).not.toContain("A");
  expect(jumpPath(h, [{ x: 50, y1: 48, y2: 100 }], 5, "arc")).not.toContain("A"); // T-junction, not a crossing
  expect(jumpPath(h, [{ x: 50, y1: 0, y2: 100 }], 5, "gap")).toBe("M0,50 L45,50 M55,50 L100,50");
  expect(jumpPath(h, [{ x: 50, y1: 0, y2: 100 }], 5, "none")).toBe("M0,50 L100,50");
});

test("jumpPath right-to-left sweeps the other way and rounds to 0.1 px", () => {
  const h = [{ x: 100.04, y: 50 }, { x: 0, y: 50 }];
  expect(jumpPath(h, [{ x: 50, y1: 0, y2: 100 }], 5, "arc")).toBe("M100,50 L55,50 A5,5 0 0 0 45,50 L0,50");
});

test("jumpPath merges a lane bundle into one flattened jump", () => {
  const h = [{ x: 0, y: 50 }, { x: 100, y: 50 }];
  const bundle = [43, 50, 57].map((x) => ({ x, y1: 0, y2: 100 }));
  expect(jumpPath(h, bundle, 5, "arc")).toBe("M0,50 L38,50 A12,5 0 0 1 62,50 L100,50");
});
