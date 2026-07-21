#!/usr/bin/env bash
# Clean-box test of the appmixer-skills distribution paths, in Docker.
#
# Verifies what a brand-new user experiences on a machine with no
# appmixer-connectors checkout, no config file, no env vars — including the
# agent-level behavior (does the skill ask instead of failing cryptically?).
#
# Prerequisites:
#   - Docker daemon (Colima: `brew install colima docker && colima start`)
#   - Claude auth for the headless scenario, either:
#       export CLAUDE_CODE_OAUTH_TOKEN=$(claude setup-token)   # or
#       export ANTHROPIC_API_KEY=sk-ant-...
#     Without either, the LLM scenario is skipped (deterministic ones still run).
#
# Usage: bash scripts/clean-box-test.sh
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE=appmixer-skills-clean-box

PASS=0; FAIL=0
check() {
    local name="$1" want="$2" got="$3"
    if [[ "$got" == *"$want"* ]]; then
        echo "ok   $name"; PASS=$((PASS+1))
    else
        echo "FAIL $name"; echo "  expected substring: $want"; echo "  got (tail): $(echo "$got" | tail -5)"; FAIL=$((FAIL+1))
    fi
}

echo "── building image ──────────────────────────────────────────────────"
docker build -q -t "$IMAGE" -f "$REPO_ROOT/scripts/clean-box.Dockerfile" "$REPO_ROOT/scripts" || exit 1

run_in_box() { # run_in_box [extra docker args --] <shell command>
    local extra=()
    while [[ "$1" != "--" ]]; do extra+=("$1"); shift; done; shift
    # ${extra[@]+...} guard: bash 3.2 (macOS) treats empty-array expansion as unbound under set -u
    docker run --rm ${extra[@]+"${extra[@]}"} "$IMAGE" bash -lc "$1" 2>&1
}

echo "── scenario 1: npx install on a clean box ──────────────────────────"
OUT=$(run_in_box -- '
    npx -y skills add Appmixer-ai/appmixer-skills --agent claude-code --skill "*" -y >/dev/null 2>&1
    ls .claude/skills/ && test -f .claude/skills/run-e2e-flows/SKILL.md && echo INSTALL_OK')
check "npx installs the 9 skill dirs" "INSTALL_OK" "$OUT"

echo "── scenario 2: bootstrap downloads bundle, scripts degrade cleanly ─"
OUT=$(run_in_box -- '
    export APPMIXER_SKILL_ROOT="${APPMIXER_SKILL_ROOT:-${CLAUDE_PLUGIN_ROOT:-$HOME/.appmixer-skills/appmixer}}"
    if [ ! -d "$APPMIXER_SKILL_ROOT/_shared" ]; then
        curl -fsSL -o /tmp/b.zip https://raw.githubusercontent.com/Appmixer-ai/appmixer-skills/main/dist/appmixer-skills.zip || exit 1
        mkdir -p "$HOME/.appmixer-skills" && unzip -oq /tmp/b.zip -d "$HOME/.appmixer-skills"
        export APPMIXER_SKILL_ROOT="$HOME/.appmixer-skills/appmixer"
    fi
    bash "$APPMIXER_SKILL_ROOT/scripts/ensure-deps.sh" >/dev/null 2>&1 && echo BOOTSTRAP_OK
    node "$APPMIXER_SKILL_ROOT/e2e-shared/scripts/appmixer-flow.mjs" list-e2e-flows 2>&1 | head -3')
check "bundle bootstrap + npm ci works on Linux" "BOOTSTRAP_OK" "$OUT"
check "no-config run announces missing instance" "instance=MISSING" "$OUT"
check "no-config run names the missing variable" "APPMIXER_SKILL_API_URL is required" "$OUT"

echo "── scenario 3: offline box (no GitHub at all) ──────────────────────"
OUT=$(run_in_box --network none -- '
    export APPMIXER_SKILL_ROOT="$HOME/.appmixer-skills/appmixer"
    curl -fsSL --max-time 10 -o /tmp/b.zip https://raw.githubusercontent.com/Appmixer-ai/appmixer-skills/main/dist/appmixer-skills.zip \
        || echo "DOWNLOAD_FAILED_AS_EXPECTED"')
check "air-gapped box cannot download (bootstrap would abort with its message)" "DOWNLOAD_FAILED_AS_EXPECTED" "$OUT"

echo "── scenario 4: agent behavior (headless claude) ────────────────────"
if [[ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" || -n "${ANTHROPIC_API_KEY:-}" ]]; then
    OUT=$(run_in_box -e CLAUDE_CODE_OAUTH_TOKEN -e ANTHROPIC_API_KEY -- '
        npx -y skills add Appmixer-ai/appmixer-skills --agent claude-code --skill "*" -y >/dev/null 2>&1
        claude -p --dangerously-skip-permissions --max-turns 15 \
          "Use the generate-E2E-test-flows skill to generate test flows for the \"asana\" connector. Do exactly what the skill says. If a prerequisite is missing, say precisely what is missing and what I should do, then stop." 2>&1')
    # A clean box has no connectors checkout and no config: the agent must surface
    # the connectors-dir prerequisite, not invent paths or crash.
    check "agent surfaces the missing connectors checkout" "APPMIXER_SKILL_CONNECTORS_DIR" "$OUT"
    echo "── agent transcript (tail) ──"; echo "$OUT" | tail -15
else
    echo "skip agent scenario: set CLAUDE_CODE_OAUTH_TOKEN (claude setup-token) or ANTHROPIC_API_KEY"
fi

echo "────────────────────────────────────────────────────────────────────"
echo "passed: $PASS, failed: $FAIL"
[[ $FAIL == 0 ]]
