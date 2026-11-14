import { expect, test } from "bun:test";
import { loadModel } from "../../src/load";
import type { Model } from "../../src/types";

const SCALE = "test/fixtures/scale/network.net";
const NETBOX = "test/fixtures/netbox/network.net";
const devices = (m: Model) => m.nodes.filter((n) => n.kind === "device");

test.each([SCALE, NETBOX])("%s loads with no errors", (f) => {
  expect(loadModel(f).diags.filter((d) => d.level === "error")).toEqual([]);
});

test.each([SCALE, NETBOX])("%s: every VLAN def and trunk set rides a link", (f) => {
  const m = loadModel(f);
  const lanes = new Set(m.links.flatMap((l) => l.lanes)),
    trunks = new Set(m.links.map((l) => l.trunk));
  expect(m.vlans.map((v) => v.name).filter((n) => !lanes.has(n))).toEqual([]);
  expect(m.trunks.map((t) => t.name).filter((n) => !trunks.has(n))).toEqual([]);
});

test("SCaLE: ≥30 devices, ≥24 VLANs, links use trunk sets", () => {
  const m = loadModel(SCALE);
  expect(devices(m).length).toBeGreaterThanOrEqual(30);
  expect(m.vlans.length).toBeGreaterThanOrEqual(24);
  expect(m.links.filter((l) => l.trunk).length).toBeGreaterThan(0);
});

test("NetBox: ≥20 linked devices, ≥24 VLANs, port-to-port links", () => {
  const m = loadModel(NETBOX);
  expect(devices(m).length).toBeGreaterThanOrEqual(20);
  expect(m.vlans.length).toBeGreaterThanOrEqual(24);
  // a dev.port endpoint resolves to a child id, parent/port
  expect(m.links.filter((l) => l.from.includes("/") && l.to.includes("/")).length).toBeGreaterThan(0);
});
