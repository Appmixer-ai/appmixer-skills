---
name: test-connector
description: Test and validate an Appmixer connector — ordered test plan, a CLI component test+fix cycle, and E2E flow testing on a live instance (upload flows, run, evaluate, fix loop). Use when user wants to test a connector, plan testing, test a component, run E2E flows, upload flows, or validate it works. Triggers on "test connector", "run e2e", "upload flows", "execute test flows", "spusť testy".
license: MIT
metadata:
  author: Appmixer
  version: "0.2.2"
  homepage: https://www.appmixer.com
  repository: https://github.com/Appmixer-ai/appmixer-skills
---

# Test Connector

Tests a connector's components with real API calls via the **`appmixer` CLI**
and validates their output.

> **Scope:** this skill covers two testing modes:
>
> 1. **CLI component tests** — the workflow in this file: ordered test plan,
>    then a component test+fix cycle via `appmixer test component`.
> 2. **E2E flow testing on a live instance** — publish the connector and
>    prepare the instance (`references/12-e2e-upload.md`), then run and
>    evaluate the flows with the CLI's deterministic runner,
>    `appmixer flow run-e2e` (`references/13-e2e-run.md`). Flows are generated
>    during the build (`build-connector`, `references/11-e2e-flow-generation.md`
>    there). All E2E tooling ships with the `appmixer` CLI — this skill bundles
>    no scripts.
>
> **You (the agent) do this directly** — plan the test order, resolve
real inputs, run the CLI, interpret the output, fix on failure, and re-test.
There is no sub-agent to spawn.

## Prerequisites

- **`appmixer` CLI** — installed and configured (`appmixer url` + login). This is
  an external tool the skill drives; it is a prerequisite, not a bundled dependency.
- **Connector npm dependencies** — connectors may declare their own runtime deps
  (e.g. `request-promise` in `microsoft/`); a missing one makes
  `appmixer test component` fail with `Cannot find module`. Install them once per
  workspace before testing — if the workspace ships `scripts/npm_install.js`
  (the appmixer-connectors repo does), run it from the workspace root; otherwise
  `npm install` in each connector dir that has a `package.json`:
  ```bash
  node scripts/npm_install.js
  ```
- **Auth credentials** — the connector must have valid auth in
  `~/.config/configstore/appmixer.json` (see Step 0).
- **Run from the connector workspace** — the current directory (or a parent)
  must contain `src/<vendor>/`; components live at
  `src/<vendor>/<connector>/core/<Component>/`. Only when running from
  elsewhere, point `APPMIXER_SKILL_CONNECTORS_DIR` at the workspace root
  (optional override). `<vendor>` is the namespace directory under `src/` — `appmixer` is only the
  default; a workspace can hold several vendors side by side. Bare connector
  names are searched across all vendor dirs; when ambiguous, qualify as
  `<vendor>/<connector>`.
  Note: the auth configstore keys (`<vendor>:<connector>`) use the vendor from
  the connector's `service.json` name.
- **Test plan** — a `test-plan.json` (create it in Step 0a below if absent).

## The test command

Run one component test with real inputs:

```bash
appmixer test component src/<vendor>/<connector>/core/<Component> \
  -i '{"in": {<flat input fields>}}'
```

- Inputs are wrapped in an `"in"` object matching the component's `inPorts`/inspector fields.
- Exit code `0` = success (output is in stdout); `1` = failure (read stdout/stderr — the error usually names the exact problem).
- **Dynamic output schema** (List/Find with `outputType`): add
  `-p '{"generateOutputPortOptions": true}'` with the same inputs to get the
  schema options instead of live data.
- Run **one test at a time** and wait for the result before the next.

## Step 0a: Create the test plan (if missing)

If `src/<vendor>/<connector>/artifacts/ai-artifacts/test-plan.json`
does not exist, create it first — an ordered plan with dependency analysis for
all components. **Only read** component files here — do not run, validate, or
authenticate anything.

1. **List the components.** Enumerate the directories with a `component.json`
   under `src/<vendor>/<connector>/` (typically under `core/`).
2. **Understand each component.** Read every `component.json` (and its behavior
   `.js` when needed) to learn what it does, its inputs, and its outputs.
3. **Design the test sequence** mimicking how users actually use the service:
   - **Test dependencies first** — components that create resources come before
     those that read, update, or delete them.
   - **Reuse test data** — outputs from earlier tests (e.g. a created ID) feed
     inputs of later tests.
   - **Follow natural workflows** — order components the way a user would use
     them. Example (Google Calendar): `CreateCalendar → ListCalendars →
     CreateEvent → FindEvents → UpdateEvent → DeleteEvent → DeleteCalendar`.
4. **Write the plan** to `artifacts/ai-artifacts/test-plan.json` — an ordered
   array, one entry per component:

   ```json
   {
     "plan": [
       { "name": "ComponentName", "completed": false, "result": {} }
     ]
   }
   ```

   Report: `OK: Test plan with N component(s).` If the user only wanted the
   plan, stop here.

## Step 0: Pre-flight auth check (MANDATORY)

Before testing, verify auth exists — running tests without valid auth wastes time.

```bash
python3 -c "
import json, sys
try:
    d = json.load(open('$HOME/.config/configstore/appmixer.json'))
    fields = d.get('<vendor>:<connector>', {}).get('authFields', {})
    if not fields:
        print('No auth credentials for <connector>. Ask user for API key/credentials.'); sys.exit(1)
    print('Auth found:', list(fields.keys()))
except FileNotFoundError:
    print('appmixer.json not found. Set up auth first.'); sys.exit(1)
"
```

If auth is missing: **set it up via the CLI — never write `appmixer.json` by hand**
(the CLI stores more than `authFields` — e.g. `authFilePath` — and hand-written
entries break `appmixer test component` in non-obvious ways). Run:

```bash
# API key connectors:
appmixer test auth login src/<vendor>/<connector>/auth.js

# OAuth 2.0 connectors (client credentials required, scope optional):
appmixer test auth login src/<vendor>/<connector>/auth.js \
  -c <clientId> -s <clientSecret> [-o scope1,scope2]
```

The command starts a local server and opens a browser where the user enters the
auth fields (API key) or completes the OAuth consent — this part is the user's,
so tell them what to expect. You can prepare and run the command for them, but
wait until it exits before testing. For OAuth this browser flow is the ONLY way
to obtain tokens. Verify success by re-running the pre-flight check above.

## Testing workflow

### Step 1: Resolve ALL input dependencies BEFORE testing

The most critical step. Provide **real, valid values for EVERY input** — never
guess IDs or use placeholders like `"1"`, `"test-id"`.

For each input in the component's `component.json`:

- **Check auth context first** — read `appmixer.json` `authFields`; they often hold
  real values (`locationId`, `accountId`, …).
- **Reuse earlier test outputs** — if a prior component (e.g. `CreateDeal`) was
  tested, its output (in `test-plan.json`) may contain the IDs you need.
- **Entity-reference inputs** (names ending in `_id` or referencing another entity —
  `view_id`, `owner_id`, `stage_id`, `pipeline_id`, `account_id`, …) almost always
  need a real ID from the service. Resolve them **dynamically** — never hardcode
  tenant-specific IDs from previous outputs:
  1. **Find components** (`FindXxx`) — preferred, support filtering
  2. **List components** (`ListXxx`) — fallback
  3. **Get components** (`GetXxx`) — if you already have an ID
  4. **Create components** (`CreateXxx`) — create the entity if nothing can discover it

  Examples: `owner_id` → FindUsers/ListUsers; `stage_id` → FindStages/ListDealStages;
  `pipeline_id` → FindPipelines; `account_id` → FindAccounts.
- **Inspector `source`** — if an input in `inspector.inputs` has a `source`, it names
  exactly which component provides valid options; call it.
- **Simple inputs** (`name`, `email`, `amount`, …) — use realistic test data.

### Step 2: Gather dependency values

Run the appropriate Find/List/Get/Create component (via the test command) for each
entity-reference input; extract the needed ID (usually the first item).

### Step 3: Run the actual test

Run the component with ALL gathered values plus realistic data for simple inputs.

### Step 4: Validate the output

- Determine pass/fail (criteria below).
- **Validate the output shape** against the component's declared output:
  - **Static schema** — `outPorts[].schema`: check the output matches (types,
    required fields); flag undeclared fields.
  - **Dynamic schema** — call the test again with `-p '{"generateOutputPortOptions": true}'`
    and check the generated options.
  - **No schema** — if the component produces output but declares no schema, that's a
    finding: the `component.json` should add one.

## Pass / fail criteria

A test **passes** only if a run with `exitCode 0` sends **meaningful data to the
`out` port**:

- Real data on `out` (not `{}`, not an empty `result: []`), **or**
- A message to the `notFound` port (a valid negative result).

A run that only generates a schema (`generateOutputPortOptions`) does **not** count
as a meaningful test on its own. `exitCode != 0`, or only empty `{}` on `out`, is a
**failure**.

Record the result (status, reason) for the component in `test-plan.json`.

## Critical rules

- Read auth context FIRST; never guess or use placeholder IDs.
- Resolve ALL entity-reference inputs via Find/List/Get/Create before testing;
  prefer Find over List.
- Never hardcode tenant-specific IDs from previous outputs — re-resolve dynamically.
- Do NOT test required-field validation (unnecessary failures); always pass required fields.
- One test at a time; wait for each result.
- On HTTP 400/422, READ the error — it usually names the missing/invalid field. Do
  NOT blindly retry with the same inputs.
- When **fixing** a component, first read 2–3 sibling components to match the
  connector's established patterns (HTTP client, auth, output). Consistency within
  the connector outweighs any single best practice. Preserve icons; only edit
  `component.json` / behavior `.js`.
- **STOP** if the test fails and you're unsure how to fix it; if you know the fix,
  apply it and re-test.
- **STOP immediately** on `[ERROR]: Mongo DB not connected!` or
  `[ERROR]: Request failed with status code 403!`.

## Known CLI limitations (version ≤ 2.3.4)

Check the installed version with `appmixer --version`. On 2.3.4 and older:

- **`context.staticCache` / `context.lock` are not implemented** — any component
  code path that touches them fails with `TypeError: Missing static cache` (thrown
  when `.get()`/`.set()` is called, not on property access). This is a CLI
  limitation, NOT a component bug: connectors MUST still implement the caching
  patterns required by the design rules (dynamic sources, `getProjectApiToken`-style
  lookups). Until the CLI ships staticCache support, cached code paths simply
  cannot be exercised via `appmixer test component` — test the component's
  non-cached path if it has one, otherwise record the component as
  `not-cli-testable (staticCache)` in `test-plan.json` and verify it on a live
  instance instead. Do NOT rewrite a component just to dodge this error.
- **No `--test` flag** — a trigger's `test(context)` method cannot be invoked via
  the CLI. Verify trigger behavior by running the real `tick()` loop (run the
  component with `-p` properties and a short `-t` tick period, create a matching
  resource mid-run via the service API, and watch for the emitted message);
  `test()` itself is then verified by code review or Flow Test Mode on a live
  instance.

## Troubleshooting

| Error | Solution |
|-------|----------|
| **404 Not Found** | Resolve a real ID via a Find/List component (prefer Find). |
| **400 / Invalid ID** | The ID is wrong or tenant-specific — re-resolve via Find/List. |
| **Validation Error** | Check `component.json` input requirements; adjust test data. |
| **Auth Failed (401/403)** | Verify the connector's auth is configured (Step 0). |
| **Rate Limit** | Add delays between tests. |
| **Output Schema Mismatch** | Actual output ≠ declared schema — fix the component logic or the schema. |
| **Cannot read properties of undefined (reading 'execute')** | Read 2–3 sibling components and follow their established pattern. |

## E2E flow testing

When the user wants end-to-end validation on a live Appmixer instance (not just
CLI component tests), follow the two references shipped with this skill:

1. **Publish & prepare** — `references/12-e2e-upload.md`: publish the connector
   (`appmixer pack` + `publish`) and verify the auth account; flow upload,
   E2E stores and account binding are handled by the runner itself.
2. **Run** — `references/13-e2e-run.md`: execute the flows from
   `src/<vendor>/<connector>/artifacts/test-flows/` with the CLI's
   deterministic runner (`appmixer flow run-e2e`), evaluate results, and drive
   the fix loop (edit flow JSON → re-run; `references/09-testing.md` holds the
   flow design rules the fixes must follow).

Flow JSONs are produced during the build by `build-connector`
(its `references/11-e2e-flow-generation.md`); `appmixer flow validate` checks
them before upload and after every fix.

## After changes

If testing leads to fixes:

1. **Commit** to the appropriate branch in the workspace repo (feature/fix
   branch — never `dev`/`main`).
2. **Publish** the connector module (`appmixer pack` + `appmixer publish` via the configured appmixer CLI).
3. **Push** the branch — confirm the push target (remote URL + branch) with the
   user before the first push of the session; never force-push. If `origin` is
   the shared upstream and the user hasn't confirmed direct write access,
   propose a fork (`gh repo fork --remote`) and push there.
