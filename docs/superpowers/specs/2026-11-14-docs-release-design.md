# Part E — documentation and first release

Milestone 2, part E. Covers Acceptance 7 of `2026-11-13-netdraw-design.md`
plus the owner's later requests (2026-11-14): a README, downloadable
release binaries, a licence and a version scheme.

## Intent

netdraw is about to be used by **other people**, not just its owner. A
stranger should be able to land on the repo, see what netdraw draws, download
a binary, write a first `.net` file, and look up any statement or command
without reading specs or source. Everything here serves that reader.

## Goals

1. `README.md`: what netdraw is (two sentences), an example render near the
   top with the short `.net` that produced it, install from releases, a quick
   start, links to `docs/dsl.md` and `docs/cli.md`, the licence, and what 0.x versions
   mean.
2. `docs/dsl.md`: every statement (top-level and device-block), its grammar
   and options, the inference rules (VLAN lanes, untagged-only ends, chain
   labels, tiers, lease opt-in), and a worked example that builds up step by
   step rather than one big file dropped in.
3. `docs/cli.md`: every command, noun, verb and flag, the `--json` output
   shapes, the error shape, exit codes, and which DSL line each edit command
   writes.
4. Tests that fail when a DSL keyword, command, noun or flag is missing from
   the docs, and that execute every example in the docs.
5. `LICENSE` (MIT), `CHANGELOG.md` with a `0.1.0` entry.
6. `netdraw --version`.
7. `.github/workflows/release.yml`: a semver tag publishes a GitHub release
   with the binaries and the man page.

## Non-goals

- No docs website, no generator; plain markdown that reads well on GitHub.
- No creating the GitHub repo or pushing: the owner does that. The workflow
  stays unverified until the first tag.
- No fixes to the known limitations; they are documented instead (below).
- No change to what the `--help` text says, beyond what the sync tests force.

## Anti-goals

- Docs that read like `--help` output: walls of flags with no "here is how
  you add a VLAN".
- Any trace of the owner's real network. Examples come only from anonymised
  material (`examples/home`, the SCaLE and NetBox fixtures, or new invented
  examples). The privacy check runs before every commit, as always.
- A release that claims a version it isn't: a local build must never print a
  release number.

## Decisions (owner)

- **Audience:** other people.
- **Distribution:** download artifacts from GitHub releases.
- **Versioning:** semver, starting at `v0.1.0`. Reason (owner): many bugs and
  features are expected and the release number should show how significant
  each change is. Recorded in precedent as a deliberate departure from the
  integer tags in the owner's other projects.
- **Licence:** MIT. Recorded in precedent.
- **Docs approach:** A, hand-written prose kept honest by tests (below).

## Approaches considered

- **A. Hand-written docs, checked by tests (chosen).** Prose written for a
  learner; a coverage test fails on any missing keyword/command/noun/flag;
  every example block runs. Trade-off: prose can still drift in meaning;
  only missing items and broken examples are caught.
- **B. Generate the reference parts of `cli.md` from `NOUNS`/`DESC`.** Cannot
  drift, but reads like `--help`, and the help strings were written for
  one-line terminal use. Rejected: wrong for a learning reader.
- **C. `dsl.md` as the single source embedded for `help dsl`.** Rejected: the
  owner wants the short grammar card in the terminal.

## Design

### Terminal help vs docs (my call, told to the owner, not objected to)

- `netdraw help dsl` keeps printing the short `GRAMMAR` card from
  `src/help.ts`.
- The man page's DSL section becomes the full `docs/dsl.md` instead of the
  card. `src/man.ts` imports the markdown as text (bun `with { type: "text" }`),
  so it is compiled into the binary and `__man` still works from a compiled
  build. `test/man.test.ts` changes from "contains GRAMMAR" to "contains
  dsl.md".
- A test checks that the card and `dsl.md` cover the same keyword set.

### Coverage test (`test/docs.test.ts`)

Source lists, read from code (export them where they aren't yet):
- top-level `KEYWORDS` and block `BLOCK` from `src/dsl/parse.ts`;
- commands from `DESC` in `src/help.ts`;
- nouns and their flags from `NOUNS` in `src/edit/table.ts`;
- the `render`/`check`/`show`/`import` flags from the yargs definitions in
  `src/cli.ts` (the builder picks how to enumerate them; a hand-kept list
  next to the yargs config, asserted equal to yargs' own, is acceptable).

Rules:
- every DSL keyword appears in `dsl.md` as inline code in a heading;
- every command and noun appears in `cli.md` as inline code in a heading;
- every flag appears in `cli.md` as `` `--flag` `` within its command's or
  noun's section;
- the keyword set in `GRAMMAR` equals the keyword set in `dsl.md`;
- every relative link in README, `docs/dsl.md` and `docs/cli.md` resolves to a file tracked in git.
- Scope (my call): the coverage, link and example rules apply only to `README.md`, `docs/dsl.md` and `docs/cli.md`. `docs/superpowers/` is internal and never scanned.

### Executable examples

Fenced-block conventions in `README.md`, `docs/dsl.md` and `docs/cli.md`:
- ` ```net ` — a complete DSL file. The test writes it to a temp dir and runs
  `check`; it must report no errors. ` ```net file=<name> ` also keeps it in
  that doc's temp dir under `<name>` for later console blocks.
- ` ```console ` — lines starting with `$ netdraw …` are run in order in the
  doc's temp dir (`netdraw` = `bun src/cli.ts`); the non-`$` lines that follow
  each command are its expected stdout, compared exactly after trimming
  trailing whitespace. A command's expected exit code, if not 0, is written
  as a trailing `# exit N` comment on the `$` line.
- ` ```text ` — grammar or illustrative fragments; not run. Grammar syntax
  lines go here.
- Each doc gets one temp dir, shared by its blocks in order, so a doc can
  walk through `init` → several `add` commands → `render`.

### README example render

- New invented example `examples/quickstart/network.net` (small: a router, a
  switch, an AP, two or three VLANs) plus its committed `network.svg`.
- The README shows the `.net` source in a ` ```net ` block (so it is checked)
  and embeds the SVG as an image.
- A test asserts the committed SVG equals a fresh render of the file and the
  README's `net` block equals the file's contents.
- A `mise run render-quickstart` task regenerates the SVG.
- The README may also show the bigger home network via
  `test/fixtures/home.golden.svg` (my call: `examples/home/network.svg` is
  gitignored, and the golden is tracked and kept current by the home test).

### README install section

- Download the binary for your platform from the Releases page (relative link
  `../../releases/latest`, so no repo URL is hard-coded), `chmod +x`, put on
  `PATH`; optional: copy `netdraw.1` into a man directory.
- Build from source: `mise run build` (or `bun install && bun build …`).
- 0.x note: a minor bump (0.1 → 0.2) may change DSL or flags, read the
  changelog; a patch bump is bug fixes only.

### Version

- `netdraw --version` prints the version and exits 0.
- The value is a compile-time constant passed by `bun build --define`, read
  from env `VERSION` in the mise `build` / `build-all` tasks; unset means
  `0.0.0-dev`. Running from source (`bun src/cli.ts`) also prints
  `0.0.0-dev`.
- `--version` appears in `--help`, the man page and `cli.md` (the coverage
  test enforces the last).

### Release workflow

- Trigger: push of a tag matching `v*.*.*`.
- Steps: checkout, install mise (tools from `mise.toml`), `bun install`,
  `mise run test`, `VERSION=${tag#v} mise run build-all`, create the GitHub
  release with `GITHUB_TOKEN` and attach `dist/netdraw-*` and
  `dist/netdraw.1`.
- Release notes: the tag's section of `CHANGELOG.md`; the workflow fails if
  that section is missing, so a release can't ship without notes.
- Fail if the tag is not valid semver.
- Renovate already exists and is left as is; it will pick up the workflow's
  actions.

### Known limitations section

`docs/dsl.md` and `docs/cli.md` each end with a "Known limitations" list,
taken from what is known and not fixed:
- a lease comment can't be cleared; an SSID containing a comma can't be
  expressed;
- `--after`/`--before` only place next to a statement of the same kind;
- `--path` shows only shortest paths;
- `place`/`row` hints are best effort;
- (the builder adds any other user-visible limit it finds; internal layout
  issues stay out).

### Copyright line

`LICENSE` copyright holder: the git user name `asm0dey`, year 2026 (my call;
the owner can change it).

## Left to the builder

- Section order and prose inside each doc; how the worked example is staged.
- How the flag lists for non-edit commands are enumerated.
- Which mise action / release action to use in the workflow (renovate-pinnable,
  `GITHUB_TOKEN` only, no extra secrets).
- Whether Windows artifacts need an `.exe` suffix and how `build-all` names
  them.
- Splitting the work into commits; each commit passes `mise run test` and the
  privacy check.

## Publishing the repo (owner, 2026-11-14)

`docs/superpowers/` and the full git history go public as they are. They
mention that a privacy check exists, never where it lives or what it guards.
