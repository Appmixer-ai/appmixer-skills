# Appmixer Skills — Architecture

How the skills in this directory work, what they depend on, and how configuration
is resolved. For installation and a skill-by-skill overview see the
[root README](../README.md).

## Skills — how they work

The skills in `skills/` are **instructions for the host agent** (e.g. a Claude
Code session) — no skill spawns its own LLM sub-agent. Two shapes:

1. **Pure instructions** — `SKILL.md` describes the procedure and the agent executes
   it directly with its own tools: `init-connector`, `plan-CLI-tests`,
   `run-CLI-tests`, `review-component-standards`, `generate-E2E-test-flows`,
   `connector-pipeline`.
2. **Instructions + deterministic script** — the agent drives a Node script with no
   LLM inside:
   - `run-e2e-flows/scripts/run.js` — E2E runner (explicit state machine;
     exit `0` = passed, `1` = hard fail incl. OAuth-scope diagnosis, `2` = NEEDS_FIX
     brief for the agent; ends with a `RESULT | STATUS | flow | designer URL` line)
   - `e2e-shared/scripts/appmixer-flow.mjs` — CLI for publish/upload workflows
   - `generate-E2E-test-flows/validate.js` — flow validator (16 rules, incl. the
     mandatory `errorHandling: { autoRetry: false, onError: "stopFlow" }`)

Configuration comes from env vars (`APPMIXER_SKILL_*`, `APPMIXER_SKILL_CONNECTORS_DIR`, …) —
see `.env.example`. Node deps are installed by `scripts/ensure-deps.sh` (idempotent).

### Dependency on `appmixer-connectors`

The skills are tooling **for** the [appmixer-connectors](https://github.com/clientIO/appmixer-connectors)
repo — they scaffold, test and review connectors inside a checkout of it. A
checkout is therefore required at runtime: set `APPMIXER_SKILL_CONNECTORS_DIR` to its
root, or run from inside the repo (`skills/_shared/resolveConnectorsDir.js` is
the shared resolver).

The connector **design conventions** (`.github/instructions/*.md`) deliberately
live in that repo, not here: they describe that codebase, are edited in the same
PRs as the connector code, and feed its own tooling (the generated
`copilot-instructions.md`, CI responder, CLAUDE.md). Skills read them from the
checkout like a linter reads a project's config — this plugin carries the
*process*, the target repo carries the *rules*. Skills that need the
conventions verify `<connectors>/.github/instructions/` exists before starting
and abort with a clear message when it's missing.

> **Note:** the `skills/*/agent/` directories are legacy sub-agent implementations —
> current SKILL.md files no longer reference them.

### Installing as a Claude Code plugin

```bash
/plugin marketplace add Appmixer-ai/appmixer-skills
/plugin install appmixer@appmixer-agents
```

Claude Code does NOT configure secrets during install — create an env file and
point the skills at it (any path works):

```bash
cp <plugin-dir>/.env.example ~/appmixer-skills.env   # then fill in credentials
export APPMIXER_ENV=~/appmixer-skills.env
```

Required: `APPMIXER_SKILL_API_URL`, `APPMIXER_SKILL_USERNAME`,
`APPMIXER_SKILL_PASSWORD`, `APPMIXER_SKILL_CONNECTORS_DIR`; `init-connector` additionally
expects an authenticated `gh` CLI. No LLM API keys are needed — the skills run directly in the
host agent. Full list: `.env.example`. Alternatively, export the individual
`APPMIXER_SKILL_*` variables in your shell and skip the file.

Note: `APPMIXER_SKILL_ROOT` (path to this `skills/` directory) equals
`CLAUDE_PLUGIN_ROOT` when running as a plugin — SKILL.md commands use
`${APPMIXER_SKILL_ROOT:-$CLAUDE_PLUGIN_ROOT}`, so you only set it for
non-plugin installs. The SessionStart hook (`hooks/hooks.json` →
`scripts/ensure-deps.sh`) installs Node deps idempotently on session start.
Requires Node ≥ 18.

## Configuration resolution

At runtime every script reads plain `process.env`:

- `APPMIXER_ENV` (optional) — path to a `.env` file; the E2E scripts
  (`run-e2e-flows/scripts/run.js`, `e2e-shared/scripts/appmixer-flow.mjs`) load
  it via dotenv before reading the variables. `appmixer-flow.mjs` prints the
  effective env file + target instance on stderr as its first line — read it to
  confirm you're talking to the right instance.
- Without `APPMIXER_ENV`, variables already exported in the shell are used as-is.
- `APPMIXER_SKILL_CONNECTORS_DIR` — if unset, `resolveConnectorsDir.js` walks up
  from the current working directory looking for a directory containing
  `src/appmixer`.
