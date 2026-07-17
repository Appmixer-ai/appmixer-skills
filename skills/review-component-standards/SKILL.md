---
name: review-component-standards
description: Review an Appmixer component against standards and best practices. Read-only — produces a list of issues without modifying files. Use when user wants to audit, check, or validate a specific component.
license: MIT
metadata:
  author: Appmixer
  version: "0.1.6"
  homepage: https://www.appmixer.com
  repository: https://github.com/Appmixer-ai/appmixer-skills
---

# Review Component Standards

Audits an Appmixer component against the standards in
`appmixer-connectors/.github/instructions/`. **You (the agent) do the review
directly** — read the files and produce a structured issue list. There is no
sub-agent to spawn. **Do NOT modify any files.**

## Design Reference

The rules to check live in `<connectors>/.github/instructions/`:

| File | Content |
|------|---------|
| `04-components.md` | Component structure, component.json schema |
| `05-component-config.md` | Config, transforms, modifiers/lambda patterns |
| `06-component-behavior.md` | Behavior file (.js) patterns |
| `07-component-types.md` | Actions, triggers, dynamic components |
| `08-best-practices.md` | Coding standards, naming, error handling |

## Prerequisites

- **Connector location** — set `APPMIXER_SKILL_CONNECTORS_DIR` to the `appmixer-connectors`
  checkout root, or run from inside the repo. When neither applies, read it
  from `~/.config/appmixer-skills/env`; if that file is missing too, ask the
  user for the path and write it there (KEY=value, `chmod 600`). Components live at
  `<connectors>/src/appmixer/<connector>/`.
- **Design conventions** — the rules this skill checks against are read from
  `<connectors>/.github/instructions/` (they live in the connectors repo, not in
  this plugin). Before starting the review, verify that directory exists; if it
  doesn't, stop and tell the user they need an up-to-date `appmixer-connectors`
  checkout.

## Input

A full component name, e.g. `appmixer.MSPowerBI.core.CreateDashboard`
(`appmixer.<connector>.<module>.<Component>`).

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
6. **Check against the rules below** and output the issue list. Report real
   issues only — do not flag correct things.

## What to check

### component.json
1. **name** matches `appmixer.<connector>.<module>.<ComponentName>`.
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

### Cross-cutting
- Naming consistency with sibling components.
- Inspector field labels match outPort schema field names.

## Output format

```json
{
  "component": "<full component name>",
  "componentType": "<action|get|list|find|trigger>",
  "summary": "<one-sentence purpose>",
  "issues": [
    {
      "severity": "error|warning|info",
      "category": "component.json|behavior|naming|schema|auth|pattern",
      "rule": "<short id, e.g. schema.type-missing>",
      "message": "<clear description>",
      "suggestion": "<how to fix it>"
    }
  ],
  "passedChecks": ["<checks that passed>"]
}
```

| Severity | Meaning |
|----------|---------|
| `error` | Violates a mandatory rule — must be fixed |
| `warning` | Should be fixed — may cause issues |
| `info` | Improvement suggestion — optional |
