export type Diag = { level: "error" | "warning"; file: string; line: number; message: string; hint?: string };
export type Endpoint = { node: string; port?: string };
export type Hint =
  | { type: "near"; a: string; b: string }
  | { type: "row"; ids: string[] }
  | { type: "side"; device: string; group: string; side: "top" | "bottom" | "left" | "right" };
export type VlanRef = string | number; // VLAN-def name or numeric id
export type IfFlags = { lan?: true; guest?: true; hotspot?: true };
export type DevItem = { line: number } & (
  | {
      kind: "wan";
      iface: string;
      on?: string;
      vlan?: number;
      route?: string;
      distance?: number;
      dhcp?: string | true;
      nat?: true;
    }
  | { kind: "router" }
  | ({ kind: "bridge"; name: string; addresses: string[]; filtering?: true; items: DevItem[] } & IfFlags)
  | { kind: "ports"; names: string[]; untagged?: VlanRef; tagged: VlanRef[]; horizon?: number }
  | ({ kind: "vlan-iface"; name: string; on?: string; vlan: number; addresses: string[] } & IfFlags)
  | { kind: "radio"; ifaces: string[]; tag?: number; ssids: string[] }
  | ({ kind: "address"; iface: string; cidrs: string[] } & IfFlags)
  | { kind: "lease"; address: string; comment?: string }
  | { kind: "allow"; from: string; to: string; label?: string }
);
export type Stmt = { line: number } & (
  | { kind: "title" | "subtitle"; text: string }
  | { kind: "import"; file: string; as: string }
  | { kind: "vlan"; name: string; ids: number[] | "untagged"; color?: string; subnets: string[] }
  | {
      kind: "node";
      type: "cloud" | "device" | "client";
      id: string;
      label?: string;
      role?: string;
      note?: string;
      lease?: string;
      model?: string;
      os?: string;
      items?: DevItem[];
    }
  | { kind: "trunk"; name: string; vlans: string[] }
  | { kind: "link"; path: Endpoint[]; vlans?: string[]; trunk?: string; label?: string }
  | { kind: "note"; target: string; text: string }
  | { kind: "hint"; hint: Hint }
  | { kind: "legend"; op: "auto" | "off" | "add" | "remove" | "note" | "position"; arg?: string; style?: string }
  | { kind: "style"; key: "jumps"; value: "arc" | "gap" | "none" }
  | { kind: "route" | "allow"; from: string; to: string; label?: string }
  | { kind: "hide"; target: string }
);
export type RscCommand = {
  path: string;
  verb: "add" | "set" | "remove" | "other";
  find?: Record<string, string>;
  props: Record<string, string>;
  line: number;
};
export type Iface = {
  name: string;
  type: "ether" | "bridge" | "vlan" | "wifi" | "wireless" | "other";
  parent?: string;
  vlanId?: number;
  bridge?: string;
  ssid?: string;
  mac?: string;
  radioMac?: string;
  useTag?: number;
  horizon?: number;
  comment?: string;
  vlanFiltering?: boolean;
};
export type DeviceFacts = {
  name: string;
  file: string;
  identity?: string;
  model?: string;
  version?: string;
  ifaces: Iface[];
  lists: Record<string, string[]>;
  addresses: { iface: string; cidr: string }[];
  dhcpClients: { iface: string; address?: string }[];
  routes: { dst: string; gateway: string; distance: number; comment?: string }[];
  leases: { address: string; mac: string; comment?: string }[];
  hotspots: string[];
  masqueradeOutLists: string[];
  forwardAccepts: { inList?: string; inIface?: string; dstAddress?: string; comment?: string; line: number }[];
  warnings: Diag[];
};
export type MNodeKind = "cloud" | "device" | "client" | "group" | "port" | "iface" | "router" | "radio";
export type MNode = {
  id: string;
  kind: MNodeKind;
  style: string;
  label: string;
  sub: string[];
  children: MNode[];
  tier: number;
  /** Set on a node standing for several identical leaf siblings: their ids, in model order. */ members?: string[];
};
export type MLink = {
  id: string;
  from: string;
  to: string;
  lanes: string[];
  label?: string;
  /** Named trunk set the link was declared with; its VLANs are in `lanes`. */ trunk?: string;
  line: number;
  /** Set only for links with explicit `vlans`: lanes the imported ends' facts imply, for `check`. */ inferred?: string[];
};
export type MArrow = { id: string; from: string; to: string; kind: "route" | "allow"; label?: string };
export type VlanDef = { name: string; ids: number[] | "untagged"; color: string; subnets: string[] };
export type LegendSpec = {
  mode: "auto" | "off";
  add: { style: string; text: string }[];
  remove: string[];
  notes: string[];
  position: "bottom" | "right";
};
export type Model = {
  title: string;
  subtitle?: string;
  nodes: MNode[];
  links: MLink[];
  arrows: MArrow[];
  vlans: VlanDef[];
  trunks: { name: string; vlans: string[] }[];
  legend: LegendSpec;
  jumps: "arc" | "gap" | "none";
  hints: Hint[];
  /** Warnings `check` adds to `diags`: unused VLANs, unlinked devices, size. */ usage?: Diag[];
  diags: Diag[] /** the DSL file, for diagnostics */;
  file?: string;
};
export type P = { x: number; y: number };
export type Box = { id: string; x: number; y: number; w: number; h: number };
export type Placed = {
  width: number;
  height: number;
  boxes: Map<string, Box>;
  links: { id: string; points: P[]; labelAt?: P }[];
  arrows: { id: string; points: P[]; labelAt?: P }[];
};
