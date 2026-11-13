# netdraw — Milestone 1 (home network end-to-end) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `netdraw render` turns `examples/home/network.net` + the four `.rsc` files into an SVG the owner judges not worse than their hand-drawn `network.svg` (in the owner's private network repo, never committed).

**Architecture:** A pipeline of pure stages: DSL text → AST; `.rsc` text → commands → per-device facts; AST + facts → one `Model` (nested nodes, oriented links with VLAN lanes, L3 arrows, legend); `Model` → elkjs layout → absolute boxes and polylines; renderer splits polylines into lanes, adds line jumps, labels, legend → SVG. A thin CLI (`render`, `check`, `show`) wires the stages.

**Tech Stack:** TypeScript on bun 1.4 (`bun test`, `bun build --compile`), elkjs (bundled build), `node:util` `parseArgs` for the CLI. No other runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-11-13-netdraw-design.md`. Reference spike: `spike3.ts` (spike code kept outside the repo; throwaway; copy ideas — lane offset, jump arcs, ELK options — not code structure).

**Out of scope for this plan (Milestone 2, separate plan):** editing commands (`device add`, `link add`, `legend add` …), `--view`/`--only`/`--site`, the ≥30-device fixture, LLM-from-`--help` acceptance, `bun build --compile` release.

## Global Constraints

- Project root is the repo root; bun for install/run/test/build; never npm.
- Automation via `mise.toml` tasks (`test`, `render-home`); bun pinned in `mise.toml`.
- `renovate.json` from the first commit: `config:recommended`, `vulnerabilityAlerts` enabled, one grouped PR for all non-major updates, majors and security separate.
- Same input → byte-identical SVG. No `Date`, `Math.random`, or Map-iteration-order dependence on unsorted input.
- No interactive prompts; non-zero exit on error; every command accepts `--file` (default `./network.net`) and `--json`.
- Error shape (JSON): `{error: string, file: string, line: number, hint?: string}`; diagnostics list uses `Diag` (Task 1).
- Theme values copied from `network.svg`: font `Inter, 'DejaVu Sans', Arial, sans-serif`; LAN `#2E7D32` w4 solid; guest `#1565C0` w3 dash `7 5`; LTE `#E65100` w4 dash `10 4`; wire `#555` w2.5; route `#6A1B9A` w4 double-headed arrow; allow `#1565C0` w2 dash `2 4` arrow; title 26px bold; `.h` 15px bold; `.s` 12.5px `#444`; `.t` 12px 600.
- Lane gap 7 px; jump arc radius 5 px; trunk collapse when a link carries more than 4 lanes.
- Fixtures are anonymised. Never copy files or identifiers from the owner's private network repo; a privacy check (kept outside the repo) must pass before every commit.
- Device kinds in the DSL: `cloud`, `device`, `client`; ids are `[a-z0-9_-]+`; child ids are `parent/child` (e.g. `core/ether3`, `core/bridge`).

## Review Focus

1. Malformed `.rsc` line (e.g. `address=192.168.0.101client-id=…`, a missing space — once present in `core.rsc`) → a warning with file and line, the rest of the file still imports. Test in Task 3.
2. DSL endpoint naming a port the `.rsc` doesn't have (`core.ether9`) → `check` error with the DSL line and a "did you mean" hint. Test in Task 6.
3. Labels with `&`, `<`, `"` and non-ASCII (`ax³`, `Zürich`) → escaped/valid SVG. Test in Task 9.
4. Link where neither end has an `.rsc` and no `vlans` given → drawn as a plain `wire` lane, never dropped. Test in Task 5.
5. A declared node with no links, or a container with no children → still rendered, layout does not throw. Test in Task 8.

---

## File Structure

```
src/
  types.ts            shared types (AST, facts, model, layout, Diag)
  dsl/parse.ts        DSL text → Stmt[] + Diag[]
  rsc/read.ts         .rsc text → RscCommand[] (+ warnings)
  rsc/import.ts       RscCommand[] → DeviceFacts
  model/build.ts      Stmt[] + facts → Model (nodes, links, lanes, legend)
  model/l3.ts         facts → MArrow[] (routed/NAT, firewall-allow)
  model/check.ts      Model → Diag[]
  layout/measure.ts   text width estimate, node sizes
  layout/elk.ts       Model → Placed (tiers, orientation, ELK options)
  render/geometry.ts  laneOffset(), jumpPath()
  render/svg.ts       Placed + Model → SVG string
  cli.ts              render | check | show
test/                 *.test.ts mirroring src/, fixtures under test/fixtures/
examples/home/        network.net + core.rsc ap1.rsc ap2.rsc lte.rsc (anonymised)
```

---

### Task 1: Project skeleton and shared types

**Files:**
- Create: `package.json`, `tsconfig.json` (strict), `mise.toml`, `renovate.json`, `.gitignore`, `src/types.ts`, `test/types.test.ts`

**Interfaces:**
- Produces (in `src/types.ts`, exported):
  ```ts
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
  export type MLink = { id: string; from: string; to: string; lanes: string[]; label?: string; line: number };
  export type MArrow = { id: string; from: string; to: string; kind: "route" | "allow"; label?: string };
  export type VlanDef = { name: string; ids: number[] | "untagged"; color: string; subnet?: string };
  export type LegendSpec = { mode: "auto" | "off"; add: { style: string; text: string }[]; remove: string[]; notes: string[]; position: "bottom" | "right" };
  export type Model = { title: string; subtitle?: string; nodes: MNode[]; links: MLink[]; arrows: MArrow[]; vlans: VlanDef[];
    legend: LegendSpec; jumps: "arc" | "gap" | "none"; hints: Hint[]; diags: Diag[] };
  export type P = { x: number; y: number };
  export type Box = { id: string; x: number; y: number; w: number; h: number };
  export type Placed = { width: number; height: number; boxes: Map<string, Box>; links: { id: string; points: P[]; labelAt?: P }[]; arrows: { id: string; points: P[]; labelAt?: P }[] };
  ```
  `MNode.style` is a theme key: `box dev cloud wan lte guest lan router port vif spare` (spike `STY`). `tier` is set by Task 5 (clouds 0, WAN ifaces 1, router 2, groups 3, ports 4, downstream = 5 + BFS hops from the router).

- [ ] **Step 1:** `git init`, `bun init -y`, `bun add elkjs`, `bun add -d @types/bun typescript`. Write `mise.toml` with `[tools] bun = "1.4.4"` and tasks `test = "bun test"`, `typecheck = "bunx tsc --noEmit"`, `render-home = "bun src/cli.ts render --file examples/home/network.net -o examples/home/network.svg"`. Write `renovate.json` per Global Constraints. `.gitignore`: `node_modules`, `*.png`.
- [ ] **Step 2:** Write `src/types.ts` as above. Test `test/types.test.ts`: `it("exports compile")` that builds one literal of `Model` with an empty legend and asserts `expect(m.nodes).toHaveLength(0)`.
- [ ] **Step 3:** Run `mise run typecheck && bun test` → PASS.
- [ ] **Step 4:** Commit `chore: scaffold netdraw with shared types`.

---

### Task 2: DSL parser

**Files:** Create `src/dsl/parse.ts`, `test/dsl/parse.test.ts`

**Interfaces:**
- Consumes: `Stmt`, `Diag`, `Endpoint`, `Hint` (Task 1).
- Produces: `export function parseDsl(text: string, file: string): { stmts: Stmt[]; diags: Diag[] }`

Grammar (line-oriented; `#` to end of line is a comment unless inside quotes; a line ending in `,` continues on the next line; strings are `"…"` with `\"` and `\\` escapes):

```
title "T"                      subtitle "T"
imports rsc <path> as <id> (, <path> as <id>)*
vlan <name> (untagged | <n>(,<n>)*) [color <c>] ["subnet"]
cloud <id> ["label"]
device <id> ["label"] [kind <role>] [model "m"] [note "n"]
client <id> ["label"] [lease <ip>] [note "n"]
link <ep> (-- <ep>)+ [vlans <name>(,<name>)*] [label "l"]     ep = id | id.port ; final ep may be id(, id)* (fan-out)
note <target> "text"           place <a> near <b>      row <a>(, <b>)+
<device>.side <group> = top|bottom|left|right
legend auto|off | legend add <style> "text" | legend remove <entry> | legend note "text" | legend position bottom|right
style jumps arc|gap|none
route <a> -> <b> ["label"]     allow <a> -> <b> ["label"]     hide <target>
```

`link a -- b -- c.p` expands to two `link` stmts (a–b, b–c.p) sharing the line number; `link sw -- x, y` expands to sw–x and sw–y.

- [ ] **Step 1: Failing tests** (`test/dsl/parse.test.ts`):
  - `parses the home sketch`: parse the DSL block from the spec ("DSL sketch" section) → no diags; `stmts.filter(s=>s.kind==="link")` has length 8 (chain + fan-out expanded); the `vlan guest` stmt has `ids: [50, 51]`, `color: "blue"`, `subnet: "10.50.0.0/24"`; the import stmt list has 4 entries with `as` = `core, ap1, ap2, lte`.
  - `link endpoint with port`: `link core.ether3 -- ap1.ether1 vlans lan,guest label "x"` → `path: [{node:"core",port:"ether3"},{node:"ap1",port:"ether1"}]`, `vlans: ["lan","guest"]`, `label: "x"`.
  - `unknown keyword`: `frobnicate x` on line 3 → one diag `{level:"error", line:3}` whose `hint` lists the valid keywords; parsing continues (a valid line after it is still in `stmts`).
  - `unterminated string`: `title "abc` → error diag on that line.
  - `side hint`: `core.side wan = top` → `{kind:"hint", hint:{type:"side", device:"core", group:"wan", side:"top"}}`.
- [ ] **Step 2:** `bun test test/dsl` → FAIL (module missing).
- [ ] **Step 3:** Implement `parseDsl`: hand-written tokenizer (words, strings, `--`, `->`, `,`, `=`, `.`) per logical line, one function per keyword.
- [ ] **Step 4:** `bun test test/dsl` → PASS.
- [ ] **Step 5:** Commit `feat(dsl): line-oriented parser`.

---

### Task 3: RouterOS reader

**Files:** Create `src/rsc/read.ts`, `test/rsc/read.test.ts`, `test/fixtures/raw-export.rsc`

**Interfaces:**
- Consumes: `RscCommand`, `Diag`.
- Produces: `export function readRsc(text: string, file: string): { cmds: RscCommand[]; header: { model?: string; version?: string }; warnings: Diag[] }`

Rules:
- Two styles: full-path one-liners (`/interface vlan add a=b`) and raw `/export` (a line `/interface vlan` sets the current path; following `add …`/`set …` lines use it).
- Menu paths follow RouterOS CLI rules. A leading `/` is always absolute from root and never nests: `/ip` then `/firewall` sets the path to `/firewall` (unknown, so its commands are ignored), not `/ip firewall`. `/` alone resets to root. A path line with no verb just sets the current path, so consecutive header lines and empty sections are harmless.
- A line starting with a menu word that is not a verb is relative to the current path: under `/ip`, `firewall filter add …` is `/ip firewall filter add …`, and `firewall filter` alone sets the path to `/ip firewall filter`.
- Verbs: `add set remove disable enable unset print export`. Only `add`/`set` matter; the rest are `verb:"other"`.
- Scripting lines (`:global`, `:if`, `:foreach`, a lone `{` or `}`) are skipped with one warning each.
- `\` at end of line joins with the next line before tokenizing, so a quoted value spanning lines (`source="…\` + `\n…"`) stays one value. Strip the leading whitespace of the continuation.
- Comment lines (`#`) skipped, except header: raw export `# … by RouterOS 7.25.1` → `version`; `# model = RB912R-2nD` → `model`. Annotated header `# NAME - <model>, <ip>, RouterOS <v>` → model + version.
- Values: bare tokens or `"…"` with `\"`, `\\`, `\$` escapes. `set [ find default-name=wlan1 ]` / `set [ find default=yes ]` → `find: {"default-name":"wlan1"}`; `set wlan1 …` (positional name) → `find: {name:"wlan1"}`.
- A token without `=` that isn't the verb or a positional name → warning `{level:"warning", line, message:"unparsed token …"}`; keep the rest of the props. A token like `address=192.168.0.101client-id=1:6c:…` → split at the second `<word>=`; emit a warning but keep both props.

- [ ] **Step 1: Failing tests:**
  - `reads one-liner`: `/interface vlan add comment="LTE: x -> y" interface=bridge name=vlan60-lte vlan-id=60` → `{path:"/interface vlan", verb:"add", props:{comment:"LTE: x -> y", interface:"bridge", name:"vlan60-lte", "vlan-id":"60"}, line:1}`.
  - `reads raw export with continuation`: fixture `test/fixtures/raw-export.rsc` (write it: header `# 2026-11-01 12:00:00 by RouterOS 7.25.1` and `# model = C53UiG+5HPaxD2HPaxD`, then `/interface bridge vlan` with an `add bridge=bridge tagged=ether1,bridge \` + `    untagged=ether4 vlan-ids=10` pair) → one command with `props["vlan-ids"]==="10"`, `props.untagged==="ether4"`; `header.version==="7.25.1"`.
  - `absolute paths never nest`: lines `/ip`, `/firewall filter`, `add chain=forward action=accept` → one command with `path === "/firewall filter"`.
  - `consecutive headers`: `/interface` then `/interface bridge` then `add name=br1` → `path === "/interface bridge"`; no warnings.
  - `relative path`: `/ip` then `firewall filter add chain=forward action=accept` → `path === "/ip firewall filter"`, `verb === "add"`; and `/ip` then `address` then `add address=10.0.0.1/24 interface=ether2` → `path === "/ip address"`.
  - `scripting skipped`: a line `:global x 1` → no command and one warning on that line.
  - `multi-line quoted value`: an inline `/system script add … source="…\` block spanning three lines → one command whose `props.source` contains `ddns`.
  - `find selector`: `/interface wireless set [ find default-name=wlan1 ] band=2ghz-b/g/n` → `find:{"default-name":"wlan1"}`.
  - `malformed lease line` (Review Focus 1): inline literal `/ip dhcp-server lease add address=192.168.0.101client-id=1:2:0:0:0:0:3 mac-address=02:00:00:00:00:03` → props `address==="192.168.0.101"`, `"client-id"` present, one warning with that line number.
  - `annotated header`: `# CORE - hAP ax3, 192.168.0.1, RouterOS 7.25.1  (main router)` → `header.model==="hAP ax3"`, `version==="7.25.1"`.
  - `reads all home files`: each of `examples/home/*.rsc` (anonymised fixtures) returns > 20 cmds and no warnings.
- [ ] **Step 2:** `bun test test/rsc/read` → FAIL.
- [ ] **Step 3:** Implement `readRsc`.
- [ ] **Step 4:** `bun test test/rsc/read` → PASS.
- [ ] **Step 5:** Commit `feat(rsc): read one-liner and raw export styles`.

---

### Task 4: RouterOS importer → DeviceFacts

**Files:** Create `src/rsc/import.ts`, `test/rsc/import.test.ts`

**Interfaces:**
- Consumes: `readRsc` (Task 3), `DeviceFacts`, `Iface`.
- Produces: `export function importRsc(text: string, file: string, name: string): DeviceFacts`

Mapping (only these menus; everything else ignored silently — `check` reports reader warnings, not ignored menus):
- `/system identity set name=` → `identity`.
- Ether ports: any `etherN`/`sfpN` name seen in bridge ports, lists, addresses, vlan parent interfaces, dhcp-client → `Iface{type:"ether"}`, sorted naturally.
- `/interface bridge add` → bridge; `/interface bridge port add bridge= interface= horizon=` → set `bridge` (and `horizon`) on that iface.
- `/interface bridge vlan add bridge= tagged= untagged= vlan-ids=` (filtering bridges) → for each tagged port, record a `vlan`-type pseudo iface `{name:"<port>.<id>", parent:<port>, vlanId}`; untagged ports get `useTag` = id.
- `/interface vlan add name= interface= vlan-id=` → `vlan` iface with `parent`, `vlanId`.
- `/interface wifi set|add` and `/interface wireless set|add`: physical radios (`default-name` wifiN/wlanN) and virtual ones (`master-interface=`); `ssid` from the prop or from the referenced `/interface wifi configuration` (`configuration=cfg-x` → that config's `ssid`); `vlan-id` + `vlan-mode=use-tag` → `useTag`; `datapath`'s `bridge=` → `bridge`; `radio-mac` → `radioMac` (CAPsMAN-managed `cap-*`).
- `/interface list member add interface= list=` → `lists[list]`.
- `/ip address add address= interface=` → `addresses`.
- `/ip dhcp-client add interface=` → `dhcpClients`.
- `/ip route add dst-address= gateway= distance= comment=` → `routes` (distance default 1).
- `/ip dhcp-server lease add address= mac-address= comment=` → `leases`.
- `/ip hotspot add interface=` → `hotspots`.
- `/ip firewall nat add action=masquerade out-interface-list=` → `masqueradeOutLists`.
- `/ip firewall filter add chain=forward action=accept …` → `forwardAccepts`, skipping rules with `connection-state=`, `ipsec-policy=`, or a comment starting `defconf:`.
- Header model/version → `model`/`version`.

- [ ] **Step 1: Failing tests** against the anonymised `examples/home/*.rsc`:
  - `core`: identity set; `ifaces` has `vlan60-lte {type:"vlan", parent:"bridge", vlanId:60}`, `vlan50-guest`, `vlan51-guest` with `bridge:"br-guest"`; `lists.WAN` equals `["ether1","vlan60-lte"]`; `routes` contains `{distance:2, comment:"wan2-lte"}`; `leases` has 11 entries including `{address:"192.168.0.200", comment:"Printer"}`; `hotspots` = `["br-guest"]`; `masqueradeOutLists` = `["WAN"]`; `forwardAccepts` has exactly one entry `{inList:"GUEST", dstAddress:"192.168.0.200"}`; `wifi1-guest` has `bridge:"br-guest"`; `cap-wifi1` has `radioMac:"02:00:00:00:00:10"`; `model==="hAP ax3"`.
  - `ap1`: `wlan1-guest` has `useTag:50`, `ssid:"HomeNet-Guest"`, `bridge:"bridgeLocal"`.
  - `ap2`: has `vlan51-guest {parent:"bridge", vlanId:51, bridge:"br-guest"}`.
  - `lte`: `vlan60 {parent:"ether1", vlanId:60}`; `addresses` contains `{iface:"vlan60", cidr:"192.168.88.1/24"}`.
  - `filtering bridge`: `test/fixtures/raw-export.rsc` → `ether1.10 {parent:"ether1", vlanId:10}` and `ether4` has `useTag:10`.
- [ ] **Step 2:** `bun test test/rsc/import` → FAIL.
- [ ] **Step 3:** Implement `importRsc`. Check exact counts against the files while writing tests; if a count above is wrong for the fixture, fix the test to the file and note it in the commit message.
- [ ] **Step 4:** `bun test test/rsc` → PASS.
- [ ] **Step 5:** Commit `feat(rsc): import interfaces, lists, routes, leases, firewall facts`.

---

### Task 5: Model builder (nodes, links, VLAN lanes, tiers, legend)

**Files:** Create `src/model/build.ts`, `test/model/build.test.ts`

**Interfaces:**
- Consumes: `parseDsl` (T2), `importRsc` (T4), types.
- Produces: `export function buildModel(stmts: Stmt[], facts: Map<string, DeviceFacts>, opts?: { all?: boolean }): Model` and `export function loadModel(file: string, opts?: { all?: boolean }): Model` (reads the DSL, resolves `imports rsc` paths relative to the DSL file, calls `parseDsl`/`importRsc`/`buildModel`, merges reader warnings into `diags`). Arrows are filled by Task 7 (`buildModel` calls `deriveArrows`, stubbed to `[]` until then).

Rules:
- **Imported device** `X` becomes `MNode{kind:"device", style:"dev"}` with label `"<ID UPPER> · <model> · <first LAN IP>[ · RouterOS <v>]"` (DSL `device X "label"` overrides). Children:
  - group `X/wan` (style `wan`, label `WAN list`) holding every iface in `lists.WAN` (`style` `box` for ether, `lte` for vlan; sub-line: `<route comment> · distance <d>` and DHCP client address if any) — only when `lists.WAN` is non-empty.
  - `X/router` (style `router`, label `routing · NAT · firewall`) when the device has `masqueradeOutLists` or more than one bridge with an address.
  - one group per bridge (`X/<bridge>`), style `lan` for the bridge in `lists.LAN`, `guest` for a bridge with a hotspot or in a list named `GUEST`, else `lan`; label `<bridge> · <cidr>`; sub-line `hotspot …` when hotspot.
  - inside each bridge group: its member ports as `kind:"port"` (`style` `port`; `spare` when the port has no link in the DSL) and `vlan` ifaces as `kind:"iface"` (style `vif`), placed in the bridge of their `parent` (strict nesting decision); wifi radios collapsed per physical radio pair into one `kind:"radio"` node per bridge listing distinct SSIDs (`wifi1 / wifi2`, sub `HomeNet · HomeNet-IoT · HomeNet-5`).
  - CAPsMAN `cap-*` radios: matched by `radioMac` against other imported devices' radio MACs and placed there; unmatched → warning diag (not drawn).
- **Non-imported** `cloud`/`device`/`client` stmts → leaf nodes (`cloud`→style `cloud`, else `box`). `client … lease <ip>` takes label/sub from the lease comment unless given. With `opts.all`, every lease of every imported device becomes a client node.
- **Links:** each `link` stmt → `MLink`. Endpoint `node.port` resolves to `node/port`; a bare imported device id resolves to its single unlinked port or is an error. Lanes: explicit `vlans` if given; else inferred — for each VLAN def, it is carried if (a) either end's port is a member of a bridge whose VLAN ifaces (by `parent` = that bridge, or the port itself) carry one of its ids **and** the other end carries it too or has no facts, or (b) the lane `untagged` def when both ends are bridge members/plain devices. No facts on either end and no `vlans` → `["wire"]` (Review Focus 4). Internal links (port → vlan iface, port → radio) are generated for each imported device: port → each vlan iface whose id the trunk carries (lane = that VLAN), wan ether → nothing (the DSL uplink link lands on it).
- **Tiers & orientation:** set `tier` per Hint in Task 1; after tiers, every `MLink` has `from.tier <= to.tier` (swap otherwise).
- **Legend:** `mode` from `legend auto|off` (default `auto`); collect `add`/`remove`/`note`/`position`.
- **Style:** `jumps` from `style jumps …` (default `arc`). `title`/`subtitle` copied; `hints` collected as-is.

- [ ] **Step 1: Failing tests** (build from `examples/home/network.net` — write that file now from the spec sketch, extended so every element in `network.svg` is declared: clients `printer lease 192.168.0.200`, `media lease 192.168.0.227`, `tv lease 192.168.0.28`, `hub`, `pi2`; links for the three Wi-Fi clients to `core.wifi1`):
  - `core has wan, router, bridge, br-guest groups` with ids `core/wan`, `core/router`, `core/bridge`, `core/br-guest`; `core/vlan50-guest` sits under `core/bridge`.
  - `ether3 link carries lan + guest`: link `core/ether3 → ap1/ether1` has `lanes` equal `["lan","guest"]`; ether4 → ap2: `["lan","guest","lte"]`.
  - `orientation`: link between `core/vlan60-lte` (tier 1) and `core/ether4` (tier 4) has `from === "core/vlan60-lte"`.
  - `cap radios land on ap2`: no node id starting `core/cap-`; `ap2` contains a radio node.
  - `wire fallback` (RF 4): `buildModel` of `cloud a` + `device b` + `link a -- b` → one link with `lanes: ["wire"]`.
  - `leases opt-in`: home model has exactly 5 client nodes; with `{all:true}` it has exactly 17 (11 core + 6 ap2 leases; declared lease clients are not duplicated).
- [ ] **Step 2:** `bun test test/model/build` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(model): build nested model with inferred VLAN lanes and tiers`.

---

### Task 6: `check`

**Files:** Create `src/model/check.ts`, `test/model/check.test.ts`

**Interfaces:**
- Consumes: `Model`, `Stmt[]`.
- Produces: `export function checkModel(model: Model): Diag[]` (returns `model.diags` plus its own findings, sorted by file, line).

Findings: link endpoint to missing node or port (error; `hint: "did you mean <closest by edit distance>?"` when distance ≤ 2); port used by two links (error); explicit `vlans` disagreeing with inferred (warning naming both sets); VLAN lane on a link whose imported end doesn't carry it (warning); hint naming an unknown node (error); reader warnings pass through.

- [ ] **Step 1: Failing tests:** home example → zero errors; `link core.ether9 -- ap1.ether1` (RF 2) → error on that DSL line with `hint` containing `ether2`… any `etherN` at distance 1 (assert `hint` matches `/did you mean core\.ether\d/`); two links on `core.ether3` → error; `place ghost near core` → error.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(check): validate links, ports, hints, VLAN consistency`.

---

### Task 7: L3 arrows

**Files:** Create `src/model/l3.ts`, `test/model/l3.test.ts`; modify `src/model/build.ts` (call it).

**Interfaces:**
- Consumes: `DeviceFacts`, `MNode` tree from `buildModel`.
- Produces: `export function deriveArrows(device: string, f: DeviceFacts, nodes: MNode[], stmts: Stmt[]): MArrow[]`

Rules (spec "Routing/firewall arrows"):
- For a device with a `router` node: one `route` arrow router ↔ each WAN group member that has a route (label `to internet` on the distance-1 one); one `route` arrow router ↔ each bridge group with an address (label = `LAN` for the bridge in `lists.LAN`; `guests, after hotspot login` for a hotspot bridge).
- One `allow` arrow per `forwardAccepts` entry with a single-host `dstAddress`: from the bridge group whose interface list matches `inList`/`inIface` to the client node whose lease address equals `dstAddress` (label `guests may also print (firewall allows .200)` style: `"<group label short> may reach <client label> (firewall)"` unless the rule comment is set, then the comment after the `prefix:`).
- DSL `route`/`allow` stmts add arrows; `hide <arrowId|nodeId>` removes.
- Arrow orientation follows tiers like links.

- [ ] **Step 1: Failing test:** home → exactly 4 `route` arrows (ether1, vlan60-lte, bridge, br-guest) and 1 `allow` arrow `core/br-guest → printer`.
- [ ] **Step 2:** FAIL. **Step 3:** implement and wire into `buildModel`. **Step 4:** `bun test` → all PASS.
- [ ] **Step 5:** Commit `feat(model): derive routed and firewall-allow arrows`.

---

### Task 8: Layout via elkjs

**Files:** Create `src/layout/measure.ts`, `src/layout/elk.ts`, `test/layout/elk.test.ts`

**Interfaces:**
- Consumes: `Model`.
- Produces: `export function textWidth(s: string, px: number, bold: boolean): number` (spike heuristic: `len * px * (bold ? 0.6 : 0.55)`); `export async function layout(model: Model): Promise<Placed>` — absolute coordinates; `boxes` keyed by node id; one entry in `links`/`arrows` per model link/arrow with ≥ 2 points; `labelAt` = midpoint of the longest segment.

ELK options (root): `algorithm=layered`, `direction=DOWN`, `edgeRouting=ORTHOGONAL`, `hierarchyHandling=INCLUDE_CHILDREN`, `json.edgeCoords=ROOT`, `json.shapeCoords=ROOT`, `considerModelOrder.strategy=NODES_AND_EDGES`, `spacing.nodeNode=40`, `layered.spacing.nodeNodeBetweenLayers=50`, `spacing.edgeEdge=14`, `spacing.edgeNode=18`, root padding `[top=110,left=40,bottom=40,right=40]`. Edge thickness = `max(4, lanes × 7)`.

Spike problems this task must fix (spec "Spike findings"):
- **Cables through containers:** a device's physical ports that have an external link become ELK **ports on the device node** (`portConstraints=FIXED_SIDE`; side from the far end's tier: lower tier → `NORTH`, higher → `SOUTH`, same tier → `EAST`); the port node inside the bridge group gets an internal edge to that border port. External links attach to the border port, never to the inner node.
- **Hints** (no `layerConstraint` — ignored inside compounds): `row a, b` → `a`,`b` emitted consecutively in model order and in the same tier; `place a near b` → `a` emitted right after `b` in model order; `side` → group order inside the device (`top` first, `bottom` last).
- **Oversize compounds:** compound padding `[top=36 (52 with sub-line),left=12,bottom=12,right=12]`; `nodeSize.constraints=MINIMUM_SIZE` with minimum = label width + 24.
- Children of every node and all edges are emitted sorted by id (determinism).

- [ ] **Step 1: Failing tests:**
  - `home places WAN group above bridge`: `boxes.get("core/wan").y < boxes.get("core/bridge").y`.
  - `no link passes through a sibling group`: for every link polyline, no segment's interior intersects a group box that contains neither endpoint (helper `segmentHitsBox` in the test).
  - `deterministic`: `JSON.stringify` of two `layout()` results over the same model are equal (convert Map to sorted array).
  - `lonely node` (RF 5): model with one `device` and no links, plus one empty group → resolves, both boxes have `w > 0`.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS (iterate on ELK options; record any option changes in a comment in `elk.ts`).
- [ ] **Step 5:** Commit `feat(layout): elkjs layout with border ports and tier orientation`.

---

### Task 9: SVG renderer (lanes, jumps, labels, legend)

**Files:** Create `src/render/geometry.ts`, `src/render/svg.ts`, `test/render/geometry.test.ts`, `test/render/svg.test.ts`

**Interfaces:**
- Consumes: `Model`, `Placed`, `P`.
- Produces:
  - `export function laneOffset(points: P[], d: number): P[]` — spike `offset()`; at a right-angle bend the new point is `p + (nIn + nOut)·d`.
  - `export function lanesFor(points: P[], lanes: string[]): { lane: string; points: P[] }[]` — offsets `(i − (k−1)/2) × 7`; when `lanes.length > 4` returns one entry `{lane:"trunk", points}`.
  - `export function jumpPath(points: P[], crossers: { x: number; y1: number; y2: number }[], r: number, style: "arc" | "gap" | "none"): string` — SVG path `d`; on horizontal segments, for each vertical crosser strictly inside (≥ r + 3 from both segment ends and with `y1 < y−3`, `y2 > y+3`), insert `L(x−r·dir) A r r 0 0 (dir>0?1:0) (x+r·dir)` for `arc`, a `M` gap of 2r for `gap`.
  - `export function renderSvg(model: Model, placed: Placed): string`

Rendering rules: draw order = groups/devices (containers before children), then lines ordered `allow, wire, lan…(VLAN defs order), trunk, route`, then labels on top. Node styles/markers exactly as spike + Global Constraints theme. Trunk = width 8 `#555` with label `VLAN <ids joined, ranges collapsed>`. Crossers for a line = vertical segments of all *other* links/arrows. Edge labels at `labelAt`, offset 6 px right/up, coloured by first lane. Title/subtitle at (40,46)/(40,72). Legend (`mode:auto`): box under the diagram (or right of it for `position:right`), one swatch per VLAN def used by any link (colour, dash, `name (ids)` + subnet), one per arrow kind present, then `add` entries, minus `remove`d names, then `notes` lines. `mode:off` → none. All text through `esc()` (`& < > "`).

- [ ] **Step 1: Failing tests:**
  - geometry: `laneOffset([{0,0},{100,0},{100,100}], 7)` → `[{0,7},{93,7},{93,100}]` (normal of direction `(dx,dy)` is `(−dy,dx)`, as in the spike).
  - geometry: `lanesFor(pts, ["a","b","c","d","e"])` → length 1, lane `trunk`.
  - geometry: `jumpPath([{0,50},{100,50}], [{x:50,y1:0,y2:100}], 5, "arc")` → `"M0,50 L45,50 A5,5 0 0 1 55,50 L100,50"`; same with a crosser at x=4 → no `A`.
  - svg (RF 3): node label `A&B <ax³> "Zürich"` → output contains `A&amp;B &lt;ax³&gt; &quot;Zürich&quot;` and no raw `<ax` substring.
  - svg: home render contains one `<path` with `stroke-dasharray="10 4"` per LTE lane segment group (≥ 3), at least one ` A5,5 ` arc, the legend text `LAN`, and no legend when `legend off` is added.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(render): SVG with VLAN lanes, line jumps, labels and legend`.

---

### Task 10: CLI (`render`, `check`, `show`)

**Files:** Create `src/cli.ts`, `test/cli.test.ts`; add `"bin": {"netdraw": "src/cli.ts"}` to `package.json`.

**Interfaces:**
- Consumes: `loadModel` (T5), `checkModel` (T6), `layout` (T8), `renderSvg` (T9).
- Produces CLI:
  - `netdraw render [--file f] [-o out.svg] [--all] [--json]` → writes SVG (stdout if no `-o`); refuses (exit 1) when `checkModel` has errors; `--json` prints `{ok:true, output, width, height, warnings}`.
  - `netdraw check [--file f] [--json]` → exit 0 with no errors, 1 otherwise; human output `file:line: level: message (hint)`; `--json` prints `{ok, diags}`.
  - `netdraw show [devices|links|vlans|<id>] [--file f] [--json]` → prints the merged model slice (`--json`: the raw objects).
  - `netdraw --help` / `<cmd> --help`: full usage incl. DSL statement summary (copy the grammar block from Task 2).
  - Unknown command → exit 2, `{error, hint:"run netdraw --help"}`.

- [ ] **Step 1: Failing tests** (spawn `bun src/cli.ts` via `Bun.spawnSync`): `check` on `examples/home` → exit 0; `check` on a temp DSL with `link a.x -- b` → exit 1, stdout JSON (`--json`) has `diags[0].line === 1`; `render -o tmp.svg` → exit 0 and file starts with `<svg`; `show links --json` → array containing a link with `from === "core/ether3"`; `bogus` → exit 2.
- [ ] **Step 2:** FAIL. **Step 3:** implement with `parseArgs`. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(cli): render, check, show`.

---

### Task 11: Home acceptance (golden + owner review)

**Files:** Create `test/acceptance/home.test.ts`, `test/fixtures/home.golden.svg`; finalize `examples/home/network.net`.

- [ ] **Step 1:** `mise run render-home`, then `rsvg-convert examples/home/network.svg -o /tmp/netdraw-home.png` (use `timeout 100`; rsvg-convert occasionally stalls on the first font-cache run — rerun). Check the render against this list — every one must be present: Internet/ISP/Mobile clouds; Core with WAN list (ether1, vlan60-lte), router hexagon, bridge, br-guest with vlan50/51; ether2–5 (ether5 spare); Cisco switch with Hub and Pi 2; AP1 and AP2 with their LAN and guest groups; LTE to AP2 ether2; LAN+50 and LAN+51+60 bundles as parallel lanes; 4 route arrows and the printer allow arrow; line-jump arcs at crossings; legend with LAN/guest/LTE/route/allow and the failover note; no cable crossing through a group it doesn't connect to; no label overlapping a box.
- [ ] **Step 2:** Fix anything failing in the owning task's code (with a test in that task's test file), not with fixture-specific hacks.
- [ ] **Step 3:** Copy the result to `test/fixtures/home.golden.svg`; test `renders home byte-identical to golden` (`loadModel` → `layout` → `renderSvg` equals the file).
- [ ] **Step 4:** `bun test` → all PASS; `mise run typecheck` → clean.
- [ ] **Step 5:** Commit `test: home golden render`. **Stop and hand over to the owner:** they render their real network locally with the same build (in their private network repo, never committed) and compare it side by side with their hand-drawn `network.svg`; the milestone is done only when they judge it not worse.
