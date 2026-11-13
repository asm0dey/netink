import type { DeviceFacts, Iface, RscCommand } from "../types";
import { readRsc } from "./read";

const ETHER = /^(ether|sfp)[\w-]*\d+$/;
const inferType = (n: string): Iface["type"] => ETHER.test(n) ? "ether" : /^wifi\d+$/.test(n) ? "wifi" : /^wlan\d+$/.test(n) ? "wireless" : "other";
const num = (s?: string) => (s !== undefined && /^\d+$/.test(s) ? Number(s) : undefined);
const split = (s?: string) => (s ? s.split(",").map((x) => x.trim()).filter(Boolean) : []);
const naturalCmp = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true });

function vlanIds(s?: string): number[] {
  const out: number[] = [];
  for (const p of split(s)) {
    const m = p.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) continue;
    for (let v = Number(m[1]); v <= Number(m[2] ?? m[1]) && out.length < 4094; v++) out.push(v);
  }
  return out;
}

export function importRsc(text: string, file: string, name: string): DeviceFacts {
  const { cmds, header, warnings } = readRsc(text, file);
  const f: DeviceFacts = {
    name, file, model: header.model, version: header.version,
    ifaces: [], lists: {}, addresses: [], dhcpClients: [], routes: [], leases: [],
    hotspots: [], masqueradeOutLists: [], forwardAccepts: [], warnings,
  };
  const byName = new Map<string, Iface>();
  const iface = (n: string, type?: Iface["type"]): Iface => {
    let i = byName.get(n);
    if (!i) { i = { name: n, type: type ?? inferType(n) }; byName.set(n, i); f.ifaces.push(i); }
    else if (type) i.type = type;
    return i;
  };
  const touch = (n?: string) => { if (n && ETHER.test(n)) iface(n); };
  const on = (c: RscCommand) => c.props.disabled !== "yes";

  // wifi configurations and datapaths may be defined after their users' neighbours; collect first.
  const datapaths = new Map<string, string>(), configs = new Map<string, { ssid?: string; datapath?: string }>();
  for (const c of cmds) {
    if (c.verb !== "add") continue;
    if (c.path === "/interface wifi datapath" && c.props.name && c.props.bridge) datapaths.set(c.props.name, c.props.bridge);
    if (c.path === "/interface wifi configuration" && c.props.name) configs.set(c.props.name, { ssid: c.props.ssid, datapath: c.props.datapath });
  }

  for (const c of cmds) {
    const p = c.props;
    switch (c.path) {
      case "/system identity":
        if (c.verb === "set" && p.name) f.identity = p.name;
        break;
      case "/interface bridge":
        if (c.verb === "add" && p.name) iface(p.name, "bridge");
        break;
      case "/interface bridge port":
        if (c.verb === "add" && p.interface) {
          const i = iface(p.interface);
          if (p.bridge) i.bridge = p.bridge;
          if (num(p.horizon) !== undefined) i.horizon = num(p.horizon);
        }
        break;
      case "/interface bridge vlan":
        if (c.verb !== "add") break;
        for (const id of vlanIds(p["vlan-ids"])) {
          for (const port of split(p.tagged)) Object.assign(iface(`${port}.${id}`, "vlan"), { parent: port, vlanId: id });
          for (const port of split(p.untagged)) iface(port).useTag ??= id;
        }
        break;
      case "/interface vlan":
        if (c.verb === "add" && p.name) {
          const i = iface(p.name, "vlan");
          i.parent = p.interface; i.vlanId = num(p["vlan-id"]);
          touch(p.interface);
        }
        break;
      case "/interface wifi":
      case "/interface wireless": {
        if (c.verb !== "add" && c.verb !== "set") break;
        const n = c.verb === "set" ? (c.find?.["default-name"] ?? c.find?.name) : (p.name ?? p["default-name"]);
        if (!n) break;
        const i = iface(n, c.path === "/interface wifi" ? "wifi" : "wireless");
        const cfg = p.configuration ? configs.get(p.configuration) : undefined;
        const ssid = p.ssid ?? cfg?.ssid;
        if (ssid) i.ssid = ssid;
        const dp = p.datapath ?? cfg?.datapath;
        const br = dp ? datapaths.get(dp) : undefined;
        if (br) i.bridge = br;
        if (p["datapath.bridge"]) i.bridge = p["datapath.bridge"];
        if (p["vlan-mode"] === "use-tag" && num(p["vlan-id"]) !== undefined) i.useTag = num(p["vlan-id"]);
        if (p["radio-mac"]) i.radioMac = p["radio-mac"];
        if (p["mac-address"]) i.mac = p["mac-address"];
        break;
      }
      case "/interface list":
        if (c.verb === "add" && p.name) f.lists[p.name] ??= [];
        break;
      case "/interface list member":
        if (c.verb === "add" && p.list && p.interface) {
          (f.lists[p.list] ??= []).push(p.interface);
          touch(p.interface);
        }
        break;
      case "/ip address":
        if (c.verb === "add" && on(c) && p.address && p.interface) { f.addresses.push({ iface: p.interface, cidr: p.address }); touch(p.interface); }
        break;
      case "/ip dhcp-client":
        if (c.verb === "add" && p.interface) { f.dhcpClients.push({ iface: p.interface, address: p.address }); touch(p.interface); }
        break;
      case "/ip route":
        if (c.verb === "add" && p["dst-address"] && p.gateway)
          f.routes.push({ dst: p["dst-address"], gateway: p.gateway, distance: num(p.distance) ?? 1, comment: p.comment });
        break;
      case "/ip dhcp-server lease":
        if (c.verb === "add" && p.address && p["mac-address"]) f.leases.push({ address: p.address, mac: p["mac-address"], comment: p.comment });
        break;
      case "/ip hotspot":
        if (c.verb === "add" && p.interface) f.hotspots.push(p.interface);
        break;
      case "/ip firewall nat":
        if (c.verb === "add" && on(c) && p.action === "masquerade" && p["out-interface-list"] && !f.masqueradeOutLists.includes(p["out-interface-list"]))
          f.masqueradeOutLists.push(p["out-interface-list"]);
        break;
      case "/ip firewall filter":
        if (c.verb === "add" && on(c) && p.chain === "forward" && p.action === "accept"
          && p["connection-state"] === undefined && p["ipsec-policy"] === undefined && !p.comment?.startsWith("defconf:"))
          f.forwardAccepts.push({ inList: p["in-interface-list"], inIface: p["in-interface"], dstAddress: p["dst-address"], comment: p.comment, line: c.line });
        break;
    }
  }
  const ether = f.ifaces.filter((i) => i.type === "ether").sort((a, b) => naturalCmp(a.name, b.name));
  f.ifaces = [...ether, ...f.ifaces.filter((i) => i.type !== "ether")];
  return f;
}
