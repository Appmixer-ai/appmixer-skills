#!/usr/bin/env bash
# Idempotent dependency guard for the E2E helper scripts (skills/package.json).
# Safe to run repeatedly; installs deps once into skills/node_modules.
set -e

# The skills root is the directory above this script — resolve symlinks so it
# also works when a skill dir is symlinked into a project's .claude/skills/.
ROOT="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}" 2>/dev/null || echo "${BASH_SOURCE[0]}")")/.." && pwd)"
cd "$ROOT"

# ajv is a real runtime dep — use it as the "deps present" sentinel.
if [ ! -d node_modules/ajv ]; then
    echo "[appmixer] Installing plugin dependencies (one-time)..."
    npm ci --omit=dev 2>/dev/null || npm install --omit=dev
fi
