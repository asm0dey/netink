# CLI editing commands Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every DSL statement and device-block line can be added, changed and removed with a `netdraw <noun> add|set|rm` command that edits the `.net` file in place, plus zsh completion.

**Architecture:** A declarative command table (`src/edit/table.ts`) describes each noun: its positionals, flags, how it matches an existing statement, how it builds/changes one. A pure editing core (`src/edit/edit.ts`) parses the file, locates the statement's line span (new span map from the parser), prints the changed statement with the existing printer, and splices only those lines (`src/edit/text.ts`). The whole CLI moves to yargs: existing commands first (Task 9), then one yargs command per noun registered from the table (Task 10), which writes atomically and runs `check`. Completion uses yargs's built-in `completion` command with a callback (`src/complete.ts`) that answers from the same table and the file.

**Tech Stack:** TypeScript on bun 1.4.4, `bun test`, yargs 18 (owner choice, 2026-11-13).

**Spec:** `docs/superpowers/specs/2026-11-13-cli-editing-design.md`

## Global Constraints

- bun for everything: `mise run test` (`bun test`), `mise run typecheck` (`bunx tsc --noEmit`). Both pass at every commit.
- `test/fixtures/home.golden.svg` is never regenerated in this plan.
- Before every commit, run the owner's privacy deny-list check: `.netdraw-privacy/privacy-check.sh` in the owner's private network folder (ask the owner for its path at the start of execution). It passes when it prints nothing; never commit when it prints anything. Never copy anything from that folder into this repo, and never write its path into the repo.
- Work on `main`, no worktree, no remote. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Exit codes stay: 0 ok; 1 model/check/edit errors; 2 usage error. Error shape in `--json`: `{"error", "file", "line", "hint"?}` (existing `fail()` in `src/cli.ts`).
- No command prompts interactively.
- No production code whose only purpose is testability (owner precedent). Tests call the real exported functions.
- Flags are named after the DSL keywords; lists are one comma-separated argument (`ether2,ether3`).
- yargs `^18.2.0` in `dependencies` (add `@types/yargs` to devDependencies only if `mise run typecheck` finds no bundled types). Configure: `.strict()`, `.exitProcess(false)`, `.fail()` handler that maps yargs validation errors to exit 2 with the documented error shape (never yargs's default message + exit 1), `.version(false)`. Clearing an optional value uses yargs boolean negation: `--no-color` arrives as `color: false`.

## Review Focus

1. A file with CRLF line endings: an edit writes CRLF on the new lines too and leaves every other byte alone. (Task 4)
2. A file with no trailing newline: an appended statement goes on its own line, not glued to the last one. (Task 4)
3. A `--label`/`--note` value with `"`, `\`, `#` or spaces: written escaped, and the file re-parses to exactly that value; a value with a newline is refused, since the DSL cannot spell it. (Task 6)
4. A file whose `imports rsc` target is missing: the edit is still written, `check` reports the unreadable import, exit 0. (Task 9)
5. Unknown noun, unknown flag, flag of another noun, missing positional: exit 2 with a hint, file untouched. (Task 9)

---

### Task 1: Layering cleanup

**Files:**
- Create: `src/model/style.ts`, `src/load.ts`, `test/layers.test.ts`
- Modify: `src/model/build.ts`, `src/model/device.ts`, `src/model/check.ts`, `src/render/svg.ts`, `src/dsl/parse.ts`, `src/rsc/translate.ts`, `src/cli.ts`, every test importing `buildModel`/`loadModel` (see `grep -rln "model/build" test`)

**Interfaces:**
- Produces: `src/model/style.ts` exports `vlanStyle`, `laneOfStyle`, `fallbackIn` (moved from `build.ts`), `physOf` (moved from `rsc/translate.ts`), `NAMED` (moved from `render/svg.ts`). `src/load.ts` exports `buildModel(stmts, facts, opts)` (the import-splicing function now at `build.ts:32-57`) and `loadModel(file, opts)`. `src/model/build.ts` keeps `buildFromStmts`. Old locations do not re-export (update importers instead), except `render/svg.ts` may keep using `NAMED` internally.

- [ ] **Step 1: Write the failing test** `test/layers.test.ts`: for each file in `src/model/*.ts`, its import specifiers (regex `from "([^"]+)"`) contain none of `../rsc`, `../render`, `../dsl`, `../layout`; and `src/dsl/parse.ts` does not import `../render`. Also: no two files in `src/model` import each other both ways (build↔device, build↔check).
- [ ] **Step 2: Run** `bun test test/layers.test.ts` — Expected: FAIL naming `src/model/build.ts` (imports `../dsl/parse`, `../rsc/...`) and `src/model/device.ts`.
- [ ] **Step 3: Move the code** as in Interfaces; update all importers (`src/`, `test/`). Pure moves, no behaviour change.
- [ ] **Step 4: Run** `mise run typecheck && mise run test` — Expected: all pass, including `test/acceptance/home.test.ts` (golden SVG unchanged; `git status test/fixtures` clean).
- [ ] **Step 5: Privacy check, commit** `refactor: model leaf style module; buildModel/loadModel out of src/model`

### Task 2: Explain the DSL-only example

The other deferred minor (a device with `items: []` prints as `device d`, which re-parses with `items` undefined) needs no code: editing goes through text, so the file, not an in-memory `items: []`, is always the source of truth. Note that in the commit message.

**Files:**
- Modify: `examples/home/network-dsl-only.net`

- [ ] **Step 1:** add 3–4 `#` comment lines at the top explaining: it is the no-`.rsc` twin of `network.net`; its device blocks came from `netdraw import` and may be hand-edited; `test/acceptance/dsl-only.test.ts` requires the same model and an identical SVG. Comments only.
- [ ] **Step 2: Run** `mise run test` — Expected: PASS.
- [ ] **Step 3: Privacy check, commit** `docs(examples): explain network-dsl-only.net` (body: the `items: []` round-trip is moot once edits go through text).

### Task 3: Parser spans

**Files:**
- Modify: `src/dsl/parse.ts` (`parseDsl`)
- Test: `test/dsl/parse.test.ts`

**Interfaces:**
- Produces: `parseDsl(text, file)` returns `{ stmts, diags, spans }` where `spans: Map<Stmt | DevItem, Span>`, `export type Span = { line: number; head: number; end: number }` (exported from `parse.ts`). `line` = first source line; `head` = last line of the statement's own text (after `,` continuations); `end` = last line including indented children (for a device: its last block line; for a bridge: its last child; otherwise `end === head`). Statements expanded from one line (link chain/fan-out, `imports a as x, b as y`) share one Span value (same `line`). `Stmt`/`DevItem` types are unchanged (existing `toEqual` tests keep passing).

- [ ] **Step 1: Failing tests:**
  - `"spans cover continuations"`: `imports rsc a.rsc as a,\n  b.rsc as b\n` → both import stmts have span `{line:1, head:2, end:2}`.
  - `"device span covers block"`: `device d\n  bridge br\n    ports e1\n  # c\n  lease 10.0.0.1\nvlan x 1\n` → device `{line:1, head:1, end:5}`, bridge `{line:2, head:2, end:3}`, ports `{3,3,3}`, lease `{5,5,5}`, vlan `{6,6,6}`.
  - `"trailing comment line after block is outside it"`: `device d\n  router\n# x\n` → device end 2.
- [ ] **Step 2: Run** `bun test test/dsl/parse.test.ts` — Expected: FAIL (`spans` undefined).
- [ ] **Step 3: Implement** in the main loop: record `head = n + 1` after the continuation loop; on attaching a block line, raise `end` of the current device (and bridge, for level 2) to that line's `head`.
- [ ] **Step 4: Run** `mise run test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(dsl): parser reports statement line spans`

### Task 4: Line splicing

**Files:**
- Create: `src/edit/text.ts`
- Test: `test/edit/text.test.ts`

**Interfaces:**
- Produces:
  - `replaceLines(text: string, from: number, to: number, lines: string[]): string` — replaces 1-based inclusive lines `from..to` with `lines` (empty array deletes them). If the original line `from` has a trailing comment (outside quotes), it is re-appended to the first new line as `"  # ..."`, keeping its original spacing before `#`. Line ending of the file (`\r\n` if the text contains one, else `\n`) is used for new lines.
  - `insertAfter(text: string, after: number, lines: string[]): string` — `after = 0` inserts at the top; `after >= lineCount` appends, adding a line ending first when the text does not end with one.
  - `commentOf(line: string): string | undefined` — the `# ...` tail outside quotes. Reuse the quote-aware scan in `parse.ts` `stripComment` (export a helper from `parse.ts` rather than duplicating it).

- [ ] **Step 1: Failing tests** (names → assertions):
  - `replace keeps other bytes`: `"a\nb\nc\n"`, replace 2..2 with `["B"]` → `"a\nB\nc\n"`.
  - `replace keeps trailing comment`: `'x 1   # keep\n'`, replace 1..1 with `["x 2"]` → `'x 2   # keep\n'`.
  - `hash inside quotes is not a comment`: `commentOf('note a "#1"')` → `undefined`.
  - `delete lines`: `"a\nb\nc\n"`, replace 2..2 with `[]` → `"a\nc\n"`.
  - `crlf preserved` (Review Focus 1): `"a\r\nb\r\n"`, `insertAfter(…, 1, ["x"])` → `"a\r\nx\r\nb\r\n"`.
  - `append without trailing newline` (Review Focus 2): `insertAfter("a", 1, ["b"])` → `"a\nb\n"`.
  - `append to empty`: `insertAfter("", 0, ["a"])` → `"a\n"`.
- [ ] **Step 2: Run** `bun test test/edit/text.test.ts` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `src/edit/text.ts`.
- [ ] **Step 4: Run** same — Expected: PASS.
- [ ] **Step 5: Commit** `feat(edit): line splicing that keeps comments and line endings`

### Task 5: Command table types and the editing core

**Files:**
- Create: `src/edit/table.ts`, `src/edit/edit.ts`
- Test: `test/edit/edit.test.ts`

**Interfaces:**
- Consumes: `parseDsl` + `Span` (Task 3), `replaceLines`/`insertAfter` (Task 4), `printStmts`/`printItems` (`src/dsl/print.ts`).
- Produces (`src/edit/table.ts`):
  ```ts
  export type Verb = "add" | "set" | "rm";
  export type Complete = "node" | "parent" | "port" | "vlan" | "color" | "path" | "jumps" | "side" | "legend-mode" | "legend-position";
  export type Arg = { name: string; optional?: true; complete?: Complete };
  export type Flag = { name: string; type: "string" | "boolean"; clearable?: true; complete?: Complete; help: string };
  export type Args = { parent?: string; pos: string[]; flags: Record<string, string | boolean | undefined> };
  export type Target = Stmt | DevItem;
  export type Noun = {
    name: string;            // "vlan", "legend entry"
    block: boolean;          // true: first positional is the parent path (device or device/bridge)
    covers: string[];        // kinds it edits, e.g. "vlan", "node:device", "hint:near", "legend:add", "item:ports"
    verbs: Verb[];
    args: Arg[];             // positionals after the parent
    flags: Flag[];           // noun-specific; --file --json --after --before --select-text are common
    repeatable?: true;       // several statements may share a key (see spec "Kinds that can repeat")
    help: string;            // one usage line for --help
    match(t: Target, a: Args): boolean;
    make(a: Args): Target;                 // add
    apply(t: Target, a: Args): Target[];   // set; may return 2 (ports split); a cleared flag arrives as flags[name] === false
  };
  export const NOUNS: Noun[];
  export const nounOf: (words: string[]) => { noun: Noun; rest: string[] } | undefined; // longest-prefix match ("legend entry" before "legend")
  ```
- Produces (`src/edit/edit.ts`):
  ```ts
  export type EditRequest = { noun: Noun; verb: Verb; args: Args };
  export type EditResult =
    | { ok: true; text: string; line: number; written: string }   // written: the new statement's lines ("" for rm); line: its first line (rm: the removed line)
    | { ok: false; error: string; line?: number; hint?: string; candidates?: { line: number; text: string }[] };
  export function edit(text: string, file: string, req: EditRequest): EditResult;
  ```
- Rules `edit` implements (from the spec, verbatim behaviour):
  - Any string value containing `\n` or `\r` → `ok:false`, error `values cannot contain a newline`.
  - Parse errors → `ok:false`, error `"<file> has parse errors; fix them first"`, nothing changed.
  - Matches among top-level statements (or the parent's items for `block` nouns): 0 → `ok:false` with hint `run netdraw show …`; >1 → `ok:false` with `candidates` (unless `--select-text` narrows to one; for exact duplicate lines `rm` takes the first).
  - `add` fails on an existing match unless `repeatable` and the new statement differs (exact duplicate always fails), hint `use set`.
  - `set` rewrites only the statement's own lines (`span.line..span.head`), never its children: a node is printed via `printStmts` with `items` removed. Statements sharing a Span (expanded line) are reprinted together, one canonical line each, with the changed member replaced/removed.
  - `rm` removes `span.line..span.end` (whole block), or rewrites the shared line without the member.
  - Insert: `--after <key>`/`--before <key>` (a key in this noun's own positional form, resolved with `match`); otherwise top-level → end of file; block item → after the parent's `span.end` (device with no items: after its `head`), indented with `printItems(…, level)`.
  - `rm` of `device|cloud|client x` refused when any link endpoint node, note target, hint id (`a`, `b`, `ids`, `device`), route/allow `from`/`to` or hide target is `x` or starts with `x.` / `x/`; error lists those lines.

- [ ] **Step 1: Failing tests** with a minimal table entry for `vlan` defined in `table.ts` (Task 6 adds the rest):
  - `vlan add appends at end`: `"title \"T\"\n# c\n"` + `vlan add iot 30 --color blue` → text ends `"# c\nvlan iot 30 color blue\n"`, `line` 3.
  - `vlan set changes only given flags, keeps comment`: `"vlan a 10 color red  # x\nvlan b 20\n"` + `vlan set a --color blue` → `"vlan a 10 color blue  # x\nvlan b 20\n"`.
  - `--no-color clears`: `vlan set a --no-color` → `"vlan a 10  # x\n…"`.
  - `add existing fails`: `vlan add a 11` → `ok:false`, hint contains `set`.
  - `missing match`: `vlan rm zz` → `ok:false`, hint contains `netdraw show vlans`.
  - `parse error refuses`: `"vlan a\n"` (no ids) + any edit → `ok:false`, text unchanged.
  - `--after places`: `"vlan a 1\nvlan b 2\n"` + `vlan add c 3 --after a` → `"vlan a 1\nvlan c 3\nvlan b 2\n"`.
- [ ] **Step 2: Run** `bun test test/edit/edit.test.ts` — Expected: FAIL (modules missing).
- [ ] **Step 3: Implement** `table.ts` types + `vlan` entry + `nounOf`, and `edit.ts`.
- [ ] **Step 4: Run** same — Expected: PASS.
- [ ] **Step 5: Commit** `feat(edit): command table and in-place editing core`

### Task 6: Top-level nouns

**Files:**
- Modify: `src/edit/table.ts`
- Test: `test/edit/nouns.test.ts`

**Interfaces:**
- Consumes: `Noun`, `edit` (Task 5).
- Produces: `NOUNS` entries (usage = `help`):

| noun | verbs | positionals | flags | key / notes |
|---|---|---|---|---|
| `title`, `subtitle` | add set rm | `<text>` | — | singleton; set/rm act on the last one |
| `import` | add set rm | `<path>` (rm: none) | `--as <id>` (required) | key `as` |
| `vlan` | add set rm | `<name> <ids\|untagged>` (set: ids optional) | `--color` (clearable, complete color), `--subnet a,b` (clearable) | key name |
| `device` | add set rm | `<id>` | `--label --kind --model --os --note` (all clearable) | key id; body-less over an imported id is allowed |
| `cloud` | add set rm | `<id>` | `--label` | key id |
| `client` | add set rm | `<id>` | `--label --lease --note` | key id |
| `link` | add set rm | `<a> <b>` | `--vlans a,b` (clearable), `--label` (clearable) | key = endpoint pair, either order; repeatable (parallel links, `--select-text` = label) |
| `note` | add set rm | `<target> <text>` (rm/set: text optional) | — | repeatable; key target (+ text when given or `--select-text`) ; set replaces text |
| `place` | add set rm | `<a>` | `--near <b>` | key a |
| `row` | add set rm | `<ids>` (set/rm: first id, then for set the new ids) | — | key first id |
| `side` | add set rm | `<device> <group> [<top\|bottom\|left\|right>]` | — | key device+group |
| `legend` | set rm | rm: `mode\|position` | `--mode auto\|off`, `--position bottom\|right` | settings; set rewrites the last `legend auto/off` / `legend position` or appends |
| `legend entry` | add rm | `<style> <text>` | — | `legend add`; repeatable, key style+text |
| `legend hide` | add rm | `<entry>` | — | `legend remove`; key entry |
| `legend note` | add rm | `<text>` | — | repeatable; key text |
| `style` | add set rm | `jumps [arc\|gap\|none]` | — | key `jumps` |
| `route`, `allow` | add set rm | `<from> <to>` | `--label` (clearable) | key from+to; `allow` without `--in` |
| `hide` | add rm | `<target>` | — | key target |

  (The spec table lists `legend entry` for both `legend add` and `legend remove`; this plan splits `legend remove` into `legend hide` so each noun maps to one statement.)

- [ ] **Step 1: Failing tests** — one `add` → `set` → `rm` round per noun on a small file (each ends with the file back to its original text), plus:
  - `newline in a value is refused`: `device add d --label $'a\nb'` → `ok:false`, error `values cannot contain a newline`, text unchanged (the DSL has no newline escape).
  - `escaping round-trips` (Review Focus 3): `device add d --label 'a "b" \ #c'` → re-parsing the result gives `label === 'a "b" \\ #c'`.
  - `link rm from a chain`: `"cloud a\ndevice b\ndevice c\nlink a -- b -- c label \"L\"\n"` + `link rm a b` → last line becomes `link b -- c label "L"`; model link count 1.
  - `link rm from a fan-out`: `link sw -- x, y` + `link rm sw y` → `link sw -- x`.
  - `parallel links need --select-text`: two `link a -- b` with labels `"1"`/`"2"`; `link rm a b` → `ok:false` with 2 candidates; with `--select-text 2` → removes the second.
  - `rm device refused while referenced`: `device d` + `note d "x"` → `device rm d` `ok:false`, error mentions line 2.
  - `legend set --mode off` on a file with `legend auto` → that line becomes `legend off`.
  - `title set` on a file with two titles rewrites the second.
- [ ] **Step 2: Run** `bun test test/edit/nouns.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the entries.
- [ ] **Step 4: Run** `mise run test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(edit): top-level statement nouns`

### Task 7: Device-block nouns

**Files:**
- Modify: `src/edit/table.ts`, `src/edit/edit.ts` (parent resolution, imported refusal)
- Test: `test/edit/items.test.ts`

**Interfaces:**
- Produces: `NOUNS` entries with `block: true`; first positional `<parent>` = `device` or `device/bridge` (bridge by name):

| noun | positionals after parent | flags |
|---|---|---|
| `wan` | `<iface>` | `--on --vlan --route --distance` (clearable), `--dhcp` (bool), `--dhcp-address <a>`, `--nat` (bool, clearable) |
| `router` | — | — |
| `bridge` | `<name>` | `--address a,b`, `--lan --guest --hotspot --filtering` (bools, clearable) |
| `ports` | `<names>` | `--untagged <vlan>`, `--tagged a,b`, `--horizon <n>` (clearable) |
| `vlan-iface` | `<name>` | `--vlan <n>` (required on add), `--on`, `--address a,b`, `--lan --guest --hotspot` |
| `radio` | `<ifaces>` | `--tag <n>`, `--ssid a,b` (clearable) |
| `address` | `<iface> <cidrs>` | `--lan --guest --hotspot` |
| `lease` | `<addr> [comment]` | — |
| `allow` with `--in <device>` | `<from> <to>` | `--label` |

  `allow` is one noun: `--in` present → item form (parent = `--in`), absent → statement form.
- Rules: parent not found → `ok:false` hint `netdraw show devices`; parent is an import alias → `ok:false`, error `"<id> is imported; its internals come from <file>"`, hint `run netdraw import <file> to get an editable block` (same text as `src/load.ts`). `ports`/`radio` match the line under the parent containing any named port/iface. `ports rm p d e2` removes `e2` from its line, deleting the line when empty; `ports set p e2 --untagged x` on a multi-port line moves `e2` to a new line right after, with the old line's other settings plus the change. A vlan ref that is all digits is stored as a number.
- [ ] **Step 1: Failing tests:**
  - `ports add under bridge goes after its last child`: device with `bridge br` + `ports e1` + `lease …` (device level) → `ports add d/br e2` inserts `    ports e2` right after `    ports e1`.
  - `first item of a bare device`: `device d\nvlan x 1\n` + `router add d` → `"device d\n  router\nvlan x 1\n"`.
  - `ports rm splits`: `ports e1, e2, e3 untagged lan` + `ports rm d/br e2` → `ports e1, e3 untagged lan`.
  - `ports set splits`: same line + `ports set d/br e2 --untagged 10` → `ports e1, e3 untagged lan` then `ports e2 untagged 10`.
  - `imported parent refused`: `imports rsc x.rsc as core\n` + `wan add core ether1` → `ok:false`, hint contains `netdraw import x.rsc`.
  - `allow --in`: `allow add ether1 10.0.0.9 --in r` adds `  allow ether1 -> 10.0.0.9` in r's block; without `--in` adds a top-level `allow`.
- [ ] **Step 2: Run** `bun test test/edit/items.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `mise run test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(edit): device-block nouns`

### Task 8: Parity table test

**Files:**
- Test: `test/edit/parity.test.ts`

- [ ] **Step 1: Write test:** a `const KINDS` listing every kind string — `title subtitle import vlan node:device node:cloud node:client link note hint:near hint:row hint:side legend:auto legend:off legend:add legend:remove legend:note legend:position style route allow hide item:wan item:router item:bridge item:ports item:vlan-iface item:radio item:address item:lease item:allow` — typed so it breaks when a kind is added: `const _s: Record<Stmt["kind"], true> = {…}` and `const _i: Record<DevItem["kind"], true> = {…}` alongside it. Assert every KINDS entry is in some noun's `covers` and that noun's `verbs` include `add` (or `set` for `legend:auto|off|position`) and `rm`; assert no `covers` entry is outside KINDS.
- [ ] **Step 2: Run** `bun test test/edit/parity.test.ts && mise run typecheck` — Expected: PASS (Tasks 6–7 cover all). Temporarily remove `hide` from `NOUNS` to see it FAIL, restore.
- [ ] **Step 3: Commit** `test(edit): every statement kind has a command`

### Task 9: Existing commands on yargs

**Files:**
- Modify: `src/cli.ts`, `package.json`, `bun.lock`
- Test: `test/cli.test.ts` (existing tests must pass unchanged)

**Interfaces:**
- Produces: `src/cli.ts` builds one yargs parser with commands `render`, `check`, `show [what]`, `import <rsc>` and the global options `--file` (default `./network.net`), `--json`; their handlers keep today's bodies (`show()`, `importCmd()`, render/check). `fail()`, `fmt()`, `out()`, `err()` stay. The `GRAMMAR` text is kept and shown by `--help` (yargs `.epilogue`). Top-level `run(argv)` last-resort catch stays.

- [ ] **Step 1:** `bun add yargs@^18.2.0`; `mise run typecheck` (add `@types/yargs` as devDependency only if it fails on missing types).
- [ ] **Step 2: Failing tests** added to `test/cli.test.ts`: `unknown flag exits 2 with json error` (`check --frob --json` → code 2, JSON with `error` and `hint`); `--as outside import exits 2`; `--help` output contains `netdraw render` and the line `ids are [a-z0-9_-]+` (case-insensitive, from `GRAMMAR`).
- [ ] **Step 3: Run** `bun test test/cli.test.ts` — Expected: the new tests may already pass on the old parser; the point is they keep passing after the migration.
- [ ] **Step 4: Migrate** `main()` to yargs.
- [ ] **Step 5: Run** `mise run test && mise run typecheck` — Expected: PASS, every pre-existing CLI test unchanged.
- [ ] **Step 6: Privacy check, commit** `refactor(cli): parse arguments with yargs`

### Task 10: Editing commands on the CLI

**Files:**
- Create: `src/edit/command.ts`
- Modify: `src/cli.ts` (register nouns, `init`, help)
- Test: `test/cli.test.ts`

**Interfaces:**
- Consumes: `NOUNS`, `edit`, `loadModel` (`src/load.ts`), `checkModel`, the yargs parser from Task 9.
- Produces: `registerEditCommands(y: Argv): Argv` in `src/edit/command.ts` — for each noun, a yargs command `<noun>` (two-word nouns as `legend <sub>` subcommands) with subcommands for its verbs; positionals and options from the table, plus common `--after --before --select-text`. Handler: read file (missing → exit 1 hint `netdraw init`), `edit`, write via `writeFileSync(tmp)` + `renameSync` in the same directory, `loadModel` + `checkModel` on the written file (load failure becomes a diag, not an error), print, exit 0. Human output: the written lines on stdout, diags on stderr in `fmt` form. `--json`: `{ok:true, file, line, text, diags}`. Edit refusal: exit 1, `fail()` shape plus `candidates` when present.
- `netdraw init [file]`: writes `""` to `file` (default `./network.net`); exists → exit 1 `"<file> exists"`.
- `--help`: drop "Editing commands come in a later version."; yargs lists the nouns; `netdraw <noun> --help` lists its verbs, positionals and flags with the table's `help` text.

- [ ] **Step 1: Failing tests** (spawned via the existing `run` helper):
  - `init then add`: `init f`; `device add d --label D --file f --json` → code 0, json `{ok:true, line:1, text:'device d "D"'}`; file is `device d "D"\n`.
  - `init refuses existing`: second `init f` → code 1.
  - `edit with missing import still writes` (Review Focus 4): file `imports rsc gone.rsc as g\n`; `vlan add a 10 --file f --json` → code 0, file gained the line, `diags` has an error mentioning `gone.rsc`.
  - `usage errors exit 2, file untouched` (Review Focus 5): `frob add x`, `vlan add a 10 --colour red`, `vlan add a 10 --near b`, `vlan add` — each code 2, file bytes unchanged.
  - `--no-color clears`: `vlan set a --no-color` → line has no `color`.
  - `ambiguous lists candidates`: two parallel links; `link rm a b --json` → code 1, `candidates.length === 2`.
  - `help lists every noun`: `--help` output contains each `NOUNS[i].name`.
- [ ] **Step 2: Run** `bun test test/cli.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `mise run test && mise run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(cli): editing commands and init`

### Task 11: Acceptance 6 — rebuild and comment survival

**Files:**
- Create: `test/acceptance/cli-rebuild.test.ts`

**Interfaces:**
- Consumes: `nounOf` + `edit` in-process (no spawn per command), `parseDsl`, `loadModel`, `renderSvg`, `layout`.

- [ ] **Step 1: Write tests:**
  - `rebuild network-dsl-only.net from commands`: a literal array of argv arrays (one or more per statement, in file order, written by hand from the file — this list *is* the acceptance script) applied to `""`. Result parses with no diags to statements equal to the hand-written file's (strip `line` recursively, as in `test/dsl/print.test.ts`), in the same order; and its SVG equals `test/fixtures/home.golden.svg`.
  - `rebuild network.net`: same, in a temp dir with `examples/home/*.rsc` copied beside it; same equalities.
  - `hand-written file keeps comments`: take `examples/home/network.net`, run `vlan set guest --color red`, `note add isp "x"`, `link rm mobile lte`; every comment line of the original is still present in order, and a line diff touches only the 3 affected lines plus the appended one.
- [ ] **Step 2: Run** `bun test test/acceptance/cli-rebuild.test.ts` — Expected: PASS. A failure here is a bug in Tasks 5–7: fix there, not in the test.
- [ ] **Step 3: Privacy check, commit** `test: Acceptance 6 — rebuild home network from CLI commands`

### Task 12: Shell completion

**Files:**
- Create: `src/complete.ts`
- Modify: `src/cli.ts` (yargs `.completion("completion", "print a shell completion script", fn)`)
- Test: `test/complete.test.ts`

**Interfaces:**
- Produces: `complete(words: string[]): string[]` — `words` are the arguments after `netdraw`; the last is the partial word being completed (may be `""`). Reads `--file` from `words` (default `./network.net`); any read/parse failure yields name candidates `[]`, never throws. Candidates, filtered by prefix:
  - position 1: commands (`render check show import init completion`) + noun first words;
  - after a noun: its verbs; then its flags (`--x`) and, for the current positional/flag value, its `complete` source: `node` → top-level node ids; `parent` → device ids + `device/bridgeName`; `port` → ports and ifaces of the parent (from `loadModel` children ids, the part after `parent/`); `vlan` → vlan names; `color` → `Object.keys(NAMED)`; `path` → `[]`; fixed sets for `jumps side legend-mode legend-position`.
- The yargs completion callback calls `complete()`. Install docs in `--help`: `netdraw completion >> ~/.zshrc` (yargs picks zsh from `$SHELL`; bash works the same way). This replaces the spec's `netdraw completion zsh` and hidden `__complete`: yargs provides both.
- [ ] **Step 1: Failing tests:**
  - `nouns at top`: `complete(["v"])` contains `vlan` and `vlan-iface`.
  - `parent paths from file`: `complete(["ports","add","--file","examples/home/network-dsl-only.net",""])` contains `core` and `ap2/br-guest`.
  - `vlan names for --untagged`: `complete(["ports","add","core/bridge","ether2","--untagged","","--file","examples/home/network-dsl-only.net"])` contains `lan` (flags after the cursor are read too).
  - `bad file never throws`: `complete(["device","set","--file","/nonexistent",""])` → `[]`.
  - `zsh script`: spawn with `SHELL=/bin/zsh`: `completion` output contains `compdef` and `netdraw`.
  - `end to end`: `run("--get-yargs-completions", "vlan", "set", "--file", "examples/home/network.net", "")` output contains `guest` (the hidden flag yargs's script calls).
- [ ] **Step 2: Run** `bun test test/complete.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `mise run test && mise run typecheck` — Expected: PASS. Then `zsh -c 'autoload -U compinit; compinit; source <(SHELL=/bin/zsh bun src/cli.ts completion); echo ok'` → prints `ok`.
- [ ] **Step 5: Privacy check, commit** `feat(cli): shell completion`

### Task 13: Wrap-up

- [ ] Update memory file `milestone2-state.md`: part C done through the last commit; next is part D (scale) / docs.
- [ ] `mise run test && mise run typecheck`, privacy check, `git status` clean.
