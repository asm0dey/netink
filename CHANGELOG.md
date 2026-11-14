# Changelog

All notable changes to netink are listed here. Versions follow [semver](https://semver.org/).

## [0.1.0] - 2026-11-14

First release.

- A line-based DSL for network diagrams: devices, VLANs, links and device internals, in a plain-text `.net` file.
- Import of MikroTik `.rsc` exports.
- CLI editing commands that rewrite the file in place.
- Views and slices of a network: `--view`, `--vlan`, `--around`, `--path` and `--address`.
- Check diagnostics for common mistakes in a network file.
- `--json` output for scripting.
- Shell completion.
- Documentation in `docs/dsl.md` and `docs/cli.md`, plus a man page.
