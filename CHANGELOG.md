# Changelog

All notable changes to this project will be documented in this file. See [commit-and-tag-version](https://github.com/absolute-version/commit-and-tag-version) for commit guidelines.

## [0.2.1](https://github.com/Appmixer-ai/appmixer-skills/compare/v0.2.0...v0.2.1) (2026-08-10)


### Bug Fixes

* plugin root = repo root so Claude Code discovers skills (appmixer:<skill>) ([#5](https://github.com/Appmixer-ai/appmixer-skills/issues/5)) ([c3033e9](https://github.com/Appmixer-ai/appmixer-skills/commit/c3033e99578e07cae4dc12211ad451a2401bbf4b))

## [0.2.0](https://github.com/Appmixer-ai/appmixer-skills/compare/v0.1.9...v0.2.0) (2026-08-10)


### ⚠ BREAKING CHANGES

* skill names changed and connector-test-method was removed as
a standalone skill.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UzfsFVGKsRrqmvG1bBNsvJ

* feat: build-connector pipeline = build -> review -> test(cli|e2e) -> publish; test-connector scoped to absorb E2E

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UzfsFVGKsRrqmvG1bBNsvJ
* skill names changed (run-CLI-tests -> test-components,
generate-E2E-test-flows -> generate-e2e-flows) and plan-CLI-tests was removed;
reinstall/update installed skills.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UzfsFVGKsRrqmvG1bBNsvJ

* feat!: merge init-connector + connector-pipeline into new-connector, drop GitHub-issue dependency

The two skills covered the same job (building a connector) split across an
arbitrary boundary. new-connector is the single end-to-end skill:
requirements -> scaffold + components -> test-components -> generate-e2e-flows
-> upload-e2e-flows -> run-e2e-flows.

Requirements are gathered directly from the user and the service's API docs —
no GitHub issue to fetch, no gh CLI prerequisite.
* init-connector and connector-pipeline skills were replaced by
new-connector.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UzfsFVGKsRrqmvG1bBNsvJ

* feat: self-contained skill references (make-skills style), extract examples

- Canonical design instructions move to instructions/ at the repo root;
  scripts/sync-references.mjs copies them into each consuming skill's
  references/ directory (new-connector: all; review-component-standards:
  04-08; run-e2e-flows: 09). Smoke test verifies the copies with --check.
- Complete example files (20) extracted from the docs into
  instructions/examples/ — auth.js variants, component.json + behavior per
  component type, polling/webhook/plugin/hybrid triggers, lib.js, a full E2E
  test flow. Docs link to them; all examples parse (node --check / JSON).
- SKILL.md files read references/ relatively — review-component-standards no
  longer needs the APPMIXER_SKILL_ROOT bundle bootstrap at all; skills/_shared/
  keeps only the JS runtime helpers.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UzfsFVGKsRrqmvG1bBNsvJ

* feat: demote APPMIXER_SKILL_CONNECTORS_DIR to optional override

Skills now assume they run from inside the connector workspace (cwd or a
parent contains src/appmixer/) — all SKILL.md paths are workspace-relative and
the Node scripts already resolve the root by walking up from the cwd.
APPMIXER_SKILL_CONNECTORS_DIR remains only as an explicit override for running
from elsewhere (CI, git worktrees) and moves to the Optional section of
.env.example; the upload-e2e-flows config guard no longer requires it.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UzfsFVGKsRrqmvG1bBNsvJ

* chore: ignore .DS_Store

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UzfsFVGKsRrqmvG1bBNsvJ

* feat: arbitrary vendor namespaces (appmixer = default only), multi-vendor workspaces

Component types and disk layout are now treated generically:
<vendor>.<connector>.<module>.<Component> <-> src/<vendor>/<connector>/... —
"appmixer" is only the default vendor and a workspace can hold several vendors
side by side.

- _shared/vendors.js (new): parseConnectorRef ("crm" | "acme/crm" | "acme.crm"),
  listVendors, findConnectorDir — bare connector names are discovered across
  vendor dirs; ambiguous matches ask for <vendor>/<connector>.
- resolveConnectorsDir: workspace = src/ with a vendor dir holding a connector
  manifest (src/appmixer still counts even when empty, for fresh workspaces).
- appmixer-flow.mjs: upload-all/create-account accept vendor-qualified refs;
  auth service is <vendor>:<connector>; auth.js path via findConnectorDir.
- run-e2e-flows runner: root derived from the src/<vendor> anchor; connector
  prefixes keep the vendor segment; account services are vendor-aware; scopes
  lookup maps type -> src/<type segments>.
- generate-e2e-flows validators: shared isConnectorComp predicate (>=3 dotted
  segments, not appmixer.utils.*) replaces the startsWith('appmixer.') gates;
  coverage/private lookups map types through src/<vendor>/....
- Docs generalized to src/<vendor>/<connector> and <vendor>:<connector>;
  new-connector gathers the vendor in Step 1 (cwd > single vendor > ask,
  default appmixer); references re-synced.
- Smoke tests: custom-vendor workspace resolution + bare-name vendor discovery
  (23 checks).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UzfsFVGKsRrqmvG1bBNsvJ

* docs: explain vendors and vendor detection in READMEs

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UzfsFVGKsRrqmvG1bBNsvJ

* docs: Getting Started walkthrough (install -> workspace -> vendor -> first connector)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UzfsFVGKsRrqmvG1bBNsvJ

* feat!: main carries only dependency-free skills; E2E skills move to the dev branch

Wave split: main now ships 4 pure-instruction skills (new-connector,
test-components, review-component-standards, connector-test-method) whose only
external tool is the appmixer CLI — no bundled scripts, no install steps, no
env configuration, no bundle download. Removed from main: generate-e2e-flows,
upload-e2e-flows, run-e2e-flows, _shared/ + e2e-shared/ runtime helpers,
ensure-deps + SessionStart hook, .env.example, build.sh + dist bundle,
clean-box harness. They continue on the dev branch until their tooling lands
in the appmixer CLI, then return as pure instructions.

new-connector's pipeline ends at publish (appmixer CLI); the E2E steps point
to the dev branch. Smoke test reduced to: references sync, manifest
consistency, example-file parsing, and a no-script-references guard.
* the e2e skills are no longer distributed from main.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UzfsFVGKsRrqmvG1bBNsvJ

* chore: final polish (JSON escaping, stale gitignore entries)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UzfsFVGKsRrqmvG1bBNsvJ

* update

* fix: drop appmixer-connectors tooling dependencies from instructions

Unit tests run via plain mocha (repo's npm run test-unit noted as optional),
outputType compliance and camelCase rules stand without repo CI scripts,
canonical lib.js points at the bundled examples/find-tasks/lib.js, the
workspace tree drops repo-specific test/ scaffolding, and new-connector's
lint+validator step is explicitly optional workspace-provided tooling.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UzfsFVGKsRrqmvG1bBNsvJ

### Features

* bundle instructions, merge skills (new-connector, test-components), drop GitHub-issue dependency ([#3](https://github.com/Appmixer-ai/appmixer-skills/issues/3)) ([fd3af73](https://github.com/Appmixer-ai/appmixer-skills/commit/fd3af730288983818abc7a85db4fed5612ce9869))
* git safety rules for pushing skills (confirm target, feature branches only, fork guidance) ([b7aa9ea](https://github.com/Appmixer-ai/appmixer-skills/commit/b7aa9ea80648541f56c8e415948dcbf72361e533))
* rename skills (build/test/review-connector), fold connector-test-method in, pipeline = build → review → test → publish ([#4](https://github.com/Appmixer-ai/appmixer-skills/issues/4)) ([df7b179](https://github.com/Appmixer-ai/appmixer-skills/commit/df7b17962273a12b6bfe7de4b4ab1ce7d96b9a54))
