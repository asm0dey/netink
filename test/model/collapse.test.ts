import { expect, test } from "bun:test";
import { parseDsl } from "../../src/dsl/parse";
import { buildModel, loadModel } from "../../src/load";
import { collapseSiblings } from "../../src/model/collapse";

const rooms = (n: number, extra = "", port = "sw") =>
  `title T\ndevice sw "SW" kind switch\ndevice sw2 "SW2" kind switch\n${Array.from({ length: n }, (_, i) => `client cfroom${101 + i}\nlink ${port} -- cfroom${101 + i}`).join("\n")}\n${extra}`;
const model = (src: string) => buildModel(parseDsl(src, "t.net").stmts, new Map());

test("14 identical rooms on one port collapse into one node and one link", () => {
  const m = collapseSiblings(model(rooms(14)));
  const n = m.nodes.find((x) => x.members)!;
  expect(n.id).toBe("cfroom101..cfroom114");
  expect(n.label).toBe("14× cfroom");
  expect(n.sub.join(" ")).toContain("cfroom101–114");
  expect(n.members).toHaveLength(14);
  expect(m.links.filter((l) => l.to === n.id || l.from === n.id)).toHaveLength(1);
  expect(m.nodes.some((x) => x.id === "cfroom105")).toBe(false);
});

test("below three nothing collapses", () => {
  const m = model(rooms(2));
  expect(collapseSiblings(m)).toEqual(m);
});

test("a member with a note stays separate", () => {
  const src = rooms(14).replace("client cfroom105", 'client cfroom105 note "projector broken"');
  const m = collapseSiblings(model(src));
  expect(m.nodes.find((x) => x.members)!.members).toHaveLength(13);
  expect(m.nodes.some((x) => x.id === "cfroom105")).toBe(true);
});

test("members on different endpoints form separate groups", () => {
  const src = `${rooms(3)}\n${rooms(3, "", "sw2")
    .replace(/cfroom1/g, "lab1")
    .split("\n")
    .slice(3)
    .join("\n")}`;
  const m = collapseSiblings(model(src));
  expect(m.nodes.filter((x) => x.members).map((x) => x.id)).toEqual(["cfroom101..cfroom103", "lab101..lab103"]);
  const four = collapseSiblings(
    model(
      `${rooms(2)}\n${rooms(2, "", "sw2")
        .replace(/cfroom1/g, "lab1")
        .split("\n")
        .slice(3)
        .join("\n")}`,
    ),
  );
  expect(four.nodes.some((x) => x.members)).toBe(false);
});

test("the home model is unchanged", () => {
  const m = loadModel("examples/home/network.net");
  expect(collapseSiblings(m)).toEqual(m);
});

test("render --no-collapse draws every SCaLE device, default collapses some", () => {
  const run = (...a: string[]) =>
    Bun.spawnSync(["bun", "src/cli.ts", "render", "--file", "test/fixtures/scale/network.net", ...a]).stdout.toString();
  const full = run("--no-collapse"),
    auto = run();
  const boxes = (s: string) => (s.match(/class="h"/g) ?? []).length;
  const size = (s: string) => /<svg [^>]*?width="([\d.]+)" height="([\d.]+)"/.exec(s)!.slice(1).join("x");
  const top = loadModel("test/fixtures/scale/network.net").nodes.filter((n) => n.kind === "device");
  expect(top.every((n) => full.includes(`>${n.label}<`) || full.includes(n.label))).toBe(true);
  expect(boxes(auto)).toBeLessThan(boxes(full));
});
