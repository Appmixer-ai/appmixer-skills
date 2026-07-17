---
name: init-connector
description: Initialize a new Appmixer connector from a GitHub issue. Use when user wants to scaffold/create/initialize a new connector, mentions a GitHub issue with connector requirements, or says "init connector" / "new connector" / "create connector".
license: MIT
metadata:
  author: Appmixer
  version: "0.1.4"
  homepage: https://www.appmixer.com
  repository: https://github.com/Appmixer-ai/appmixer-skills
---

# Initialize Connector

Scaffolds a complete new Appmixer connector from a GitHub issue. **You (the
agent) do this directly** — fetch the issue, research the API, and write the
files. There is no sub-agent to spawn.

## Prerequisites

- **GitHub access** — `gh` CLI authenticated (`gh auth login`); needed to fetch
  the source issue and push the branch.
- **Connector location** — set `APPMIXER_SKILL_CONNECTORS_DIR` to the `appmixer-connectors`
  checkout root, or run from inside the repo. When neither applies, read it
  from `~/.config/appmixer-skills/env`; if that file is missing too, ask the
  user for the path and write it there (KEY=value, `chmod 600`).
- **Design conventions** — this skill reads the canonical rules from
  `<connectors>/.github/instructions/` (they live in the connectors repo, not in
  this plugin). Before doing anything else, verify that directory exists; if it
  doesn't, stop and tell the user they need an up-to-date `appmixer-connectors`
  checkout.

## Input

- `issue-ref` — GitHub issue URL or `org/repo#123`
- optional connector name override
- optional API docs URL override (otherwise extracted from the issue)

## Step 1: Fetch and parse the issue

```bash
gh issue view <number> --repo <org/repo> --json title,body,labels
```

From the issue extract:
- **Connector name** — lowercase, alphanumeric (e.g. from "Connector: X" in the
  title/body). Ask the user if ambiguous.
- **Auth type** — API key, OAuth 2.0, …
- **Component list** — the components to generate
- **API docs URL** — any link containing api/docs/reference/swagger/openapi/developer

**Abort if the connector already exists** —
check `<connectors>/src/appmixer/<connector>/service.json`.

## Step 2: Load the design rules

Read `<connectors>/.github/instructions/` — at minimum: `01-connectors.md`,
`02-authentication.md`, `04-components.md`, `06-component-behavior.md`,
`07-component-types.md`, `08-best-practices.md`. These are the canonical
conventions everything below must follow.

## Step 3: Research the API

Read the API documentation (the URL from the issue). For each component in the
issue, identify: endpoint, method, required/optional parameters, response shape,
auth mechanism, and rate limits. If the docs link to an OpenAPI/Swagger spec,
read the relevant paths from it.

## Step 4: Scaffold core files

Under `src/appmixer/<connector>/`:

1. **service.json** — name `appmixer.<connector>`, label from the issue,
   category `"applications"`, version `"1.0.0"`.
2. **bundle.json** — same name, version `"1.0.0"`,
   `changelog: { "1.0.0": ["Initial release."] }`.
3. **auth.js** — matching the auth type from the issue (see `02-authentication.md`).
4. **quota.js** — rate limits from the issue/docs, or sensible defaults.

## Step 5: Generate components

For each component, under `src/appmixer/<connector>/core/<ComponentName>/`:

1. **component.json** — proper inPorts, outPorts (typed schema with `example` on
   every leaf property), auth, quota, icon.
2. **<ComponentName>.js** — a working implementation using `context.httpRequest`
   based on the API documentation.

Rules:
- Follow Appmixer conventions strictly (component types table: Get/List/Find/
  Create/Update/Delete/Trigger semantics per `07-component-types.md`).
- Keep HTTP client, auth handling, and output conventions consistent across all
  generated components.
- Every component referenced as a dropdown `source.url` (dynamic inspector
  source) MUST follow the four dynamic-source rules in `07-component-types.md`
  ("Dynamic Source Calls"): `text` input type (never `select`), optional
  dependency inputs, error suppression, and a **cached** fetch
  (`context.staticCache` + `context.lock`, TTL `context.config.listCacheTTL`,
  default 120 s). The designer fires these calls in concurrent bursts on every
  inspector open — uncached sources trip API rate limits (429). For heavily
  rate-limited APIs, cache unconditionally in `receive()` (see the Xero
  `withCache` variant in `07-component-types.md`).
- Do NOT create `package.json` unless the issue explicitly mentions npm dependencies.

## Step 6: Summary

Report what was created (files, component count, auth type).

## After initialization

1. **Create branch** `feature/<connector>-connector` in `appmixer-connectors`
2. **Commit** all generated files with message like `feat: add <connector> connector`
3. **Publish** the connector module to Appmixer (`appmixer pack` + `appmixer publish` — credentials from the `APPMIXER_SKILL_*` env vars / `$APPMIXER_ENV` file)
4. **Push** the branch to origin

Tell the user the connector is initialized and suggest next step:
> "Connector **X** initialized with N components. Next: authenticate and run `plan-CLI-tests` to start testing."
