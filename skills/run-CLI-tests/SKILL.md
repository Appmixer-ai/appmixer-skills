---
name: run-CLI-tests
description: Test and validate Appmixer connector components. Use when user wants to test a component, validate it works, or run test+fix cycle on components.
license: MIT
metadata:
  author: Appmixer
  version: "0.1.9"
  homepage: https://www.appmixer.com
  repository: https://github.com/Appmixer-ai/appmixer-skills
---

# Test Connector Component

Tests a component with real API calls via the **`appmixer` CLI** and validates
its output. **You (the agent) do this directly** — resolve real inputs, run the
CLI, interpret the output, fix on failure, and re-test. There is no sub-agent to
spawn.

## Prerequisites

- **`appmixer` CLI** — installed and configured (`appmixer url` + login). This is
  an external tool the skill drives; it is a prerequisite, not a bundled dependency.
- **Connector npm dependencies** — connectors may declare their own runtime deps
  (e.g. `request-promise` in `microsoft/`); a missing one makes
  `appmixer test component` fail with `Cannot find module`. Install them once per
  checkout before testing:
  ```bash
  cd "$APPMIXER_SKILL_CONNECTORS_DIR" && node scripts/npm_install.js
  ```
- **Auth credentials** — the connector must have valid auth in
  `~/.config/configstore/appmixer.json` (see Step 0).
- **Connector location** — set `APPMIXER_SKILL_CONNECTORS_DIR` to the `appmixer-connectors`
  checkout root, or run from inside the repo. When neither applies, read it
  from `~/.config/appmixer-skills/env`; if that file is missing too, ask the
  user for the path and write it there (KEY=value, `chmod 600`). Components live at
  `<connectors>/src/appmixer/<connector>/core/<Component>/`.
- **Test plan** — a `test-plan.json` (run the `plan-CLI-tests` skill first if absent).

## The test command

Run one component test with real inputs:

```bash
appmixer test component <connectors>/src/appmixer/<connector>/core/<Component> \
  -i '{"in": {<flat input fields>}}'
```

- Inputs are wrapped in an `"in"` object matching the component's `inPorts`/inspector fields.
- Exit code `0` = success (output is in stdout); `1` = failure (read stdout/stderr — the error usually names the exact problem).
- **Dynamic output schema** (List/Find with `outputType`): add
  `-p '{"generateOutputPortOptions": true}'` with the same inputs to get the
  schema options instead of live data.
- Run **one test at a time** and wait for the result before the next.

## Step 0: Pre-flight auth check (MANDATORY)

Before testing, verify auth exists — running tests without valid auth wastes time.

```bash
python3 -c "
import json, sys
try:
    d = json.load(open('$HOME/.config/configstore/appmixer.json'))
    fields = d.get('appmixer:<connector>', {}).get('authFields', {})
    if not fields:
        print('No auth credentials for <connector>. Ask user for API key/credentials.'); sys.exit(1)
    print('Auth found:', list(fields.keys()))
except FileNotFoundError:
    print('appmixer.json not found. Set up auth first.'); sys.exit(1)
"
```

If auth is missing: **STOP and ask the user for credentials.** To save them, add an
entry to `appmixer.json`:

```json
{ "appmixer:<connector>": { "authFields": { "apiKey": "..." }, "profileInfo": {}, "accountName": "test" } }
```

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

## After changes

If testing leads to fixes:

1. **Commit** to the appropriate branch in `appmixer-connectors` (feature/fix
   branch — never `dev`/`main`).
2. **Publish** the connector module (`appmixer pack` + `appmixer publish` — credentials from the `APPMIXER_SKILL_*` env vars / `$APPMIXER_ENV` file).
3. **Push** the branch — confirm the push target (remote URL + branch) with the
   user before the first push of the session; never force-push. If `origin` is
   the shared upstream and the user hasn't confirmed direct write access,
   propose a fork (`gh repo fork --remote`) and push there.
