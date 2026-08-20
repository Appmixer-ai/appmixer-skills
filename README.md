# Appmixer Skills for AI Coding Agents

Give your AI coding agent deep Appmixer connector-development expertise — scaffold connectors, run CLI tests, and review components against Appmixer standards. Works with Claude Code via a dedicated plugin, and with Cursor, GitHub Copilot, Windsurf, Cline, and [40+ other agents](https://skills.sh) via the [Open Agent Skills](https://skills.sh) protocol.

> **Recommended:** The Claude Code plugin gives the best experience — all skills load automatically, with no manual setup.

## Skills

| Skill | What it does |
|-------|-------------|
| **build-connector** | The end-to-end pipeline: build (requirements → research → scaffold incl. trigger `test()`) → review → test → publish |
| **test-connector** | Test a connector: CLI component test+fix cycle, plus E2E flow testing on a live instance (upload flows, run, evaluate, fix loop) |
| **review-connector** | Read-only audit of connector components against Appmixer standards (incl. trigger `test()` rules) |

All three skills are pure instructions; the only external tool they drive is
the [`appmixer` CLI](https://www.npmjs.com/package/appmixer) — including E2E
flow testing, which uses the CLI's built-in `appmixer e2e` command family
(`import`, `run`, `list`, `results`, `export`, `validate`, `rm`).

### build-connector

Drives the whole connector lifecycle: gathers requirements, reads the service's
API docs, scaffolds `service.json`/`auth.js`/`quota.js` and every component
(actions, triggers with `test()` for Flow Test Mode, dynamic dropdown sources
with caching), then hands off to review, testing, and publishing. Also handles
smaller jobs inside an existing connector — adding components or retrofitting a
`test()` method onto a trigger. Progress persists in
`artifacts/ai-artifacts/pipeline-state.json`, so an interrupted build resumes
where it stopped.

Example prompts:

> Create an Appmixer connector for PostHog under vendor `acme`. Auth is a
> Personal API key; I want CaptureEvent, FindPersons, ListFeatureFlags and a
> NewAnnotation trigger.

> Add a DeleteContact component to the existing `acme.crm` connector.

> The `NewTicket` trigger in our freshdesk connector has no `test()` method —
> add one so Flow Test Mode works.

> Continue building the posthog connector where we left off.

### test-connector

Tests components with real API calls via `appmixer test component`. Writes a
dependency-ordered test plan first (create → find → get → update → delete, so
earlier outputs feed later inputs), resolves every entity-reference input to a
real ID (never placeholders), then runs the test+fix loop — on failure it reads
the error, fixes the component, and re-tests (max 3 iterations per component).
Results land in `artifacts/ai-artifacts/test-plan.json`. Auth is set up through
`appmixer test auth login` (the browser step is yours). Heads-up: tests spend
API credits, so the agent always asks before running them.

Also covers **E2E flow testing on a live Appmixer instance**: publishes the
connector, imports the flow JSONs from `artifacts/test-flows/` (generated
during the build) with `appmixer e2e import` — which binds auth accounts and
validates variables — then runs each flow with `appmixer e2e run --fix` and
drives the fix loop until the flows pass.

Example prompts:

> Test the posthog connector.

> Write a test plan for `acme.posthog` but don't run anything yet.

> Test just the CaptureEvent component.

> Upload and run the E2E flows for `acme.posthog`.

> FindPersons failed with a 400 — figure out why and fix it.

### review-connector

Read-only audit — produces a findings table (severity, rule id, suggested fix)
plus a list of passed checks, and never modifies files. Checks component.json
contracts (typed output schemas with examples, inspector/schema type pairing),
behavior patterns (required-input asserts, outputType helpers, pagination),
dynamic-source rules (text inputs, caching, error suppression), and trigger
`test()` quality. Useful standalone on connectors the agent didn't build —
e.g. before publishing a hand-written or legacy connector.

Example prompts:

> Review the `acme.posthog` connector.

> Audit `acme.posthog.core.NewAnnotation` against the trigger rules.

> Review our old salesforce connector and tell me what would block publishing —
> don't change anything.

## E2E flow testing

End-to-end testing against a live Appmixer instance is pure instructions too —
all the tooling is the CLI's built-in `appmixer e2e` command family. Flows live
in the workspace under `src/<vendor>/<connector>/artifacts/test-flows/` and are
identified on the instance by customFields
(`category=E2E_test_flow`, `connector=<vendor>:<connector>`, `name=<test case>`),
so the agent loop is:

```sh
appmixer e2e import src/<vendor>/<connector>/artifacts/test-flows   # validate, upload,
                                                                    # stores, accounts
appmixer e2e list -c <vendor>:<connector> --json                    # flow IDs
appmixer e2e run <flowId> --fix     # run + watch; exit 2 = FIX BRIEF → the agent
                                    # edits the flow JSON, re-imports, re-runs
appmixer e2e results -c <vendor>:<connector>                        # stored results
```

Flow *generation* rules ship with `build-connector`
(`references/11-e2e-flow-generation.md`); upload/run procedures with
`test-connector` (`references/12-e2e-upload.md`, `references/13-e2e-run.md`).

See [skills/README.md](skills/README.md) for architecture details (how the skills work, the references sync).

## Getting Started

The complete zero-to-first-connector path — nothing else is needed:

**1. Install the skills** (Claude Code shown; other agents: [Installation](#installation)):

```bash
claude
/plugin marketplace add Appmixer-ai/appmixer-skills
/plugin install appmixer@appmixer-agents
```

**2. Create a workspace** — a folder with `src/<vendor>/` inside. The vendor is your namespace; pick your company name, or just use `appmixer`:

```bash
mkdir -p my-connectors/src/acme
cd my-connectors
```

**3. Start your agent inside the workspace** (that's how the skills find it — no configuration needed):

```bash
claude
```

**4. Build your first connector** — describe what you want in plain language:

> Create a new connector for the Cat Facts API (https://catfact.ninja), vendor `acme`, with components GetFact and ListBreeds.

The `build-connector` skill reads the API docs and scaffolds everything:

```
my-connectors/
└── src/acme/catfacts/
    ├── service.json          # name: acme.catfacts
    ├── bundle.json
    ├── auth.js
    ├── quota.js
    └── core/
        ├── GetFact/     — component.json + GetFact.js
        └── ListBreeds/  — component.json + ListBreeds.js
```

(Cat Facts needs no API key, so it's a good dry run — for a real service the agent asks for credentials when testing starts.)

**5. Test it** — say:

> Test the catfacts components.

Requires the [`appmixer` CLI](https://www.npmjs.com/package/appmixer) (`npm i -g appmixer`); the agent tells you if anything is missing.

**6. (Optional) Publish to your Appmixer instance** — say "publish the catfacts connector"; the agent drives `appmixer pack` + `appmixer publish` (and tells you how to configure the CLI if it isn't yet).

## Prerequisites

- Node.js >= 18
- A local **connector workspace** — any directory containing `src/<vendor>/` that the skills write connector code into (`appmixer` is only the default vendor namespace — a workspace can use any vendor, or several side by side). This can be your own (git-managed) workspace, or a clone of [appmixer-connectors](https://github.com/appmixer-ai/appmixer-connectors) (which also serves as a library of real-world example connectors):
  ```bash
  git clone https://github.com/appmixer-ai/appmixer-connectors.git
  ```
  The connector design conventions ship inside the skills (each skill's `references/` directory) — the workspace does not need to provide them. When the workspace is a git repo, skills commit generated code to feature branches and ask before the first push of a session.
- The [`appmixer` CLI](https://www.npmjs.com/package/appmixer) (`npm i -g appmixer`) — used for component testing and publishing; configure with `appmixer url` + `appmixer login`

## Vendors

Connectors live under `src/<vendor>/<connector>/`, and component names mirror the disk layout: `<vendor>.<connector>.<module>.<Component>`. The `<vendor>` segment is a namespace — **`appmixer` is only the default**; a customer workspace can use its own vendor name, or several vendors side by side. (Built-in `appmixer.utils.*` components — OnStart, Assert, ProcessE2EResults — always keep the `appmixer` vendor; they ship with the engine.)

The skills determine the vendor without extra configuration:

1. **From data** — flow JSONs, component names and file paths all carry the vendor; where one is at hand, nothing is asked.
2. **From your location** — running from inside `src/<vendor>/` selects that vendor.
3. **By discovery** — a bare connector name is searched across all vendor dirs; a single match wins, an ambiguous one asks you to qualify it as `<vendor>/<connector>`.
4. **When scaffolding a new connector**, `build-connector` asks for the vendor if it can't be inferred (default suggestion: `appmixer`).

## Installation

### Claude Code Plugin ⭐ Recommended

```bash
claude
/plugin marketplace add Appmixer-ai/appmixer-skills
/plugin install appmixer@appmixer-agents
```

All 3 skills load automatically, namespaced as `appmixer:build-connector`, `appmixer:test-connector`, `appmixer:review-connector`.

### Claude Code Plugin (Manual)

```bash
git clone https://github.com/Appmixer-ai/appmixer-skills.git
claude
/plugin add /path/to/appmixer-skills
```

### Claude Desktop / Claude.ai

Each skill directory under `skills/` is self-contained (SKILL.md + `references/`) — zip the ones you want and upload them to your project.

### Cursor, GitHub Copilot, Windsurf, Cline, and others (via Open Agent Skills)

```bash
npx skills add Appmixer-ai/appmixer-skills
```

By default the CLI opens an interactive skill picker (when it can't auto-detect your agent). For a non-interactive install of everything — scripts, CI, containers — pass the flags explicitly:

```bash
npx skills add Appmixer-ai/appmixer-skills --agent claude-code --skill "*" -y
```

Installs all skills into your agent's skills directory. Works with any agent that supports the [Open Agent Skills](https://skills.sh) protocol. Each skill directory is fully self-contained — no shared helpers, no post-install downloads.

### Manual Installation (Any Agent)

Copy the skill directories from `skills/` into your agent's skills folder — each one is self-contained:

| Agent | Skills directory |
|-------|-----------------|
| Claude Code | `.claude/skills/` |
| Cursor | `.cursor/skills/` |
| Windsurf | `.windsurf/skills/` |
| Cline | `.cline/skills/` |
| Generic | `.agents/skills/` |

## Configuration

Almost none. The skills find the workspace from the directory you run your agent in, and instance access goes through the `appmixer` CLI (`appmixer url` + `appmixer login`).

Optional knobs, all environment variables:

- `APPMIXER_SKILL_CONNECTORS_DIR` — workspace root override when running your agent from outside the workspace (CI, git worktrees).
- `APPMIXER_SKILL_API_URL` / `APPMIXER_SKILL_USERNAME` / `APPMIXER_SKILL_PASSWORD` — credentials for the E2E commands; the CLI loads them from exported vars, the file `$APPMIXER_ENV` points to, or `~/.config/appmixer-skills/env` (the skills offer to write that file on first E2E use). Without them the E2E commands fall back to the CLI's own `appmixer url` + `appmixer login` session.
- `APPMIXER_SKILL_ACCOUNT_ID` — pins the auth account bound to connector components during `appmixer e2e import`.
- `APPMIXER_SKILL_UI_URL` — designer base URL, used to print clickable flow links in E2E results.

## Releasing (maintainers)

```bash
npm install
npm test               # smoke tests: references sync, manifest consistency, example files parse
npm run release        # bumps version everywhere, updates CHANGELOG, tags
git push --follow-tags
```

Versions are kept in sync across `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, and every `SKILL.md` frontmatter via [.versionrc.json](.versionrc.json). Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, …) so the changelog generates itself.

## License

MIT
