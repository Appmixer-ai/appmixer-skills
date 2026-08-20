# Run E2E Flows

Execute E2E test flows against a live Appmixer instance and evaluate results.

The heavy lifting is done by the **`appmixer e2e` commands** built into the
appmixer CLI (deterministic, no LLM). **You (the agent) are the fix loop**:
when `appmixer e2e run --fix` exits with a `NEEDS_FIX` brief, you diagnose it,
edit the local flow JSON, re-import it, and re-run. Uploading, store setup and
account binding are `appmixer e2e import`'s job; `appmixer e2e run` only runs
a flow that already lives on the instance.

**Assumes the connector is already published** (`appmixer pack` + `publish` per
`12-e2e-upload.md`) and the flows are imported (`appmixer e2e import`, also in
`12-e2e-upload.md`).

## Prerequisites

- **`appmixer` CLI** — installed (`npm i -g appmixer`) at version **2.6.0 or
  newer** (check with `appmixer e2e run --help`). The ONLY dependency — no
  other tooling, no required environment variable.
- **CLI configured** — `appmixer url` + `appmixer login` as the e2e user (see
  `12-e2e-upload.md` Prerequisites; that doc also lists the optional
  `APPMIXER_TOKEN`/`APPMIXER_SKILL_*` env overrides for CI).
- Connector published on the instance; an auth account exists for it
- Flows imported (`appmixer e2e import` — see `12-e2e-upload.md`)
- **Design conventions** — the fix loop consults
  `references/09-testing.md` in this skill's directory (no setup needed).

## The runner

```bash
appmixer e2e run <flowId> [--fix] [--max-attempts <n>] [--timeout <seconds>] [--json]
```

The argument is a **flow ID on the instance** — get it from
`appmixer e2e list -c <connector-ref> --json` (connector refs look like
`appmixer:todoist` or `appmixer:google:gdrive`). Options:
`--fix` (enable the deterministic fix loop — use it in agent workflows),
`--max-attempts <n>` (deterministic fix attempts, `--fix` only, default 5),
`--timeout <seconds>` (per-run completion timeout, default 480), `--json`
(machine-readable result object on the last line).

The runner starts the flow, monitors **the logs of the current run only** (the
run boundary is anchored on the server's own log timestamps, so previous runs
can never leak into the result), waits for completion, and reports OK or the
list of errors. With `--fix` it also triages failures deterministically —
rebinds accounts on token errors, re-runs on transient infra failures — and
emits a structured FIX BRIEF when no deterministic rule matches.

**Fail-fast error handling is enforced at import:** `appmixer e2e import`
injects `errorHandling: { autoRetry: false, onError: "stopFlow" }` into any
component that doesn't already carry it (flow-authored settings win), so the
first component error stops the flow instead of silently auto-retrying. On
older engines that reject the property, the import strips it and re-uploads
automatically.

**Exit codes:**

| Code | Meaning | Your action |
|------|---------|-------------|
| `0` | Flow passed | Next flow |
| `1` | Failed — errors/timeout; with `--fix` also: config error, retry budget spent, no account, **missing OAuth scopes** | Report to user — a scope failure prints the exact scopes to re-authenticate with |
| `2` | `NEEDS_FIX` — structured brief printed as JSON (`--fix` only) | Fix the flow JSON, re-import, re-run (see below) |

The last line of every run is machine-parsable:
`RESULT | PASSED\|FAILED\|NEEDS_FIX | <flow name> | <designer URL>`.
The designer URL opens the flow in the instance UI. It is built from
`APPMIXER_SKILL_UI_URL` (no host derivation from the API URL); when unset, the
runner prints the flowId instead of a link. Progress output goes to stderr;
results (`RESULT |` line, FIX BRIEF, `--json` payload) go to stdout.

**Unbound accounts fail fast:** without `--fix`, the runner refuses to start a
flow whose connector components have no valid account bound and tells you to
run `appmixer e2e import` (which binds accounts and validity-tests them).

**Auth failures are detected automatically:**
- **Preflight at import** — every bound account is validity-tested
  (`POST /accounts/:id/test`) by `appmixer e2e import`; an expired/revoked token
  fails the import with the account id, before anything runs. ⚠️ This test runs
  the connector's `validateAccessToken`, which in some connectors (salesforce)
  only compares a stored expiry date — a dead token can still pass preflight and
  surface as runtime 401/403 (`Bad_OAuth_Token`, `INVALID_SESSION_ID`) or as a
  flow-start 400 wrapping an inner 401 from the trigger's `start()` call. In
  that case try the service's OTHER accounts and pin the working one.
- **Scopes (`--fix`)** — a TokenError that persists after one account rebind
  means the bound account's token lacks the component's required scopes (read
  from its `component.json`). The runner hard-fails with the exact scopes —
  pass that to the user; only a human OAuth re-consent fixes it. After the
  re-consent, pin the new account with `appmixer e2e import --account
  <accountId>` if the old scope-less account still exists next to it.

**A pinned account is authoritative:** with `appmixer e2e import --account
<accountId>` (or the `APPMIXER_SKILL_ACCOUNT_ID` env override), the import
overrides flow-authored `config.properties.account` values both in the
uploaded flow definition and in the auth grants — a stale account hardcoded in
the flow JSON can never shadow it. (Unpinned imports keep flow-authored
accounts — that is how multi-account flows work — but only when the ID exists
on the target instance; foreign/deleted IDs, e.g. from a flow exported off
another tenant, are ignored and a live account is bound instead.)

**Clean timeouts are triaged by flow type (`--fix`):** a timeout with zero
errors means some Assert never fired.
- **Flow with an external trigger** (a sourceless non-utils component): the event
  just may not have arrived yet — latency varies from seconds to many minutes.
  The runner re-runs once deterministically; only a second clean timeout
  surfaces as NEEDS_FIX.
- **OnStart-only flow** (every component wired): nothing can "arrive later", so
  the runner does NOT retry — it reports NEEDS_FIX immediately with
  `assertsFired`/`assertsSilent` in the brief. A silent assert points at its
  upstream: typically a per-record `outputType` that emitted NOTHING on an empty
  result, or a link/variable referencing a non-existent outPort (run the
  `outport-exists` / `outputtype-fanout` validators on the flow).

**Transient infra errors re-run once (`--fix`):** errors matching quota-server /
ECONNREFUSED / ETIMEDOUT patterns (e.g. `Error while calling quota server:
connect ECONNREFUSED …`) trigger one plain re-run (triage rule
`infra-transient`); if the error repeats, the runner hard-fails with an
instance-outage message instead of burning the fix budget.

**A killed runner stops the flow:** on runner timeout, SIGINT or SIGTERM the
runner stops the flow (best-effort, 10 s cap) before exiting, so no run leaks a
running flow with live trigger subscriptions.

**Overall runner timeout is `AGENT_TIMEOUT_MS` (default 10 min).** With two
482 s WAIT windows plus stop overhead, the default expires DURING the second
window — an external event arriving after ~9 min is lost to "Runner timeout
exceeded". For trigger flows waiting on slow external events (manual
storefront/UI steps, provider-side latency in the tens of minutes), export
`AGENT_TIMEOUT_MS=1500000` (or more) before invoking the runner.

## The fix loop (you)

On exit code 2 (`--fix`) the runner prints a `NEEDS_FIX` JSON brief: `reason`,
`errors` (componentType + message), `recentLogs` (current-run only), `flowId`,
`flowName`, `connector`, and — for clean timeouts —
`assertsFired`/`assertsSilent` (component IDs). The local file lives at
`src/<vendor>/<connector>/artifacts/test-flows/` (the `connector` field of the
brief maps `appmixer:google:gdrive` → `src/appmixer/google/gdrive/`); match it
by the flow name. Then:

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
     `12-e2e-upload.md` "Stale Component Definition / Code After Publish").
2. **Read the failing component's `component.json`** to confirm expected
   inputs/outputs before changing variable paths.
3. **Fix the flow JSON on disk**: variable paths, assert expressions, input
   mappings, modifiers. Consult `references/09-testing.md` for flow design
   patterns.
4. **If the component source itself is broken**, fix it in the connector and
   re-publish (`appmixer pack && appmixer publish`) before re-running.
5. **Validate** the edited flow:
   ```bash
   appmixer e2e validate <flow.json>
   ```
6. **Re-import and re-run:**
   ```bash
   appmixer e2e import <flow.json>
   appmixer e2e run <flowId> --fix
   ```
   (Import updates the flow in place by identity — the flowId stays the same.)

### Fix rules (hard requirements)

- **Never delete and recreate flows** — `appmixer e2e import` always updates in
  place by identity.
- **Do NOT change the flow name or component IDs** — the name is part of the
  flow's identity (`customFields.name`); IDs are referenced by variable paths.
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

Import the directory once, then run each flow by ID:

```bash
appmixer e2e import src/<vendor>/<connector>/artifacts/test-flows
appmixer e2e list -c <vendor>:<connector> --json    # → [{ flowId, ... }, ...]
for id in $(appmixer e2e list -c <vendor>:<connector> --json | jq -r '.[].flowId'); do
    appmixer e2e run "$id" --fix | tee -a /tmp/e2e-run.log
done
grep '^RESULT |' /tmp/e2e-run.log
appmixer e2e results -c <vendor>:<connector> --json   # stored per-test-case results; exit 1 = failures
```

Never run flows **in parallel** — parallel runs against one instance cause
noisy logs and account contention. Apply the fix loop to each failing flow
before moving on.

**Always end your report to the user with the summary table** built from the
`RESULT |` lines — one row per flow: name, status, designer URL.

## Flow Completion Detection

Flows are monitored via **log polling**, not flow stage:

- **ProcessE2EResults in logs** = flow completed. The runner stops the flow and parses results.
- **Component errors in logs** = tracked and reported. OnError/StopFlow errors are **ignored** (noisy infrastructure artifacts).
- E2E flows don't auto-stop after ProcessE2EResults — the runner handles stopping.
- Only logs of **the current run** count: the run boundary is the newest log
  timestamp that existed before start (+1 ms), taken from the server's own
  clock; hits without a parseable timestamp are excluded.

Do NOT use `OnError + StopFlow` components in test flows — they cause spurious lock errors on some instances and add noise to logs.

## Known Gotchas

### Polling triggers baseline on their first tick — the flow must be RUNNING when the event lands
A `tick()` trigger records the current item set on its first poll after flow
start and only emits items that appear LATER. The runner stops the flow between
its retry windows, so an event that becomes visible during that stopped gap is
swallowed by the next run's fresh baseline — with slow provider latency (e.g.
Shopify lists an abandoned checkout ~10 min after the customer leaves) the
runner's stop/start windows can miss it forever. Workaround for such flows:
start the flow directly (`appmixer flow start <flowId>`), keep it running until
the event is visible, verify the emission in `/logs` manually, then stop the
flow (`appmixer flow stop <flowId>`). Note the flow-authored AfterAll timeout
still applies — a very late event yields a recorded "timeout" result even
though the trigger emission proves the component works; restart the flow just
before the event if you need a clean PASSED record.

### Webhook registration fails with 422/404 "Invalid topic"
Two distinct causes, in triage order: (1) the auth token lacks the topic's
required scope — fix by granting the scope upstream; (2) the topic does not
exist on that API surface — some providers expose certain topics only via a
different registration channel (Shopify: most `returns/*` topics are
GraphQL-`webhookSubscriptionCreate`-only; REST rejects them). Probe the topic
with a direct API call before touching the component code.

### Stale logs from previous runs
The runner filters strictly by a server-side run boundary — errors from
previous runs (including log entries with no timestamp) cannot appear in its
results or the FIX BRIEF. When reading `/logs` **manually**, always check
`gridTimestamp` yourself.

### `GET /flows` default limit is 100
**Always use `limit=500`** in list queries: `GET /flows?filter=...&limit=500`.
(`appmixer e2e list` does this for you.)

### `GET /flows/:flowId` Elasticsearch errors
**Always use `?projection=stage` for status checks** and `?projection=flow` for the definition.

### Search/Find race conditions after Create
Many APIs have eventual consistency on search indexes. A record created 1 second ago may not appear in search results yet:
- **Best approach:** Search for a pre-existing test record instead of a just-created one
- **Alternative:** Insert `appmixer.utils.timers.Wait` with `interval: "1m"` (minimum unit is minutes). CodeBlock CANNOT delay — it runs synchronously in isolated-vm (`evalSync`), `await`/`setTimeout`/Promises are unavailable and error out.
- **Alternative:** Use GetById between Create and Find to add natural delay

### Duplicate records on re-runs
Previous test runs may leave records behind if cleanup failed:
1. Stop any running flows first
2. Check if the API rejects duplicates
3. Clean up leftover test data from previous runs via the connector's API

### CodeBlock output wraps results under `result`
`appmixer.utils.controls.CodeBlock` wraps the return value under a `result` field. Access it via `$.code-block-id.out.result`. Deep access like `$.code-block-id.out.result.field` does NOT work — return simple strings/numbers only.

### CodeBlock code syntax
CodeBlock runs in `isolated-vm`, **synchronously** (`evalSync`) — no `await`, no `setTimeout`, no Promises. Input variables are exposed on **`$data`** (e.g. `$data.body`), not as bare identifiers. Bare `return` statements are illegal. Use expressions directly (e.g., `'value-' + Date.now()`) or IIFEs — a single expression that evaluates to a value.

### Assert failures do NOT stop the flow — and `equal` reads `expected`, not `value`
A failed assertion is logged in the Assert result payload (`error[]`) as a plain info message; the flow continues and ProcessE2EResults still completes. The runner scans Assert payloads (`collectAssertFailures`) so these fail the run — but when reading logs manually, always check the Assert `success`/`error` arrays, not just component errors. Common authoring bug: `{"assertion": "equal", "field": ..., "value": "200"}` — the Assert component reads the comparison value from the key **`expected`**; with `value` it compares against `undefined` and fails with the misleading message "expected undefined to equal 200".

### Log parsing
The `/logs` API returns raw Elasticsearch hits. Error details are in `hits[]._source.err` as a **JSON string** (not object). Parse `err.response.data` for the actual error message.

### Deterministic test design
Tests must pass on repeated runs without input changes:
- **Create + Delete cleanup**: If the API rejects duplicates, the test MUST delete created resources at the end.
- **Unique inputs via modifiers**: Use `g_timestamp` or `g_uuid4` modifier functions for unique identifiers.
- **Avoid hardcoded dates**: Use `g_now` + `g_addTimeSpan` modifiers to compute future dates dynamically.

## Key API Endpoints

Prefer the CLI (`appmixer e2e list/run/results`, `appmixer flow start/stop`);
raw endpoints for manual debugging:

| Action | Method | Endpoint |
|--------|--------|----------|
| List E2E flows | GET | `/flows?filter=customFields.category:E2E_test_flow&limit=500` |
| Get flow status | GET | `/flows/:flowId?projection=stage` |
| Start flow | POST | `/flows/:flowId/coordinator` `{"command":"start"}` |
| Stop flow | POST | `/flows/:flowId/coordinator` `{"command":"stop"}` |
| Get logs | GET | `/logs?flowId=:flowId&from=0&size=100` |

## References

- **Flow design patterns**: `references/09-testing.md` — read before diagnosing or fixing flows
- **API details**: the appmixer CLI's `src/api/` modules are the single source of truth for Appmixer API calls (auth, flows, accounts, logs, stores); raw endpoints are listed in the table above
- **Triage rules**: `src/e2e-runner/triage.js` in the appmixer CLI repo — add deterministic rules there for repeatable failure classes (keeps fixes rare)
