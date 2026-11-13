export type Diag = { level: "error" | "warning"; file: string; line: number; message: string; hint?: string };
export type Endpoint = { node: string; port?: string };
export type Hint =
  | { type: "near"; a: string; b: string }
  | { type: "row"; ids: string[] }
  | { type: "side"; device: string; group: string; side: "top" | "bottom" | "left" | "right" };
export type Stmt = { line: number } & (
  | { kind: "title" | "subtitle"; text: string }
  | { kind: "import"; file: string; as: string }
  | { kind: "vlan"; name: string; ids: number[] | "untagged"; color?: string; subnet?: string }
  | { kind: "node"; type: "cloud" | "device" | "client"; id: string; label?: string; role?: string; note?: string; lease?: string; model?: string }
  | { kind: "link"; path: Endpoint[]; vlans?: string[]; label?: string }
  | { kind: "note"; target: string; text: string }
  | { kind: "hint"; hint: Hint }
  | { kind: "legend"; op: "auto" | "off" | "add" | "remove" | "note" | "position"; arg?: string; style?: string }
  | { kind: "style"; key: "jumps"; value: "arc" | "gap" | "none" }
  | { kind: "route" | "allow"; from: string; to: string; label?: string }
  | { kind: "hide"; target: string });
export type RscCommand = { path: string; verb: "add" | "set" | "remove" | "other"; find?: Record<string, string>; props: Record<string, string>; line: number };
export type Iface = { name: string; type: "ether" | "bridge" | "vlan" | "wifi" | "wireless" | "other";
  parent?: string; vlanId?: number; bridge?: string; ssid?: string; mac?: string; radioMac?: string; useTag?: number; horizon?: number; comment?: string };
export type DeviceFacts = { name: string; file: string; identity?: string; model?: string; version?: string;
  ifaces: Iface[]; lists: Record<string, string[]>; addresses: { iface: string; cidr: string }[];
  dhcpClients: { iface: string; address?: string }[];
  routes: { dst: string; gateway: string; distance: number; comment?: string }[];
  leases: { address: string; mac: string; comment?: string }[];
  hotspots: string[]; masqueradeOutLists: string[];
  forwardAccepts: { inList?: string; inIface?: string; dstAddress?: string; comment?: string; line: number }[];
  warnings: Diag[] };
export type MNodeKind = "cloud" | "device" | "client" | "group" | "port" | "iface" | "router" | "radio";
export type MNode = { id: string; kind: MNodeKind; style: string; label: string; sub: string[]; children: MNode[]; tier: number };
export type MLink = { id: string; from: string; to: string; lanes: string[]; label?: string; line: number;
  /** Set only for links with explicit `vlans`: lanes the imported ends' facts imply, for `check`. */ inferred?: string[] };
export type MArrow = { id: string; from: string; to: string; kind: "route" | "allow"; label?: string };
export type VlanDef = { name: string; ids: number[] | "untagged"; color: string; subnet?: string };
export type LegendSpec = { mode: "auto" | "off"; add: { style: string; text: string }[]; remove: string[]; notes: string[]; position: "bottom" | "right" };
export type Model = { title: string; subtitle?: string; nodes: MNode[]; links: MLink[]; arrows: MArrow[]; vlans: VlanDef[];
  legend: LegendSpec; jumps: "arc" | "gap" | "none"; hints: Hint[]; diags: Diag[] };
export type P = { x: number; y: number };
export type Box = { id: string; x: number; y: number; w: number; h: number };
export type Placed = { width: number; height: number; boxes: Map<string, Box>; links: { id: string; points: P[]; labelAt?: P }[]; arrows: { id: string; points: P[]; labelAt?: P }[] };
