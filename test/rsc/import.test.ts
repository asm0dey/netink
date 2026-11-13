import { expect, test } from "bun:test";
import { importRsc } from "../../src/rsc/import";

const load = (p: string, name: string) => importRsc(require("node:fs").readFileSync(p, "utf8"), p, name);
const get = (f: ReturnType<typeof load>, n: string) => f.ifaces.find((i) => i.name === n);

test("core", () => {
  const f = load("examples/home/core.rsc", "core");
  expect(f.identity).toBe("core");
  expect(f.model).toBe("hAP ax3");
  expect(get(f, "vlan60-lte")).toMatchObject({ type: "vlan", parent: "bridge", vlanId: 60 });
  for (const n of ["vlan50-guest", "vlan51-guest"]) expect(get(f, n)?.bridge).toBe("br-guest");
  expect(f.lists.WAN).toEqual(["ether1", "vlan60-lte"]);
  expect(f.routes).toContainEqual(expect.objectContaining({ distance: 2, comment: "wan2-lte" }));
  expect(f.routes.find((r) => r.comment === "wan1-probe")?.distance).toBe(1);
  expect(f.leases).toHaveLength(11);
  expect(f.leases).toContainEqual(expect.objectContaining({ address: "192.168.0.200", comment: "Printer" }));
  expect(f.hotspots).toEqual(["br-guest"]);
  expect(f.masqueradeOutLists).toEqual(["WAN"]);
  expect(f.forwardAccepts).toHaveLength(1);
  expect(f.forwardAccepts[0]).toMatchObject({ inList: "GUEST", dstAddress: "192.168.0.200" });
  expect(get(f, "wifi1-guest")?.bridge).toBe("br-guest");
  expect(get(f, "wifi1-iot")?.ssid).toBe("HomeNet-IoT");
  expect(get(f, "cap-wifi1")?.radioMac).toBe("02:00:00:00:00:10");
  expect(f.dhcpClients.map((d) => d.iface)).toEqual(["ether1", "vlan60-lte"]);
  expect(f.ifaces.filter((i) => i.type === "ether").map((i) => i.name)).toEqual(["ether1", "ether2", "ether3", "ether4", "ether5"]);
});

test("ap1", () => {
  expect(get(load("examples/home/ap1.rsc", "ap1"), "wlan1-guest")).toMatchObject({ useTag: 50, ssid: "HomeNet-Guest", bridge: "bridgeLocal" });
});

test("ap2", () => {
  expect(get(load("examples/home/ap2.rsc", "ap2"), "vlan51-guest")).toMatchObject({ parent: "bridge", vlanId: 51, bridge: "br-guest" });
});

test("lte", () => {
  const f = load("examples/home/lte.rsc", "lte");
  expect(get(f, "vlan60")).toMatchObject({ parent: "ether1", vlanId: 60 });
  expect(f.addresses).toContainEqual({ iface: "vlan60", cidr: "192.168.88.1/24" });
});

test("filtering bridge", () => {
  const f = load("test/fixtures/raw-export.rsc", "raw");
  expect(get(f, "ether1.10")).toMatchObject({ type: "vlan", parent: "ether1", vlanId: 10 });
  expect(get(f, "ether4")?.useTag).toBe(10);
});

test("passes reader warnings through", () => {
  const f = importRsc(":global x 1\n/system identity set name=a\n", "t.rsc", "t");
  expect(f.warnings).toHaveLength(1);
  expect(f.warnings[0]!.file).toBe("t.rsc");
});
