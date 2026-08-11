#!/usr/bin/env bash
# Smoke tests for the appmixer-skills repo (wave 1: pure-instruction skills,
# no runtime scripts). Deterministic, no network, no LLM.
set -uo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

PASS=0; FAIL=0
ok()   { echo "ok   $1"; PASS=$((PASS+1)); }
fail() { echo "FAIL $1"; FAIL=$((FAIL+1)); }

echo "── references sync (instructions/ -> skills/*/references/) ─────────"
if node "$REPO_ROOT/scripts/sync-references.mjs" --check > /dev/null 2>&1; then
    ok "skill references/ in sync with instructions/"
else
    fail "references out of sync — run: node scripts/sync-references.mjs"
fi

echo "── skill manifests ─────────────────────────────────────────────────"
MANIFEST_OK=1
while IFS= read -r p; do
    dir="$REPO_ROOT/${p#./}"
    name="$(basename "$p")"
    if [[ ! -f "$dir/SKILL.md" ]]; then echo "  missing SKILL.md: $p"; MANIFEST_OK=0; continue; fi
    grep -q "^name: $name$" "$dir/SKILL.md" || { echo "  frontmatter name != dir: $p"; MANIFEST_OK=0; }
done < <(node -p "require('$REPO_ROOT/package.json').agents.skills.map(s => s.path).join('\n')")
[[ $MANIFEST_OK == 1 ]] && ok "every manifest skill exists and frontmatter name matches its dir" \
                        || fail "skill manifest inconsistencies (see above)"

echo "── instructions examples parse ─────────────────────────────────────"
EX_OK=1
while IFS= read -r f; do
    case "$f" in
        *.json) node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" || { echo "  bad JSON: $f"; EX_OK=0; } ;;
        *.js)   node --check "$f" || { echo "  bad JS: $f"; EX_OK=0; } ;;
    esac
done < <(find "$REPO_ROOT/instructions/examples" -type f \( -name '*.json' -o -name '*.js' \))
[[ $EX_OK == 1 ]] && ok "all instructions/examples files parse (JSON + node --check)" \
                  || fail "invalid example files (see above)"

echo "── e2e script infrastructure ───────────────────────────────────────"
E2E_OK=1
for f in skills/test-connector/scripts/run.js skills/test-connector/scripts/validate.js \
         skills/test-connector/scripts/appmixer-flow.mjs skills/_shared/appmixerApi/index.js \
         skills/scripts/ensure-deps.sh skills/package.json; do
    [[ -f "$REPO_ROOT/$f" ]] || { E2E_OK=0; echo "  missing: $f"; }
done
# no references to pre-consolidation skill layouts anywhere in skills/
if grep -rn "e2e-shared\|generate-e2e-flows\|run-e2e-flows/\|upload-e2e-flows" \
        "$REPO_ROOT/skills" --include='*.md' --include='*.js' --include='*.mjs' > /dev/null 2>&1; then
    E2E_OK=0; echo "  stale pre-consolidation skill paths referenced in skills/"
fi
[[ $E2E_OK == 1 ]] && ok "e2e scripts present, no stale skill paths" \
                   || fail "e2e script infrastructure broken (see above)"

echo "────────────────────────────────────────────────────────────────────"
echo "passed: $PASS, failed: $FAIL"
[[ $FAIL == 0 ]]
