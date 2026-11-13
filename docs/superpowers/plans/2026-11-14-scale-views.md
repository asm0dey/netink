# Scale and views Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Big networks (SCaLE ≈188 devices, NetBox demo 24 sites) render as a clean full SVG, and `render` can cut readable slices out of them.

**Architecture:** Model-level passes run between `loadModel` and `layout`: `sliceModel` (views and filters, stubs) then `collapseSiblings`, both pure `Model → Model` functions in `src/model/`. Rendering changes stay in `src/render/svg.ts` (labels that avoid each other, trunk-set labels, complete legend, distinct VLAN looks). A new DSL statement `trunk` flows through parser, printer, model and the part C command table. An overlap checker in `test/helpers/` is the judge of "high quality" for every fixture and slice.

**Tech Stack:** TypeScript on bun 1.4.4, `bun test`, elkjs (layered), yargs 18, Biome.

**Spec:** `docs/superpowers/specs/2026-11-14-scale-views-design.md`

## Global Constraints

- bun for everything. `mise run test` (Biome check + `bun test`) and `mise run typecheck` pass at every commit; `mise run fmt` before committing.
- `test/fixtures/home.golden.svg` and `test/acceptance/dsl-only.test.ts` stay byte-identical. If a task's change moves anything in the home render, stop and report to the owner with a before/after; do not regenerate the golden without the owner's yes.
- Privacy: after `git add`, run the owner's privacy deny-list check (`.netdraw-privacy/privacy-check.sh` in the owner's private network folder; ask the owner for its path at the start of execution); commit only when it prints nothing (its exit code is 1 when clean — ignore the code, judge the output). Never write that path or anything from that folder into the repo.
- Fixtures are public data only: SCaLE (BSD-3-Clause), NetBox demo data (MIT). Never EMF Camp data, never anything from the owner's network.
- Converter scripts live in the session scratchpad, never in the repo.
- Work on `main`, no worktree, no remote. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Error shape and exit codes unchanged: 0 ok; 1 model/check/edit/slice errors; 2 usage errors; `--json` errors are `{"error","file","line"?,"hint"?}` via `fail()` in `src/cli.ts`.
- Every new DSL statement gets a part C noun (`src/edit/table.ts`), completion, generated help/man; `test/edit/parity.test.ts` must keep passing.
- No production code whose only purpose is testability. Text never shrinks to fit: font sizes and stroke widths are constants.

## Review Focus

1. Collapsing must never lose information: members with any differing note/role/lease/label text, or with internals, stay separate. (Task 6)
2. `--around` given a child id (`core/ether2`) or a collapsed member id resolves to the top-level device; `--depth 0` keeps just that device plus stubs; a negative depth is a usage error (exit 2). (Task 7)
3. `--vlan 50` (numeric id) and `--vlan guest` (name) both work; an unknown VLAN errors with a closest-name hint; a defined VLAN that no link carries errors with "VLAN <x> is carried by no link" (exit 1). (Task 7)
4. A trunk set named like a VLAN, a trunk set listing an unknown VLAN, and a link with both `vlans` and `trunk`: each an error with line and hint; the file is not half-applied by the CLI. (Tasks 2, 3)
5. New `check` warnings must not fire on `examples/home/network.net` or `network-dsl-only.net` (no new noise on the owner's real network shape). (Task 8)

---

### Task 1: Overlap checker and fix-first coverage

**Files:**
- Create: `test/helpers/overlap.ts`, `test/helpers/overlap.test.ts`
- Modify (only if a case is missing): `test/model/build.test.ts`, `test/render/geometry.test.ts`

**Interfaces:**
- Produces: `overlaps(svg: string, placed: Placed): string[]` — empty when clean; each string names the two offenders and their rects.

Rules the checker enforces (from spec §3):
- Two boxes in `placed.boxes` either don't intersect or one contains the other.
- Two `<text>` rects don't intersect. A text rect is derived from the element's `x`, `y`, `text-anchor`, font size (its `class`: `.t` 12 px bold, `.s` 12.5 px, `.h` 15 px bold; explicit `font-size` wins; default 14) and `textWidth(text, size, bold)` from `src/layout/measure.ts`; height = size, baseline at `y`.
- A text rect is, for every box, either fully inside or fully outside it (crossing a border = clipped).
- The legend `<g class="legend">` texts are checked against each other and against boxes too.

- [ ] **Step 1: Write the failing tests** in `test/helpers/overlap.test.ts`:
  - `overlaps` on a hand-built SVG with two texts at the same x/y returns one entry;
  - on two boxes that partly overlap returns one entry; on a box inside another returns `[]`;
  - on a text half across a box border returns one entry;
  - `home renders with no overlaps`: `overlaps(renderSvg(m, p), p)` for `examples/home/network.net` is `[]`.
- [ ] **Step 2: Run** `bun test test/helpers` — expect FAIL (module missing).
- [ ] **Step 3: Implement** `overlaps` (regex over `<text …>…</text>` is enough; unescape `&amp;` etc. before measuring).
- [ ] **Step 4: Run** `bun test test/helpers` — expect PASS. If the home case fails, the checker or the home render is wrong: fix the checker if it misreads the SVG; if home really overlaps, stop and report to the owner (golden constraint).
- [ ] **Step 5: Fix-first coverage.** Confirm tests exist for: a VLAN def named each of `wan`, `dev`, `spare` getting VLAN (not device) styles (fix `9d24324`); a vertical ending 3, 5 and 8 px past a horizontal crossing keeps its end (fix `13e7ebd`). Add whichever is missing; run `bun test`.
- [ ] **Step 6: Commit** `test: overlap checker; fix-first cases covered`.

### Task 2: `trunk` statement — DSL, model, render

**Files:**
- Modify: `src/types.ts`, `src/dsl/parse.ts`, `src/dsl/print.ts`, `src/model/build.ts`, `src/render/geometry.ts`, `src/render/svg.ts`, `src/help.ts` (grammar lines)
- Test: `test/dsl/parse.test.ts`, `test/dsl/print.test.ts`, `test/model/build.test.ts`, `test/render/svg.test.ts`

**Interfaces:**
- Produces:
  - `Stmt` gains `{ kind: "trunk"; name: string; vlans: string[] }`; link `Stmt` gains `trunk?: string`.
  - `MLink` gains `trunk?: string`; `Model` gains `trunks: { name: string; vlans: string[] }[]` (definition order).
  - `lanesFor(points: P[], lanes: string[], trunk?: boolean)` — returns the single `"trunk"` bar when `trunk` is true or `lanes.length > TRUNK_AT`.

Grammar (add to `GRAMMAR` in `src/help.ts`):
```
trunk <name> vlans <vlan>(, <vlan>)*
link <ep> (-- <ep>)+ [vlans <name>(,<name>)* | trunk <name>] [label "l"]
```

- [ ] **Step 1: Failing tests:**
  - parse `trunk up vlans a, b` → `{kind:"trunk", name:"up", vlans:["a","b"]}`; parse `link x -- y trunk up` → link with `trunk:"up"` and no `vlans`; parse `link x -- y vlans a trunk up` → `DslError` with hint `use either vlans or trunk`.
  - print round-trip of both statements equals the input lines.
  - build: with `vlan a 10`, `vlan b 20`, `trunk up vlans a, b`, `link x -- y trunk up` → the link's `lanes` = `["a","b"]`, `trunk` = `"up"`; `model.trunks` = `[{name:"up", vlans:["a","b"]}]`.
  - build errors (in `model.diags`, level error, with line): `link … trunk nope` → `unknown trunk "nope"` with closest hint; `trunk up vlans a, zz` → `unknown vlan "zz"`; a trunk named like a VLAN (`trunk a vlans b`) → `trunk "a" clashes with vlan "a"`.
  - `show links --json` includes `"trunk":"up"` on that link and its expanded `lanes`.
  - render: a 2-VLAN trunk-set link draws one path with the trunk stroke (`stroke-width="8"`) and one label text `up`; no `VLAN 10, 20` text for it.
- [ ] **Step 2: Run** `bun test test/dsl test/model test/render` — expect FAIL.
- [ ] **Step 3: Implement.** Parser: `trunk` joins the top-level keyword list; link options accept `trunk <ident>`. Build: resolve `trunk` to its VLAN names exactly as `l.vlans` is resolved today (same branch in the `ends.forEach` loop in `build.ts`), set `MLink.trunk`. Render: pass `!!l.trunk` to `lanesFor`; the label text for a trunk-set link is `[l.label, l.trunk]` joined by ` · ` (instead of the `VLAN …` id list).
- [ ] **Step 4: Run** `bun test` — expect PASS, home golden unchanged.
- [ ] **Step 5: Commit** `feat(dsl): named trunk sets`.

### Task 3: `trunk` CLI noun and `link --trunk`

**Files:**
- Modify: `src/edit/table.ts`, `src/complete.ts` (if trunk-name completion isn't table-driven), `src/cli.ts` (`show trunks` if `show` slices are listed there)
- Test: `test/edit/nouns.test.ts`, `test/edit/parity.test.ts`, `test/complete.test.ts`

**Interfaces:**
- Consumes: `Stmt` kinds from Task 2.
- Produces: noun `trunk` (`add|set|rm <name> [--vlans a,b]`, covers `["trunk"]`, `show: "trunks"`); `link` noun flag `trunk` (clearable); `Complete` gains `"trunk"`.

- [ ] **Step 1: Failing tests:**
  - `netdraw trunk add up --vlans a,b` on a file appends `trunk up vlans a, b`; `trunk set up --vlans a` rewrites it; `trunk rm up` deletes it; `trunk add up` without `--vlans` → exit 1, message `trunk add needs --vlans`.
  - `link set x y --trunk up` on a link with `vlans a` → line becomes `link x -- y trunk up` (vlans removed); `link set x y --vlans a` on a trunk link removes `trunk`; `link add x y --vlans a --trunk up` → exit 1, `use either --vlans or --trunk`, file untouched.
  - `complete(["link","set","x","y","--trunk",""])` lists the file's trunk names.
  - parity test: `trunk` is covered by a noun (the existing coverage test picks the new kind up).
- [ ] **Step 2: Run** `bun test test/edit test/complete.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** following the `vlan` and `link` nouns in `table.ts`.
- [ ] **Step 4: Run** `bun test` and `mise run man` — PASS; `dist/netdraw.1` mentions `trunk`.
- [ ] **Step 5: Commit** `feat(cli): trunk noun, link --trunk`.

### Task 4: Large fixtures

**Files:**
- Create: `test/fixtures/scale/network.net`, `test/fixtures/scale/LICENSE`, `test/fixtures/netbox/network.net`, `test/fixtures/netbox/LICENSE`, `test/acceptance/large.test.ts`

**Interfaces:**
- Produces: the two fixture paths, used by Tasks 5–10.

Conversion (throwaway scripts in the scratchpad; download sources into their own empty scratch dirs):
- **SCaLE**, `full` size, from `github.com/socallinuxexpo/scale-network` (`switch-configuration/config/{vlans,switchtypes,trunktypes,types}`, `facts/routers/routerlist.csv`, `facts/aps/apuse.csv`): one `device` per switch/router/AP, links from the switchtypes `Hierarchy` column, one `vlan` per VLAN with its published IPv4 and IPv6 prefixes and colour, one `trunk` per trunktype, links using those trunks. Each gateway router gets `router`, a `wan` line and `address` lines for the VLANs it routes, so `--view routing` has content.
- **NetBox**, `sql/netbox-demo-v4.7.sql` from `github.com/netbox-community/netbox-demo-data`: devices that end at least one interface-to-interface cable (skip power, console, front/rear-port cables); links port-to-port (`dev.port`); VLANs (deduplicate clashing names by suffixing the group/site slug); prefixes as `subnet`; interface IPs as `address`; site routers get `router`. Port names keep `/`; characters the DSL rejects become `-` (note each such rewrite in the fixture header).
- Each `.net` header: source URL, commit/version, date, licence name, "converted by a throwaway script; this file is the source of truth". `LICENSE` holds the upstream copyright notice and licence text verbatim.

- [ ] **Step 1: Write `test/acceptance/large.test.ts`** (fails: files missing):
  - each fixture loads with zero error diags;
  - SCaLE: ≥30 top-level devices and ≥24 VLAN defs; NetBox: ≥24 VLAN defs and ≥20 top-level devices;
  - each fixture uses at least one `trunk` (SCaLE) / at least one `dev.port` endpoint (NetBox).
- [ ] **Step 2: Convert** and write both fixtures and LICENSE files.
- [ ] **Step 3: Run** `bun test test/acceptance/large.test.ts` — PASS. Record in the commit message how long `bun src/cli.ts render --file test/fixtures/scale/network.net -o /dev/null` takes.
- [ ] **Step 4: Commit** `test: SCaLE and NetBox large fixtures` (privacy check first).

### Task 5: Full-render quality — labels, legend, colours, packing

**Files:**
- Modify: `src/render/svg.ts`, `src/layout/elk.ts`
- Test: `test/render/svg.test.ts`, `test/acceptance/large.test.ts`

**Interfaces:**
- Consumes: `overlaps` (Task 1), fixtures (Task 4), `Model.trunks` (Task 2).

- [ ] **Step 1: Failing tests:**
  - `large.test.ts`: `overlaps(svg, placed)` is `[]` for SCaLE and NetBox full renders.
  - legend completeness: every VLAN name that appears in some `MLink.lanes` or as `laneOfStyle(node.style)` has a legend entry; no entry for a VLAN that appears nowhere.
  - legend trunk sets: each `model.trunks` entry used by a link has a legend entry `"<name> → <vlan, vlan, …>"` drawn with the trunk stroke.
  - distinct looks: on SCaLE, the `(stroke, stroke-width, stroke-dasharray)` triples of all VLAN lanes from `laneStyles` are pairwise distinct (export `laneStyles` if it isn't).
  - legend move: a model with `legend position right` whose legend is taller than `placed.height` puts the legend below (its `y` ≥ `placed.height`).
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement:**
  - `spot()` treats every already-placed label rect as an obstacle (keep a list of placed rects); when no option is clean, try the same options shifted outward in 14 px steps (up to 10) before falling back. Home must stay identical — home labels are placed first-come in today's order and today's first clean spot doesn't touch another label, so it shouldn't move; verify.
  - `laneStyles`: keep today's assignment; when a VLAN's triple equals an earlier one, step it through an extended dash list (today's `DASHES` first, then generated patterns) until unique. Home has no collision, so it is unchanged.
  - `legendEntries`: VLANs carried by links **or** used by node styles; trunk-set entries; legend move when right-hand and taller than the diagram.
  - `elk.ts`: try `elk.separateConnectedComponents: true` with `elk.aspectRatio` (start at 1.6) for NetBox's disconnected sites. Keep only if home stays byte-identical; otherwise leave it out and note it in the commit.
- [ ] **Step 4: Wrapping timebox (1 h max):** try ELK layered wrapping (`elk.layered.wrapping.strategy`) on SCaLE. Keep only if home is identical and SCaLE has no overlaps; otherwise revert and note the outcome in the commit.
- [ ] **Step 5: Run** `bun test` — PASS.
- [ ] **Step 6: Commit** `feat(render): labels avoid each other, complete legend, distinct VLAN looks`.

### Task 6: Sibling collapse

**Files:**
- Create: `src/model/collapse.ts`, `test/model/collapse.test.ts`
- Modify: `src/cli.ts` (render pipeline, `--collapse` flag), `src/types.ts`

**Interfaces:**
- Produces: `collapseSiblings(model: Model): Model`; `MNode` gains `members?: string[]` (the collapsed top-level ids, in model order).

Rule (spec §5): ≥3 top-level leaf devices (no `children`) whose only link goes to the same endpoint (same node id, port included), with equal `lanes` and `trunk`, equal `style`, equal `sub` lines and no note/role/lease differences (equal `sub` covers that). The group becomes one node: id = first member's id + `..` + last member's id; label `N× <longest common prefix of the ids, trimmed of -_.>` or, when the prefix is empty, `N× <model>`; `sub` gets the member ids as ranges (`cfroom101–114`; reuse the numeric-run logic of `idList` on the trailing digits, plain list otherwise). One link replaces the members' links. Hints and arrows naming a member are dropped only if they name the member itself.

- [ ] **Step 1: Failing tests** in `test/model/collapse.test.ts`:
  - 14 identical rooms on one switch port → one node, label `14× cfroom`, sub contains `cfroom101–114`, one link;
  - two groups of 2 → nothing collapsed (below 3);
  - one member with a note → that member stays separate, the other 13 collapse;
  - members on two different parent ports → two groups (or none, per the ≥3 rule);
  - home model: `collapseSiblings(m)` deep-equals `m`.
  - three cut-off stubs (from a slice) on the same parent endpoint collapse into one stub-styled node.
  - CLI: `render --no-collapse` on SCaLE draws every AP id; default render on SCaLE has fewer device boxes than top-level devices.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement** `collapseSiblings`; wire `render` (and only `render`): `layout(collapse ? collapseSiblings(m) : m)`. yargs option `collapse` boolean default `true` (so `--no-collapse` works), described "draw identical leaf siblings one by one".
- [ ] **Step 4: Run** `bun test` — PASS, overlap check on SCaLE still `[]`.
- [ ] **Step 5: Commit** `feat(render): collapse identical leaf siblings`.

### Task 7: Slices — `--vlan`, `--around`, `--depth`

**Files:**
- Create: `src/model/slice.ts`, `test/model/slice.test.ts`
- Modify: `src/cli.ts`, `src/complete.ts`, `src/render/svg.ts` (stub look)
- Test: `test/cli.test.ts`, `test/complete.test.ts`

**Interfaces:**
- Consumes: `closest` from `src/model/check.ts`.
- Produces: `type Slice = { view?: "combined" | "physical" | "vlans" | "routing"; vlans?: string[]; around?: string; depth?: number }`; `sliceModel(model: Model, s: Slice): { model: Model } | { error: string; hint?: string }`. A stub is an `MNode` with `kind: "device"`, `style: "stub"`, `children: []`, `label` = the original top-level id. (`view` is implemented in Task 8; this task accepts only `combined`/undefined.)

Semantics (spec §6; pipeline build → slice → collapse):
- Top-level device of any id = `id.split("/")[0]`.
- `--around D --depth N` (default 1): keep top-level devices within N links of D (BFS over top-level adjacency from `model.links`).
- `--vlan X` (repeatable; name or numeric id): keep top-level devices where one of their links' `lanes`, or a descendant node's `laneOfStyle(style)`, is that VLAN. Links of kept devices keep only those VLAN lanes (a link left with no lanes keeps `["wire"]`). Kept devices keep their internals whole.
- Several flags: intersection.
- Stubs: a dropped top-level device linked to a kept one becomes a stub; links to it are kept (endpoint rewritten to the stub id when the link ended on a port of it). Arrows and hints touching dropped devices are dropped.
- Errors (exit 1 via `fail()`): unknown device or VLAN → `unknown device "x"` / `unknown vlan "x"` with `closest` hint; VLAN carried nowhere → `VLAN <x> is carried by no link`; empty result → `the slice is empty`. `--depth` < 0 → usage error, exit 2.
- Legend follows the sliced model (no extra code if `legendEntries` reads the model).
- Stub render: dashed border (`stroke-dasharray="4 3"`), `#9E9E9E` stroke, white fill, label in `.s` class.

- [ ] **Step 1: Failing tests** in `test/model/slice.test.ts` (on the home model and the fixtures):
  - `--around core --depth 1` on home keeps core and its direct neighbours, the next ring are stubs;
  - `--around core/ether2` ≡ `--around core`; `--depth 0` keeps core only, every neighbour a stub;
  - `--vlan guest` and `--vlan 50` give the same model; the kept links carry only `guest`;
  - unknown VLAN → error with hint; defined-but-unused VLAN → `VLAN x is carried by no link`;
  - stubs: no arrow references a dropped id; every link endpoint exists in the sliced model.
  - `test/cli.test.ts`: `render --depth -1` exits 2; `render --around nope --json` exits 1 with `{"error":"unknown device \"nope\"", "hint":…}`.
  - `test/complete.test.ts`: `render --vlan ` completes VLAN names, `render --around ` completes device ids.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement** `sliceModel`; `render` runs `sliceModel` before `collapseSiblings`; yargs options `vlan` (string array), `around` (string), `depth` (number, default 1); completion.
- [ ] **Step 4: Run** `bun test`, `mise run man` — PASS; overlap check passes on `--around` and `--vlan` slices of both fixtures.
- [ ] **Step 5: Commit** `feat(render): --vlan, --around, --depth slices with stubs`.

### Task 8: Views — `--view physical|vlans|routing`; `check` additions

**Files:**
- Modify: `src/model/slice.ts`, `src/cli.ts`, `src/complete.ts`, `src/model/check.ts`
- Test: `test/model/slice.test.ts`, `test/model/check.test.ts`

**Interfaces:**
- Consumes: `Slice.view` from Task 7.

Views:
- `physical`: every link's `lanes` = `["wire"]`, `trunk` cleared, `arrows` = `[]`.
- `vlans`: `arrows` = `[]`.
- `routing`: keep top-level devices that contain a `router` node, plus stubs for their neighbours; arrows as today; links among kept devices and to stubs.
- `combined`: today's model.

`check` warnings (spec §7), added to `checkModel`:
- `vlan <x> is defined but carried by no link` — a VLAN def that no link lane and no node style uses;
- `device <x> has no links` — top-level `device`/`client` with no link (clouds exempt);
- `<n> devices: layout may be slow; render a slice (--around, --vlan)` once when top-level devices > 200.

- [ ] **Step 1: Failing tests:**
  - physical view of home: no path with a VLAN stroke, no arrow path, legend has no VLAN entries;
  - vlans view of home: arrows empty, lanes unchanged;
  - routing view of SCaLE and NetBox: non-empty, every kept non-stub device has a router child;
  - routing view of a model with no router → `the slice is empty`;
  - check: each new warning fires on a minimal file; **none of them fires on `examples/home/network.net` or `network-dsl-only.net`**.
  - completion: `render --view ` → `combined physical vlans routing`.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `bun test`, `mise run man` — PASS.
- [ ] **Step 5: Commit** `feat(render): --view physical|vlans|routing; check warns on unused vlans, unlinked devices, size`.

### Task 9: Acceptance goldens and spec updates

**Files:**
- Create: `test/fixtures/scale/*.golden.svg`, `test/fixtures/netbox/*.golden.svg`
- Modify: `test/acceptance/large.test.ts`, `docs/superpowers/specs/2026-11-13-netdraw-design.md`

- [ ] **Step 1: Goldens.** For each fixture write goldens for: full render, `--around <core> --depth 1` (SCaLE: the core router; NetBox: one site router), `--vlan <one>`, `--view physical`, `--view routing`. Test: each renders byte-identical to its golden and `overlaps` is `[]`. Put a regenerate one-liner comment at the top of the test, like `test/acceptance/home.test.ts`.
- [ ] **Step 2: Parent spec.** In `2026-11-13-netdraw-design.md`: Acceptance 2 → the reworded text from the part D spec §2; Views item 3 and the CLI sketch → `--view combined|physical|vlans|routing`, `--vlan <name|id>`, `--around <device> [--depth N]`, `--no-collapse`.
- [ ] **Step 3: Run** `mise run test`, `mise run typecheck` — PASS.
- [ ] **Step 4: Commit** `test: acceptance goldens for large fixtures and slices; spec flags renamed`.
- [ ] **Step 5: Owner review.** Send the owner the full and slice SVGs of both fixtures (render to the scratchpad) for the "readable" judgement of Acceptance 3. Fix what they reject before calling part D done.
- [ ] **Step 6: Memory.** Update `milestone2-state.md`: part D done through the last commit; next is part E (docs, Acceptance 7).
