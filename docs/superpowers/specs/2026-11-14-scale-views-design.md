# Scale and views — design (milestone 2, part D)

Status: draft for owner approval, 2026-11-14. Inputs:
`2026-11-13-milestone-2-inputs.md` (scale spike, milestone-1 findings); parent spec
`2026-11-13-netdraw-design.md` (Acceptance 2, 3, Views item 3); part C
`2026-11-13-cli-editing-design.md` (CLI parity rules every new statement must meet).

## Intent

netdraw draws the home network well; at 40–190 devices (the SCaLE spike) the picture
breaks: overprinted trunk labels, a legend that silently drops VLANs and repeats
colours, solid bands of fan-out bars, components in one endless row. The owner wants:

- the **full render** of a big network to be a high-quality image: vector, crisp, nothing
  overlapping or clipped, everything traceable, legend complete. Wide is acceptable; the
  owner zooms the SVG in a viewer.
- **selection by slicing**: `render` flags that cut out the part you want to look at.
  Fancy selection is the slice's job, not the full picture's.

## Goals

1. Milestone-1 "fix first" findings: already fixed on main (`9d24324` VLAN style namespace,
   `13e7ebd` jump-halo margin). Part D only confirms the tests cover `wan`/`dev`/`spare` and the
   3–8 px case, adding them if missing.
2. Full render of the large fixtures has no overlapping boxes or text, no clipped or
   overprinted labels, every VLAN that is drawn is in the legend with a distinct look.
3. Fan-outs of identical leaf siblings drawn as one box.
4. Named trunk sets: a trunk carrying a named set shows one label, the set's name.
5. Slices: `--view`, `--vlan`, `--around/--depth`, with stubs for cut-off neighbours.
6. Two committed large fixtures in DSL (SCaLE, NetBox demo) with tests.
7. Acceptance 2 reworded (below); Acceptance 2 and 3 pass.

## Non-goals

- Making the full picture compact (ELK wrapping/aspect tuning beyond a 1-hour try, overview
  pages, per-site output files). Approach A and C below were rejected.
- Zoom aids: repeated lane names, tooltips as the only carrier of information.
- Layout performance work (752-device stress = 10 s is accepted). `check` warns only.
- A `site` concept in the DSL.
- `.rsc` import at scale. `.rsc` support stays as built in milestone 1 (vlan-filtering and raw
  `/export` already covered by `test/fixtures/raw-export.rsc`); the owner does not need a
  replicated MikroTik fixture.
- Importers for Cisco/Junos/NetBox. Fixtures are converted once by throwaway scripts.
- `docs/dsl.md`, `docs/cli.md` and their sync tests (Acceptance 7): part E.
- Other deferred milestone-1 items (`straighten`, `placeCaps`, `theme.ts`, splitting
  `build.ts`) unless a goal above has to touch the code anyway.

## Anti-goals

- Shrinking text or line widths to fit a big network on a page. Size grows; text doesn't shrink.
- Information that silently disappears (VLANs dropped from the legend, devices hidden by
  collapse with no trace of their names).
- Changing the home render. `test/fixtures/home.golden.svg` and the DSL-only parity test stay
  byte-identical unless a fix-first item legitimately changes them (then regenerate once and
  say why in the commit).
- Committing any data derived from the owner's network or from unlicensed sources (EMF Camp).

## Constraints

- Privacy: `privacy-check.sh` (owner's private folder) after `git add`, before every commit.
  Fixtures are public data only.
- Licences: SCaLE is BSD-3-Clause, NetBox demo data is MIT. Each fixture file carries the
  upstream copyright notice and licence text (or a sibling `LICENSE` file) and the source URL.
- CLI parity (Acceptance 6): every new DSL statement gets a CLI command with the part C
  machinery (noun table, completion, generated help and man page, rebuild/parity tests).
- Tooling: bun, `mise run test` (Biome + bun test), `mise run fmt`.

## Approaches

- **A. Make the one big picture fit** — ELK wrapping/aspect ratio, collapse, multi-column legend;
  views as extras. Most layout work, uncertain with nested ports and full-width lanes.
- **B. Correct full picture, readability by slicing** — chosen. The spike showed width comes
  from fan-out itself; slices remove it at the source. Collapse and trunk labels help both.
- **C. Overview + per-site pages** — several output files, a second drawing style; fits
  NetBox's 24 sites but not SCaLE's single site.

Owner picked B, clarifying "zoom in" means a high-quality vector image, not zoom features.

## Design

### 1. Fix-firsts (verify only)

Both are on main. Check `test/model` and `test/render` cover a VLAN named each of `wan`, `dev`,
`spare`, and a vertical ending 3–8 px past a crossing; add the missing cases.

### 2. Fixtures (Acceptance 2, reworded)

New Acceptance 2 text: *"A DSL fixture with ≥30 devices and ≥24 VLANs renders without
overlaps, every link traceable, legend complete. Fixtures: SCaLE (one big tree) and the
NetBox demo data (many small sites)."*

- `test/fixtures/scale/network.net`: SCaLE `main` size (≈42 devices, 21+ VLANs) from
  `socallinuxexpo/scale-network` `switch-configuration/config/*` and
  `facts/routers/routerlist.csv`; topology from the switchtypes `Hierarchy` column; VLAN
  IPv4+IPv6 prefixes and colours as published. Gateway routers get `router`, `wan` and
  `address` lines so `--view routing` has something to draw (same for NetBox's site routers). Uses trunk sets (section 4) for the
  trunktypes. Optionally a `full` variant with APs (188 devices) for a slow/`check`-only test.
- `test/fixtures/netbox/network.net`: NetBox demo data v4.7 (72 devices, 108 cables, 63 VLANs,
  24 sites). Real cable ends, so ports are named; prefixes and addresses as in the dump.
  Disconnected sites are separate components.
- Converter scripts are throwaway, not committed; the `.net` files are the source of truth
  and say in their header where they came from.
- EMF Camp 2014 configs (no licence) may be converted locally to sanity-check a deep real
  tree. Never committed.

### 3. Full-render quality

- **Overlap check**: a test helper over the placed layout + rendered label boxes: no two
  device/group boxes overlap, no text box overlaps another text box or a box it doesn't
  belong to, no label is clipped by its container. Runs on home, SCaLE, NetBox, and every
  slice test.
- **Trunk labels**: one label per link, never overprinted or struck through. A link carrying
  a named trunk set shows the name; an unnamed collapsed trunk shows the existing id-range
  text once.
- **Legend**: lists only styles and VLANs actually drawn, and all of them (no silent drop). A
  VLAN counts as drawn when any drawn link, trunk bar or chip carries it, so VLANs that only
  travel inside a trunk bar are listed too (call). A trunk-set entry shows
  `name → VLAN list`; its member VLANs still get their own entries. The legend wraps into as
  many columns as needed; a right-hand legend taller than the diagram moves below it (call).
  Otherwise today's placement rules and the `legend` statement are unchanged; home never
  triggers the move.
- **Colours**: the 8-entry `PALETTE` runs out at scale. VLANs without an explicit colour get
  distinct looks: palette colours first, then palette × dash patterns, so 146 VLANs are
  pairwise distinguishable in the legend. Explicit `color` always wins.
- **Disconnected components** (NetBox sites) are packed into rows instead of one line, if ELK's
  component packing (`elk.separateConnectedComponents` + `elk.aspectRatio`) does it without
  breaking the home golden; otherwise left as is (not a goal).
- **Wrapping**: one timeboxed try (1 h) of ELK layered wrapping on SCaLE. Keep only if home
  stays identical and SCaLE gets no overlaps.

### 4. Named trunk sets (new DSL statement)

```
trunk cfuplink vlans cfspkr, cfinfra, cfvendor, cfsigns
link cf-mdf-01 -- cf-idf-01 trunk cfuplink
```

- `trunk <name> vlans <vlan>(, <vlan>)*` defines a set; `link … trunk <name>` uses it instead
  of `vlans …` (mutually exclusive on one link; `check` errors on both, unknown set, or a set
  naming an unknown VLAN).
- Semantics: exactly as if the link listed those VLANs; only rendering and the legend differ.
  A link with a trunk set is always drawn as one trunk bar labelled with the set name, even
  with ≤ `TRUNK_AT` VLANs (call: the point of naming is one label).
- CLI parity: noun `trunk` (`add`, `set`, `rm`, list), `link add/set --trunk <name>`,
  completion of set names, help/man generated, rebuild and parity tests extended.
- `show --json` keeps the expanded lanes and adds `trunk: <name>` on the link.

### 5. Sibling collapse (automatic)

- Leaf devices are collapsed when ≥3 share: the same single neighbour endpoint (same parent
  device *and* same parent port, or all device-level), the same link lanes/trunk set, no internals (no ports/bridges/radios/addresses
  blocks), and the same model/style. Anything that differs keeps them separate.
- Drawn as one box, `N×` + the common name (shared prefix, or the model), with the member ids
  on a sub-line as ranges (`cfroom101–114`) so no name disappears. One link to the parent.
- `render --no-collapse` draws them all. No DSL statement (so no CLI noun).
- Home network has no such group; its golden stays identical (test asserts it).

### 6. Slices (`render` flags)

| Flag | Effect |
|---|---|
| `--view combined\|physical\|vlans\|routing` | combined (default) = today; physical = boxes and cables, no lanes/arrows; vlans = lanes, no arrows; routing = only devices with a `router` line, with today's per-device arrows (WAN → router → its bridges/VLAN ifaces; no cross-link L3 modelling, owner choice) |
| `--vlan <name\|id>` (repeatable) | keep devices and links that carry one of these VLANs; lanes of other VLANs hidden |
| `--around <device> [--depth N]` | keep devices within N links (default 1) of the device |

- Pipeline: build → slice → collapse (call). Slices see real device ids (`--around cfroom105`
  works); collapse then runs on what is kept; cut-off identical leaves collapse into one stub.
- Flags combine as intersection.
- `--vlan`: a device is kept when one of its links or internals (ports, vlan-ifaces, radios)
  carries the VLAN. Kept devices keep their internals whole; only lanes of other VLANs are
  hidden (call: context over minimalism).
- A neighbour that is cut off but linked to a kept device is drawn as a **stub**: small dashed
  box with its id, and the link to it. Stubs are not expanded further.
- Legend in a slice lists only what the slice draws.
- Errors: unknown device/VLAN → the part C error shape with a hint listing the closest names
  (`closest` exists). Empty slice → error, exit 1.
- Completion for `--vlan` and `--around` values; help and man page generated as in part C.
- Parent spec's `--only vlan <x>` and `--site <device>` are renamed to `--vlan` and `--around`
  (no site concept exists; "around" says what it does). Parent spec updated.

### 7. `check` additions

- Warning: VLAN defined but drawn nowhere.
- Warning: device with no links (excluding the top cloud).
- Info/warning above 200 devices: layout may be slow; suggest a slice.

## Acceptance (this part)

1. Fix-first tests pass; home golden and DSL-only parity unchanged (or regenerated once, with reason).
2. Reworded Acceptance 2: SCaLE and NetBox fixtures render; overlap check passes; legend lists
   every drawn VLAN, pairwise distinct.
3. Acceptance 3: on both fixtures, golden SVGs for at least `--around <core> --depth 1`,
   `--vlan <one>`, `--view physical`, `--view routing`; each passes the overlap check and the
   owner judges them readable.
4. `trunk` statement: DSL round-trip, CLI rebuild/parity tests, `check` errors.
5. Collapse: SCaLE fan-out of 13–14 rooms renders as one box; `--no-collapse` renders all.

## Left to the builder

- Exact stub look, collapse label wording, dash patterns and column widths, the legend's
  column-breaking rule.
- How the overlap helper measures text (reuse `textWidth`).
- Order of work; the fix-firsts go first.
