---
name: plan-CLI-tests
description: Create a test plan for all components in an Appmixer connector. Use when user wants to plan testing, see what components need testing, or before running batch tests.
license: MIT
metadata:
  author: Appmixer
  version: "0.1.3"
  homepage: https://www.appmixer.com
  repository: https://github.com/Appmixer-ai/appmixer-skills
---

# Plan Tests for Connector

Creates an ordered test plan with dependency analysis for all components in a
connector. **You (the agent) do this directly** — read the component definitions,
reason about dependencies, and write the plan. There is no sub-agent to spawn.

## Prerequisites

- **Connector location** — the `appmixer-connectors` checkout. Set
  `APPMIXER_SKILL_CONNECTORS_DIR` to its root, or run from inside the repo (the connector
  lives at `<connectors>/src/appmixer/<connector>/`).

## What to do

1. **List the components.** Enumerate the connector's components under
   `<connectors>/src/appmixer/<connector>/` (each component is a directory with a
   `component.json`, typically under `core/`).
2. **Understand each component.** Read every `component.json` (and its behavior
   `.js` when needed) to learn what it does, its inputs, and its outputs.
   **Only read** — do not run, validate, or authenticate anything here.
3. **Design the test sequence** following the principles below.
4. **Write the plan** to
   `<connectors>/src/appmixer/<connector>/artifacts/ai-artifacts/test-plan.json`
   in the format below.

## Principles

Design a sequence that mimics how users actually use the service:

- **Test dependencies first** — components that create resources come before
  those that read, update, or delete them.
- **Reuse test data** — outputs from earlier tests (e.g. a created ID) feed
  inputs of later tests.
- **Follow natural workflows** — order components the way a user would use them.

Example (Google Calendar): `CreateCalendar → ListCalendars → CreateEvent →
FindEvents → UpdateEvent → DeleteEvent → DeleteCalendar`.

## Output format

`test-plan.json` — an ordered array, one entry per component:

```json
{
  "plan": [
    { "name": "ComponentName", "completed": false, "result": {} }
  ]
}
```

On success, report: `OK: Test plan with N component(s).`
