#!/usr/bin/env bash
# Usage: release-notes.sh vX.Y.Z — prints that version's CHANGELOG.md section body.
set -eu
tag="${1:-}"
if ! [[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "release-notes.sh: '$tag' is not a vMAJOR.MINOR.PATCH tag" >&2
  exit 1
fi
cd "$(dirname "$0")/.."
body=$(awk -v h="## [${tag#v}]" 'index($0, h) == 1 { on = 1; next } /^## / { on = 0 } on' CHANGELOG.md)
if [[ -z "${body//[[:space:]]/}" ]]; then
  echo "release-notes.sh: no section for ${tag#v} in CHANGELOG.md" >&2
  exit 1
fi
printf '%s\n' "$body"
