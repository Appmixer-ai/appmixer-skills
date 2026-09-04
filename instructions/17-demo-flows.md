# Demo Flows

Demo flows are small, presentable flows shipped with a connector in
`src/<vendor>/<connector_name>/artifacts/demo-flows/` (connector level — never
inside a module). Unlike E2E test flows they are not a harness: no Assert, no
AfterAll, no ProcessE2EResults, no cleanup lane. A demo flow shows one
realistic use case a customer would actually build — typically
`trigger → enrich → notify/act` (e.g. Abandoned Cart → Get Customer →
Send Email).

## Conventions

- **File name**: `demo-<connector>-<usecase>.json`
  (e.g. `demo-prestashop-abandonedcart.json`).
- **Flow name**: `"Demo <Service> - <Use case>"`
  (e.g. `"Demo PrestaShop - Abandoned Cart Recovery"`).
- **Top-level shape**: `{ "name", "type": "automation", "flow", "wizard": { "fields": [] } }`
  — the empty `wizard` keeps the flow usable as an automation-template seed.
- **Component IDs**: UUIDs, same as test flows.
- **Layout**: left→right, same grid minimums as E2E flows.
- **errorHandling**: `{ "autoRetry": false, "onError": "stopFlow" }` on every
  component.
- **2–4 components** — a demo is a pitch, not coverage; the E2E flows own
  coverage.

## Variables: reference what the schema offers

The single most common authoring mistake: extracting a field from Raw Output
with a `g_jsonPath` modifier when the sender's outPort schema already declares
it. Runtime works, but the designer renders an ugly magenta **"Raw Output"**
chip instead of the named field the picker offers.

- Field is declared in the sender's static outPort `schema`/`options` (the
  picker shows a named chip) → reference it **directly**:
  `{ "variable": "$.<id>.out.id_customer", "functions": [] }`.
- Path the picker does NOT offer (deeper than the static contract) → reference
  the deepest declared parent + `g_jsonPath` — see the deep-path rule in
  `11-e2e-flow-generation.md`.

The `raw-output-declared-field` flow validator (appmixer CLI, basic ruleset)
warns on the Raw Output form.

## Verify before committing

Import the flow on a live instance and check the variable chips the way the
designer does — every used variable must be among the offered ones:

```bash
appmixer flow import <demo-flow.json>        # plain import — no E2E tagging
appmixer flow variables <flowId> --json      # offered variables (designer endpoint)
# clean up the test import afterwards
```

`appmixer flow validate --ruleset basic <path>` runs the generic flow rules
(schema, UUID ids, variable paths, layout) without the E2E-harness rules.
