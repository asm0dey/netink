# Milestone 2 — inputs (collected 2026-11-13, not yet a design)

Starting material for the milestone-2 brainstorm. Nothing here is decided.

## From the design spec (Acceptance 2–7)

- Large network fixture (≥30 devices, ≥24 VLANs), views/filters.
- LLM drives the tool from `--help` alone.
- DSL-only parity: the home network described with no `.rsc`, identical model and SVG.
- CLI parity: every DSL statement has a command that edits the file in place.
- Full docs: `docs/dsl.md`, `docs/cli.md`, kept in sync by tests.

## Open finding from milestone 1 (fix first)

- A VLAN def named `wan`, `dev` or `spare` gets device colours: VLAN-derived group styles share a namespace with built-in styles. Fix: prefix VLAN styles (`vlan:<name>`) or branch on node kind.
- Jump halo (7 px) can erase a vertical that ends 3–8 px past a crossing; the crossing filter margin (3 px) must be ≥ r + w/2 + 2.
- Smaller deferred items: `straighten` ignores neighbour lane width and doesn't move `labelAt`; tagged radio chip can be orphaned; `placeCaps` first-match; unknown `.rsc` menus ignored silently (spec wants them listed); `near`/`row` hints best-effort; cables through own device titles; theme constants should move to `src/theme.ts`; `build.ts` should split into lanes/tiers modules.

## Scale spike: SCaLE expo network

Data: github.com/socallinuxexpo/scale-network (BSD-3-Clause), `switch-configuration/config/{vlans,switchtypes,trunktypes,types}`, `facts/routers/routerlist.csv`, `facts/aps/apuse.csv`. No cabling list: topology inferred from the switchtypes `Hierarchy` column.

| Size | Devices | Links | VLANs | render | canvas |
|---|---|---|---|---|---|
| small | 10 | 10 | 21 | 0.17 s | 789×1230 |
| main | 42 | 42 | 21 | 0.20 s | 4995×842 |
| full (with APs) | 188 | 169 | 146 | 0.43 s | 19499×934 |
| 4× stress | 752 | 676 | 146 | 10.4 s | 77219×934 |

Problems, worst first:
1. One-row layout (6:1 / 21:1); nothing wraps.
2. Fan-outs of 13–14 siblings become a solid band of trunk bars.
3. Collapsed-trunk label repeated on every link, struck through, overprinted, clipped.
4. Legend doesn't scale: styles never drawn are listed, colours repeat after 13, 127 of 146 VLANs vanish silently.
5. DSL-declared devices can't have ports; Junos `ge-0/0/0` clashes with `/` in node ids.
6. Superlinear layout time, no guard.

Ideas: collapse identical siblings ("14× cfRoom"); named trunk sets (`trunk cfuplink vlans …`, `link … trunk cfuplink`); one label per shared trunk; ELK wrapping/aspect/direction options; views (`--view <id> --depth N`, `--vlan <name>`); multi-column grouped legend; quoted port names; `check` warnings for size, unused VLANs, unlinked devices.

## Addressing (owner observation)

SCaLE publishes per-VLAN IPv4 *and* IPv6 prefixes, a management VLAN + address per switch, router (gateway) addresses, and a description + colour per VLAN. netdraw keeps one subnet string per VLAN and no per-device addresses for DSL-declared devices. Proposal sketch:

```
vlan cfspkr 502 color "#eeddbb" "Speaker Network"
     subnet 10.128.2.0/24, 2001:470:f026:502::/64
address noc vlan cfinfra 2001:470:f026:503::200:1
address cf-mdf-01 vlan cfinfra 2001:470:f026:503::1 gateway
```

Rendered as device sub-lines; `check` warns on an address outside its VLAN's subnets or duplicated; the `.rsc` importer emits the same `address` facts (part of DSL-only parity).

## Privacy

Fixtures stay anonymised. The deny-list check lives outside the repo (owner's private network folder, `.netdraw-privacy/privacy-check.sh`) and must pass before every commit.
