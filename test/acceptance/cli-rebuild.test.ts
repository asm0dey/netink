import { expect, test } from "bun:test";
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseDsl } from "../../src/dsl/parse";
import { parseEditArgv } from "../../src/edit/command";
import { edit } from "../../src/edit/edit";
import { layout } from "../../src/layout/elk";
import { loadModel } from "../../src/load";
import { renderSvg } from "../../src/render/svg";

const HOME = "examples/home";
const GOLDEN = readFileSync("test/fixtures/home.golden.svg", "utf8");

/** Deep copy without `line` (recursively, items included) or undefined values. */
const strip = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(strip)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.entries(v)
            .filter(([k, x]) => k !== "line" && x !== undefined)
            .map(([k, x]) => [k, strip(x)]),
        )
      : v;

/** Each command applied in turn, in-process, as `netdraw <argv>` would. */
function run(text: string, file: string, cmds: string[][]): string {
  for (const argv of cmds) {
    const p = parseEditArgv(argv);
    if ("usage" in p) throw new Error(`usage error on [${argv.join(" ")}]: ${p.usage}`);
    const r = edit(text, file, p.req);
    if (!r.ok) throw new Error(`edit refused on [${argv.join(" ")}]: ${JSON.stringify(r)}`);
    text = r.text;
  }
  return text;
}

/** Everything after the device blocks: identical in both home files except the `# VLANs inferred` comment. */
const SHARED: string[][] = [
  ["vlan", "add", "lan", "untagged", "--color", "green", "--subnet", "192.168.0.0/24"],
  ["vlan", "add", "guest", "50,51", "--color", "blue", "--subnet", "10.50.0.0/24"],
  ["vlan", "add", "lte", "60", "--color", "orange", "--subnet", "192.168.88.0/24"],
  ["cloud", "add", "internet", "--label", "Internet"],
  ["device", "add", "isp", "--label", "ISP box"],
  ["cloud", "add", "mobile", "--label", "Mobile network"],
  ["device", "add", "switch", "--label", "Switch", "--kind", "switch"],
  ["client", "add", "hub", "--label", "Hub .130", "--lease", "192.168.0.130"],
  ["client", "add", "pi2", "--label", "Pi 2 .153", "--lease", "192.168.0.153", "--note", "DNS server"],
  ["client", "add", "printer", "--lease", "192.168.0.200"],
  ["client", "add", "media", "--lease", "192.168.0.227"],
  ["client", "add", "tv", "--lease", "192.168.0.28"],
  ["link", "add", "internet", "isp"],
  ["link", "add", "isp", "core.ether1", "--label", "primary uplink"],
  ["link", "add", "mobile", "lte"],
  ["link", "add", "core.ether2", "switch"],
  ["link", "add", "switch", "hub"],
  ["link", "add", "switch", "pi2"],
  ["link", "add", "core.ether3", "ap1.ether1"],
  ["link", "add", "core.ether4", "ap2.ether1"],
  ["link", "add", "lte.ether1", "ap2.ether2", "--vlans", "lte", "--label", "tagged 60"],
  ["link", "add", "core.wifi1", "printer"],
  ["link", "add", "core.wifi1", "media"],
  ["link", "add", "core.wifi1", "tv"],
  ["note", "add", "core.ether1", "CAKE shaping"],
  ["note", "add", "mobile", "Mobile ISP"],
  ["place", "add", "lte", "--near", "isp"],
  ["row", "add", "ap1,ap2"],
  ["legend", "set", "--mode", "auto"],
  ["legend", "note", "add", "Failover: when 9.9.9.9 stops answering via ether1, wan2-lte takes over."],
];

const DSL_ONLY: string[][] = [
  ["title", "add", "Home network"],
  ["device", "add", "core", "--model", "hAP ax3", "--os", "RouterOS 7.25.1"],
  ["wan", "add", "core", "ether1", "--route", "wan1-main", "--distance", "1", "--dhcp", "--nat"],
  [
    "wan",
    "add",
    "core",
    "vlan60-lte",
    "--on",
    "bridge",
    "--vlan",
    "60",
    "--route",
    "wan2-lte",
    "--distance",
    "2",
    "--dhcp",
    "--nat",
  ],
  ["router", "add", "core"],
  ["bridge", "add", "core", "bridge", "--address", "192.168.0.1/24", "--lan"],
  ["ports", "add", "core/bridge", "ether2,ether3,ether4,ether5"],
  [
    "radio",
    "add",
    "core/bridge",
    "wifi1,wifi2,wifi1-iot,wifi1-5g,wifi2-iot",
    "--ssid",
    "HomeNet,HomeNet-IoT,HomeNet-5",
  ],
  ["bridge", "add", "core", "br-guest", "--address", "10.50.0.1/24", "--guest", "--hotspot"],
  ["vlan-iface", "add", "core/br-guest", "vlan50-guest", "--on", "bridge", "--vlan", "50"],
  ["vlan-iface", "add", "core/br-guest", "vlan51-guest", "--on", "bridge", "--vlan", "51"],
  ["radio", "add", "core/br-guest", "wifi1-guest,wifi2-guest", "--ssid", "HomeNet-Guest"],
  ["lease", "add", "core", "192.168.0.28", "TV"],
  ["lease", "add", "core", "192.168.0.101", "AP ap1"],
  ["lease", "add", "core", "192.168.0.102", "AP ap2"],
  ["lease", "add", "core", "192.168.0.120", "Printer 2"],
  ["lease", "add", "core", "192.168.0.130", "Hub"],
  ["lease", "add", "core", "192.168.0.132", "Light 1"],
  ["lease", "add", "core", "192.168.0.133", "Light 2"],
  ["lease", "add", "core", "192.168.0.153", "DNS server"],
  ["lease", "add", "core", "192.168.0.196", "LED strip"],
  ["lease", "add", "core", "192.168.0.200", "Printer"],
  ["lease", "add", "core", "192.168.0.227", "media-server"],
  ["allow", "add", "br-guest", "192.168.0.200", "--in", "core", "--label", "printer"],
  ["device", "add", "ap1", "--model", "hAP ac lite", "--os", "RouterOS 7.25"],
  ["bridge", "add", "ap1", "bridgeLocal"],
  ["ports", "add", "ap1/bridgeLocal", "ether1,ether2,ether3,ether4,ether5"],
  ["radio", "add", "ap1/bridgeLocal", "wlan1,wlan2,wlan1-iot,wlan2-iot", "--ssid", "HomeNet,HomeNet-IoT"],
  ["radio", "add", "ap1/bridgeLocal", "wlan1-guest,wlan2-guest", "--tag", "50", "--ssid", "HomeNet-Guest"],
  ["device", "add", "ap2", "--model", "hAP ac2", "--os", "RouterOS 7.25"],
  ["bridge", "add", "ap2", "bridge", "--lan"],
  ["ports", "add", "ap2/bridge", "ether1,ether2,ether3,ether4,ether5"],
  ["radio", "add", "ap2/bridge", "wifi1,wifi2,wifi1-iot,wifi2-iot", "--ssid", "HomeNet,HomeNet-IoT"],
  ["bridge", "add", "ap2", "br-guest"],
  ["vlan-iface", "add", "ap2/br-guest", "vlan51-guest", "--on", "bridge", "--vlan", "51"],
  ["radio", "add", "ap2/br-guest", "wifi1-guest,wifi2-guest", "--ssid", "HomeNet-Guest"],
  ["address", "add", "ap2", "wg1", "192.168.19.1/24"],
  ["lease", "add", "ap2", "192.168.1.200"],
  ["lease", "add", "ap2", "192.168.1.2"],
  ["lease", "add", "ap2", "192.168.1.130"],
  ["lease", "add", "ap2", "192.168.1.201"],
  ["lease", "add", "ap2", "192.168.1.202"],
  ["lease", "add", "ap2", "192.168.1.132"],
  ["device", "add", "lte", "--model", "LtAP mini LTE", "--os", "RouterOS 7.25.1"],
  ["wan", "add", "lte", "lte1", "--nat"],
  ["router", "add", "lte"],
  ["bridge", "add", "lte", "bridge", "--lan"],
  ["radio", "add", "lte/bridge", "wlan1", "--ssid", "MikroTik-000020"],
  ["ports", "add", "lte", "ether1"],
  ["vlan-iface", "add", "lte", "vlan60", "--on", "ether1", "--vlan", "60", "--address", "192.168.88.1/24", "--lan"],
  ...SHARED,
];

const RSC: string[][] = [
  ["title", "add", "Home network"],
  ["import", "add", "core.rsc", "--as", "core"],
  ["import", "add", "ap1.rsc", "--as", "ap1"],
  ["import", "add", "ap2.rsc", "--as", "ap2"],
  ["import", "add", "lte.rsc", "--as", "lte"],
  ...SHARED,
];

/** Rebuild `name` from `cmds` in a temp dir beside the home .rsc files; check statements and SVG against the hand-written file. */
async function rebuild(name: string, cmds: string[][]) {
  const dir = mkdtempSync(join(tmpdir(), "netdraw-rebuild-"));
  try {
    for (const f of readdirSync(HOME).filter((f) => f.endsWith(".rsc"))) copyFileSync(join(HOME, f), join(dir, f));
    const file = join(dir, name);
    const text = run("", file, cmds);
    const got = parseDsl(text, file),
      want = parseDsl(readFileSync(join(HOME, name), "utf8"), name);
    expect(got.diags).toEqual([]);
    expect(strip(got.stmts)).toEqual(strip(want.stmts));
    writeFileSync(file, text);
    const m = loadModel(file);
    const noFile = (ds: typeof m.diags) => ds.map(({ file: _, ...d }) => d);
    expect(noFile(m.diags)).toEqual(noFile(loadModel(join(HOME, name)).diags)); // the home rsc files carry one CAPsMAN warning
    expect(renderSvg(m, await layout(m))).toBe(GOLDEN);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("rebuild network-dsl-only.net from commands", () => rebuild("network-dsl-only.net", DSL_ONLY));
test("rebuild network.net from commands", () => rebuild("network.net", RSC));

test("hand-written file keeps comments", () => {
  const file = join(HOME, "network.net");
  const before = readFileSync(file, "utf8").split("\n");
  const after = run(before.join("\n"), file, [
    ["vlan", "set", "guest", "--color", "red"],
    ["note", "add", "isp", "x"],
    ["link", "rm", "mobile", "lte"],
  ]).split("\n");
  const comments = (ls: string[]) => ls.filter((l) => /#/.test(l));
  expect(comments(after)).toEqual(comments(before));
  // multiset line diff: only the guest vlan and the mobile link go; the edited vlan and the new note come
  const minus = (a: string[], b: string[]) => {
    const r = [...a];
    for (const l of b) {
      const i = r.indexOf(l);
      if (i >= 0) r.splice(i, 1);
    }
    return r;
  };
  expect(minus(before, after)).toEqual([before.find((l) => l.startsWith("vlan guest"))!, "link mobile -- lte"]);
  const added = minus(after, before);
  expect(added).toHaveLength(2);
  expect(added[0]).toMatch(/^vlan guest .*color red/);
  expect(added[1]).toMatch(/^note isp "?x"?$/);
});
