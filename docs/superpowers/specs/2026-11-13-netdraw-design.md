# netdraw — design

Date: 2026-11-13. Status: draft for approval.

## Intent

Draw network diagrams as SVG from a text description, with no LLM in the loop.
Today the owner's `network.svg` (in the owner's private network repo, never committed) is hand-placed coordinates (205 lines). Every
config change means an LLM or a human moves boxes by hand. netdraw replaces that:
edit a text file (or run a command), run `render`, get the diagram.

Two kinds of users drive the same tool: the owner typing commands, and any LLM
agent scripting it through the CLI alone (no plugin, no MCP, no special prompt).
The model for this is Articraft-style tooling: every capability is a subcommand.

## Goals

- A DSL that describes any network: devices, ports, links, VLANs, clouds,
  clients, notes, layout hints, legend.
- Optional RouterOS `.rsc` import. When given, it supplies what the config
  already knows; the DSL adds what a config can't hold (physical boxes like the
  ISP modem or an unmanaged switch, clients, human labels, layout hints).
  Without `.rsc` (or for non-MikroTik gear) the DSL alone is complete.
- Output quality not worse than the owner's `network.svg`: nested device boxes,
  sub-containers (bridges, WAN list), named ports, VLAN lanes drawn as parallel
  tracks along one cable, routed/firewall arrows, clouds, legend, footnotes.
- Scale to dozens of devices and dozens of VLANs.
- A command for everything; machine-readable output; precise errors.

## Non-goals

- Live polling of routers (SSH/API). Input is files only.
- Importers for other vendors (Cisco IOS, OpenWrt UCI) in v1. The importer
  boundary must allow adding them later.
- Interactive/GUI editing.
- PNG/PDF export (use an existing converter on the SVG).

## Anti-goals (failure even if it "works")

- Needing an LLM or hand-edited coordinates to get a decent picture.
- A diagram that is worse than `network.svg` on the owner's home network.
- Retyping in the DSL facts that the `.rsc` already states.
- Commands that only a human can use (interactive prompts, output only parseable
  by eye).

## Decisions made with the owner

1. **Inputs:** DSL always; `.rsc` files optional and merged in. DSL alone must
   be sufficient.
2. **CLI:** every operation is a subcommand (Articraft-style). Commands edit the
   DSL file; hand-editing the file is equally valid; both give the same result.
3. **Views:** `render` draws the combined view (physical + L2 VLAN lanes + L3
   routing arrows, like today). Also `--view physical | vlans | routing`, and
   filters `--only vlan <name|id>`, `--site <device>`. Filtered-out neighbours
   are drawn as stubs so a slice still shows where it connects.
4. **Layout:** automatic, steerable by hints in the DSL (`place X near Y`,
   `row A, B`, `<device>.side <group> = top`). No pinned coordinates.
5. **Stack (approach A):** TypeScript on bun, elkjs for layout, a custom SVG
   renderer. Distributed as one binary via `bun build --compile`.
6. **DSL style:** line-oriented, as sketched below. Accepted in general.
7. **Legend:** must be addable and removable (details below).

## Approaches considered

- **A. TypeScript/bun + elkjs + custom SVG renderer (chosen).** ELK layered is
  the strongest open layout engine for nested boxes with ports and orthogonal
  routing; hints map to ELK options; we own the renderer so lanes and style
  match. Risk: lane offsetting is our own code.
- **B. Kotlin/JVM + ELK Java + GraalVM native.** Same engine and output; heavier
  build and native-image setup for a small CLI. Rejected on cost.
- **C. Compile DSL to D2/Graphviz.** Least code, but no parallel VLAN lanes and
  limited styling; fails the quality bar. Rejected.
- A hand-written layout engine was dismissed: placing dozens of nested devices is
  what ELK already solves.

## DSL sketch (the home network)

```
# network.net
title "Home network"
subtitle "VLANs, Wi-Fi and LTE failover"
imports rsc core.rsc as core, ap1.rsc as ap1,
            ap2.rsc as ap2, lte.rsc as lte

vlan lan   untagged color green  "192.168.0.0/24"
vlan guest 50,51    color blue   "10.50.0.0/24"
vlan lte   60       color orange "192.168.88.0/24"

cloud internet "Internet"
device isp "ISP box"
device switch "Cisco switch" kind switch
client hub "Hub .130" note "fwd WAN:18080"

link internet -- isp -- core.ether1  label "primary uplink"
link core.ether2 -- switch
link core.ether3 -- ap1.ether1       # VLANs inferred from rsc
link core.ether4 -- ap2.ether1
link lte.ether1  -- ap2.ether2       vlans lte  label "tagged 60"
link switch -- hub, pi2

note core.ether1 "CAKE shaping"
place lte near isp
row ap1, ap2

legend auto
legend note "Failover: when 9.9.9.9 stops answering via ether1, wan2-lte takes over."
```

Rules:
- A device named in `imports rsc ... as X` gets its identity, interfaces,
  bridges, VLAN interfaces, IPs, interface lists (WAN/LAN), wifi SSIDs, and DHCP
  static leases from the file. The DSL may add labels/notes to those, never has
  to redeclare them.
- `link` without `vlans` infers carried VLANs from both ends' configs (bridge
  ports, vlan interfaces on top, wifi `vlan-id`/`use-tag`). With `vlans` it is
  explicit; if explicit and inferred disagree, `check` reports it.
- Every DSL statement has a CLI command that appends/edits/removes it.
- Exact grammar (quoting, comments, multi-line continuation) is the builder's
  call, keeping the look above.

## Legend

- `legend auto` (default): built from what the diagram actually uses — one
  entry per VLAN with its colour/dash and subnet, plus one per edge kind present
  (routed+NAT, firewall-allows, plain wire).
- `legend off`: no legend.
- `legend add <style> "text"` / `legend remove <entry>`: add a custom entry or
  drop an auto one.
- `legend note "text"`: footnote lines under the legend (like the failover line
  today).
- `legend position bottom|right`: placement.
- CLI: `netdraw legend on|off|add|remove|note|position`.

## Rendering requirements (from `network.svg`)

- Containers nest: device ⊃ group (e.g. WAN list, bridge, br-guest) ⊃
  interface/port chips. Ports sit on the container edge where their cable leaves.
- A cable carrying several VLANs is drawn as parallel lanes, one per VLAN, with
  the VLAN's colour and dash. Lanes stay parallel through bends and land on the
  right sub-container at each end (e.g. tag 60 lane ends at `vlan60-lte`).
- Above a threshold (builder's call, ~4 lanes), a trunk collapses to one thick
  line with a label like `VLAN 10–40, 99`.
- Routing: ELK layered with `edgeRouting=ORTHOGONAL`, port constraints fixed
  (side/order), `hierarchyHandling=INCLUDE_CHILDREN` for cables crossing
  container boundaries. A multi-VLAN cable is one ELK edge whose thickness is
  set to the bundle width, so ELK reserves room; the renderer then splits it
  into parallel lanes along ELK's bend points.
- Crossings: line jumps. After layout, find every point where two edges'
  segments cross; the horizontal segment gets a small semicircle arc (SVG `A`,
  radius ~5 px) over the vertical one. Each lane in a bundle jumps separately,
  at the same x. Arcs are skipped within a few px of a bend or port. DSL/CLI
  `style jumps arc|gap|none` (default `arc`; `gap` = today's white-halo break).
- Routed/NAT arrows (purple, double-headed) and firewall-allow arrows (dotted)
  come from the L3 model (routing, NAT, firewall forward rules permitting
  inter-subnet traffic). In `.rsc`-less networks they are declared in the DSL.
- Clouds for internet/mobile network; client boxes for end devices.
- Title, subtitle, legend, footnotes. Typography and palette follow
  `network.svg` (Inter/DejaVu Sans, the green/blue/orange/purple set) as the
  default theme.

## CLI surface (v1)

```
netdraw init [file]
netdraw import rsc <file> --as <name>
netdraw device add|rm|set <name> [...]
netdraw cloud add|rm, client add|rm
netdraw vlan add|rm|set <name> <ids|untagged> [--color] [--subnet]
netdraw link add|rm <a.port> <b.port> [--vlans ...] [--label ...]
netdraw note add|rm <target> "text"
netdraw hint add|rm "place lte near isp"
netdraw legend on|off|add|remove|note|position
netdraw check                     # validate model, no drawing
netdraw show [devices|links|vlans|<name>]   # print the merged model
netdraw render [-o out.svg] [--view ...] [--only ...] [--site ...]
```

- Every command takes `--file` (default `./network.net`) and `--json`.
- `--json` output is a stable documented shape; errors are
  `{error, file, line, hint}`.
- Non-zero exit on any error; no interactive prompts ever.
- `--help` on every command is complete enough for an LLM to drive the tool
  from it alone.
- Commands rewrite the DSL file preserving comments and order.

## `check` catches at least

- link to a missing device or port; port used by two links
- VLAN carried on a link but not configured on one end
- explicit `vlans` disagreeing with what the `.rsc` implies
- hint naming an unknown device
- `.rsc` lines the importer didn't understand (warning, listed, not fatal)

## RouterOS import

- Must accept both raw `/export` output (section headers, `add ...` lines, `\`
  continuations) and the annotated "reading copy" style of the owner's configs (anonymised copies in `examples/home/*.rsc`)
  (full-path one-liners, heavy comments, regrouped sections).
- Reads: `/system identity`, `/interface ethernet|bridge|vlan|wifi|wireless`,
  `/interface bridge port|vlan`, `/interface list` + members, `/ip address`,
  `/ip dhcp-client`, `/ip dhcp-server lease` (static), `/ip route`,
  `/ip firewall nat|filter` (enough for routed/NAT and allow arrows),
  `/ip hotspot` (label only).
- Both bridge models: VLAN interfaces on a non-filtering bridge (the home network today) and
  `vlan-filtering=yes` with `/interface bridge vlan` tagged/untagged tables.
- Everything else is ignored and reported by `check` as unparsed.
- Importer sits behind an interface so other vendors can be added later.

## Acceptance

1. **Home network:** a `network.net` plus the four `.rsc` files
   renders a diagram the owner judges not worse than `network.svg`, side by
   side (the owner renders their real network locally; only the anonymised
   `examples/home` copy is committed). Same information present: all boxes, ports, lanes, arrows, legend.
2. **Large network:** a fixture with ≥30 devices and ≥24 VLANs renders without
   overlaps, every link traceable, legend complete. Real large configs are
   scarce publicly (privacy); build the fixture from the multi-device reference
   configs in the MikroTik forum thread "Using RouterOS to VLAN your network"
   (router + CRS switches + APs, `vlan-filtering=yes`), replicated across sites
   to reach scale. A raw `/export` style must be among the fixtures.
3. Filters/views on the large fixture produce readable slices.
4. An LLM given only `netdraw --help` can build the home-network DSL via commands.
5. **DSL-only parity (owner request, 2026-11-13):** `examples/home/network-dsl-only.net`
   describes the whole home network with no `.rsc` files. It must produce the
   same model as `network.net` + `.rsc`: `netdraw show --json` output equal
   and an identical SVG. The DSL in v1 cannot express a device's internals
   (WAN group, router, bridges/groups, member ports, VLAN interfaces, radios
   with SSIDs, hotspot, leases), so this needs DSL statements for device
   internals, designed together with the owner after milestone 1. Every
   fact the importer produces must have a DSL spelling. That keeps "DSL alone
   is sufficient" true for non-MikroTik gear.
6. **CLI parity (owner request, 2026-11-13):** everything the DSL can express,
   including the device-internals statements from item 5, can be added,
   changed and removed through a CLI command. Each command writes the DSL file
   immediately: it keeps comments and order, has no separate save step, and
   holds no hidden state. Tests:
   - rebuild `examples/home/network.net` from an empty file using only CLI
     commands, and check that it parses to the same statements as the
     hand-written file;
   - edit a hand-written file via the CLI, and check that its comments and
     ordering survive;
   - a table test fails when a DSL statement kind has no command.
7. **Documentation (owner request, 2026-11-13):**
   - `docs/dsl.md`: every statement, its grammar and options, the inference
     rules (VLAN lanes, untagged-only ends, chain labels, tiers, lease
     opt-in), and a complete worked example.
   - `docs/cli.md`: every command and flag, the `--json` output shapes, the
     error shape, exit codes, and which DSL line each command writes.
   - `netdraw --help` and `netdraw help dsl` print the same reference text.
   - Tests fail when a DSL keyword or CLI command is missing from the docs.
     Every example in the docs is executed by the test suite.

## Constraints and project conventions

- bun for install/run/build/test (owner precedent). mise tasks for automation.
- renovate.json from the start (owner precedent shape).
- Golden-file tests for parser, importer, model merge; SVG snapshot tests for
  rendering; the `examples/home` fixture is the first golden.

## What an import draws (owner decision)

- Drawn automatically: ports, bridges, VLAN interfaces, WAN/LAN lists, radios.
  Virtual SSID interfaces collapse into one chip per physical radio, listing
  the SSIDs.
- Clients (DHCP leases) are opt-in: a lease appears only when the DSL names it,
  e.g. `client printer lease 192.168.0.200` (label/notes from the lease comment
  unless overridden). `render --all` draws every lease.
- Descriptive text: config facts (model, identity, IP, RouterOS version, WAN
  distance, DHCP client address) are generated; anything else ("CAKE shaping",
  "old wireless driver") comes from `note`.

## Routing/firewall arrows (owner decision)

- One routed arrow per subnet pair (or subnet → WAN) that can reach each other,
  derived from routes, NAT (masquerade on the WAN list) and forward-accept
  rules. Hotspot on a subnet adds the label "after hotspot login".
- One dotted "firewall allows" arrow per accept rule that opens a single host
  (or a host list) across subnets, e.g. guests → 192.168.0.200.
- Default/stateful rules (established/related, drop invalid, defconf fasttrack)
  are ignored. This is a heuristic, not a full firewall evaluator.
- DSL can add (`route a -> b "label"`, `allow a -> host "label"`) or hide
  arrows. Without `.rsc`, arrows come only from the DSL.

## Layout stability (owner decision)

- Same input → byte-identical SVG (deterministic). Across edits, a full reflow is
  acceptable; no stability mechanism beyond determinism. Snapshot tests may be
  regenerated when the fixture changes.

## Calls made by the designer (not the owner) — check these

- **Radio placement (CAPsMAN):** a radio is drawn in the box that physically
  holds it. The merge matches radio MACs across imported devices (e.g. Core's
  `cap-wifi1` with AP2's radio MAC lands under AP2). Unmatched CAP
  interfaces are reported by `check`, not drawn inside the manager.
- **Strict nesting:** a VLAN interface sits inside its parent bridge and draws an
  edge into the group it is a member of (e.g. `vlan50-guest` inside `bridge`,
  edge into `br-guest`). No straddling across two containers in v1; plain ELK
  hierarchy. Lanes land on the VLAN interface.

## Spike findings (2026-11-13, throwaway, the home network as hand-written ELK JSON)

- Works: orthogonal routes through nested containers, ports on device edges,
  parallel lanes along one route (LAN + 51 + 60 to AP2), line-jump arcs,
  route arrows. Deterministic, sub-second.
- Edge direction drives layering: WAN-side edges must point *into* the router
  (ether1 → router) so the WAN list lands on top. The model must orient edges
  uplink → downlink before handing them to ELK.
- Edge orientation rule (fixes the ether4 → vlan60-lte wrap-around): every
  edge is oriented from the lower *tier* to the higher one before ELK sees it.
  Tiers: clouds 0, WAN-list interfaces 1, router 2, bridges/groups 3, physical
  ports 4, then BFS hop count from the router for downstream devices. A back
  edge (target in an earlier layer) otherwise leaves its node's bottom and
  enters the other's top, looping around the whole container.
- Not yet good, must be solved in the build:
  - Cables route *through* the interior of sibling containers (bridge, br-guest).
    Fix: physical ports as ELK ports on the device border (`FIXED_SIDE`/
    `FIXED_ORDER`), not chips inside a nested group; groups get their own ports.
  - `layerConstraint` hints are ignored for nodes nested inside compounds under
    `INCLUDE_CHILDREN`; hints must be expressed via ports, model order and edge
    direction instead.
  - Edge labels land away from their edge (label coordinates vs `edgeCoords`
    =ROOT); place labels ourselves on the longest segment.
  - Compound nodes come out oversized (AP1/AP2); tighten padding and
    `nodeSize` options.
- Spike output: home-network diagram before/after the direction fix (spike code kept outside the repo).

## Left to the builder

- Exact DSL grammar details, parser technique, file extension.
- Internal model shape, ELK option mapping for each hint.
- Lane-offset algorithm and collapse threshold.
- Theme mechanism (a single default theme is enough for v1).
- Repo layout and test tooling within bun.
