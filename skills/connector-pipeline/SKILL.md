---
name: connector-pipeline
description: End-to-end Appmixer connector development pipeline. Use when user wants to build a complete connector from scratch, run the full pipeline, or continue an in-progress connector build. Also use when discussing connector development workflow or steps.
---

# Connector Development Pipeline

Full end-to-end workflow for building an Appmixer connector.

Before running any step, ensure Node dependencies are installed (idempotent, skips if already present):

```bash
bash "${CLAUDE_PLUGIN_ROOT:-${VERO_SKILL_ROOT:-.}/..}/scripts/ensure-deps.sh"
```

## Design Reference

All connector design knowledge lives in `appmixer-connectors/.github/instructions/`. This is the single source of truth for connector standards — all agents in the pipeline load it automatically via `loadContext`. The conventions live in the connectors repo, not in this plugin: before starting the pipeline, verify `<connectors>/.github/instructions/` exists; if it doesn't, stop and tell the user they need an up-to-date `appmixer-connectors` checkout (set `VERO_CONNECTORS_DIR` or run from inside it).

| File | Content |
|------|---------|
| `00-overview.md` | Appmixer architecture overview |
| `01-connectors.md` | Connector structure, service.json, bundle.json |
| `02-authentication.md` | Auth patterns (API key, OAuth, etc.) |
| `04-components.md` | Component structure and component.json |
| `05-component-config.md` | Transforms, modifiers, lambda patterns |
| `06-component-behavior.md` | Behavior file patterns |
| `07-component-types.md` | Actions, triggers, dynamic components |
| `08-best-practices.md` | Coding standards, naming, error handling |
| `09-testing.md` | E2E flow design, modifier functions, deterministic patterns |

Consult these when reviewing agent output, debugging failures, or giving custom instructions.

## Pipeline Overview

```
Step 1: RESEARCH        → GitHub issue with full spec
Step 2: INITIALIZE      → Scaffold + generate components                  [init-connector]
Step 3: TEST + FIX      → Authenticate → test loop → finalize            [run-CLI-tests]
Step 4: E2E TEST FLOWS  → Generate test flow JSONs for final component set [generate-E2E-test-flows]
Step 5: UPLOAD E2E FLOWS → Publish connector, upload flows, validate           [upload-e2e-flows]
Step 6: RUN E2E FLOWS   → Execute flows & auto-fix on live instance            [run-e2e-flows]
```

---

## Adding New Components to an Existing Connector

When a connector already exists and you only need to add one or more new components (not rebuild from scratch), use a shorter flow:

### 1. Research (optional)

If the API endpoint is unknown, check the existing GitHub issue or API docs. No need to create a new issue unless the scope is large.

### 2. Scaffold the new component(s) manually

`init-connector` is for creating new connectors from scratch — do not use it here.

Instead, scaffold the new component manually using the existing connector structure as a reference:
- Copy a similar existing component directory
- Update `component.json`, `component.js`, and any output/transform files to match the new endpoint
- Register the component in the connector's `package.json` if needed

### 3. Test + Fix (same as full pipeline Step 3b–3d)

Auth is usually already set up. Follow the `run-CLI-tests` skill to test only the
new components (drive the `appmixer test component` CLI directly — no sub-agent).

Fix components on failure, max 3 iterations. Report to user if still failing.

### 4. E2E test flows (if needed)

Only run if the new components need E2E coverage. Follow the
`generate-E2E-test-flows` skill: the agent writes the flow JSON(s) directly —
generate flows only for the NEW components (do not regenerate existing flows and
risk breaking them), then validate:

```bash
node ../generate-E2E-test-flows/validate.js \
    $VERO_CONNECTORS_DIR/src/appmixer/<connector>/artifacts/test-flows
```

### 5. Publish

Lint, commit, publish, push — same as full pipeline Git & Publish Rules below.

## How the skills execute

No skill spawns a sub-agent. Each skill is either pure instructions you follow
directly (init-connector, plan-CLI-tests, run-CLI-tests, review-component-standards,
generate-E2E-test-flows) or instructions plus a deterministic helper script you
drive (`run-e2e-flows/scripts/run.js`, `e2e-shared/scripts/appmixer-flow.mjs`,
`generate-E2E-test-flows/validate.js`).

---

## Step 1: Research

Use slash command in the connectors repo (Claude Code, not OpenClaw):
```
/research-connector <service> <api-docs-url>
```
Output: GitHub issue with auth details, component list, endpoints, rate limits.

If user already has an issue → skip to Step 2.

---

## Step 2: Initialize

Follow the `init-connector` skill — fetch the issue, research the API, and
scaffold the connector + components directly.

When done, check: connector name, components generated, any errors.

---

## ⚠️ CLI Tests — Always Ask First

Before running `plan-CLI-tests` or `run-CLI-tests`, **always ask the user** whether to proceed.

Never run these agents automatically — they can take a long time and cost credits. Even when the pipeline suggests it as the next step, stop and confirm:

> "Ready to plan/run CLI tests for `<connector>`. Shall I go ahead?"

---

## Step 3: Test + Fix

### 3a. Auth (REQUIRED — human step)

Ask user to authenticate. API Key connectors: provide key. OAuth: complete flow via Appmixer instance.

### 3b. Test plan

**Ask user first** — confirm before running.

Follow the `plan-CLI-tests` skill — read the connector's component definitions
and write an ordered `test-plan.json` directly (no sub-agent).

### 3c. Test + fix loop

**Ask user first** before each component test run.

For each component in the test plan, test sequentially (port 2300 conflict if
parallel) by following the `run-CLI-tests` skill (drives `appmixer test component`).

On failure → fix the component (edit `component.json` / behavior directly) → re-test. Max 3 iterations per component.

After 3 failures → report to user: skip or investigate manually.

> **Auditing without changing files:** use the `review-component-standards`
> skill for a read-only report. Fixing is done by editing the component files
> directly as part of this loop — apply the standards in
> `<connectors>/.github/instructions/`.

### 3d. Finalize

Ask user about consistently failing components: remove or keep?

---

## Step 4: E2E Test Flows

Follow the `generate-E2E-test-flows` skill — the agent writes the flow JSONs
directly (per the skill's rules + `test-flow-template.json`), then validates and
fixes until clean:

```bash
node ../generate-E2E-test-flows/validate.js \
    $VERO_CONNECTORS_DIR/src/appmixer/<connector>/artifacts/test-flows
```

Only run after Step 3 is complete (component list final).

---

## Step 5: Upload E2E Flows

Run after Step 4 generates test flow JSONs. Publishes the connector and uploads flows to the live instance.

**Prerequisites:**
- Test flow JSONs in `artifacts/test-flows/` (from Step 4)
- Auth credentials configured (from Step 3a)
- `appmixer.env` in the workspace root (auto-detected) **or** `APPMIXER_ENV` env var pointing to a custom path; must contain `VERO_CONNECTORS_DIR`, `VERO_APPMIXER_BASE_URL`, `VERO_APPMIXER_USERNAME`, `VERO_APPMIXER_PASSWORD`

1. **Lint + repo validator** before publishing — catch errors early:
   ```bash
   cd $VERO_CONNECTORS_DIR
   npm install   # only needed once
   ./node_modules/.bin/eslint src/appmixer/<connector>/ --ext .js
   # repo-wide connector standards (MakeApiCall presence, required-input guards,
   # dynamic outPort sources, output examples, bundle bumps, …)
   node scripts/validate.js --connector <connector>
   ```
   Fix every validator failure before proceeding (warnings: use judgement). Common
   lint issues: trailing spaces, `max-len` (120 char limit), extra blank lines.

2. **Publish + upload flows:**
   ```bash
   : "${APPMIXER_ENV:=$(pwd)/appmixer.env}"
   source "$APPMIXER_ENV"

   # Pack and publish connector
   cd $VERO_CONNECTORS_DIR/src/appmixer
   appmixer pack <connector>
   appmixer publish appmixer.<connector>.zip

   # Ensure stores exist (first time only)
   node ../e2e-shared/scripts/appmixer-flow.mjs ensure-stores

   # Upload all test flows (handles account assignment automatically)
   node ../e2e-shared/scripts/appmixer-flow.mjs upload-all <connector>
   ```

3. **Validate:**
   ```bash
   node ../e2e-shared/scripts/validate-flows.mjs \
       $VERO_CONNECTORS_DIR/src/appmixer/<connector>/artifacts/test-flows \
       $VERO_CONNECTORS_DIR/src/appmixer
   ```

See `upload-e2e-flows` skill for full details on account management, variable validation, and known gotchas.

---

## Step 6: Run E2E Flows

Run after Step 5. Executes the uploaded flows and evaluates results.

Run each flow with the deterministic runner and act on its exit code:

```bash
node ../run-e2e-flows/scripts/run.js <path-to-flow.json>
```

- exit `0` — passed, next flow
- exit `2` — `NEEDS_FIX` brief printed: diagnose, fix the flow JSON on disk,
  re-run (max 5 iterations per flow)
- exit `1` — hard failure: investigate / report

See the `run-e2e-flows` skill for full details on the fix rules, monitoring, and gotchas.

---

## Git & Publish Rules

After every meaningful change (component created, refactored, fixed):

1. **Commit** to the appropriate branch in `appmixer-connectors`:
   - New connector: `feature/<connector>-connector`
   - Fixes/improvements: `fix/<connector>-<description>` or the current feature branch
   - Use descriptive commit messages

2. **Publish** to the Appmixer instance (credentials from `.env`):
   ```bash
   cd $VERO_CONNECTORS_DIR
   appmixer url $VERO_APPMIXER_BASE_URL
   appmixer login -u $VERO_APPMIXER_USERNAME -p $VERO_APPMIXER_PASSWORD
   appmixer pack <connector-module-path>
   appmixer publish
   ```
   Publish the whole module (not individual components) when there's a service dependency.

3. **Push** the branch to origin after commits.

Load credentials from `openclaw/.env` for the Appmixer instance URL and credentials.

---

## State tracking

Progress is tracked in the connector's artifacts:
`<VERO_CONNECTORS_DIR>/src/appmixer/<connector>/artifacts/ai-artifacts/pipeline-state.json`

Read this file to know where to resume if the pipeline was interrupted.

---

## Parallel execution

- **Step 2 (init):** Single run, one long job
- **Step 3c (test/fix):** Sequential — port 2300 conflict if parallel
- **Step 3c (fix-only, no test run):** Can parallelize 3–5 at a time (no port conflict)
- **Step 4 (test flows):** Single run
- **Step 5 (run e2e):** Sequential per flow (start → wait → evaluate before next)


### Always bump bundle.json before publishing
- **Patch** (`x.x.+1`) — bug fixes, no new inputs/outputs
- **Minor** (`x.+1.0`) — new features, new properties supported, behaviour changes
- **Major** (`+1.0.0`) — breaking changes
- Add a changelog entry describing what changed — do this **before** `appmixer pack && appmixer publish`
