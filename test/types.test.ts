import { it, expect } from "bun:test";
import type { Model } from "../src/types";

it("exports compile", () => {
  const m: Model = {
    title: "t",
    nodes: [],
    links: [],
    arrows: [],
    vlans: [],
    legend: { mode: "auto", add: [], remove: [], notes: [], position: "bottom" },
    jumps: "arc",
    hints: [],
    diags: [],
  };
  expect(m.nodes).toHaveLength(0);
});
