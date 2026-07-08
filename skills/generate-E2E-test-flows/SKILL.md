---
name: generate-E2E-test-flows
description: Generate E2E test flows for an Appmixer connector. Use when user wants to create end-to-end tests, generate test flows, or after component testing is complete.
---

# E2E Test Flows

Generate E2E test flow JSON files for a connector's components. **You (the agent)
write the flows directly** — there is no separate sub-agent. After writing them
you run a deterministic validator and fix anything it flags, looping until clean.

> **Paths:** `$VERO_SKILL_ROOT` points at the skills directory
> (`.../workspace-vero/skills`), set by the runtime (openclaw box or the CI
> workflow). When running as a Claude Code plugin `VERO_SKILL_ROOT` is not set —
> resolve it from the plugin root by prefixing commands with:
> `export VERO_SKILL_ROOT="${VERO_SKILL_ROOT:-$CLAUDE_PLUGIN_ROOT/skills}"`.
> The validator (`validate.js`) needs Node deps (`ajv`) which are
> installed via `npm ci` in `workspace-vero`.

## Setup (first run)

Install Node dependencies (idempotent, skips if already present):

```bash
bash "${CLAUDE_PLUGIN_ROOT:-${VERO_SKILL_ROOT:-.}/..}/scripts/ensure-deps.sh"
```

## How it works

1. **Pick the components** to cover (one trigger or action per flow; default: all
   testable components of the connector).
2. **Read the canonical template** `$VERO_SKILL_ROOT/generate-E2E-test-flows/test-flow-template.json`
   — copy its structure (OnStart → setup → component-under-test → Assert →
   AfterAll → ProcessE2EResults). It is a complete, working example.
3. **Read each component's `component.json`** under
   `$VERO_CONNECTORS_DIR/src/appmixer/<connector>/...` to get the REAL input
   schema and output port name(s) — do not guess them.
4. **Write** each flow to
   `$VERO_CONNECTORS_DIR/src/appmixer/<connector>/artifacts/test-flows/test-flow-<name>.json`.
5. **Validate**:
   ```bash
   node "$VERO_SKILL_ROOT/generate-E2E-test-flows/validate.js" \
     "$VERO_CONNECTORS_DIR/src/appmixer/<connector>/artifacts/test-flows"
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
   `VERO_APPMIXER_ACCOUNT_ID`). Flows downloaded from a live instance
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
   `ListChannels` uses `channels`). Read `outPorts[*].name` in `component.json`.
5. **List/outputType components need a single-item `outputType`** in the flow
   transform so the component emits one item and individual fields like
   `$.comp-id.out.id` are accessible — assert on those fields **directly** (do NOT
   route through SetVariable/CodeBlock). **Read the component's
   `inspector.inputs.outputType.options` and use a value that is actually
   declared there** — connectors differ (`first` vs `object` = "one item at a
   time"); a value the runtime happens to accept but the inspector doesn't
   declare renders as a validation error in the designer. The validator allows
   `$.comp.out.field` precisely when the flow sets a single-item outputType.
   Note: with `first` an empty result throws CancelError; with `object` an empty
   result emits nothing (flow stalls until AfterAll timeout) — filter for data
   you created in the same flow so the result is never empty.
6. **Assert variable paths must resolve to a scalar** (string/number/boolean) —
   never an object or array; use `g_jsonPath` / `g_first` to extract a leaf.
7. **Input fields** should use realistic values that satisfy the component's
   `inPorts[0].schema` (required fields set, no generic placeholders).
8. **No numeric array indexing** in variable paths (`$.x.out.items.0.id` does NOT
   resolve) — use a modifier (`g_jsonPath "$[0].field"`, `g_first`, `g_last`).
9. **Bind every modifier in `lambda`** — a field that defines `modifiers` must have
   a non-empty lambda value (`{{{var-id}}}`); Assert clause `field` must not be
   empty. An empty binding silently ignores the modifier.
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
16. **Trigger flows (provoke pattern)** — the trigger sits **sourceless** in the
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

(Failures 1-10 fail validation; 11-16 are warnings.)

## Adding / changing a rule

The validator is `validate.js` + `validators/*.js` (modeled on
`appmixer-connectors/scripts/validate.js`): each validator exports
`{ name, description, run(ctx) }` and calls `ctx.addFailure` / `ctx.addWarning`.
Shared check logic lives in `validators/lib/`. Add a new file to `validators/` to
add a rule — `validate.js` auto-discovers it.

## Next step

Run `upload-e2e-flows` to publish the connector and upload the flows.
