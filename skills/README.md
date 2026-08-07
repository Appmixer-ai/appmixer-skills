# Appmixer Skills — Architecture

How the skills in this directory work, what they depend on, and how configuration
is resolved. For installation and a skill-by-skill overview see the
[root README](../README.md).

## Skills — how they work

The skills in `skills/` are **instructions for the host agent** (e.g. a Claude
Code session) — no skill spawns its own LLM sub-agent. Two shapes:

1. **Pure instructions** — `SKILL.md` describes the procedure and the agent executes
   it directly with its own tools: `new-connector`, `test-components`,
   `review-component-standards`, `generate-e2e-flows`.
2. **Instructions + deterministic script** — the agent drives a Node script with no
   LLM inside:
   - `run-e2e-flows/scripts/run.js` — E2E runner (explicit state machine;
     exit `0` = passed, `1` = hard fail incl. OAuth-scope diagnosis, `2` = NEEDS_FIX
     brief for the agent; ends with a `RESULT | STATUS | flow | designer URL` line)
   - `e2e-shared/scripts/appmixer-flow.mjs` — CLI for publish/upload workflows
   - `generate-e2e-flows/validate.js` — flow validator (16 rules, incl. the
     mandatory `errorHandling: { autoRetry: false, onError: "stopFlow" }`)

Configuration comes from env vars (`APPMIXER_SKILL_*`) —
see `.env.example`. Node deps are installed by `scripts/ensure-deps.sh` (idempotent).

### The connector workspace

The skills scaffold, test and review connectors inside a local **workspace** —
any directory containing `src/<vendor>/<connector>/` (`appmixer` is only the default vendor namespace; several vendors can live side by side). Run your agent from inside it; the
skills and scripts resolve the workspace root by walking up from the cwd
(`skills/_shared/resolveConnectorsDir.js` is the shared resolver). The vendor
of a bare connector name is discovered across vendor dirs by
`skills/_shared/vendors.js` (`findConnectorDir`) — ambiguous matches must be
qualified as `<vendor>/<connector>`; component types carry the vendor as their
first segment, so flow-driven tooling derives it from data.
`APPMIXER_SKILL_CONNECTORS_DIR` is an optional override for running from
elsewhere (CI, git worktrees). A clone of
[appmixer-connectors](https://github.com/appmixer-ai/appmixer-connectors) works
as a workspace and doubles as a library of real-world example connectors, but a
customer's own workspace works just as well.

The connector **design conventions** ship inside the skills that use them
(`new-connector`, `review-component-standards`, `run-e2e-flows`), in each
skill's `references/` directory — including complete example files in
`references/examples/`. The canonical source is `instructions/` at the repo
root; `node scripts/sync-references.mjs` copies it into the skills (CI checks
the copies with `--check`). Edit `instructions/`, never the copies. The
workspace itself does not need to provide any conventions.

> **Note:** the `skills/*/agent/` directories are legacy sub-agent implementations —
> current SKILL.md files no longer reference them.

### Installing as a Claude Code plugin

```bash
/plugin marketplace add Appmixer-ai/appmixer-skills
/plugin install appmixer@appmixer-agents
```

Claude Code does NOT configure secrets during install — configuration happens on
first use: when a skill finds no config, it asks the user for the values and
writes `~/.config/appmixer-skills/env` itself. To configure manually instead:

```bash
mkdir -p ~/.config/appmixer-skills
cp <plugin-dir>/.env.example ~/.config/appmixer-skills/env   # then fill in
```

Required (live-instance skills only): `APPMIXER_SKILL_API_URL`,
`APPMIXER_SKILL_USERNAME`, `APPMIXER_SKILL_PASSWORD`. No LLM API keys are
needed — the skills run directly in the host agent. Full list: `.env.example`.

Note: `APPMIXER_SKILL_ROOT` points at the full skills directory (the one
containing `_shared/`). The setup block in each affected SKILL.md resolves it
automatically: plugin root when running as a Claude Code plugin, otherwise
`~/.appmixer-skills/appmixer` — downloading the bundle there first when the
shared helpers are missing (per-skill installs via `npx skills` or manual
copies). The SessionStart hook (`hooks/hooks.json` → `scripts/ensure-deps.sh`)
installs Node deps idempotently on session start. Requires Node ≥ 18.

## Configuration resolution

Every script entrypoint calls `_shared/loadEnv.js`, which loads configuration
into `process.env` with this precedence:

1. Variables already exported in the shell always win (dotenv never overrides).
2. `APPMIXER_ENV` — explicit path to an alternate config file, when set (useful
   for switching between instances).
3. `~/.config/appmixer-skills/env` — the well-known default, when it exists.
   Skills create it on first use by asking the user for the values.

`appmixer-flow.mjs` prints the effective config file + target instance on stderr
as its first line — read it to confirm you're talking to the right instance.

The connector workspace is resolved from the current working directory
(`resolveConnectorsDir.js` walks up looking for a directory containing
`src/<vendor>/` with connectors); `APPMIXER_SKILL_CONNECTORS_DIR`, when set, overrides it.
