---
name: build-connector
description: Build a new Appmixer connector end-to-end — gather requirements, research the API, scaffold and generate components, then drive testing and publishing via the appmixer CLI. Use when user wants to create/scaffold/build a new connector, add components to an existing one, continue an in-progress connector build, or discusses the connector development workflow. Triggers on "new connector", "create connector", "init connector", "build connector", "implement test()", "make trigger testable".
license: MIT
metadata:
  author: Appmixer
  version: "0.2.1"
  homepage: https://www.appmixer.com
  repository: https://github.com/Appmixer-ai/appmixer-skills
---

# Build Connector

Full end-to-end workflow for building an Appmixer connector: build → review →
test → publish. **You (the agent) do the scaffolding directly** — research the
API and write the files; review follows the `review-connector` skill and
testing the `test-connector` skill. No sub-agents, no install scripts.

## Prerequisites

- **Run from the connector workspace** — the current directory (or a parent)
  must contain `src/<vendor>/`; the connector is built at
  `src/<vendor>/<connector>/`. Only when running from elsewhere, point
  `APPMIXER_SKILL_CONNECTORS_DIR` at the workspace root (optional override).
  If no workspace exists yet, ask the user where to create one (`mkdir -p
  <dir>/src/<vendor>`) and continue from there.
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
| `10-trigger-test-method.md` | Trigger `test(context)` for Flow Test Mode — patterns per trigger group |

Consult these when generating code, debugging failures, or reviewing output.

## Pipeline Overview

```
Step 1: BUILD      → Requirements → research the API → scaffold + components  (this skill)
Step 2: REVIEW     → Audit against standards, fix findings              [review-connector]
Step 3a: TEST CLI  → Authenticate → component test loop → finalize      [test-connector]
Step 3b: TEST E2E  → E2E flows on a live instance                       [test-connector — coming]
Step 4: PUBLISH    → Lint, bundle bump, pack & publish via the appmixer CLI
```

Step 3b (generate → upload → run E2E flows) will become part of the
`test-connector` skill once its tooling lands in the appmixer CLI; until then
it lives on the `dev` branch of this repo and the pipeline here goes
3a → 4.

Progress is tracked in
`src/<vendor>/<connector>/artifacts/ai-artifacts/pipeline-state.json` —
read it to know where to resume if the pipeline was interrupted.

---

## Step 1: Build

### 1a. Requirements

Collect everything needed directly from the user and the service's public docs —
there is no external ticket to fetch. Ask for whatever is missing:

- **Connector name** — lowercase, alphanumeric (e.g. `pipedrive`). Ask if ambiguous.
- **Vendor** — the namespace directory under `src/` the connector belongs to
  (component names become `<vendor>.<connector>.<module>.<Component>`).
  Determine it in this order: (1) the user named it explicitly; (2) the cwd is
  inside `src/<vendor>/` — use that; (3) the workspace has exactly one vendor
  dir — use it; (4) otherwise ask the user (default suggestion: `appmixer`).
  Workspaces can hold several vendors side by side — never assume `appmixer`
  when other vendor dirs exist.
- **API docs URL** — the service's API reference (or an OpenAPI/Swagger spec).
- **Auth type** — API key, OAuth 2.0, … (derivable from the docs if not stated).
- **Component list** — which actions/triggers to build. If the user doesn't have
  one, propose a sensible set from the API docs (CRUD on the core entities +
  the most useful triggers) and confirm it before generating.

**Abort if the connector already exists** —
check `src/<vendor>/<connector>/service.json`. If it exists and the
user wants more components, use the "Adding New Components" flow below instead.

### 1b. Load the design rules

Read this skill's `references/` — at minimum: `01-connectors.md`,
`02-authentication.md`, `04-components.md`, `06-component-behavior.md`,
`07-component-types.md`, `08-best-practices.md`. These are the canonical
conventions everything below must follow. Use the complete example files in
`references/examples/` as scaffolding templates.

When a reference implementation helps (auth pattern, pagination, dynamic
sources), browse real connectors at
https://github.com/appmixer-ai/appmixer-connectors (`src/appmixer/<connector>/`).

### 1c. Research the API

Read the API documentation. For each component from 1a, identify: endpoint,
method, required/optional parameters, response shape, auth mechanism, and rate
limits. If the docs link to an OpenAPI/Swagger spec, read the relevant paths
from it.

### 1d. Scaffold core files

Under `src/<vendor>/<connector>/`:

1. **service.json** — name `<vendor>.<connector>`, label from the requirements,
   category `"applications"`, version `"1.0.0"`.
2. **bundle.json** — same name, version `"1.0.0"`,
   `changelog: { "1.0.0": ["Initial release."] }`.
3. **auth.js** — matching the auth type (see `02-authentication.md`).
4. **quota.js** — rate limits from the docs, or sensible defaults.

### 1e. Generate components

For each component, under `src/<vendor>/<connector>/core/<ComponentName>/`:

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
- **Every trigger gets a `test(context)` method** so Flow Test Mode can emit one
  realistic item — follow `references/10-trigger-test-method.md` (thin wrapper
  over the shared request+mapping path, read-only, no state writes, throw when
  no real example exists). Also use it when a user asks to add/retrofit
  `test()` on existing triggers.

### 1f. Summary

Report what was created (files, component count, auth type), then continue with
Step 2.

---

## Step 2: Review

Follow the `review-connector` skill — a read-only audit of every generated
component against the standards in `references/` (component.json contract,
behavior patterns, dynamic-source rules, trigger `test()` rules). Fix every
`error` finding by editing the component files directly; use judgement on
warnings. Re-run the review after fixes until clean.

---

## ⚠️ CLI Tests — Always Ask First

Before running `test-connector` (the plan step or the test loop), **always ask the user** whether to proceed.

Never run these automatically — they can take a long time and cost credits. Even when the pipeline suggests it as the next step, stop and confirm:

> "Ready to plan/run CLI tests for `<connector>`. Shall I go ahead?"

---

## Step 3a: Test CLI

### CLI-1. Auth (REQUIRED — human step)

Authenticate via the CLI — run `appmixer test auth login src/<vendor>/<connector>/auth.js`
(OAuth 2.0: add `-c <clientId> -s <clientSecret>` and optionally `-o scope1,scope2`).
The command opens a browser where the user enters the API key fields or completes the
OAuth consent — wait for them to finish. Never write `~/.config/configstore/appmixer.json`
by hand; the CLI stores extra keys (e.g. `authFilePath`) that hand-written entries miss.

### CLI-2. Test plan

**Ask user first** — confirm before running.

Follow Step 0a of the `test-connector` skill — read the connector's component
definitions and write an ordered `test-plan.json` directly (no sub-agent).

### CLI-3. Test + fix loop

**Ask user first** before each component test run.

For each component in the test plan, test sequentially (port 2300 conflict if
parallel) by following the `test-connector` skill (drives `appmixer test component`).

On failure → fix the component (edit `component.json` / behavior directly) → re-test. Max 3 iterations per component.

After 3 failures → report to user: skip or investigate manually.

### CLI-4. Finalize

Ask user about consistently failing components: remove or keep?

---

## Step 3b: Test E2E (coming to `test-connector`)

End-to-end testing — generate E2E test flows, publish to a live instance,
run and evaluate them — will fold into the `test-connector` skill once the
required tooling ships in the appmixer CLI. Until then those skills live on
the `dev` branch of this repo; on `main` continue with Step 4.

---

## Step 4: Publish

Run after Step 3a is complete (component list final).

1. **Lint + workspace validator** — catch errors early. This step is **optional
   and workspace-provided**: run it only when the workspace ships the tooling
   (an eslint config, a `scripts/validate.js` — the appmixer-connectors repo
   has both); a bare customer workspace has neither and that is fine — skip to
   publishing.
   ```bash
   # from the workspace root, only if the workspace provides these
   npm install   # only needed once
   ./node_modules/.bin/eslint src/<vendor>/<connector>/ --ext .js
   node scripts/validate.js --connector <connector>
   ```
   Fix every validator failure before proceeding (warnings: use judgement). Common
   lint issues: trailing spaces, `max-len` (120 char limit), extra blank lines.

2. **Publish** — follow the Git & Publish Rules below (bundle bump → pack →
   publish via the appmixer CLI).

---

## Adding New Components to an Existing Connector

When a connector already exists and you only need to add one or more new components (not rebuild from scratch), use a shorter flow:

1. **Research (optional)** — if the API endpoint is unknown, check the API docs.
2. **Scaffold the new component(s)** using the existing connector structure as a
   reference:
   - Copy a similar existing component directory
   - Update `component.json`, `component.js`, and any output/transform files to match the new endpoint
   - Register the component in the connector's `package.json` if needed
3. **Test + Fix** (same as Step 3a) — auth is usually already set up. Follow
   the `test-connector` skill to test only the new components. Max 3 iterations.
4. **Publish** — lint, commit, publish, push — same as Git & Publish Rules below.

---

## How the skills execute

No skill spawns a sub-agent or runs bundled scripts — every skill is pure
instructions you follow directly with your own tools (build-connector,
test-connector, review-connector), driving
the `appmixer` CLI where needed.

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

2. **Publish** to the Appmixer instance via the appmixer CLI (run from the
   workspace root; ask the user for the instance URL/login if the CLI is not
   configured yet):
   ```bash
   appmixer url <api-url>
   appmixer login <username>
   cd src/<vendor> && appmixer pack <connector>
   appmixer publish <vendor>.<connector>.zip
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

- **Step 1 (build):** Single run, one long job
- **Step 3a (test/fix):** Sequential — port 2300 conflict if parallel
- **Step 3a (fix-only, no test run):** Can parallelize 3–5 at a time (no port conflict)
