# DSL device internals — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A device's internals can be written in the DSL as indented blocks, the `.rsc` importer becomes a translator into those blocks, and the home network described with no `.rsc` gives the same model and a byte-identical SVG.

**Architecture:** `parseDsl` gains indented device blocks (`DevItem[]` on the `device` node statement). A new translator (`src/rsc/translate.ts`) turns all imported `DeviceFacts` into the same `device` statements, absorbing every RouterOS inference `build.ts`/`l3.ts` make today. `buildModel(stmts, facts)` keeps its signature as a thin wrapper: it replaces each `import` statement with its translated `device` statement and runs the one statement-only builder. Inside the builder, a device's items become a neutral interface table (the existing `Iface` shape), so the lane-inference code changes very little. Because the wrapper keeps the signature, the existing 119 tests and `home.golden.svg` serve as the parity oracle throughout.

**Tech Stack:** TypeScript on bun 1.4 (`bun test`, `bunx tsc --noEmit`), elkjs. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-13-dsl-device-internals-design.md` (parent: `docs/superpowers/specs/2026-11-13-netdraw-design.md`, inputs: `docs/superpowers/specs/2026-11-13-milestone-2-inputs.md`).

**Refinements of the spec made by this plan (the spec leaves Stmt shapes to the builder):**
- `allow <iface> -> <addr> ["label"]` is also a **device-block item** (local interface name). The translator emits its forward-accept arrows there, so derived arrows keep today's order (per device: route arrows, then allow arrows). Top-level `allow` keeps working as today.
- "`show --json` equal" (spec Acceptance 1) compares the `Model` with `line`, `file` and `diags` removed. Diags differ by nature: the `.rsc` path warns about the unmatched CAPsMAN radio `cap-wifi2`.

## Global Constraints

- bun for everything (`bun test`, `bun src/cli.ts`); never npm. mise tasks: `mise run test`, `mise run typecheck`.
- Same input → byte-identical SVG. No `Date`, no `Math.random`, no dependence on unsorted Map order.
- `test/fixtures/home.golden.svg` may be regenerated only by Task 1 or Task 2, each in its own commit and each with a stated reason. From Task 3 on it must pass **unchanged**.
- Before every commit, run the owner's privacy deny-list check: `.netdraw-privacy/privacy-check.sh` in the owner's private network folder. **Ask the owner for its path at the start of execution.** Never commit when it fails.
- Fixtures stay anonymised: only `examples/home` names and documentation prefixes (`2001:db8::/32`, `203.0.113.0/24`).
- Ids are `[a-z0-9_-]+`; child ids are `<device>/<name>`. A `/` inside a quoted block name is written `%2F` in the id, and `%` is written `%25`.
- Indentation: two spaces per level. Tabs and odd counts are errors.
- Language anti-goal: no RouterOS words (lists, masquerade, datapath, CAPsMAN) in the DSL grammar.

## Review Focus

1. **A continuation line inside or after a block** (a trailing comma, then an indented next line, as in `imports rsc …,`) must not be read as a block line. Test in Task 3.
2. **A comment-only or blank line between block lines** must not end the block. Test in Task 3.
3. **A hand-written `allow` to an address that no client leases** must draw no arrow and raise no error, as derived arrows behave today. Test in Task 6.
4. **A DSL device with internals but no `router`** (an AP written by hand) must get today's router-less behaviour: unlinked ports are hidden unless `--all`, and uplink → radio links are drawn. Test in Task 6.
5. **An IPv6-only interface or VLAN** (no IPv4 anywhere) must not throw in label computation or the subnet check. Test in Task 7.

---

## File Structure

- `src/types.ts`: new `DevItem`, `VlanRef`; `node` Stmt gains `os`, `items`; `vlan` Stmt and `VlanDef` change `subnet?: string` → `subnets: string[]`.
- `src/dsl/parse.ts`: indentation and block items.
- `src/dsl/print.ts` (new): `printStmts`.
- `src/rsc/translate.ts` (new): `translate`; `collectRadios`/`placeCaps`/route matching move here from `build.ts`.
- `src/model/device.ts` (new): `buildDevice` over items, plus the neutral iface table.
- `src/model/build.ts`: statement-only builder plus the `buildModel(stmts, facts)` wrapper. `DeviceFacts` is imported only by the wrapper's expand step.
- `src/model/l3.ts`: `deriveArrows` over device items.
- `src/model/addr.ts` (new): IPv4/IPv6 CIDR math for the check.
- `src/render/svg.ts`, `src/render/geometry.ts`: Tasks 1, 2, 7.
- `src/cli.ts`: `import` command; grammar help text.
- `examples/home/network-dsl-only.net` (new); `test/acceptance/dsl-only.test.ts` (new).

---

### Task 1: VLAN styles get their own namespace

Fixes the milestone-1 finding: a VLAN named `wan`, `dev` or `spare` is drawn in device colours.

**Files:** Modify `src/model/build.ts` (every place a style is taken from a VLAN def: WAN vlan chip `vstyle`, bridge `def?.name`/untagged name, radio `def?.name`), `src/render/svg.ts` (style lookups `lanes.get(n.style)`, `styleStroke`). Test: `test/model/build.test.ts`, `test/render/svg.test.ts`.

**Interfaces:** Produces `vlanStyle(name: string): string` → `` `vlan:${name}` `` and `laneOfStyle(style: string): string | undefined` (strips `vlan:`; `undefined` for built-ins), both exported from `src/model/build.ts`. Built-in styles (`dev`, `wan`, `router`, `port`, `box`, `spare`, `vif`, `cloud`, and the fallbacks `guest`/`lan`/`lte`) stay unprefixed.

- [ ] **Step 1: Write the failing tests**
  - `build.test.ts` › `"a bridge on a VLAN named wan gets style vlan:wan"`: an import whose bridge carries a vlan iface on id 70, with `vlan wan 70 color cyan`. The bridge node's `style` is `"vlan:wan"`.
  - `svg.test.ts` › `"a vlan:wan group is stroked in the VLAN colour, not the WAN red"`: the rendered SVG for that group's rect contains the cyan stroke (`#0097A7`) and not `#C62828`.
- [ ] **Step 2: Run** `bun test test/model/build.test.ts test/render/svg.test.ts`. Expected: both new tests FAIL.
- [ ] **Step 3: Implement.** Every VLAN-derived style goes through `vlanStyle`. svg.ts resolves lanes via `laneOfStyle(n.style)` before using built-in `TINT`/branches.
- [ ] **Step 4: Run** `bun test`. Expected: all pass. If `home.golden.svg` differs, the diff must be style-name-only and invisible (no colour or geometry change). Otherwise fix the code, not the golden. Regenerate only if the SVG text embeds style names.
- [ ] **Step 5: Privacy check, then commit** `fix(model): VLAN-derived styles live under vlan:<name>`.

### Task 2: Jump crossing margin clears the halo

Fixes the milestone-1 finding: the 7 px jump halo can erase a vertical that ends 3–8 px past a crossing.

**Files:** Modify `src/render/geometry.ts:43` (the `c.y1 < a.y - 3 && c.y2 > a.y + 3` filter); the halo width used by the arc pass in `src/render/svg.ts` (~line 201). Test: `test/render/geometry.test.ts`.

**Interfaces:** Produces `export const JUMP_HALO_W = 7` in `geometry.ts`; svg.ts uses it for the arc halo. Margin = `r + JUMP_HALO_W / 2 + 2`.

- [ ] **Step 1: Write the failing test** `"no jump over a vertical that ends 6 px past the horizontal"`: horizontal (0,100)→(200,100), vertical x=100 from y=0 to y=106, r=5. The path has no arc. Also add `"jump over a vertical that extends 12 px past"`: vertical to y=112, one arc.
- [ ] **Step 2: Run** `bun test test/render/geometry.test.ts`. Expected: the first test FAILS.
- [ ] **Step 3: Implement** the margin with `JUMP_HALO_W`.
- [ ] **Step 4: Run** `bun test`. If the home golden changes, inspect it in a browser: no jump disappears that crosses a line passing through. Regenerate with the command in `test/acceptance/home.test.ts`.
- [ ] **Step 5: Privacy check, then commit** `fix(render): jump crossing margin clears the 7 px halo` (golden in the same commit, if changed).

### Task 3: Types and parser — indented device blocks

**Files:** Modify `src/types.ts`, `src/dsl/parse.ts`, `src/cli.ts` (`GRAMMAR` text and `show vlans` output for `subnets`), `src/model/build.ts:145` and `src/render/svg.ts:134` (`subnet` → `subnets`, legend sub-line `subnets.join(", ")`). Test: `test/dsl/parse.test.ts`.

**Interfaces — Produces (in `src/types.ts`):**
```ts
export type VlanRef = string | number;            // VLAN-def name or numeric id
export type IfFlags = { lan?: true; guest?: true; hotspot?: true };
export type DevItem = { line: number } & (
  | { kind: "wan"; iface: string; on?: string; vlan?: number; route?: string; distance?: number; dhcp?: string | true; nat?: true }
  | { kind: "router" }
  | ({ kind: "bridge"; name: string; addresses: string[]; filtering?: true; items: DevItem[] } & IfFlags)
  | { kind: "ports"; names: string[]; untagged?: VlanRef; tagged: VlanRef[]; horizon?: number }
  | ({ kind: "vif"; name: string; on?: string; vlan: number; addresses: string[] } & IfFlags)
  | { kind: "radio"; ifaces: string[]; tag?: number; ssids: string[] }
  | ({ kind: "address"; iface: string; cidrs: string[] } & IfFlags)
  | { kind: "lease"; address: string; comment?: string }
  | { kind: "allow"; from: string; to: string; label?: string });
```
The `node` Stmt gains `os?: string; items?: DevItem[]` (only for `type: "device"`). `vlan` Stmt and `VlanDef`: `subnets: string[]` (empty when absent).

Grammar per the spec's statement table. Block children of `bridge` may only be `ports`, `vif`, `radio`. `allow` is a device-level item. `dhcp` takes an optional address word. Quoted strings are accepted wherever a block name is expected. `vlan … subnet a, b` and the old bare string (`vlan lan untagged "192.168.0.0/24"`) both parse to `subnets`.

- [ ] **Step 1: Write the failing tests** in `parse.test.ts`:
  - `"device block parses into items"`: the full `core` example from the spec's "The language" section. Assert `items` kinds in order `wan, wan, router, bridge, bridge, address, lease, lease`. The first bridge has `addresses: ["192.168.0.1/24"]`, `lan: true`, and items `ports, ports, radio`. The second `ports` has `tagged: [50, 60]`. The radio has 5 `ifaces` and 3 `ssids`. The second wan has `on: "bridge", vlan: 60, distance: 2, dhcp: true, nat: true`.
  - `"quoted port name"`: `ports "ge-0/0/0", ge-0/0/1` → `names: ["ge-0/0/0", "ge-0/0/1"]`.
  - `"vlan subnets: list and legacy string"`: both forms give `subnets` arrays, including an IPv6 entry.
  - `"tab indentation is an error"`, `"three-space indentation is an error"`: diag at that line, hint `indent block lines with two spaces`.
  - `"block line with no parent"`: an indented `ports` after a `cloud` line → error `ports must be inside a device block`.
  - `"ports under a wan line is an error"`: 4-space `ports` whose level-1 parent is not a `bridge` → error.
  - `"top-level keyword inside a block"`: indented `link …` → error, hint `unindent it`.
  - Review Focus 1, `"continuation line is not a block line"`: `imports rsc a.rsc as a,` followed by `            b.rsc as b` still gives two imports.
  - Review Focus 2, `"comment and blank lines inside a block keep the block open"`.
- [ ] **Step 2: Run** `bun test test/dsl/parse.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.** Track indentation on the first physical line of each logical line only; continuations join first, as today. Keep a stack: the last level-0 `device` and its last level-1 `bridge`. Fix every compile error from `subnet` → `subnets`.
- [ ] **Step 4: Run** `bun test && bunx tsc --noEmit`. Expected: all pass, golden unchanged.
- [ ] **Step 5: Privacy check, then commit** `feat(dsl): indented device blocks and vlan subnet lists`.

### Task 4: Statement printer

**Files:** Create `src/dsl/print.ts`. Test: `test/dsl/print.test.ts`.

**Interfaces:** Produces `printStmts(stmts: Stmt[]): string` (canonical DSL, one statement per line, two-space block indent, strings quoted with `"` and `\` escaped, names quoted only when not `[A-Za-z0-9_.:/-]+`). Also `printItems(items: DevItem[], indent: number): string[]`.

- [ ] **Step 1: Write the failing tests.**
  - `"round-trip every statement kind"`: one Stmt per kind and per `DevItem` kind, every optional field set. Assert `strip(parseDsl(printStmts(s)).stmts)` equals `strip(s)`, where `strip` deletes `line` recursively.
  - `"round-trip examples/home/network.net"`: same assertion on the parsed home file.
  - `"name with a space is quoted"`.
  - Linked fan-out and chains expand at parse time, so the printer emits one `link a -- b` per Stmt. Assert that form.
- [ ] **Step 2: Run** `bun test test/dsl/print.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `bun test test/dsl/print.test.ts`. Expected: PASS.
- [ ] **Step 5: Privacy check, then commit** `feat(dsl): statement printer with round-trip`.

### Task 5: Translator — facts to device statements

**Files:** Create `src/rsc/translate.ts`. Move `collectRadios`, `placeCaps`, `physOf`, `inCidr`/`ipNum`, the WAN route-matching block and the `hasRouter` rule out of `src/model/build.ts`, into the translator. Test: `test/rsc/translate.test.ts`.

**Interfaces:**
- Consumes: `DeviceFacts` (unchanged), `VlanDef` (with `subnets`).
- Produces: `translate(devs: { id: string; line: number; f: DeviceFacts }[], vlans: VlanDef[]): { stmts: Extract<Stmt, { kind: "node" }>[]; diags: Diag[] }`. It returns one `device` node Stmt per input, in input order, with `line` = the import line, `model` = `f.model`, `os` = `` `RouterOS ${f.version}` `` (when known) and `items`. The unmatched-CAP warning goes in `diags`, with today's text.

Emission rules (each mirrors today's `buildDevice`/`deriveArrows`; items appear in this order):
1. One `wan` per `lists.WAN` member, in list order. A vlan-type member gets `on`/`vlan`. A matched default route gives `route` (= comment ?? dst) and `distance`. A DHCP client gives `dhcp` (its address, or `true`). Membership in a masquerade out-list gives `nat`.
2. `router` when the `hasRouter` rule holds.
3. One `bridge` per non-WAN bridge, in iface order. Its addresses come from `/ip address`. `lan` when the bridge is in `lists.LAN`; `guest` when it is in hotspots or `lists.GUEST`; `hotspot`; `filtering`. Inside it, in this order: `ports` lines (one per run of members with equal `untagged`/`tagged`/`horizon`; `tagged` = numeric ids of the bridge VLAN-table rows on that port; `untagged` = `useTag`), then `vif` lines whose bridge membership is this bridge, then `radio` lines from `collectRadios` for this bridge (with `tag`, and SSIDs after `placeCaps`).
4. At device level: `ports` for standalone ether ifaces, `vif` for vlan ifaces with no bridge membership, `radio` for bridge-less radios.
5. `address` for every `/ip address` not already on a `bridge`/`vif` line (vif addresses go on the `vif` line), with flags from the lists.
6. `lease` per lease, in order.
7. `allow <bridge> -> <host>` per forward accept with a single-host `dst-address`, per bridge in its in-list/in-iface. The label is the comment text after `:`, trimmed. With no comment, no label.

- [ ] **Step 1: Write the failing tests** in `translate.test.ts`, loading the four home `.rsc` with `importRsc` and the `vlan` defs of `examples/home/network.net`:
  - `"core: wan lines"`: `wan ether1 route "wan1-main" distance 1 dhcp` and `wan vlan60-lte on bridge vlan 60 route "wan2-lte" distance 2 dhcp`.
  - `"core: router, two bridges, lan and hotspot flags"`: `bridge` has `lan`; `br-guest` has `guest`, `hotspot`, `addresses ["10.50.0.1/24"]`.
  - `"core: bridge radio lists member interfaces and SSIDs"`: the `bridge` radio's `ssids` equal `["HomeNet", "HomeNet-IoT", "HomeNet-5"]`.
  - `"ap1: tagged radio chip"`: a `radio` with `tag: 50`, `ifaces ["wlan1-guest", "wlan2-guest"]`, `ssids ["HomeNet-Guest"]`.
  - `"lte: lan flag on a non-bridge vif"`: `vif vlan60 … addresses ["192.168.88.1/24"] lan`.
  - `"core: forward accept becomes an allow item"`: `allow br-guest -> 192.168.0.200` with the label from `"guest: printer"`.
  - `"unmatched CAPsMAN radio warns"`: one diag naming `cap-wifi2`, same text as today.
  - `"raw-export translates with no new warnings"`: `test/fixtures/raw-export.rsc` — translator `diags` plus `importRsc` warnings equal what `loadModel` reports for it today (capture before refactoring).
- [ ] **Step 2: Run** `bun test test/rsc/translate.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** `build.ts` still compiles: during this task it may import the moved helpers back from `translate.ts`. Task 6 removes that.
- [ ] **Step 4: Run** `bun test && bunx tsc --noEmit`. Expected: all pass.
- [ ] **Step 5: Privacy check, then commit** `feat(rsc): translate device facts into DSL device blocks`.

### Task 6: Build from statements only

**Files:** Create `src/model/device.ts`. Rewrite `src/model/build.ts` (device building, endpoint resolution, lane inference, internal links, pruning, leases) and `src/model/l3.ts` over items. Test: `test/model/build.test.ts`, `test/model/l3.test.ts`, `test/model/check.test.ts`.

**Interfaces:**
- Consumes: `translate` (Task 5), `DevItem` (Task 3), `vlanStyle` (Task 1).
- Produces:
  - `buildModel(stmts: Stmt[], facts: Map<string, DeviceFacts>, opts?: Opts): Model`. Signature unchanged. Wrapper: `translate` the imports (with their lines and the vlan defs), splice each result in place of its `import` Stmt, then call `buildFromStmts`.
  - `buildFromStmts(stmts: Stmt[], opts?: Opts): Model`. No `DeviceFacts` anywhere below this line.
  - In `device.ts`: `buildDevice(s: Extract<Stmt, { kind: "node" }>, vlans: VlanDef[]): Dev`, where `Dev` keeps its fields except `f`, replaced by `ifaces: Iface[]` (the neutral table), `wan: DevItem[]`, `addresses: { iface: string; cidr: string; flags: IfFlags }[]`, `leases: { address: string; comment?: string }[]` and `allows: Extract<DevItem, { kind: "allow" }>[]`.
  - In `l3.ts`: `deriveArrows(d: Dev, nodes: MNode[], leases: Map<string, string>): MArrow[]`.

Rules the builder applies (vendor-neutral, from the spec):
- Neutral table: `ports` → `type: "ether"` with `bridge` = enclosing bridge, `useTag` = numeric `untagged`, plus one `<port>.<id>` `type: "vlan"` row per `tagged` id with `parent` = port. The `isTable` rule is unchanged. `vif` → `type: "vlan"`, `parent` = `on`, `bridge` = enclosing bridge. `radio` → one `type: "wifi"` row per iface, with `bridge` and `useTag` = `tag`. `bridge` → `type: "bridge"`, `vlanFiltering` = `filtering`. Non-vlan `wan` → `type: "other"`. A VLAN name in `tagged`/`untagged` resolves to its ids; an unknown name is an error `unknown vlan "x"`.
- Children order: WAN group, router, bridges in block order; then three passes over all items in document order (ports, then vifs placed by `on` (else their block), then radios), exactly as today's `buildDevice`.
- Device label without an explicit label: `ID · model · <first IPv4 of the first lan-flagged address, document order> · os`.
- Radio chip id: `<dev>/radio[-<bridge>][-tag<n>]`. Its label is the physical names (`physOf`) for an untagged chip, and members plus `· use-tag N` for a tagged one.
- An import id with a hand-written `device` block that has `items` is an error: `"core" is imported; its internals come from core.rsc`, hint `run netdraw import core.rsc to get an editable block`. A `device` line on an imported id without items stays a label/note override, as today.
- Internal links take the device Stmt's `line` (the import line for translated devices).
- A quoted name containing `/` or `%` gets the id escape from Global Constraints; `show <id>` and link endpoints resolve by the unescaped name.
- An `allow` (item or top-level) whose target is an address with no client is dropped silently (Review Focus 3).

- [ ] **Step 1: Write the failing tests:**
  - `build.test.ts` › `"hand-written AP block behaves like an imported router-less AP"` (Review Focus 4): a `device ap` block with `bridge br` / `ports ether1, ether2` / `radio wlan1 ssid X`, linked only on `ether1`. `ether2` is absent from nodes without `--all` and present with `--all`, and a link `ap/ether1 → ap/radio-br` exists.
  - `"internals on an imported id is an error"`.
  - `"tagged names an unknown vlan"` → error.
  - `l3.test.ts` › `"allow to an unleased address draws nothing"` (Review Focus 3).
  - `"buildFromStmts never sees DeviceFacts"`: a type-level test, `// @ts-expect-error` passing facts to `buildFromStmts`.
- [ ] **Step 2: Run** `bun test test/model`. Expected: the new tests FAIL; the existing ones pass.
- [ ] **Step 3: Implement.** Work in small steps and keep `bun test` green between them. The existing 119 tests and the home golden are the oracle. Split lane inference into `src/model/lanes.ts` only if that falls out naturally.
- [ ] **Step 4: Run** `bun test && bunx tsc --noEmit && grep -n DeviceFacts src/model/*.ts`. Expected: all tests pass, golden unchanged, and `DeviceFacts` appears only in the `buildModel` wrapper's import line and signature.
- [ ] **Step 5: Privacy check, then commit** `refactor(model): build devices from DSL statements only`.

### Task 7: Addressing — several addresses, IPv6, checks

**Files:** Create `src/model/addr.ts`. Modify `src/model/device.ts` (extra address sub-lines), `src/model/check.ts`. Test: `test/model/addr.test.ts`, `test/model/check.test.ts`.

**Interfaces:** Produces `parseCidr(s: string): { v: 4 | 6; net: bigint; len: number } | undefined` and `inPrefix(addr: string, prefix: string): boolean` (`addr` with or without `/len`; address families never match each other).

- [ ] **Step 1: Write the failing tests:**
  - `addr.test.ts`: `inPrefix("2001:db8:50::1", "2001:db8:50::/64")` is true; `inPrefix("2001:db8:51::1", "2001:db8:50::/64")` is false; `inPrefix("10.50.0.1/24", "10.50.0.0/24")` is true; `inPrefix("10.50.0.1", "2001:db8::/32")` is false; `::` shorthand and a bad input give `undefined`/false.
  - `check.test.ts` › `"address outside its VLAN's subnets warns"`: `vif v50 vlan 50 address 10.99.0.1/24` with `vlan guest 50 subnet 10.50.0.0/24`. Warning on the vif line, naming both values.
  - `"same address on two interfaces warns"`.
  - `"second address becomes a sub-line"`: `bridge br address 192.168.0.1/24, 2001:db8::1/64` gives the label `br · 192.168.0.1/24` and the sub-line `2001:db8::1/64`.
  - Review Focus 5, `"IPv6-only bridge and vlan"`: no throw; the label carries the IPv6 address; the device label skips the address part when it has no IPv4.
- [ ] **Step 2: Run** `bun test test/model`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.** "Its VLAN" means the `vif`/`wan … vlan` id, or for a bridge the VLAN its style came from. Skip the check when that VLAN has no `subnets`.
- [ ] **Step 4: Run** `bun test`. Expected: all pass, golden unchanged, and `netdraw check --file examples/home/network.net` prints only the existing CAPsMAN warning.
- [ ] **Step 5: Privacy check, then commit** `feat(model): IPv6 and multi-address interfaces with subnet checks`.

### Task 8: `netdraw import`

**Files:** Modify `src/cli.ts` (command, `HELP`, `GRAMMAR` with the new block statements). Test: `test/cli.test.ts`.

**Interfaces:** `netdraw import <file.rsc> [--as <id>] [--file <f>] [--json]`. It prints `printStmts([deviceStmt])` to stdout.
- With `--file` (default `./network.net`) existing: translate **all** of that file's imports together (so CAPsMAN SSIDs land correctly), using its vlan defs, and print the block of the import whose path resolves to `<file.rsc>`. `--as` overrides the id.
- Without it, or when the `.rsc` isn't among the imports: translate the `.rsc` alone, with that file's vlan defs if it exists. The id is `--as` or the basename without `.rsc`.
- `--json` prints `{ok: true, stmt}`. Missing file → exit 1 with the standard error shape. A missing argument is a usage error (exit 2).

- [ ] **Step 1: Write the failing tests:**
  - `"import prints a parseable core block"`: `bun src/cli.ts import examples/home/core.rsc --file examples/home/network.net`. Exit 0; the output parses with no diags and begins `device core model "hAP ax3" os "RouterOS 7.25.1"`.
  - `"import without an argument is exit 2"`.
  - `"ejected blocks replace their imports"` (spec Acceptance 2): build a temp `.net` from `network.net` with the `imports` line removed and the four printed blocks in its place, placed where the imports line was. Its model equals the original's under the `strip` comparison (`line`, `file`, `diags` removed), and its SVG is byte-identical.
- [ ] **Step 2: Run** `bun test test/cli.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `bun test`. Expected: all pass.
- [ ] **Step 5: Privacy check, then commit** `feat(cli): netdraw import ejects a device block`.

### Task 9: DSL-only home network (Acceptance 5)

**Files:** Create `examples/home/network-dsl-only.net` and `test/acceptance/dsl-only.test.ts`.

- [ ] **Step 1: Write the failing test** `"DSL-only home equals rsc home"`: `loadModel` on both files. The models are equal after `strip` (`line`, `file`, `diags` removed). `renderSvg(m, await layout(m))` is byte-identical for both, and equal to `test/fixtures/home.golden.svg`. `check` on the DSL-only file reports no errors and no warnings.
- [ ] **Step 2: Run** `bun test test/acceptance`. Expected: FAIL (file missing).
- [ ] **Step 3: Write the file.** Start from `netdraw import` output for the four devices, then edit it by hand into what a person would write. Use VLAN names in `tagged` where a def covers exactly those ids, and keep it commented like `network.net`. Every edit must keep the test green.
- [ ] **Step 4: Run** `bun test && bunx tsc --noEmit`. Expected: all pass.
- [ ] **Step 5: Privacy check, then commit** `test: home network described in DSL alone (acceptance 5)`.
