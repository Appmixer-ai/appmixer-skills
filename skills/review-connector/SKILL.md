---
name: review-connector
description: Review an Appmixer connector component against standards and best practices. Read-only — produces a list of issues without modifying files. Use when user wants to audit, check, review or validate a connector or a specific component.
license: MIT
metadata:
  author: Appmixer
  version: "1.0.0"
  homepage: https://www.appmixer.com
  repository: https://github.com/Appmixer-ai/appmixer-skills
---

# Review Connector

Audits an Appmixer component against the design standards bundled in this
skill's `references/` directory. **You (the agent) do the review
directly** — read the files and produce a structured issue list. There is no
sub-agent to spawn. **Do NOT modify any files.**

## Design Reference

The rules to check live in the `references/` directory next to this SKILL.md:

| File | Content |
|------|---------|
| `04-components.md` | Component structure, component.json schema |
| `05-component-config.md` | Config, transforms, modifiers/lambda patterns |
| `06-component-behavior.md` | Behavior file (.js) patterns |
| `07-component-types.md` | Actions, triggers, dynamic components |
| `08-best-practices.md` | Coding standards, naming, error handling |
| `10-trigger-test-method.md` | Trigger `test(context)` rules for Flow Test Mode |
| `14-async-components.md` | Jobs that finish later — self-callback vs. continuation chain |

Complete example files (component.json, behaviors, auth.js, lib.js) are in
`references/examples/`. Real-world example connectors (when you want a
reference implementation): https://github.com/appmixer-ai/appmixer-connectors

## Prerequisites

- **Run from the connector workspace** — the current directory (or a parent)
  must contain `src/<vendor>/`; components live at
  `src/<vendor>/<connector>/`. Only when running from elsewhere, point
  `APPMIXER_SKILL_CONNECTORS_DIR` at the workspace root (optional override).

## Input

A full component name, e.g. `appmixer.MSPowerBI.core.CreateDashboard`
(`<vendor>.<connector>.<module>.<Component>` — `appmixer` is only the default
vendor; the first segment names the vendor dir under `src/`).

## Review process

1. **Read the component.** Its `component.json` and behavior `.js`.
2. **Read established patterns.** List the connector's other components and read
   2–3 siblings to learn the connector's conventions (HTTP client, auth, output).
3. **Read the connector's `auth.js`.**
4. **Load the design rules** from the Design Reference files above.
5. **Detect the component type** — Action (Create/Update/Delete/Send/Post), Get,
   List, Find (outputType selector), or Trigger (On/When). Apply type-specific
   rules. Also detect whether the component is a **dynamic source**: grep the
   connector's `component.json` files for `<ComponentName>?outPort` in
   `source.url` references (ignore self-references that only pass
   `generateOutputPortOptions`).
6. **Ask whether the operation finishes later.** This is a separate question from
   the component type and it is easy to miss, because an async component looks
   like an ordinary action from the outside — it returns quickly, with an id.
   Answer YES if any of these hold, then apply `14-async-components.md`:
   - the behavior sends a job/snapshot/task/render/transcription **id** rather
     than the result the component's label promises;
   - the API accepts a callback, webhook, `notify` or `endpoint` **URL
     parameter**, or the connector exposes one as a component input;
   - the connector ships a companion "get status" / "is it ready" component, or
     its own e2e flow reaches the result through a `Wait`/timer step;
   - the behavior sleeps, polls in a loop, or blocks on a long request.

   The smell is often spread across **several** components rather than visible in
   one file, so check the connector's component list and its test flows, not just
   the file in front of you.
7. **Place the connector in its family.** Plenty of connectors are one of a
   kind, but some belong to an obvious group doing the same job against a
   different vendor — storage (`google/drive`, `box`, `dropbox`,
   `microsoft/onedrive`, `microsoft/sharepoint`, `aws/s3`, `utils/ftp`), AI
   (everything under `src/appmixer/ai/`, where the family is already the
   directory), and the usual CRM / ticketing / e-commerce / calendar clusters.
   When there is a family, list the components of one or two peers and compare.
   This is a **soft** check — see "Family consistency" below — and it is the one
   part of this review whose findings are suggestions, not defects.
8. **Check against the rules below** and output the issue list. Report real
   issues only — do not flag correct things.

## What to check

### component.json
1. **name** matches `<vendor>.<connector>.<module>.<ComponentName>` (matching the disk path `src/<vendor>/<connector>/<module>/<ComponentName>/`).
2. **label** — human-readable, title-case, no redundant connector prefix.
3. **description** — present, meaningful, not identical to the label.
4. **icon** — present.
5. **auth** — references the connector's auth service.
6. **inPorts** — valid schema; required fields marked `required: true`.
7. **outPorts** — static components have a typed schema with **`type` + `example`
   on every leaf property** (and `title` for the label); List/Find have an
   `outputType` input and a dynamic `source`; correct JSON Schema types; no
   invented fields. Dynamic `source` URLs carry `ignoreAuth=true` and supply all
   of the target's required inputs (`"dummy"` for ones that don't shape the schema).
8. **Dynamic output options quality (`getOutputPortOptions`)** — the generated
   options MUST derive from a single shared schema const where every leaf has
   `type` + `title` (human label, e.g. "Event ID", not the raw field name) +
   `example`; nested objects use proper JSON Schema `properties` (`{type, title}`
   nodes — never `{label, value}` inside `properties`). Raw field names as labels
   or missing types render as bare keys in the designer variable picker. If the
   behavior appends fields to each record (e.g. `index`/`count`), declare them too;
   only declare fields the behavior actually sends.
   That const MUST be a complete JSON Schema exported as **`ITEM_SCHEMA`**
   (`{ type, required, properties }`, declared above `module.exports`, passed to the
   helper as `ITEM_SCHEMA.properties`) — see "Export the item schema as
   `ITEM_SCHEMA`" in `07-component-types.md`. A dynamic port declares nothing in
   component.json, so without the export the whole output contract is invisible to
   offline checks and `verify` must treat every field as required. Missing export =
   `warning` (rule `outport.item-schema-missing`); exported but with no `required`
   on a payload that is polymorphic or has optional fields = `warning`
   (`outport.required-missing`).
8. **inspector.inputs** — labels, descriptions, types for all inputs;
   entity-reference inputs have a `source` pointing to a List/Find component.
9. **quota** — present for components that call external APIs.

### Behavior file (.js)
1. **HTTP client** matches the connector's established pattern (consistency is paramount).
2. **Auth** uses the same fields/headers as `auth.js`; no hardcoded credentials.
3. **Error handling** — API errors handled and wrapped with context, not crashing.
4. **Output** — sent on the correct port; no undefined/null output.
5. **Pagination** implemented for List/Find when the API supports it.
6. **outputType** supported for Find components (flat, first, count, …).
7. **tenantId / accountId** passed correctly for multi-tenant connectors.
8. **Dynamic-source caching** — if the component is referenced as a `source.url`
   from any sibling `component.json` (detected in review step 5), its live fetch
   MUST be cached (`context.staticCache` + `context.lock`, TTL
   `context.config.listCacheTTL`) and errors suppressed for source calls, per
   `07-component-types.md` → "Dynamic Source Calls". The cache key must include
   every result-shaping input (token, tenant, params). Uncached source fetch =
   `error` — inspector opens fire concurrent bursts that trip API rate limits
   (429). Self-references used only for `generateOutputPortOptions` (static
   options) are exempt and must not call the API at all.

### Async components only (when review step 6 answered YES)

Apply `14-async-components.md`. Its decision rule is: if the provider offers a
callback/webhook URL parameter, the component MUST use the **self-callback**
shape (`"webhook": true` + `context.getWebhookUrl()` + a second, completion
port); if the provider only offers a status endpoint to poll, it MUST use a
**continuation chain** (`context.setTimeout`, minimum interval one minute).

1. **Callback URL exposed as a component input** — `error`, rule
   `async.callback-url-as-input`. The reference file names this explicitly: the
   moment a user fills it in, the provider delivers elsewhere and the completion
   port silently never fires. None of the four reference implementations
   (`clearbit/enrichment/FindPerson`, `plivo/sms/SendSMSAndWaitForReply`,
   `twilio/calls/ForwardCall`, `utils/tasks/RequestApproval`) expose one.
2. **Neither shape implemented** — `error`, rule `async.no-completion-path`.
   Returning a job id on `out` and leaving the user to poll — whether by hand in
   the flow, via a `Wait` timer, or through a companion status component — is
   not a completion path. Check which of the two shapes the provider's API
   supports before deciding which one to recommend.
3. **Blocking instead of continuing** — sleeping or polling in a loop inside
   `receive()` holds a worker for the whole job. `warning` normally, `info` when
   a sibling connector does the same deliberately AND the wait is short enough
   that the one-minute continuation floor would be too coarse.
4. **`tick()` used to deliver completion**, or a separate polling trigger used as
   an action's completion path — `error`. A tick emit has no message scope, so it
   cannot continue the branch that started the job. (A polling trigger is still
   legitimate on its own, for jobs submitted outside Appmixer.)
5. **Missing echo** on the self-callback shape — one component instance has ONE
   callback URL, so parallel jobs arrive in completion order. The job's inputs
   plus a **Correlation ID** input must be echoed on both ports; without them a
   downstream component cannot tell which result belongs to which input —
   `warning`.
6. **Echo carried in component state** rather than in the callback URL —
   `warning`, rule `async.echo-in-state`. `stateSet` after the submit races the
   provider's callback (it starts working the moment it accepts the job), a
   redelivered callback finds the entry already `stateUnset`, and state has no
   TTL so a job that never calls back leaks its entry forever. The fix is to
   append the echo to `context.getWebhookUrl()` and read it back from
   `context.messages.webhook.content.query`.
7. **Callback emitted without checking it carries a job id** — `warning`, rule
   `async.unguarded-callback`. Anything can POST to a webhook URL; without the
   guard a stray or replayed request emits a `done` carrying an empty result.
8. **`context.response()` not in a `finally`** — `warning`, rule
   `async.ack-not-guaranteed`. An emit (or a state call) that throws before the
   ack means no 2xx, the provider redelivers, and the redelivery re-runs the
   same failure.
9. **Submit drops a file read stream on the error path**, or accepts a missing
   job id from the submit response — `warning`. An un-destroyed stream holds a
   descriptor per failed attempt; a missing job id sends `request_id: undefined`
   into the flow and silently unlinks the callback, so it should throw.
10. **A `limit-concurrency` quota rule whose comment describes capping in-flight
    jobs** on a component that submits and returns — `info`. The slot is released
    when `receive()` returns, so it caps concurrent submissions only; the comment
    must not claim protection the rule no longer provides.

### Triggers only
1. **`test(context)` present** — triggers should implement `test()` so Flow Test
   Mode works; its absence is a `warning` (rule `trigger.test-missing`).
2. **`test()` quality** (per `10-trigger-test-method.md`): shares the
   request+mapping path with `tick()`/`receive()` (no duplicated URL/auth/query
   logic); read-only upstream; no state writes (`saveState`/`stateSet`/…);
   honors `context.properties` filters; emits exactly ONE item via `sendJson`
   on the correct port; throws (never fabricates synthetic data) when no real
   example exists.

### Cross-cutting
- Naming consistency with sibling components.
- Inspector field labels match outPort schema field names.

### Family consistency (soft — suggestions, not defects)

Connectors in the same family should be recognizable to someone who already
knows a sibling: a flow built on Drive should be rebuildable on SharePoint
without relearning the vocabulary. Compare against one or two peers, in this
order of value:

1. **Missing operations** — `family.missing-operation`. What do peers offer
   that this connector doesn't, and does the vendor's API actually support it?
   This is the check worth doing; the rest is polish. It is how gaps surface —
   e.g. `microsoft/onedrive` has no delete, no search and no copy while every
   other storage connector has all three. Name the peer that has it.
2. **Gratuitous naming divergence** — `family.naming-divergence`. Same concept,
   different name: `GetFile` vs `GetFileMetadata`, `query` vs `q`, `fileTypes`
   vs `fileTypesRestriction`. For a **new, unreleased** component, adopting the
   family's existing name is free, so a `warning` is fair. For an **already
   released** one, `info` at most — and do not offer a rename as the fix.
   Renaming a published component breaks live flows and costs a major bump; the
   finding exists to inform a future migration, not to demand one now.
3. **Shape rather than vocabulary** — `family.shape-divergence`. The same
   operation should have the same *shape* across the family: Find/List with an
   `outputType` selector, a `notFound` port and an exported `ITEM_SCHEMA`;
   Delete/Update returning `{}`. Shape is what actually breaks a flow when a
   connector is swapped, which is why it outranks naming.

Do **not** report these — each is a legitimate difference, not drift:

- **Output field names that follow the vendor's API** (`modified_at` vs
  `modifiedTime` vs `lastModifiedDateTime`). Keep the vendor's vocabulary. A
  synthetic normalized one stops matching the vendor's docs and the connector's
  own MakeApiCall output, which costs more than it buys.
- **Operations the API genuinely cannot do.** S3 has no folders, no move and no
  rename; FTP has no IDs, no search and no sharing; Dropbox is path-based where
  the others are ID-based. A family is a resemblance, not a lowest common
  denominator — do not propose faking a capability to fill a slot.
- **Vendor-specific components with no peer analogue** — Box locking and
  comments, Graph `ListDrives`/`ListSites`, S3 buckets, Drive `GooglePicker`.
  Breadth beyond the family is a feature.
- **Input order, labels and tooltips**, and differences that exist because the
  underlying APIs differ rather than because nobody looked.

## Output format

Report the findings as readable Markdown — no JSON. Structure:

1. **Header line** — component (or connector) name, detected type, one-sentence
   purpose, and the issue count by severity (e.g. `0 errors, 2 warnings, 3 info`).
2. **Issues table** — one row per finding, most severe first:

   | Severity | Component | Rule | Finding | Suggested fix |
   |----------|-----------|------|---------|---------------|
   | warning | FindPersons | source.required-inputs-missing | generateOutputPortOptions source doesn't supply required `projectId` | add `"in/projectId": "dummy"` to `source.data.messages` |

   - `Rule` is a short kebab-case id (e.g. `schema.type-missing`) so findings are
     easy to reference in a follow-up ("fix the two source.* warnings").
   - Group identical findings that hit multiple components into ONE row listing
     the components — don't repeat the same finding per component.
   - When reviewing a whole connector, keep a single table for all components.
3. **Passed checks** — a short bullet list of what was verified and found OK, so
   a clean review is distinguishable from a shallow one.

If there are no findings, say so explicitly and still list the passed checks.

| Severity | Meaning |
|----------|---------|
| `error` | Violates a mandatory rule — must be fixed |
| `warning` | Should be fixed — may cause issues |
| `info` | Improvement suggestion — optional |
