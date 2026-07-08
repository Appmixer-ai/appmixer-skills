---
name: generate-E2E-test-flows
description: Generate E2E test flows for an Appmixer connector. Use when user wants to create end-to-end tests, generate test flows, or after component testing is complete.
license: MIT
metadata:
  author: Appmixer
  version: "0.1.1"
  homepage: https://www.appmixer.com
  repository: https://github.com/Appmixer-ai/appmixer-skills
---

# E2E Test Flows

Generate E2E test flow JSON files for a connector's components. **You (the agent)
write the flows directly** — there is no separate sub-agent. After writing them
you run a deterministic validator and fix anything it flags, looping until clean.

> **Paths:** `$APPMIXER_SKILL_ROOT` points at the skills directory
> (`.../workspace-vero/skills`), set by the runtime (openclaw box or the CI
> workflow). When running as a Claude Code plugin `APPMIXER_SKILL_ROOT` is not set —
> resolve it from the plugin root by prefixing commands with:
> `export APPMIXER_SKILL_ROOT="${APPMIXER_SKILL_ROOT:-$CLAUDE_PLUGIN_ROOT/skills}"`.
> The validator (`validate.js`) needs Node deps (`ajv`) which are
> installed via `npm ci` in `workspace-vero`.

## Setup (first run)

Install Node dependencies (idempotent, skips if already present):

```bash
bash "${CLAUDE_PLUGIN_ROOT:-${APPMIXER_SKILL_ROOT:-.}/..}/scripts/ensure-deps.sh"
```

## How it works

1. **Pick the components** to cover (one trigger or action per flow; default: all
   testable components of the connector).
2. **Read the canonical template** `$APPMIXER_SKILL_ROOT/generate-E2E-test-flows/test-flow-template.json`
   — copy its structure (OnStart → setup → component-under-test → Assert →
   AfterAll → ProcessE2EResults). It is a complete, working example.
3. **Read each component's `component.json`** under
   `$APPMIXER_SKILL_CONNECTORS_DIR/src/appmixer/<connector>/...` to get the REAL input
   schema and output port name(s) — do not guess them.
4. **Write** each flow to
   `$APPMIXER_SKILL_CONNECTORS_DIR/src/appmixer/<connector>/artifacts/test-flows/test-flow-<name>.json`.
5. **Validate**:
   ```bash
   node "$APPMIXER_SKILL_ROOT/generate-E2E-test-flows/validate.js" \
     "$APPMIXER_SKILL_CONNECTORS_DIR/src/appmixer/<connector>/artifacts/test-flows"
   ```
   Fix every reported failure and re-run until it prints `Validation passed`.
   Warnings are informational (improve them when easy, but they don't block).

## Critical rules (the validator enforces these)

0. **Every component MUST carry fail-fast error handling** —
   `"errorHandling": { "autoRetry": false, "onError": "stopFlow" }` on every
   component in the flow (the template already does this). **Why it matters:**
   without it the engine silently auto-retries a failing component with backoff
   while the flow keeps "running" — failures surface late and
   non-deterministically. With it, the first component error stops the flow
   immediately: the run has a clear terminal state, logs carry the single real
   error, and the runner detects the failure in seconds. Enforced by
   `error-handling`.

0b. **Component ids MUST be unique UUIDs** — every key under `flow` (and every
   reference to it in `source.in`, `config.transform.in`, and `$.<id>.<port>`
   variable paths) must be a freshly generated UUID (`crypto.randomUUID()`), NOT
   a readable slug like `create-project` / `get-project`. The template already
   does this. **Why it matters:** the engine resolves a component's OAuth scopes
   via a GLOBAL `findByComponentId(userId, componentId)` lookup that ignores the
   flow id; readable ids are reused across every flow, so connecting an account
   binds to the wrong flow and requests only the base scope → the provider
   rejects auth ("no supported scopes"). Enforced by `component-id-uuid`.

0c. **Key `source` and `config.transform` by the component's REAL inPort name** —
   read it from the component.json `inPorts` of the component you are wiring INTO.
   It is `in` for most components, but NOT all (salesforce CreateLead/UpdateLead →
   `lead`, CreateContact/UpdateContact → `contact`). **Why it matters:** a wrong
   key uploads fine and even passes the variables check, but the engine rejects
   flow START with an opaque 400 "Malformed transformation" that names no
   component. Enforced by `inport-key-match`.

0d. **Don't invent `config.properties.account`** in newly generated flows —
   binding happens at upload time (patch-accounts / runner
   `APPMIXER_SKILL_ACCOUNT_ID`). Flows downloaded from a live instance
   (`download-E2E-flows.js`) DO carry that instance's account IDs — leave them
   in place; the runner ignores IDs that don't exist on the target instance and
   rebinds a live account instead.

1. **Flow name starts with `E2E `** and is descriptive.
2. **Required components present**: `OnStart`, `AfterAll`, `ProcessE2EResults`
   (wired per the template).
3. **NEVER assert on Raw Output** — `$.comp-id.out` / `$.comp-id.channels` always
   contains something, so the assertion is meaningless. Assert a SPECIFIC field,
   e.g. `$.comp-id.out.id`.
4. **Use the REAL output port name** — it is not always `out` (e.g. Slack
   `ListChannels` uses `channels`, `utils.files.SaveFile` uses `file`). Read
   `outPorts[*].name` in `component.json`. A link to a non-existent port uploads
   and starts fine but the listener NEVER receives a message — the flow stalls
   with zero errors until AfterAll times out. Enforced by `outport-exists`
   (both links and `$.id.port.…` variable paths).
5. **List/outputType components need a single-item `outputType`** in the flow
   transform so the component emits one item and individual fields like
   `$.comp-id.out.id` are accessible — assert on those fields **directly** (do NOT
   route through SetVariable/CodeBlock). **Read the component's
   `inspector.inputs.outputType.options` and use a value that is actually
   declared there** — connectors differ (`first` vs `object` = "one item at a
   time"); a value the runtime happens to accept but the inspector doesn't
   declare renders as a validation error in the designer. The validator allows
   `$.comp.out.field` precisely when the flow sets a single-item outputType.
   Note: with `first` an empty result throws CancelError; with per-record modes
   (`object` microsoft-style, `item` xero-style) an empty result emits NOTHING
   (flow stalls until AfterAll timeout) — filter for data you created in the
   same flow so the result is never empty.
5b. **Connectors without `first` (e.g. xero: `item`/`items`/`file`)** — prefer the
   array mode (`items`/`array`) for components under test and assert the wrapper
   field notEmpty (`$.comp.<port>.items` / `.result` for `array`): it always
   emits, so an empty result fails LOUDLY in the Assert instead of hanging
   AfterAll.
5c. **Per-record modes must NOT feed the middle of a chain** — `item`/`object`
   emit one message PER RECORD, so every downstream component re-executes once
   per record (real case: ListTenants in `item` mode on an account with two
   Xero organisations ran the entire pipeline twice, in both orgs). Mid-chain,
   use `items`/`array` (single message) and extract the first record on the
   consumer with a `g_jsonPath "$[0].<field>"` modifier. Enforced by
   `outputtype-fanout`.
6. **Assert variable paths must resolve to a scalar** (string/number/boolean) —
   never an object or array; use `g_jsonPath` / `g_first` to extract a leaf.
6b. **Never reference deeper than the sender's STATIC outPort contract** —
   `$.x.out.response.opportunityid` resolves at RUNTIME (the flow even passes),
   but if the sender declares only `response`/`status`/`statusText`
   (e.g. MakeApiCall), the designer's variable picker cannot offer the deep path
   and renders a red invalid-variable chip. Reference the deepest DECLARED path
   and extract the leaf with a modifier:
   `"variable": "$.x.out.response", "functions": [{ "name": "g_jsonPath",
   "params": [{ "value": "$.opportunityid" }] }]` (note: `params`, not `args`).
   Dynamic outPorts (options generated by a live `source` call, e.g. entity
   triggers) DO offer leaf fields — reference those directly. Enforced by
   `static-outport-deep-path`.
7. **Input fields** should use realistic values that satisfy the component's
   `inPorts[0].schema` (required fields set, no generic placeholders).
8. **No numeric array indexing** in variable paths (`$.x.out.items.0.id` does NOT
   resolve) — use a modifier (`g_jsonPath "$[0].field"`, `g_first`, `g_last`).
9. **Bind every modifier in `lambda`** — a field that defines `modifiers` must have
   a non-empty lambda value (`{{{var-id}}}`); Assert clause `field` must not be
   empty. An empty binding silently ignores the modifier.
9b. **String-typed inputs take STRINGS — serialize arrays/objects as JSON** —
   key-value inspector inputs (MakeApiCall `headers`/`parameters`) declare
   `"type": "string"` in the schema; the runtime parses either form, but a raw
   array (`"headers": [{ "key": "Prefer", "value": "return=representation" }]`)
   fails the designer's schema validation with a red "must be string" chip.
   Write `"headers": "[{\"key\": \"Prefer\", \"value\": \"return=representation\"}]"`.
   Enforced by `lambda-string-schema`.
10. **Assert assertions** are only `equal`, `notEmpty`, `regex`.
11. **Prefer modifiers over CodeBlock** (g_jsonPath/g_first/g_now+g_addTimeSpan/…);
    CodeBlock is a last resort.
12. **No hardcoded dates** — compute with `g_now` + `g_addTimeSpan` (determinism).
13. **Clean up what you create** — a flow that Creates a resource should Delete it.
14. **Layout flows left→right** — each connection's target should sit to the right
    of its source (`target.x >= source.x + 128`); no backward/overlapping edges.
15. **Cover every component** — each connector **action** should appear in at least
    one flow. `component-coverage` excludes `trigger: true` components, so it only
    flags uncovered **actions** — but triggers CAN and SHOULD be E2E-covered too,
    using the provoke pattern below.
17. **Never verify a Create via full-text search** — search endpoints
    (`searchTerm`-style inputs) read an eventually-consistent index: a record
    created a second earlier is deterministically missing (and archived/deleted
    records are often excluded by default). Verify with Get-by-ID or a
    consistent list filter (`where Name=="…"` + `includeArchived` in Xero) —
    list endpoints read the primary store.
18. **Unique names per run where the API enforces uniqueness** — contact names,
    option/category names etc. reject duplicates. Either make the name unique
    per run (append `{{{mod}}}` bound to `$.<onStart>.out.started`, or
    `g_now`/timestamp modifiers) or create+archive/delete in the same flow so
    the name is reusable. NEVER create per-run instances of org-capped
    resources (e.g. Xero allows max 2 active tracking categories per org) —
    reuse an existing one via `items[0]` instead.
19. **Trigger flows (provoke pattern)** — the trigger sits **sourceless** in the
    flow next to the normal OnStart chain; an action in the same flow provokes the
    event it listens for:
    - webhook trigger: `OnStart → SetVariable → Wait 1m → Create/Update/Delete
      (provokes) …` + `Trigger → Assert → cleanup` — the Wait lets the provider-side
      subscription propagate before provoking; the trigger's subscription itself is
      created during flow start, before OnStart fires.
    - polling trigger (e.g. event-start): create data the first poll will match
      (an ongoing/imminent item) — no Wait needed.
    - Webhook notifications can take **minutes** to arrive (MS Graph: ~5 measured)
      — set the AfterAll `timeout` to 420 and expect the runner to wait, not fail.
    - Cleanup should consume the TRIGGER's output (`$.trigger.out.id`) — it then
      doubles as the assertion that the trigger fired.

(Failures 1-10 — including 5c, 6b and 9b — fail validation; 11-19 are warnings
or generation guidance.)

## Adding / changing a rule

The validator is `validate.js` + `validators/*.js` (modeled on
`appmixer-connectors/scripts/validate.js`): each validator exports
`{ name, description, run(ctx) }` and calls `ctx.addFailure` / `ctx.addWarning`.
Shared check logic lives in `validators/lib/`. Add a new file to `validators/` to
add a rule — `validate.js` auto-discovers it.

## Next step

Run `upload-e2e-flows` to publish the connector and upload the flows.
