# CLI editing commands — design (milestone 2, part C)

Status: approved by the owner in conversation, 2026-11-13. Inputs:
`2026-11-13-milestone-2-inputs.md`; parent spec `2026-11-13-netdraw-design.md`
(Acceptance 6, CLI surface sketch); part B `2026-11-13-dsl-device-internals-design.md`.

## Intent

An LLM (or the owner) should be able to build and maintain a `.net` file from
`netdraw --help` alone, without hand-editing. Every DSL statement, including the
part-B device internals, gets a command that adds, changes or removes it. Each
command writes the file immediately; comments and order survive; no save step,
no hidden state. Hand-editing stays equally valid.

## Goals

- One subcommand per statement kind, each with `add` / `set` / `rm`.
- Content matching to name the statement to change or remove.
- Byte-preserving edits: only the touched statement's lines change.
- zsh completion, including names read from the file.
- Acceptance 6 tests (below) pass.

## Non-goals

- bash/fish completion (the `__complete` hook makes them cheap later).
- `--line N` addressing (rejected by the owner; content matching only).
- Docs (`docs/dsl.md`, `docs/cli.md`) and the help/doc sync tests: part D/E
  (Acceptance 7). `--help` text for the new commands is in scope.
- Scale features, views, legend scaling.
- Editing the internals of devices that come from `imports rsc`. Item
  commands on an imported id are refused with a hint to `netdraw import`. A
  body-less `device <id> --label/--note/...` over an imported id is allowed
  (`device add|set|rm`), since `buildModel` already applies it (my call).

## Anti-goals

- A second grammar that drifts from the DSL. Flags are named after the DSL
  keywords; the command table is the single source for help, completion and
  the parity test.
- Reformatting untouched lines. A diff after one command shows only that
  statement's lines.
- Silent guesses: an ambiguous match writes nothing.

## Decisions made with the owner

1. **Content matching** (rejected: line numbers from `show`; both).
2. **One subcommand per statement, with flags** (option 2). Rejected: DSL-tail
   commands (`netdraw add vlan home 10 color blue`), one grammar but shell
   quoting and an ad-hoc unset syntax; and flags generated from a grammar
   schema (most cost, keeps two spellings).
3. **zsh completion is required**, with names from the file.
4. The rest of the "proposal" below was played back and approved ("lgtm").
5. **Insert position: end of file**, with optional `--after <key>` /
   `--before <key>` (rejected: grouping by kind — statement order sets drawing
   order, so a grouped rebuild would draw differently). Block items go at the
   end of their block (or bridge sub-block); `--after`/`--before` work there too.

## Approaches considered

See decision 2. Option 2 costs ~28 hand-written command entries; the cost is
contained by a declarative command table (below) rather than 28 handlers.

## Preliminary commits (first, each on its own)

1. Layering cleanup deferred from part B: style helpers and `physOf` into a
   model leaf module; `buildModel`/`loadModel` out of `src/model` so it no
   longer imports `src/rsc`; break the build↔device and build↔check cycles.
   Also `src/dsl/parse.ts` imports `NAMED` from `src/render/svg` — move colour
   names to a leaf so the editor can use the parser without the renderer.
2. A device with `items: []` prints no block (printer fix).
3. `examples/home/network-dsl-only.net`: 3–4 explanatory comments.

Golden SVG must not change in any of these.

## Command surface

```
netdraw <noun> add|set|rm <key...> [flags] [--file f] [--json]
netdraw init [file]
netdraw completion zsh
```

Nouns and their keys (key = what content matching uses):

| Noun | Statement | Key | Flags (DSL keyword names) |
|---|---|---|---|
| `title`, `subtitle` | title/subtitle | — (singleton) | text positional |
| `import` | `imports rsc` | `--as` id | path positional |
| `vlan` | vlan | name | ids positional (`10,20` or `untagged`), `--color`, `--subnet` |
| `device`, `cloud`, `client` | node | id | `--label`, `--kind`, `--model`, `--os`, `--note`, `--lease` (as the DSL allows per type) |
| `link` | link | endpoint pair | `--vlans`, `--label` |
| `note` | note | target | text positional |
| `place` | place near | a | `--near b` |
| `row` | row | first id | ids positional |
| `side` | `<device>.side` | device + group | side positional |
| `legend` | legend auto/off, position | — (settings) | `legend set --mode auto\|off --position bottom\|right` |
| `legend entry` | `legend add` / `legend remove` | style + text | `legend entry add\|rm <style> "text"` |
| `legend note` | `legend note` | text | `legend note add\|rm "text"` |
| `style` | style | key | value positional |
| `route`, `allow` | route/allow | from + to | `--label` |
| `hide` | hide | target | — |
| `wan` | item | parent + iface | `--on`, `--vlan`, `--route`, `--distance`, `--dhcp`, `--nat` |
| `router` | item | parent | — |
| `bridge` | item | parent + name | `--address`, `--lan`, `--guest`, `--hotspot`, `--filtering` |
| `ports` | item | parent (device or device/bridge) + port names | `--untagged`, `--tagged`, `--horizon` |
| `vlan-iface` | item | parent + name | `--on`, `--vlan`, `--address`, flags |
| `radio` | item | parent + iface(s) | `--tag`, `--ssid` |
| `address` | item | parent + iface | cidrs positional, flags |
| `lease` | item | parent + address | comment positional |
| `allow --in <device>` | item allow | device + from + to | `--label` |

Device-internal commands take the parent first: `netdraw ports add core/bridge
ether2,ether3 --untagged home`. `allow` without `--in` is the top-level
statement; with `--in core` it is the line inside core's block.

### Verbs

- `add`: build the statement from key + flags, insert it. Fails (exit 1) only
  for an exact duplicate, or for a same-key statement of a kind that cannot
  repeat (vlan name, node id, item with a name). Kinds that can legally repeat
  are listed under matching.
- `set`: change only the flags given. `--no-<flag>` clears an optional field
  (implemented as explicit `no-*` boolean options: bun's `parseArgs` has no
  negation for string options). Fails if nothing matches.
- `rm`: remove the matched statement (and a device's whole block).

### Content matching rules

- Kinds that can repeat (my call, from the review): notes on one target (the
  text is part of the key), `legend note` / `legend entry` (text is the key),
  parallel links between one pair (told apart by `--label`). An exact
  duplicate line in a hand-written file: `rm` removes the first one.
- `title` / `subtitle`: singletons; `set` rewrites the last one (the one the
  model uses), `add` fails if one exists.
- Exactly one match → edit. Zero → exit 1, hint names the `show` command to
  list candidates. More than one → exit 1, nothing written, diag lists each
  candidate's `file:line` and text.
- `ports rm parent ether2` removes ether2 from whichever ports line under that
  parent holds it; the line is deleted if it becomes empty. `ports set parent
  ether2 --untagged x` on a multi-port line splits ether2 onto its own line
  right after (the others keep their settings).
- Links: `link rm a.p b` matches a link whose endpoints are that pair (either
  order; a bare id matches any port of it only if unambiguous). A source line
  that expanded to several links (chain `a -- b -- c`, fan-out `sw -- x, y`)
  is rewritten as the remaining links in the same compact form where possible,
  otherwise as one `link` line each.
- `rm device x` (and cloud/client) is refused while links, notes, hints,
  routes, allows or hides refer to x; the error lists them.

## Editing engine

- Parser gains `endLine` per statement and item (covering `,` continuation
  lines and, for a device/bridge, its indented children).
- An edit: parse → locate span → mutate the statement → print it with
  `printStmts`/`printItems` at the right indent → splice those lines into the
  original text. Every other byte is copied unchanged, including line endings
  as the file uses them.
- A trailing `# comment` on the first line of the edited statement is kept
  (re-appended). Comment-only lines inside a device block are kept in place
  unless their whole device is removed.
- Insert position: appended at end of file; items at the end of their block, bridge children at the end
  of the bridge's sub-block. `--after <key>` / `--before <key>` place relative
  to a matched sibling (same matching rules; ambiguous → exit 1).
- A file with parse errors is not edited (exit 1, the parse diags): spans can't
  be trusted.
- The model may be invalid after an edit (building from empty passes through
  "link before device"). The edit is written, then `check` runs and its diags
  are printed as with `netdraw check`; exit 0 if the write succeeded. Write is
  atomic (temp file + rename).
- `--json`: `{ok, file, line, text, diags}`; `line`/`text` are the written
  statement's first line and full text (`text: ""` for `rm`). Errors use the
  existing error shape.
- `init [file]` creates an empty file (default `./network.net`); refuses if it
  exists.

## Command table

One declarative table describes each noun: the statement kind it maps to, key
positionals, flags (name, type, DSL keyword, completion source), and which
`Stmt`/`DevItem` fields they set. It drives: argument parsing, `--help`, the
zsh completion script, and the parity table test. Handlers are generic over
the table except where a statement needs special matching (ports splitting,
link expansion, legend ops).

## Completion

- `netdraw completion zsh` prints a `#compdef netdraw` script generated from
  the command table. Install: `> ~/.zfunc/_netdraw` or
  `eval "$(netdraw completion zsh)"`.
- Dynamic names via hidden `netdraw __complete <kind> [--file f]`, printing one
  candidate per line, never erroring (prints nothing on a bad file). Kinds:
  node ids (devices, clouds, clients, child paths like `core/bridge`), ports of
  a node, VLAN names, named colours, style keys/values, legend ops.
- `--file` given earlier on the command line is passed through.

## Tests (Acceptance 6 plus engine)

- Rebuild `examples/home/network-dsl-only.net` and `examples/home/network.net`
  from `init` using only commands issued in the file's own order; each parses
  to the same statements, in the same order, as the hand-written file (line
  numbers ignored), and renders the same SVG.
- Edit a hand-written file with comments; comments and order survive, and the
  diff touches only the edited statement.
- Table test: every `Stmt` kind and `DevItem` kind (and every node type) has a
  noun; fails when a kind has none.
- Ambiguous / missing match cases; ports split; chain/fan-out link removal;
  refused device removal; parse-error refusal.
- Completion: the generated script mentions every noun; `__complete` returns
  expected ids for the home example.
- Privacy check passes before every commit.

## Left to the builder

- Module layout of the editor (`src/edit/` suggested).
- Exact flag spellings where a DSL keyword is ambiguous, keeping DSL names.
- Help text wording.
