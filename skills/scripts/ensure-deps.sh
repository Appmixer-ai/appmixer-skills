#!/usr/bin/env bash
# Idempotent dependency guard for the Appmixer skills plugin.
#
# Runs on Claude Code SessionStart (see hooks/hooks.json). If node_modules is
# vendored (committed) this is a no-op; otherwise it installs deps once. Other
# agents (skills.sh, Cursor, ...) don't fire this hook — they rely on the
# vendored node_modules instead.
set -e

# Resolve plugin root: CLAUDE_PLUGIN_ROOT when invoked by Claude Code,
# else the directory above this script (manual / other invocation).
ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$ROOT"

# ajv is a real runtime dep — use it as the "deps present" sentinel.
if [ ! -d node_modules/ajv ]; then
    echo "[appmixer] Installing plugin dependencies (one-time)..."
    npm ci --omit=dev 2>/dev/null || npm install --omit=dev
fi
