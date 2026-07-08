---
name: run-e2e-flows
description: Run E2E test flows on a live Appmixer instance and monitor results. Assumes the connector is already published (use upload-e2e-flows skill first). Handles start, log monitoring, pass/fail evaluation, and an iterative fix loop. Triggers on "run e2e", "execute flows", "run test flows", "e2e test", "validate connector live", "spusť testy".
---

# Run E2E Flows

Execute E2E test flows against a live Appmixer instance and evaluate results.

The heavy lifting is done by a **deterministic runner script** (explicit state
machine, no LLM). **You (the agent) are the fix loop**: when the runner exits
with a `NEEDS_FIX` brief, you diagnose it, edit the local flow JSON, and re-run
the script. The runner re-uploads the local file and rebinds accounts on every
run, so edit → re-run is the whole cycle.

**Assumes the connector is already published** (`appmixer pack` + `publish` via
the `upload-e2e-flows` skill). The runner uploads/updates the *flows* itself.

## Prerequisites

- **Node dependencies** — install once (idempotent, skips if already present):
  ```bash
  bash "${CLAUDE_PLUGIN_ROOT:-${VERO_SKILL_ROOT:-.}/..}/scripts/ensure-deps.sh"
  ```
- `APPMIXER_ENV` pointing to a `.env` file with `VERO_APPMIXER_BASE_URL`,
  `VERO_APPMIXER_USERNAME`, `VERO_APPMIXER_PASSWORD` (or those vars set directly)
- Connector published on the instance; an auth account exists for it
- **Design conventions** — the fix loop consults
  `<connectors>/.github/instructions/09-testing.md` (it lives in the connectors
  repo, not in this plugin). If `<connectors>/.github/instructions/` is missing,
  stop and tell the user they need an up-to-date `appmixer-connectors` checkout.

## The runner

```bash
node "${CLAUDE_PLUGIN_ROOT:-${VERO_SKILL_ROOT:-.}/..}/skills/run-e2e-flows/scripts/run.js" \
    <path-to-flow.json> [baseUrl]
```

One flow per invocation. It derives the connector and repo root from the flow
path, then: ensures E2E stores exist → createOrUpdates the flow from the local
JSON → rebinds accounts → starts → monitors logs → triages deterministically
(e.g. rebinds accounts on token errors and retries). Every state transition is
logged as `[FSM] FROM → TO (why)` — a run log reads as a narrative.

**Fail-fast error handling is enforced at upload:** the runner injects
`errorHandling: { autoRetry: false, onError: "stopFlow" }` into any component
that doesn't already carry it (flow-authored settings win), so the first
component error stops the flow instead of silently auto-retrying. On older
engines that reject the property, the runner strips it and re-uploads
automatically.

**Exit codes:**

| Code | Meaning | Your action |
|------|---------|-------------|
| `0` | Flow passed | Next flow |
| `1` | Hard failure (config error, retry budget spent, no account, **missing OAuth scopes**) | Report to user — a scope failure prints the exact scopes to re-authenticate with |
| `2` | `NEEDS_FIX` — structured brief printed as JSON | Fix the flow JSON, re-run (see below) |

The last line of every run is machine-parsable:
`RESULT | PASSED\|FAILED\|NEEDS_FIX | <flow name> | <designer URL>`.
The designer URL opens the flow in the instance UI (api host → my host convention;
override with `VERO_APPMIXER_UI_URL`).

**Auth failures are detected automatically:**
- **Preflight** — every bound account is validity-tested (`POST /accounts/:id/test`)
  before the first run; an expired/revoked token hard-fails immediately with the
  account id, before anything executes. ⚠️ This test runs the connector's
  `validateAccessToken`, which in some connectors (salesforce) only compares a stored
  expiry date — a dead token can still pass preflight and surface as runtime 401/403
  (`Bad_OAuth_Token`, `INVALID_SESSION_ID`) or as a flow-start 400 wrapping an inner
  401 from the trigger's `start()` call. In that case try the service's OTHER
  accounts and pin the working one.
- **Scopes** — a TokenError that persists after one account rebind means the bound
  account's token lacks the component's required scopes (read from its
  `component.json`). The runner hard-fails with the exact scopes — pass that to the
  user; only a human OAuth re-consent fixes it. After the re-consent, pin the new
  account with `VERO_APPMIXER_ACCOUNT_ID=<accountId>` if the old scope-less account
  still exists next to it.

**`VERO_APPMIXER_ACCOUNT_ID` is authoritative:** when set, it overrides
flow-authored `config.properties.account` values both in the uploaded flow
definition and in the auth grants — a stale account hardcoded in the flow JSON
can never shadow it. (Unpinned runs keep flow-authored accounts — that is how
multi-account flows work — but only when the ID exists on the target instance;
foreign/deleted IDs, e.g. from a flow downloaded off another tenant, are
ignored and a live account is bound instead.)

**Clean timeouts retry once:** a timeout with zero errors means an external event
(webhook notification) just hasn't arrived yet — latency varies from seconds to
many minutes. The runner re-runs once deterministically before reporting; only a
second clean timeout surfaces as NEEDS_FIX.

## The fix loop (you)

On exit code 2 the runner prints a `NEEDS_FIX` JSON brief: `reason`, `errors`
(componentType + message), `recentLogs`, `flowJsonPath`. Then:

1. **Diagnose from the brief.** Typical failure classes:
   - HTTP errors (4xx/5xx) from connector components
   - Assert failures (wrong field values, missing fields) — Assert output has
     `success` and `error` arrays
   - Variable reference errors (invalid paths in `config.transform.*` / `lambda`)
   - Component errors (bad config); `"Component error"` on ProcessE2EResults
     usually means an upstream Assert or AfterAll failed
   - `"timeout"` in AfterAll = not all Asserts fired — something upstream is stuck
   - **Flow start rejected: `Component transformation validation error` /
     `Malformed transformation`** (the response names no component) — some
     component's `source`/`config.transform` is keyed on a port name that is not
     one of its inPorts. Most components use `in`, but not all (salesforce
     CreateLead → `lead`, CreateContact → `contact`). Check every component's
     `component.json` inPorts; the `inport-key-match` validator catches this
     statically.
   - **Flow start rejected: 400 wrapping an inner 401/AxiosError with a service
     URL** — the engine called the service during start (trigger `start()`) with a
     dead/wrong account; see the auth notes above. `Cannot read properties of
     undefined (reading 'fn')` in an OLD component after a publish = stale
     per-version code snapshot — remove + republish that component (see
     upload-e2e-flows "Stale Component Definition / Code After Publish").
2. **Read the failing component's `component.json`** to confirm expected
   inputs/outputs before changing variable paths.
3. **Fix the flow JSON on disk** (`flowJsonPath` from the brief): variable paths,
   assert expressions, input mappings, modifiers. Consult
   `<connectors>/.github/instructions/09-testing.md` for flow design patterns.
4. **If the component source itself is broken**, fix it in the connector and
   re-publish (`appmixer pack && appmixer publish`) before re-running.
5. **Validate** the edited flow:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT:-${VERO_SKILL_ROOT:-.}/..}/skills/generate-E2E-test-flows/validate.js" <flow.json>
   ```
6. **Re-run the runner** with the same flow path.

### Fix rules (hard requirements)

- **Never delete and recreate flows** — the runner always updates in place.
- **Do NOT change the flow name or component IDs** — the name is the server-side
  identity; IDs are referenced by variable paths.
- **Removing a component or assert is a LAST RESORT.** Only when the underlying
  API feature is confirmed unsupported in this environment. If you do, report it
  loudly: `⚠️ REMOVED COMPONENT: <id> — <reason>` — never remove silently.
- Always read the flow JSON from disk before editing — never work from memory of
  a previous version.
- When fixing variable paths, verify the referenced component ID exists in the
  flow and the field matches the component's output schema.
- **Max 5 fix iterations per flow.** Still failing → report remaining errors to
  the user and stop.

## Running all flows of a connector

Iterate the runner over each flow file and collect the `RESULT |` lines:

```bash
for f in "$VERO_CONNECTORS_DIR"/src/appmixer/<connector>/artifacts/test-flows/test-flow-*.json; do
    node .../run-e2e-flows/scripts/run.js "$f" | tee -a /tmp/e2e-run.log
done
grep '^RESULT |' /tmp/e2e-run.log
```

Run flows **sequentially** — parallel runs against one instance cause noisy logs
and account contention. Apply the fix loop to each failing flow before moving on.

**Always end your report to the user with the summary table** built from the
`RESULT |` lines — one row per flow: name, status, designer URL.

## Flow Completion Detection

Flows are monitored via **log polling**, not flow stage:

- **ProcessE2EResults in logs** = flow completed. The runner stops the flow and parses results.
- **Component errors in logs** = tracked and reported. OnError/StopFlow errors are **ignored** (noisy infrastructure artifacts).
- E2E flows don't auto-stop after ProcessE2EResults — the runner handles stopping.

Do NOT use `OnError + StopFlow` components in test flows — they cause spurious lock errors on some instances and add noise to logs.

## Known Gotchas

### Stale logs from previous runs
Errors shown may be from **previous** runs. The runner filters by run start
timestamp, but when reading logs manually always check `gridTimestamp`.

### `GET /flows` default limit is 100
**Always use `limit=500`** in list queries: `GET /flows?filter=...&limit=500`.

### `GET /flows/:flowId` Elasticsearch errors
**Always use `?projection=stage` for status checks** and `?projection=flow` for the definition.

### Search/Find race conditions after Create
Many APIs have eventual consistency on search indexes. A record created 1 second ago may not appear in search results yet:
- **Best approach:** Search for a pre-existing test record instead of a just-created one
- **Alternative:** Add a `appmixer.utils.controls.CodeBlock` with `await new Promise(r => setTimeout(r, 5000))` as delay
- **Alternative:** Use GetById between Create and Find to add natural delay

### Duplicate records on re-runs
Previous test runs may leave records behind if cleanup failed:
1. Stop any running flows first
2. Check if the API rejects duplicates
3. Clean up leftover test data from previous runs via the connector's API

### CodeBlock output wraps results under `result`
`appmixer.utils.controls.CodeBlock` wraps the return value under a `result` field. Access it via `$.code-block-id.out.result`. Deep access like `$.code-block-id.out.result.field` does NOT work — return simple strings/numbers only.

### CodeBlock code syntax
CodeBlock runs in `isolated-vm`. Bare `return` statements are illegal. Use expressions directly (e.g., `'value-' + Date.now()`) or IIFEs — a single expression that evaluates to a value.

### Log parsing
The `/logs` API returns raw Elasticsearch hits. Error details are in `hits[]._source.err` as a **JSON string** (not object). Parse `err.response.data` for the actual error message.

### Deterministic test design
Tests must pass on repeated runs without input changes:
- **Create + Delete cleanup**: If the API rejects duplicates, the test MUST delete created resources at the end.
- **Unique inputs via modifiers**: Use `g_timestamp` or `g_uuid4` modifier functions for unique identifiers.
- **Avoid hardcoded dates**: Use `g_now` + `g_addTimeSpan` modifiers to compute future dates dynamically.

## Key API Endpoints

| Action | Method | Endpoint |
|--------|--------|----------|
| List E2E flows | GET | `/flows?filter=customFields.category:E2E_test_flow&limit=500` |
| Get flow status | GET | `/flows/:flowId?projection=stage` |
| Start flow | POST | `/flows/:flowId/coordinator` `{"command":"start"}` |
| Stop flow | POST | `/flows/:flowId/coordinator` `{"command":"stop"}` |
| Get logs | GET | `/logs?flowId=:flowId&from=0&size=100` |

## References

- **Flow design patterns**: `<connectors>/.github/instructions/09-testing.md` — read before diagnosing or fixing flows
- **API details**: `skills/_shared/appmixerApi/*.js` — the shared HTTP client library is the single source of truth for Appmixer API calls (auth, flows, accounts, logs, stores)
- **Triage rules**: `scripts/triage.js` — add deterministic rules there for repeatable failure classes (keeps fixes rare)
