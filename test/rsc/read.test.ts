import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { readRsc } from "../../src/rsc/read";

const r = (t: string) => readRsc(t, "t.rsc");

test("reads one-liner", () => {
  const { cmds } = r('/interface vlan add comment="LTE: x -> y" interface=bridge name=vlan60-lte vlan-id=60');
  expect(cmds).toEqual([
    {
      path: "/interface vlan",
      verb: "add",
      props: { comment: "LTE: x -> y", interface: "bridge", name: "vlan60-lte", "vlan-id": "60" },
      line: 1,
    },
  ]);
});
test("reads raw export with continuation", () => {
  const { cmds, header } = r(readFileSync("test/fixtures/raw-export.rsc", "utf8"));
  expect(cmds).toHaveLength(2);
  expect(cmds[0]!.path).toBe("/interface bridge vlan");
  expect(cmds[0]!.props["vlan-ids"]).toBe("10");
  expect(cmds[0]!.props.untagged).toBe("ether4");
  expect(cmds[0]!.line).toBe(4);
  expect(header).toEqual({ version: "7.25.1", model: "C53UiG+5HPaxD2HPaxD" });
});
test("absolute paths never nest", () => {
  const { cmds } = r("/ip\n/firewall filter\nadd chain=forward action=accept");
  expect(cmds.map((c) => c.path)).toEqual(["/firewall filter"]);
});
test("consecutive headers", () => {
  const { cmds, warnings } = r("/interface\n/interface bridge\nadd name=br1");
  expect(cmds[0]!.path).toBe("/interface bridge");
  expect(warnings).toEqual([]);
});
test("relative path", () => {
  let { cmds } = r("/ip\nfirewall filter add chain=forward action=accept");
  expect(cmds[0]!).toMatchObject({ path: "/ip firewall filter", verb: "add" });
  ({ cmds } = r("/ip\naddress\nadd address=10.0.0.1/24 interface=ether2"));
  expect(cmds[0]!.path).toBe("/ip address");
});
test("scripting skipped", () => {
  const { cmds, warnings } = r("# c\n:global x 1");
  expect(cmds).toEqual([]);
  expect(warnings).toHaveLength(1);
  expect(warnings[0]!.line).toBe(2);
});
test("multi-line quoted value", () => {
  const { cmds } = r(
    '/system script add name=upd owner=admin source=":global k \\"x\\"\\\n    \\n:log info ddns-sync\\\n    \\n:delay 1s"\n/ip address add address=10.0.0.1/24',
  );
  expect(cmds).toHaveLength(2);
  expect(cmds[0]!.props.source).toContain("ddns");
  expect(cmds[0]!.props.source).toContain('"x"');
  expect(cmds[1]!.line).toBe(4);
});
test("find selector", () => {
  const { cmds } = r("/interface wireless set [ find default-name=wlan1 ] band=2ghz-b/g/n");
  expect(cmds[0]!).toMatchObject({ verb: "set", find: { "default-name": "wlan1" }, props: { band: "2ghz-b/g/n" } });
  expect(r("/interface wifi set wlan1 disabled=no").cmds[0]!.find).toEqual({ name: "wlan1" });
});
test("malformed lease line", () => {
  const { cmds, warnings } = r(
    "\n/ip dhcp-server lease add address=192.168.0.101client-id=1:2:0:0:0:0:3 mac-address=02:00:00:00:00:03",
  );
  expect(cmds[0]!.props.address).toBe("192.168.0.101");
  expect(cmds[0]!.props["client-id"]).toBe("1:2:0:0:0:0:3");
  expect(cmds[0]!.props["mac-address"]).toBe("02:00:00:00:00:03");
  expect(warnings).toHaveLength(1);
  expect(warnings[0]!.line).toBe(2);
});
test("unparsed bare token warns", () => {
  const { cmds, warnings } = r("/ip address add junk x=1");
  expect(cmds[0]!.props).toEqual({ x: "1" });
  expect(warnings[0]!.message).toContain("unparsed token");
});
test("annotated header", () => {
  const { header } = r("# CORE - hAP ax3, 192.168.0.1, RouterOS 7.25.1  (main router)");
  expect(header).toEqual({ model: "hAP ax3", version: "7.25.1" });
});
test("annotated header: a comma after the version is not part of it", () => {
  const { header } = r("# AP - hAP ac2, 10.0.0.2, RouterOS 7.25, wifi-qcom-ac  (AP only)");
  expect(header).toEqual({ model: "hAP ac2", version: "7.25" });
});
test("reads a larger synthetic export", () => {
  const body = Array.from(
    { length: 40 },
    (_, i) => `/interface vlan add interface=bridge name=vlan${i} vlan-id=${i + 1}`,
  ).join("\n");
  const { cmds, warnings } = r(`# ap1 - hAP, 10.0.0.1, RouterOS 7.0\n${body}\n`);
  expect(cmds).toHaveLength(40);
  expect(warnings).toEqual([]);
});
test("reads all home files", () => {
  for (const f of ["core", "ap1", "ap2", "lte"]) {
    const { cmds, warnings } = readRsc(readFileSync(`examples/home/${f}.rsc`, "utf8"), `${f}.rsc`);
    expect(cmds.length).toBeGreaterThan(20);
    expect(warnings).toEqual([]);
  }
});
