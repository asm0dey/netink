import { expect, test } from "bun:test";
import { layout } from "../../src/layout/elk";
import { loadModel } from "../../src/model/build";
import { renderSvg } from "../../src/render/svg";

// Regenerate after an intended render change: bun -e 'import {layout} from "./src/layout/elk"; import {loadModel} from "./src/model/build"; import {renderSvg} from "./src/render/svg"; const m = loadModel("examples/home/network.net"); await Bun.write("test/fixtures/home.golden.svg", renderSvg(m, await layout(m)))'
test("renders home byte-identical to golden", async () => {
  const m = loadModel("examples/home/network.net");
  expect(renderSvg(m, await layout(m))).toBe(await Bun.file("test/fixtures/home.golden.svg").text());
});
