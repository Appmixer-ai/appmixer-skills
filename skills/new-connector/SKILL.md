---
name: new-connector
description: Build a new Appmixer connector end-to-end — gather requirements, research the API, scaffold and generate components, then drive testing, E2E flows and publishing. Use when user wants to create/scaffold/build a new connector, add components to an existing one, continue an in-progress connector build, or discusses the connector development workflow. Triggers on "new connector", "create connector", "init connector", "build connector".
license: MIT
metadata:
  author: Appmixer
  version: "0.1.9"
  homepage: https://www.appmixer.com
  repository: https://github.com/Appmixer-ai/appmixer-skills
---

# New Connector

Full end-to-end workflow for building an Appmixer connector: requirements →
scaffold + components → CLI tests → E2E flows → publish → live runs. **You (the
agent) do the scaffolding directly** — research the API and write the files;
the later steps delegate to the dedicated skills (`test-components`,
`generate-e2e-flows`, `upload-e2e-flows`, `run-e2e-flows`). No sub-agents.

Before running any step, ensure Node dependencies are installed (idempotent, skips if already present):

```bash
export APPMIXER_SKILL_ROOT="${APPMIXER_SKILL_ROOT:-${CLAUDE_PLUGIN_ROOT:-$HOME/.appmixer-skills/appmixer}}"
if [ ! -d "$APPMIXER_SKILL_ROOT/_shared" ]; then
    # per-skill installs (npx skills, manual copy) ship only the skill dirs —
    # fetch the full bundle with the shared helpers once
    curl -fsSL -o /tmp/appmixer-skills.zip https://raw.githubusercontent.com/Appmixer-ai/appmixer-skills/main/dist/appmixer-skills.zip \
        || { echo "ERROR: cannot download the appmixer-skills bundle (GitHub unreachable)." >&2
             echo "Offline alternatives: install the Claude Code plugin, or copy the full" >&2
             echo "skills directory (with _shared/) and export APPMIXER_SKILL_ROOT to it." >&2
             exit 1; }
    mkdir -p "$HOME/.appmixer-skills" && unzip -oq /tmp/appmixer-skills.zip -d "$HOME/.appmixer-skills" && rm /tmp/appmixer-skills.zip
    export APPMIXER_SKILL_ROOT="$HOME/.appmixer-skills/appmixer"
fi
bash "$APPMIXER_SKILL_ROOT/scripts/ensure-deps.sh"
```

## Prerequisites

- **Run from the connector workspace** — the current directory (or a parent)
  must contain `src/appmixer/`; the connector is built at
  `src/appmixer/<connector>/`. Only when running from elsewhere, point
  `APPMIXER_SKILL_CONNECTORS_DIR` at the workspace root (optional override).
  If no workspace exists yet, ask the user where to create one (`mkdir -p
  <dir>/src/appmixer`) and continue from there.
- **Design conventions** — bundled in this skill's own `references/` directory;
  no extra setup needed to read them.

## Design Reference

All connector design knowledge lives in the `references/` directory next to this
SKILL.md — the single source of truth for connector standards. Complete example
files (component.json, behaviors, auth.js, lib.js, an E2E flow) are in
`references/examples/`. Real-world example connectors:
https://github.com/appmixer-ai/appmixer-connectors.

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

Consult these when generating code, debugging failures, or reviewing output.

## Pipeline Overview

```
Step 1: REQUIREMENTS    → Gather service, API docs, auth type, component list
Step 2: SCAFFOLD        → Research the API, scaffold + generate components
Step 3: TEST + FIX      → Authenticate → test loop → finalize            [test-components]
Step 4: E2E TEST FLOWS  → Generate test flow JSONs for final component set [generate-e2e-flows]
Step 5: UPLOAD E2E FLOWS → Publish connector, upload flows, validate       [upload-e2e-flows]
Step 6: RUN E2E FLOWS   → Execute flows & auto-fix on live instance        [run-e2e-flows]
```

Progress is tracked in
`src/appmixer/<connector>/artifacts/ai-artifacts/pipeline-state.json` —
read it to know where to resume if the pipeline was interrupted.

---

## Step 1: Requirements

Collect everything needed directly from the user and the service's public docs —
there is no external ticket to fetch. Ask for whatever is missing:

- **Connector name** — lowercase, alphanumeric (e.g. `pipedrive`). Ask if ambiguous.
- **API docs URL** — the service's API reference (or an OpenAPI/Swagger spec).
- **Auth type** — API key, OAuth 2.0, … (derivable from the docs if not stated).
- **Component list** — which actions/triggers to build. If the user doesn't have
  one, propose a sensible set from the API docs (CRUD on the core entities +
  the most useful triggers) and confirm it before generating.

**Abort if the connector already exists** —
check `src/appmixer/<connector>/service.json`. If it exists and the
user wants more components, use the "Adding New Components" flow below instead.

## Step 2: Scaffold + Generate Components

### 2a. Load the design rules

Read this skill's `references/` — at minimum: `01-connectors.md`,
`02-authentication.md`, `04-components.md`, `06-component-behavior.md`,
`07-component-types.md`, `08-best-practices.md`. These are the canonical
conventions everything below must follow. Use the complete example files in
`references/examples/` as scaffolding templates.

When a reference implementation helps (auth pattern, pagination, dynamic
sources), browse real connectors at
https://github.com/appmixer-ai/appmixer-connectors (`src/appmixer/<connector>/`).

### 2b. Research the API

Read the API documentation. For each component from Step 1, identify: endpoint,
method, required/optional parameters, response shape, auth mechanism, and rate
limits. If the docs link to an OpenAPI/Swagger spec, read the relevant paths
from it.

### 2c. Scaffold core files

Under `src/appmixer/<connector>/`:

1. **service.json** — name `appmixer.<connector>`, label from the requirements,
   category `"applications"`, version `"1.0.0"`.
2. **bundle.json** — same name, version `"1.0.0"`,
   `changelog: { "1.0.0": ["Initial release."] }`.
3. **auth.js** — matching the auth type (see `02-authentication.md`).
4. **quota.js** — rate limits from the docs, or sensible defaults.

### 2d. Generate components

For each component, under `src/appmixer/<connector>/core/<ComponentName>/`:

1. **component.json** — proper inPorts, outPorts (typed schema with `example` on
   every leaf property), auth, quota, icon.
2. **<ComponentName>.js** — a working implementation using `context.httpRequest`
   based on the API documentation.

Rules:
- Follow Appmixer conventions strictly (component types table: Get/List/Find/
  Create/Update/Delete/Trigger semantics per `07-component-types.md`).
- Keep HTTP client, auth handling, and output conventions consistent across all
  generated components.
- Every component referenced as a dropdown `source.url` (dynamic inspector
  source) MUST follow the four dynamic-source rules in `07-component-types.md`
  ("Dynamic Source Calls"): `text` input type (never `select`), optional
  dependency inputs, error suppression, and a **cached** fetch
  (`context.staticCache` + `context.lock`, TTL `context.config.listCacheTTL`,
  default 120 s). The designer fires these calls in concurrent bursts on every
  inspector open — uncached sources trip API rate limits (429). For heavily
  rate-limited APIs, cache unconditionally in `receive()` (see the Xero
  `withCache` variant in `07-component-types.md`).
- Do NOT create `package.json` unless the connector genuinely needs npm dependencies.

### 2e. Summary

Report what was created (files, component count, auth type), then continue with
Step 3 (ask first — see below).

---

## ⚠️ CLI Tests — Always Ask First

Before running `test-components` (the plan step or the test loop), **always ask the user** whether to proceed.

Never run these automatically — they can take a long time and cost credits. Even when the pipeline suggests it as the next step, stop and confirm:

> "Ready to plan/run CLI tests for `<connector>`. Shall I go ahead?"

---

## Step 3: Test + Fix

### 3a. Auth (REQUIRED — human step)

Ask user to authenticate. API Key connectors: provide key. OAuth: complete flow via Appmixer instance.

### 3b. Test plan

**Ask user first** — confirm before running.

Follow Step 0a of the `test-components` skill — read the connector's component
definitions and write an ordered `test-plan.json` directly (no sub-agent).

### 3c. Test + fix loop

**Ask user first** before each component test run.

For each component in the test plan, test sequentially (port 2300 conflict if
parallel) by following the `test-components` skill (drives `appmixer test component`).

On failure → fix the component (edit `component.json` / behavior directly) → re-test. Max 3 iterations per component.

After 3 failures → report to user: skip or investigate manually.

> **Auditing without changing files:** use the `review-component-standards`
> skill for a read-only report. Fixing is done by editing the component files
> directly as part of this loop — apply the standards in this skill's
> `references/`.

### 3d. Finalize

Ask user about consistently failing components: remove or keep?

---

## Step 4: E2E Test Flows

Follow the `generate-e2e-flows` skill — the agent writes the flow JSONs
directly (per the skill's rules + `test-flow-template.json`), then validates and
fixes until clean:

```bash
node "$APPMIXER_SKILL_ROOT"/generate-e2e-flows/validate.js \
    src/appmixer/<connector>/artifacts/test-flows
```

Only run after Step 3 is complete (component list final).

---

## Step 5: Upload E2E Flows

Run after Step 4 generates test flow JSONs. Publishes the connector and uploads flows to the live instance.

**Prerequisites:**
- Test flow JSONs in `artifacts/test-flows/` (from Step 4)
- Auth credentials configured (from Step 3a)
- Configuration providing `APPMIXER_SKILL_API_URL`, `APPMIXER_SKILL_USERNAME`, `APPMIXER_SKILL_PASSWORD` — from exported vars, the `APPMIXER_ENV` file, or `~/.config/appmixer-skills/env` (in that precedence). If missing, ask the user for the values and write `~/.config/appmixer-skills/env` (KEY=value lines, `chmod 600`) first.

1. **Lint + workspace validator** before publishing — catch errors early (run
   from the workspace root):
   ```bash
   npm install   # only needed once
   ./node_modules/.bin/eslint src/appmixer/<connector>/ --ext .js
   # workspace-wide connector standards (MakeApiCall presence, required-input
   # guards, dynamic outPort sources, output examples, bundle bumps, …) — only
   # when the workspace ships this validator (the appmixer-connectors repo does)
   node scripts/validate.js --connector <connector>
   ```
   Fix every validator failure before proceeding (warnings: use judgement). Common
   lint issues: trailing spaces, `max-len` (120 char limit), extra blank lines.

2. **Publish + upload flows:** follow the `upload-e2e-flows` skill (pack/publish,
   stores, auth account, upload, account assignment, validation).

---

## Step 6: Run E2E Flows

Run after Step 5. Executes the uploaded flows and evaluates results.

Run each flow with the deterministic runner and act on its exit code:

```bash
node "$APPMIXER_SKILL_ROOT"/run-e2e-flows/scripts/run.js <path-to-flow.json>
```

- exit `0` — passed, next flow
- exit `2` — `NEEDS_FIX` brief printed: diagnose, fix the flow JSON on disk,
  re-run (max 5 iterations per flow)
- exit `1` — hard failure: investigate / report

See the `run-e2e-flows` skill for full details on the fix rules, monitoring, and gotchas.

---

## Adding New Components to an Existing Connector

When a connector already exists and you only need to add one or more new components (not rebuild from scratch), use a shorter flow:

1. **Research (optional)** — if the API endpoint is unknown, check the API docs.
2. **Scaffold the new component(s)** using the existing connector structure as a
   reference:
   - Copy a similar existing component directory
   - Update `component.json`, `component.js`, and any output/transform files to match the new endpoint
   - Register the component in the connector's `package.json` if needed
3. **Test + Fix** (same as Step 3b–3d) — auth is usually already set up. Follow
   the `test-components` skill to test only the new components. Max 3 iterations.
4. **E2E test flows (if needed)** — follow the `generate-e2e-flows` skill;
   generate flows only for the NEW components (do not regenerate existing flows
   and risk breaking them), then validate.
5. **Publish** — lint, commit, publish, push — same as Git & Publish Rules below.

---

## How the skills execute

No skill spawns a sub-agent. Each skill is either pure instructions you follow
directly (new-connector, test-components, review-component-standards,
generate-e2e-flows) or instructions plus a deterministic helper script you
drive (`run-e2e-flows/scripts/run.js`, `e2e-shared/scripts/appmixer-flow.mjs`,
`generate-e2e-flows/validate.js`).

---

## Git & Publish Rules

**Git safety (applies to every push; only relevant when the workspace is git-managed):**

- **Confirm the push target with the user before the FIRST push of the session** —
  state the remote URL and branch and wait for approval; subsequent pushes to the
  same remote+branch may proceed without re-asking.
- **Feature branches only** — never push to `dev`/`main`/`master`, never force-push.
- **Check where `origin` points** (`git remote get-url origin`): if it is a shared
  upstream and the user hasn't explicitly confirmed direct write access, propose
  a fork workflow instead (`gh repo fork --remote` adds a fork and a remote) and
  push there.

After every meaningful change (component created, refactored, fixed):

1. **Commit** to the appropriate branch in the workspace repo:
   - New connector: `feature/<connector>-connector`
   - Fixes/improvements: `fix/<connector>-<description>` or the current feature branch
   - Use descriptive commit messages

2. **Publish** to the Appmixer instance (credentials from the `APPMIXER_SKILL_*` env vars / `$APPMIXER_ENV` file; run from the workspace root):
   ```bash
   appmixer url $APPMIXER_SKILL_API_URL
   appmixer login -u $APPMIXER_SKILL_USERNAME -p $APPMIXER_SKILL_PASSWORD
   appmixer pack <connector-module-path>
   appmixer publish
   ```
   Publish the whole module (not individual components) when there's a service dependency.

3. **Push** the branch to origin after commits.

### Always bump bundle.json before publishing
- **Patch** (`x.x.+1`) — bug fixes, no new inputs/outputs
- **Minor** (`x.+1.0`) — new features, new properties supported, behaviour changes
- **Major** (`+1.0.0`) — breaking changes
- Add a changelog entry describing what changed — do this **before** `appmixer pack && appmixer publish`

---

## Parallel execution

- **Step 2 (scaffold):** Single run, one long job
- **Step 3c (test/fix):** Sequential — port 2300 conflict if parallel
- **Step 3c (fix-only, no test run):** Can parallelize 3–5 at a time (no port conflict)
- **Step 4 (test flows):** Single run
- **Step 6 (run e2e):** Sequential per flow (start → wait → evaluate before next)
