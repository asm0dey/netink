import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { edit, type EditResult } from "../../src/edit/edit";
import { NOUNS, type Args, type Verb } from "../../src/edit/table";
import { parseDsl } from "../../src/dsl/parse";
import { printItems } from "../../src/dsl/print";

const run = (
  text: string,
  noun: string,
  verb: Verb,
  parent: string | undefined,
  pos: string[],
  flags: Args["flags"] = {},
): EditResult =>
  edit(text, "t.net", {
    noun: NOUNS.find((n) => n.name === noun)!,
    verb,
    args: { pos, flags, ...(parent ? { parent } : {}) },
  });
const ok = (r: EditResult) => {
  if (!r.ok) throw new Error(`edit failed: ${r.error}`);
  return r.text;
};

const BR = "device d\n  bridge br\n    ports e1, e2, e3 untagged lan\n  lease 10.0.0.1\n";

test("ports add under bridge goes after its last child", () => {
  expect(ok(run("device d\n  bridge br\n    ports e1\n  lease 10.0.0.1\n", "ports", "add", "d/br", ["e2"]))).toBe(
    "device d\n  bridge br\n    ports e1\n    ports e2\n  lease 10.0.0.1\n",
  );
});
test("first item of a bare device", () => {
  expect(ok(run("device d\nvlan x 1\n", "router", "add", "d", []))).toBe("device d\n  router\nvlan x 1\n");
});
test("ports rm splits", () => {
  expect(ok(run(BR, "ports", "rm", "d/br", ["e2"]))).toBe(
    "device d\n  bridge br\n    ports e1, e3 untagged lan\n  lease 10.0.0.1\n",
  );
});
test("ports rm of the last port deletes the line", () => {
  expect(ok(run("device d\n  ports e1\n  lease 10.0.0.1\n", "ports", "rm", "d", ["e1"]))).toBe(
    "device d\n  lease 10.0.0.1\n",
  );
});
test("ports set splits", () => {
  expect(ok(run(BR, "ports", "set", "d/br", ["e2"], { untagged: "10" }))).toBe(
    "device d\n  bridge br\n    ports e1, e3 untagged lan\n    ports e2 untagged 10\n  lease 10.0.0.1\n",
  );
});
test("ports set whole line, tagged and clear", () => {
  expect(
    ok(
      run("device d\n  ports e1 untagged lan\n", "ports", "set", "d", ["e1"], {
        untagged: false,
        tagged: "10,guest",
        horizon: "1",
      }),
    ),
  ).toBe("device d\n  ports e1 tagged 10, guest horizon 1\n");
});
test("imported parent refused", () => {
  const r = run("imports rsc x.rsc as core\n", "wan", "add", "core", ["ether1"]);
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.error).toBe('"core" is imported; its internals come from x.rsc');
    expect(r.hint).toContain("netdraw import x.rsc");
  }
});
test("missing parent and too deep", () => {
  const r = run("device d\n", "router", "add", "zz", []);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.hint).toBe("run netdraw show devices");
  expect(run(BR, "ports", "add", "d/br/x", ["e9"]).ok).toBe(false);
});
test("allow --in is an item, without it a statement", () => {
  expect(ok(run("device r\n", "allow", "add", "r", ["ether1", "10.0.0.9"]))).toBe(
    "device r\n  allow ether1 -> 10.0.0.9\n",
  );
  expect(ok(run("device r\n", "allow", "add", undefined, ["ether1", "10.0.0.9"]))).toBe(
    "device r\nallow ether1 -> 10.0.0.9\n",
  );
  expect(NOUNS.find((n) => n.name === "allow")!.covers).toContain("item:allow");
});
test("wan, bridge, vlan-iface, radio, address, lease", () => {
  let t = "device d\n";
  t = ok(run(t, "wan", "add", "d", ["ether1"], { route: "w1", distance: "1", dhcp: true, nat: true }));
  t = ok(run(t, "bridge", "add", "d", ["bridge"], { address: "192.168.0.1/24", lan: true }));
  t = ok(run(t, "vlan-iface", "add", "d/bridge", ["v51"], { on: "bridge", vlan: "51" }));
  t = ok(run(t, "radio", "add", "d/bridge", ["w1,w2"], { ssid: "A,B" }));
  t = ok(run(t, "address", "add", "d", ["wg1", "192.168.19.1/24"], { guest: true }));
  t = ok(run(t, "lease", "add", "d", ["192.168.1.200", "TV"]));
  expect(t).toBe(`device d
  wan ether1 route w1 distance 1 dhcp nat
  bridge bridge address 192.168.0.1/24 lan
    vlan-iface v51 on bridge vlan 51
    radio w1, w2 ssid A, B
  address wg1 192.168.19.1/24 guest
  lease 192.168.1.200 "TV"
`);
  t = ok(run(t, "wan", "set", "d", ["ether1"], { nat: false, "dhcp-address": "10.0.0.2", vlan: "60" }));
  expect(t).toContain("  wan ether1 vlan 60 route w1 distance 1 dhcp 10.0.0.2\n");
  t = ok(run(t, "radio", "set", "d/bridge", ["w2"], { tag: "50" }));
  expect(t).toContain("    radio w1 ssid A, B\n    radio w2 tag 50 ssid A, B\n");
});
test("vlan-iface needs --vlan", () => {
  expect(run("device d\n", "vlan-iface", "add", "d", ["v"]).ok).toBe(false);
});
test("replays the home example's device blocks", () => {
  const src = readFileSync("examples/home/network-dsl-only.net", "utf8");
  const { stmts } = parseDsl(src, "h.net");
  const flagsOf = (it: any): Args["flags"] => {
    const f: Args["flags"] = {};
    for (const k of ["lan", "guest", "hotspot", "filtering", "nat"]) if (it[k]) f[k] = true;
    if (it.addresses?.length) f.address = it.addresses.join(",");
    if (it.on) f.on = it.on;
    if (it.vlan !== undefined) f.vlan = String(it.vlan);
    if (it.route) f.route = it.route;
    if (it.distance !== undefined) f.distance = String(it.distance);
    if (it.dhcp === true) f.dhcp = true;
    else if (it.dhcp) f["dhcp-address"] = it.dhcp;
    if (it.tag !== undefined) f.tag = String(it.tag);
    if (it.ssids?.length) f.ssid = it.ssids.join(",");
    if (it.untagged !== undefined) f.untagged = String(it.untagged);
    if (it.tagged?.length) f.tagged = it.tagged.join(",");
    if (it.horizon !== undefined) f.horizon = String(it.horizon);
    return f;
  };
  const posOf = (it: any): string[] => {
    switch (it.kind) {
      case "wan":
        return [it.iface];
      case "router":
        return [];
      case "bridge":
      case "vlan-iface":
        return [it.name];
      case "ports":
        return [it.names.join(",")];
      case "radio":
        return [it.ifaces.join(",")];
      case "address":
        return [it.iface, it.cidrs.join(",")];
      case "lease":
        return it.comment !== undefined ? [it.address, it.comment] : [it.address];
      default:
        return [it.from, it.to];
    }
  };
  const flagsFor = (it: any) =>
    it.kind === "address"
      ? { ...flagsOf(it), address: undefined }
      : it.kind === "allow"
        ? it.label
          ? { label: it.label }
          : {}
        : flagsOf(it);
  for (const s of stmts) {
    if (s.kind !== "node" || !s.items) continue;
    let t = `device ${s.id}\n`;
    const feed = (items: any[], parent: string) => {
      for (const it of items) {
        t = ok(run(t, it.kind, "add", parent, posOf(it), flagsFor(it)));
        if (it.kind === "bridge") feed(it.items, `${s.id}/${it.name}`);
      }
    };
    feed(s.items, s.id);
    expect(t).toBe(`device ${s.id}\n${printItems(s.items, 1).join("\n")}\n`);
  }
});
