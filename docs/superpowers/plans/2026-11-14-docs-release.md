# Part E — netink: rename, logo, docs, first release — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the tool to netink, give it a logo, write user docs (README, `docs/dsl.md`, `docs/cli.md`) that tests keep honest, and add `--version`, MIT licence, changelog and a tag-driven GitHub release.

**Architecture:** The rename is a mechanical sweep guarded by a test that forbids the old name outside history. Docs are hand-written markdown; `test/docs.test.ts` derives the required keyword/command/flag sets from code and runs every ` ```net ` and ` ```console ` block. The release is one GitHub Actions workflow calling the existing `mise run build-all` with `VERSION` set from the tag.

**Tech Stack:** bun 1.4.4 (run, test, `bun build --compile --define`), TypeScript, yargs 18, marked-man, mise tasks, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-14-docs-release-design.md` (read it; the logo sketch is `docs/superpowers/specs/assets/2026-11-14-netink-logo-sketch.html`).

## Global Constraints

- bun for everything, never npm. `mise run test` (= biome check + bun test) passes at every commit.
- Privacy: after `git add`, run the owner's privacy deny-list check (`.netdraw-privacy/privacy-check.sh` in the owner's private folder); commit **only if its output is empty** (it exits 1 when clean — ignore the exit code; never chain the commit after it with `;` or `&&`). Never write that path into the repo. Examples use only invented or already-public data (`examples/home`, SCaLE, NetBox fixtures).
- Name: lowercase `netink` everywhere. `.net` extension and default `./network.net` unchanged. `docs/superpowers/**` keeps "netdraw" (history).
- Version: semver tags `vMAJOR.MINOR.PATCH`, first `v0.1.0`. Unreleased/local builds and `bun src/cli.ts` print `0.0.0-dev`.
- Licence MIT, copyright line `Copyright (c) 2026 asm0dey`.
- Colours: tile `#1f2a44`, cable `#5fe3cf`, "ink" light `#0f9d8a`, dark-theme text `#e6edf3`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Work on `main`, no remote, no push.

## Review Focus

1. A doc example whose command exits non-zero (or prints something else) must fail the test with the doc file and the block's line number, not a bare diff — Task 4 test `example failures name file and line`.
2. A relative link in README/docs to a file that exists locally but is not tracked (e.g. gitignored `examples/home/network.svg`) must fail — Task 4 link check uses `git ls-files`.
3. A compiled binary built without `VERSION` must print `0.0.0-dev`, never a release number — Task 2 test `compiled build without VERSION is 0.0.0-dev`.
4. The wordmark must look the same on a machine without the monospace font — Task 3 test `logo svgs contain no <text>`.
5. A tag that is not semver, or has no `CHANGELOG.md` section, must stop the release before anything is published — Task 6 tests `non-semver tag is refused` and `missing changelog section is refused`.

---

### Task 1: Rename netdraw → netink

**Files:**
- Modify: `package.json` (`name`, `bin` key → `netink`), `bun.lock` (via `bun install`), `mise.toml` (outfiles `dist/netink`, `dist/netink-$t`, man → `dist/netink.md`, `dist/netink.1`), `src/cli.ts`, `src/help.ts`, `src/man.ts` (`netink(1) -- draw network diagrams from a DSL`), `src/complete.ts`, `src/edit/command.ts`, `src/edit/edit.ts`, `src/edit/table.ts`, `src/load.ts`, `examples/home/network-dsl-only.net` (comment), every test listed by `git grep -il netdraw -- test`
- Create: `test/name.test.ts`

**Interfaces:** Produces: CLI program name `netink`; yargs `scriptName("netink")`, so the completion script defines `_netink_yargs_completions`.

- [ ] **Step 1: Write the failing guard test** `test/name.test.ts`:
  - `test("old name is gone outside history")`: `Bun.spawnSync(["git","grep","-il","netdraw","--",".",":!docs/superpowers",":!test/name.test.ts"])` stdout is `""`.
  - `test("--help names netink")`: `bun src/cli.ts --help` stdout contains `"netink <command>"` and not `"netdraw"`.
- [ ] **Step 2: Run** `bun test test/name.test.ts` — Expected: FAIL listing the files above.
- [ ] **Step 3: Sweep.** Replace `netdraw` → `netink` (also capitalised forms, temp-dir prefixes `netdraw-cli-` → `netink-cli-`) in every listed file; update the existing assertions in `test/cli.test.ts`, `test/complete.test.ts`, `test/man.test.ts` etc. to the new strings. Run `bun install` to rewrite `bun.lock`.
- [ ] **Step 4: Run** `mise run test` — Expected: PASS. Then `mise run build && ./dist/netink --help | head -3` shows `netink`.
- [ ] **Step 5: Commit** `refactor: rename netdraw to netink` (privacy check first).

### Task 2: `--version`

**Files:**
- Create: `src/version.ts`
- Modify: `src/cli.ts` (global option), `src/help.ts` / `src/man.ts` (mention), `mise.toml` (`build`, `build-all` pass `--define`)
- Test: `test/cli.test.ts`

**Interfaces:** Produces: `export const VERSION: string` in `src/version.ts`, value of the compile-time global `NETINK_VERSION` or `"0.0.0-dev"`.

- [ ] **Step 1: Write failing tests** in `test/cli.test.ts`:
  - `test("--version from source is 0.0.0-dev")`: `run("--version")` → code 0, `out.trim() === "0.0.0-dev"`.
  - `test("--version is listed in --help")`: `run("--help").out` contains `--version`.
  - `test("compiled build without VERSION is 0.0.0-dev")` and `test("compiled build with VERSION=9.8.7 prints it")`: run `mise run build` with env `VERSION` unset / `"9.8.7"` into the default `dist/netink`, then `./dist/netink --version` → `0.0.0-dev` / `9.8.7`. Give both a 60 s timeout.
- [ ] **Step 2: Run** them — Expected: FAIL (unknown flag `--version`, exit 2).
- [ ] **Step 3: Implement.** `src/version.ts`: `declare const NETINK_VERSION: string | undefined; export const VERSION = typeof NETINK_VERSION === "string" ? NETINK_VERSION : "0.0.0-dev";`. In `cli()` replace nothing in `base()` (it keeps `.version(false)` for noun parsers); on the top-level parser add `.version("version", "print the netink version", VERSION)`. mise: `bun build src/cli.ts --compile --define NETINK_VERSION="\"${VERSION:-0.0.0-dev}\"" …` in both tasks (quote so the define is a JSON string).
- [ ] **Step 4: Run** `mise run test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat: netink --version, set at build time from VERSION`.

### Task 3: Logo assets

**Files:**
- Create: `assets/logo.svg`, `assets/logo-512.png`, `assets/wordmark-light.svg`, `assets/wordmark-dark.svg`
- Modify: `.gitignore` (add `!assets/*.png` after `*.png`)
- Test: `test/assets.test.ts`

**Interfaces:** Produces the four asset paths above; README (Task 7) references `assets/wordmark-light.svg` / `assets/wordmark-dark.svg`.

- [ ] **Step 1: Write failing tests** `test/assets.test.ts`:
  - `test("logo files exist and are tracked")`: `git ls-files assets` lists all four.
  - `test("logo svgs contain no <text>")`: none of the three SVGs matches `/<text[\s>]/`.
  - `test("icon is centred")`: parse `assets/logo.svg` with a 64×64 `viewBox`; the union bounding box of the cable path and the two device `rect`s (compute from their coordinates; the path uses only M/L/Q with absolute coords) has its centre within 1 unit of (32, 32) horizontally and within 2 units vertically.
  - `test("png is 512x512")`: read the PNG IHDR (bytes 16–23) → width 512, height 512.
- [ ] **Step 2: Run** — Expected: FAIL (files missing).
- [ ] **Step 3: Draw.** Start from symbol `c2` and the D wordmark in the sketch file. Icon: tile `rect x=2 y=2 w=60 h=60 rx=14`, cable stroke 6 with rounded arch, two white device boxes 14×10. Wordmarks: icon (scaled to the cap height) + "net"/"ink" + the three-node cable line; convert the text to paths with `inkscape --export-text-to-path --export-plain-svg`. PNG: `rsvg-convert -w 512 -h 512 assets/logo.svg -o assets/logo-512.png`. Look at the result at 16, 48 and 512 px before committing.
- [ ] **Step 4: Run** `mise run test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat: netink logo and wordmark` — send the owner a PNG preview of all four at small and large size.

### Task 4: Doc test harness + `docs/dsl.md` + man page

**Files:**
- Create: `test/docs.test.ts`, `test/helpers/docs.ts`, `docs/dsl.md`
- Modify: `src/dsl/parse.ts` (export `KEYWORDS`, `BLOCK`), `src/man.ts` (DSL section = `docs/dsl.md`), `test/man.test.ts`

**Interfaces:**
- Produces (`test/helpers/docs.ts`):
  - `type Block = { lang: string; info: string; body: string; line: number }` — `line` is the 1-based line of the opening fence.
  - `blocks(md: string): Block[]`
  - `headingCodes(md: string): Set<string>` — every `` `x` `` inside a `#`-heading line.
  - `sections(md: string): Map<string, string>` — heading-code → text up to the next heading of the same or higher level.
  - `runExamples(file: string): Promise<string[]>` — runs the doc's blocks in one fresh temp dir; returns failure messages `"<file>:<line>: <what>"`, empty when all pass.
  - `relLinks(md: string): string[]` — relative link/image targets (no scheme, no leading `#`), fragments stripped.
- Consumes: `KEYWORDS`, `BLOCK` from `src/dsl/parse.ts`; `GRAMMAR` from `src/help.ts`.

Block rules (from the spec): ` ```net ` and ` ```net file=<name> ` → write body to `<tmp>/<name>` (default `network.net`), run `netink check --file <that>`, must exit 0. ` ```console ` → each `$ netink …` line runs via `bun <repo>/src/cli.ts …` in `<tmp>` (shell-style quoting; split with a small tokenizer that honours `'…'` and `"…"`); the following non-`$` lines up to the next `$` are expected stdout, compared after trimming trailing whitespace on each line and trailing blank lines; a trailing `# exit N` comment on the `$` line sets the expected code (default 0). ` ```text ` and others are not run.

- [ ] **Step 1: Write failing tests** `test/docs.test.ts`:
  - `test("every DSL keyword has a heading in dsl.md")`: for each of `KEYWORDS` (map `"<device>.side"` → `".side"`) and `BLOCK`, `headingCodes(dsl)` has an entry whose text starts with it.
  - `test("help dsl card and dsl.md cover the same keywords")`: the set of those keywords found in `GRAMMAR` (word at line start after indentation) equals the set found by the previous rule.
  - `test("dsl.md examples run")`: `await runExamples("docs/dsl.md")` equals `[]`.
  - `test("example failures name file and line")`: write a temp md with a ` ```console ` block `$ netink check --file nope.net` expecting exit 0; `runExamples` returns one message matching `/^.*\.md:\d+: /` and mentioning `exit 1`.
  - `test("relative links resolve to tracked files")` over `README.md`, `docs/dsl.md`, `docs/cli.md` (skip files that don't exist yet; Task 7 removes the skip): each `relLinks` target, resolved from the doc's directory, is in `git ls-files`. Links of the form `../../releases…` are allowed (GitHub-relative).
  - In `test/man.test.ts`: replace `expect(m).toContain(GRAMMAR)` with `expect(m).toContain(readFileSync("docs/dsl.md","utf8").trim())`.
- [ ] **Step 2: Run** `bun test test/docs.test.ts test/man.test.ts` — Expected: FAIL (dsl.md missing).
- [ ] **Step 3: Implement the helpers** and export `KEYWORDS`, `BLOCK`. `src/man.ts`: `import dslDoc from "../docs/dsl.md" with { type: "text" };` and use it as the `## DSL` section body (demote its `#` headings by two levels so they nest under `## DSL`). Verify `mise run build && ./dist/netink __man | grep -c '^#'` works from the compiled binary.
- [ ] **Step 4: Write `docs/dsl.md`** for a newcomer. Required content: file basics (comments, quoting, continuation lines, ids and `parent/child` ids); one section per top-level keyword and per block keyword, each with a heading containing the keyword in backticks, its grammar in a ` ```text ` block, its options, and at least one ` ```net ` example; the inference rules — VLAN lanes, untagged-only ends, chain labels, tiers, lease opt-in (sources: `docs/superpowers/specs/2026-11-13-netdraw-design.md`, `…-dsl-device-internals-design.md`, `…-scale-views-design.md`, and `src/model/`); a worked example that grows one invented network over 4–6 ` ```net ` steps (router → switch → VLANs → AP with SSIDs → a client lease); "Known limitations": a lease comment can't be cleared; an SSID containing a comma can't be written; `place`/`row` hints are best effort; plus any other user-visible limit you find. Keep every example invented.
- [ ] **Step 5: Run** `mise run test` — Expected: PASS.
- [ ] **Step 6: Commit** `docs: DSL reference with executed examples` .

### Task 5: `docs/cli.md`

**Files:**
- Create: `docs/cli.md`
- Modify: `test/docs.test.ts`

**Interfaces:** Consumes `headingCodes`, `sections`, `runExamples` (Task 4); `DESC` (`src/help.ts`); `NOUNS` (`src/edit/table.ts`, each with `name`, `verbs`, `flags[].name`).

- [ ] **Step 1: Write failing tests:**
  - `test("every command and noun has a heading in cli.md")`: each key of `DESC`, `help`, and each `NOUNS[i].name` is in `headingCodes(cli)` (heading text starts with the name, e.g. `` `render` `` or `` `netink render` `` — accept both).
  - `test("every flag is documented in its section")`: for each command in `DESC` except `completion`, the flags are the `--x` tokens in `bun src/cli.ts <cmd> --help` output (excluding `--help`); each appears as `` `--x` `` in that command's `sections()` text. For each noun, every `flags[].name` plus the common `--after`, `--before`, `--select-text` appears in the noun's section. Global `--file`, `--json`, `--version` appear anywhere in cli.md.
  - `test("cli.md examples run")`: `await runExamples("docs/cli.md")` equals `[]`.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Write `docs/cli.md`:** global flags; one section per command (purpose, flags, exit codes, one console example); editing — how a noun/verb command works, then one section per noun naming the exact DSL line it writes (show it with a console example that runs `init`, the add, and `cat`-free verification via `netink show <id>`); `--json` output shapes and the error shape (from `JSON_OUT` in `src/help.ts`); exit codes (from `EXIT`); shell completion; "Known limitations": `--after`/`--before` only place next to a statement of the same kind; `--path` shows only shortest paths; a lease comment can't be cleared. Console examples write SVG with `-o`, never to stdout.
- [ ] **Step 4: Run** `mise run test` — Expected: PASS.
- [ ] **Step 5: Commit** `docs: CLI reference with executed examples`.

### Task 6: LICENSE, CHANGELOG, release workflow

**Files:**
- Create: `LICENSE`, `CHANGELOG.md`, `.github/workflows/release.yml`, `scripts/release-notes.sh`
- Test: `test/release.test.ts`

**Interfaces:** Consumes `mise run build-all` with `VERSION` (Task 2). Produces `scripts/release-notes.sh <tag>`: prints that version's CHANGELOG section body on stdout, exit 0; exit 1 with a message on stderr when the tag is not `v<semver>` or the section is missing.

- [ ] **Step 1: Write failing tests** `test/release.test.ts`:
  - `test("release notes for v0.1.0")`: `bash scripts/release-notes.sh v0.1.0` → exit 0, non-empty stdout, no `## ` heading line in it.
  - `test("non-semver tag is refused")`: `v1`, `0.1.0`, `v0.1` → exit 1.
  - `test("missing changelog section is refused")`: `v9.9.9` → exit 1, stderr mentions `CHANGELOG.md`.
  - `test("workflow builds from the tag")`: `.github/workflows/release.yml` text contains `tags:`, `v*.*.*`, `mise run test`, `mise run build-all`, `scripts/release-notes.sh`, `dist/netink.1`, and no `secrets.` other than `secrets.GITHUB_TOKEN`.
  - `test("LICENSE is MIT")`: starts with `MIT License` and contains `Copyright (c) 2026 asm0dey`.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.** `LICENSE`: standard MIT text. `CHANGELOG.md`: Keep-a-Changelog style headings `## [0.1.0] - unreleased` (the owner sets the date when tagging) listing what 0.1.0 is (the DSL, `.rsc` import, CLI editing, views/slices, docs) — short, user-facing. `release-notes.sh`: validate `^v[0-9]+\.[0-9]+\.[0-9]+$`, extract lines between `## [X.Y.Z]` and the next `## `. Workflow: on push tags `v*.*.*`; `permissions: contents: write`; `concurrency` group `release`; steps — checkout, `jdx/mise-action` (installs bun from `mise.toml`), `bun install --frozen-lockfile`, `mise run test`, notes = `bash scripts/release-notes.sh "$GITHUB_REF_NAME"` (fails the job early), `VERSION="${GITHUB_REF_NAME#v}" mise run build-all`, `gh release create "$GITHUB_REF_NAME" dist/netink-* dist/netink.1 --notes-file notes.md` with `GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`. Check what file names `build-all` actually produces for the Windows targets (bun may add `.exe`) and make sure the glob picks them up.
- [ ] **Step 4: Run** `mise run test` — Expected: PASS. Run `VERSION=0.1.0 mise run build-all && ls dist` — all 8 binaries plus `netink.1`; `./dist/netink-linux-x64 --version` prints `0.1.0`.
- [ ] **Step 5: Commit** `build: MIT licence, changelog, tag-driven release workflow`.

### Task 7: README + quickstart example

**Files:**
- Create: `README.md`, `examples/quickstart/network.net`, `examples/quickstart/network.svg`
- Modify: `mise.toml` (task `render-quickstart`), `test/docs.test.ts`

**Interfaces:** Consumes `blocks`, `runExamples`, `relLinks` (Task 4); assets from Task 3; `LICENSE`, `CHANGELOG.md` (Task 6); `loadModel`, `layout`, `renderSvg` as in `test/acceptance/home.test.ts`.

- [ ] **Step 1: Write failing tests:**
  - `test("quickstart svg is current")`: render `examples/quickstart/network.net` the way `home.test.ts` does; equals the committed `examples/quickstart/network.svg`.
  - `test("README shows the quickstart source")`: the first ` ```net ` block in README equals the file's contents (trimmed).
  - `test("README examples run")`: `runExamples("README.md")` equals `[]`.
  - Remove the "skip missing files" clause from the link test.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Write the quickstart** (invented: one router, one switch, one AP with two SSIDs, 2–3 VLANs, ≤ 15 lines) and `mise` task `render-quickstart = "bun src/cli.ts render --file examples/quickstart/network.net -o examples/quickstart/network.svg"`; run it.
- [ ] **Step 4: Write `README.md`** in this order: header `<picture>` with `assets/wordmark-dark.svg` for `(prefers-color-scheme: dark)` and `assets/wordmark-light.svg` as the `img`; two-sentence description; the quickstart SVG image and its ` ```net ` source; "Install" — download from [Releases](../../releases/latest), `chmod +x`, put on `PATH`, optional `netink.1` into a man dir, and "build from source" (`mise run build`); quick start console block (`init`, two `add` commands, `render -o`); a bigger example linking `test/fixtures/home.golden.svg`; links to `docs/dsl.md` and `docs/cli.md`; "Versioning" — semver, during 0.x a minor bump may change the DSL or flags (read `CHANGELOG.md`), a patch bump is fixes only; "License" — MIT, link `LICENSE`.
- [ ] **Step 5: Run** `mise run test` — Expected: PASS.
- [ ] **Step 6: Commit** `docs: README with quickstart` — send the owner a rendered preview of the README (e.g. chromium screenshot of the markdown rendered to HTML).

### Task 8: Wrap-up

- [ ] **Step 1:** Update the memory file `milestone2-state.md`: part E done through the last commit; the workflow is unverified until the owner creates the GitHub repo and pushes `v0.1.0`; the owner uploads `assets/logo-512.png` as the avatar/social preview by hand.
- [ ] **Step 2:** Tell the owner the steps to publish: create the GitHub repo, add the remote, push `main`, set the CHANGELOG date, tag `v0.1.0`, push the tag.
