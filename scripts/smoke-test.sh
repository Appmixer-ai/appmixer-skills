#!/usr/bin/env bash
# Smoke tests for the Appmixer skills plugin.
#
# Simulates a plugin install into a random location and verifies that the
# deterministic scripts degrade with clear, actionable errors when
# configuration is missing, and that the happy-path mechanics (APPMIXER_ENV
# loading, connectors-dir resolution, ensure-deps) work from a foreign cwd.
# No live Appmixer instance is needed.
#
# Usage: bash scripts/smoke-test.sh   (or: npm test)
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

PLUGIN="$WORK/installed-plugin"      # what a plugin install produces
PROJECT="$WORK/random-user-project"  # foreign cwd, no connectors checkout
CONNECTORS="$WORK/fake-connectors"   # minimal fake appmixer-connectors clone
mkdir -p "$PROJECT" "$CONNECTORS/src/appmixer/testsvc" "$CONNECTORS/sub/deep"
cp -R "$REPO_ROOT/skills/" "$PLUGIN/"

PASS=0; FAIL=0
check() { # check <name> <expected-substring> <actual-output>
    local name="$1" want="$2" got="$3"
    if [[ "$got" == *"$want"* ]]; then
        echo "ok   $name"; PASS=$((PASS+1))
    else
        echo "FAIL $name"; echo "  expected substring: $want"; echo "  got: $(echo "$got" | head -3)"; FAIL=$((FAIL+1))
    fi
}

# Config precedence is exported vars > APPMIXER_ENV > ~/.config/appmixer-skills/env.
# Isolate HOME so the developer's real config file can't leak into the tests.
FAKE_HOME="$WORK/home"
mkdir -p "$FAKE_HOME"
CLEAN=(env -u APPMIXER_ENV -u APPMIXER_SKILL_API_URL -u APPMIXER_SKILL_USERNAME \
       -u APPMIXER_SKILL_PASSWORD -u APPMIXER_SKILL_CONNECTORS_DIR -u APPMIXER_TOKEN \
       -u APPMIXER_SKILL_ACCOUNT_ID -u APPMIXER_SKILL_UI_URL -u CLAUDE_PLUGIN_ROOT \
       HOME="$FAKE_HOME")

echo "── syntax ──────────────────────────────────────────────────────────"
SYNTAX_OK=1
while IFS= read -r f; do
    node --check "$f" || { echo "FAIL syntax: $f"; SYNTAX_OK=0; }
done < <(find "$REPO_ROOT/skills" -name node_modules -prune -o \( -name '*.js' -o -name '*.mjs' \) -print)
[[ $SYNTAX_OK == 1 ]] && { echo "ok   node --check on all shipped scripts"; PASS=$((PASS+1)); } || FAIL=$((FAIL+1))

echo "── bundle integrity (bootstrap contract) ───────────────────────────"
# Per-skill installs (npx skills) bootstrap by downloading dist/appmixer-skills.zip
# from main — the committed bundle must always contain the shared runtime.
BUNDLE_LIST=$(unzip -l "$REPO_ROOT/dist/appmixer-skills.zip" 2>/dev/null || echo MISSING)
for want in appmixer/_shared/loadEnv.js appmixer/scripts/ensure-deps.sh \
            appmixer/e2e-shared/scripts/appmixer-flow.mjs appmixer/package-lock.json; do
    check "bundle contains $want" "$want" "$BUNDLE_LIST"
done

echo "── env-var contract ────────────────────────────────────────────────"
# .env.example is the authoritative list: every process.env.X read by shipped
# scripts must appear there, or be a documented runtime/meta variable.
ALLOWLIST="APPMIXER_ENV"  # pointer TO the env file; cannot live inside it
MISSING=""
while IFS= read -r var; do
    grep -q "$var" "$REPO_ROOT/skills/.env.example" || [[ " $ALLOWLIST " == *" $var "* ]] || MISSING="$MISSING $var"
done < <(grep -rhoE 'process\.env\.[A-Z_][A-Z0-9_]*' "$REPO_ROOT/skills" \
           --include='*.js' --include='*.mjs' --exclude-dir=node_modules \
         | sed 's/process\.env\.//' | sort -u)
if [[ -z "$MISSING" ]]; then
    echo "ok   every env var read by scripts is documented in .env.example"; PASS=$((PASS+1))
else
    echo "FAIL undocumented env vars:$MISSING (add to skills/.env.example or ALLOWLIST)"; FAIL=$((FAIL+1))
fi

echo "── no-config failure modes (install anywhere, cwd anywhere) ────────"
cd "$PROJECT"

OUT=$("${CLEAN[@]}" node -e "import('$PLUGIN/_shared/resolveConnectorsDir.js').then(m => { try { m.resolveConnectorsDir(); } catch(e) { console.log(e.message); } })" 2>&1)
check "resolveConnectorsDir without config gives actionable error" \
      "set APPMIXER_SKILL_CONNECTORS_DIR or run from inside" "$OUT"

OUT=$("${CLEAN[@]}" node "$PLUGIN/run-e2e-flows/scripts/run.js" 2>&1)
check "run.js without args prints usage" "Usage: node run.js" "$OUT"

OUT=$("${CLEAN[@]}" node "$PLUGIN/e2e-shared/scripts/appmixer-flow.mjs" list-e2e-flows 2>&1)
check "appmixer-flow.mjs announces missing instance" "instance=MISSING" "$OUT"
check "appmixer-flow.mjs names the missing variable" "APPMIXER_SKILL_API_URL is required" "$OUT"

echo "── offline bootstrap failure (no GitHub) ───────────────────────────"
# The SKILL.md bootstrap block must abort with an actionable message when the
# bundle download fails (air-gapped box, GitHub outage) — not cascade into
# unzip/file-not-found noise. Reproduce with a failing curl shim.
mkdir -p "$WORK/no-net-bin"
printf '#!/bin/bash\necho "curl: (6) Could not resolve host" >&2\nexit 6\n' > "$WORK/no-net-bin/curl"
chmod +x "$WORK/no-net-bin/curl"
BOOTSTRAP_BLOCK=$(awk '/^ *export APPMIXER_SKILL_ROOT=/{f=1} f{sub(/^  /,""); print} /ensure-deps.sh"$/{if(f)exit}' \
    "$REPO_ROOT/skills/upload-e2e-flows/SKILL.md")
OUT=$("${CLEAN[@]}" PATH="$WORK/no-net-bin:$PATH" bash -c "$BOOTSTRAP_BLOCK" 2>&1)
check "bootstrap aborts with actionable offline error" "cannot download the appmixer-skills bundle" "$OUT"
check "bootstrap suggests offline alternatives" "Offline alternatives" "$OUT"

echo "── happy-path mechanics ────────────────────────────────────────────"
cd "$CONNECTORS/sub/deep"
OUT=$("${CLEAN[@]}" node -e "import('$PLUGIN/_shared/resolveConnectorsDir.js').then(m => console.log(m.resolveConnectorsDir()))" 2>&1)
check "resolveConnectorsDir walks up from cwd inside a checkout" "$CONNECTORS" "$OUT"

cd "$PROJECT"
OUT=$("${CLEAN[@]}" APPMIXER_SKILL_CONNECTORS_DIR="$CONNECTORS" node -e "import('$PLUGIN/_shared/resolveConnectorsDir.js').then(m => console.log(m.resolveConnectorsDir()))" 2>&1)
check "APPMIXER_SKILL_CONNECTORS_DIR overrides cwd" "$CONNECTORS" "$OUT"

cat > "$WORK/test.env" <<'EOF'
APPMIXER_SKILL_API_URL=https://api.example-nonexistent.test
APPMIXER_SKILL_USERNAME=u@example.com
APPMIXER_SKILL_PASSWORD=pw
EOF
OUT=$("${CLEAN[@]}" APPMIXER_ENV="$WORK/test.env" node "$PLUGIN/e2e-shared/scripts/appmixer-flow.mjs" list-e2e-flows 2>&1)
check "APPMIXER_ENV file is loaded and announced" "env=$WORK/test.env" "$OUT"
check "instance from APPMIXER_ENV is effective" "instance=https://api.example-nonexistent.test" "$OUT"

mkdir -p "$FAKE_HOME/.config/appmixer-skills"
sed 's/example-nonexistent/default-config/' "$WORK/test.env" > "$FAKE_HOME/.config/appmixer-skills/env"
OUT=$("${CLEAN[@]}" node "$PLUGIN/e2e-shared/scripts/appmixer-flow.mjs" list-e2e-flows 2>&1)
check "default ~/.config/appmixer-skills/env is auto-loaded" "instance=https://api.default-config.test" "$OUT"

OUT=$("${CLEAN[@]}" APPMIXER_ENV="$WORK/test.env" node "$PLUGIN/e2e-shared/scripts/appmixer-flow.mjs" list-e2e-flows 2>&1)
check "APPMIXER_ENV wins over the default file" "instance=https://api.example-nonexistent.test" "$OUT"

OUT=$("${CLEAN[@]}" APPMIXER_SKILL_API_URL="https://api.exported-var.test" node "$PLUGIN/e2e-shared/scripts/appmixer-flow.mjs" list-e2e-flows 2>&1)
check "exported vars win over config files" "instance=https://api.exported-var.test" "$OUT"

OUT=$(CLAUDE_PLUGIN_ROOT="$PLUGIN" bash "$PLUGIN/scripts/ensure-deps.sh" 2>&1 && echo ENSURE_DEPS_OK)
check "ensure-deps.sh no-ops with vendored node_modules" "ENSURE_DEPS_OK" "$OUT"

echo "────────────────────────────────────────────────────────────────────"
echo "passed: $PASS, failed: $FAIL"
[[ $FAIL == 0 ]]
