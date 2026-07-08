#!/usr/bin/env bash
# Build script for appmixer-skills distribution packages
# Creates a zip bundle of the complete plugin (the skills/ directory).
#
# Unlike per-skill zips, we only ship a single bundle: the skills share
# runtime helpers (_shared/, e2e-shared/, scripts/, hooks/, package.json),
# so individual skills are not self-contained.
#
# Artifact strategy:
#   dist/appmixer-skills.zip          — stable alias, committed to main for raw downloads
#   dist/appmixer-skills-v<ver>.zip   — versioned, gitignored, attached to GitHub Releases
#
# After building, publish versioned artifacts to a release:
#   gh release create v${VERSION} dist/*-v${VERSION}.zip

set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
DIST_DIR="$REPO_ROOT/dist"
VERSION=$(node -p "require('$REPO_ROOT/skills/.claude-plugin/plugin.json').version")

# Cleanup temp dirs on exit/error/interrupt
_CLEANUP_DIRS=()
cleanup() {
  for d in "${_CLEANUP_DIRS[@]}"; do rm -rf "$d" 2>/dev/null; done
}
trap cleanup EXIT

echo "Building appmixer-skills distribution package v${VERSION}..."

rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"

TMPDIR=$(mktemp -d "${TMPDIR:-/tmp}/appmixer-skills.XXXXXX")
_CLEANUP_DIRS+=("$TMPDIR")
BUNDLE="$TMPDIR/appmixer"
mkdir -p "$BUNDLE"

# The plugin root is the skills/ directory — copy it without local-only files
rsync -a \
  --exclude 'node_modules' \
  --exclude '.env' \
  --exclude '.DS_Store' \
  "$REPO_ROOT/skills/" "$BUNDLE/"

(cd "$TMPDIR" && zip -rq "$DIST_DIR/appmixer-skills-v${VERSION}.zip" "appmixer/")
# Stable alias (version-free) so download links don't 404 after a bump
cp "$DIST_DIR/appmixer-skills-v${VERSION}.zip" "$DIST_DIR/appmixer-skills.zip"

echo ""
echo "Build complete! Files in dist/:"
SIZE=$(du -h "$DIST_DIR/appmixer-skills-v${VERSION}.zip" | cut -f1)
echo "  appmixer-skills-v${VERSION}.zip  ${SIZE}"
echo "  appmixer-skills.zip  (stable alias)"
