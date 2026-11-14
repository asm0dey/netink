import { expect, test } from "bun:test";
import { layout } from "../../src/layout/elk";
import { loadModel } from "../../src/load";
import { collapseSiblings } from "../../src/model/collapse";
import { type Slice, sliceModel } from "../../src/model/slice";
import { renderSvg } from "../../src/render/svg";
import { overlaps } from "../helpers/overlap";

// Same path as `netink render`: load -> sliceModel -> collapseSiblings -> layout -> renderSvg.
// Regenerate after an intended render change (owner's yes first):
//   UPDATE_GOLDENS=1 bun test test/acceptance/large-goldens.test.ts
const CASES: [string, string, Slice][] = [
  ...(
    [
      ["scale", "test/fixtures/scale", "ex-mdf-01", "exSpkr", ["confidf", "expoidf"], "10.0.4.17"],
      [
        "netbox",
        "test/fixtures/netbox",
        "dmi01-akron-rtr01",
        "Data-dm-akron",
        ["dmi01-akron-rtr01", "dmi01-akron-sw01"],
        "10.112.129.0/24",
      ],
    ] as const
  ).flatMap(([name, dir, core, vlan, path, address]): [string, string, Slice][] => [
    [name, `${dir}/full.golden.svg`, {}],
    [name, `${dir}/around.golden.svg`, { around: core, depth: 1 }],
    [name, `${dir}/vlan.golden.svg`, { vlans: [vlan] }],
    [name, `${dir}/physical.golden.svg`, { view: "physical" }],
    [name, `${dir}/routing.golden.svg`, { view: "routing" }],
    [name, `${dir}/path.golden.svg`, { path: [path[0], path[1]] }],
    [name, `${dir}/address.golden.svg`, { address }],
  ]),
];

test.each(CASES)(
  "%s: %s matches golden, no overlaps",
  async (name, golden, slice) => {
    const r = sliceModel(loadModel(`test/fixtures/${name}/network.net`), slice);
    if ("error" in r) throw new Error(r.error);
    const m = collapseSiblings(r.model),
      p = await layout(m),
      svg = renderSvg(m, p);
    if (process.env.UPDATE_GOLDENS) await Bun.write(golden, svg);
    expect(svg).toBe(await Bun.file(golden).text());
    expect(overlaps(svg, p)).toEqual([]);
  },
  60000,
);
