# Appmixer Skills — Architecture

How the skills in this directory work and what they depend on. For installation
and a skill-by-skill overview see the [root README](../README.md).

## Skills — how they work

Every skill is **pure instructions for the host agent** (e.g. a Claude Code
session) — no skill spawns its own LLM sub-agent, runs bundled scripts, or
reads environment variables. `SKILL.md` describes the procedure and the agent
executes it directly with its own tools: `new-connector`, `test-components`,
`review-component-standards`, `connector-test-method`. Where a real tool is
needed (component testing, publishing), the skills drive the external
[`appmixer` CLI](https://www.npmjs.com/package/appmixer) — the only
prerequisite.

Each skill directory is fully self-contained (`SKILL.md` + `references/`), so
per-skill installs (`npx skills`, manual copy) work without any shared helpers
or post-install downloads.

> The **E2E skills** (`generate-e2e-flows`, `upload-e2e-flows`,
> `run-e2e-flows`) live on the `dev` branch together with their runtime
> scripts (`_shared/`, `e2e-shared/`) while that tooling moves into the
> appmixer CLI. Once the CLI commands exist they return here as pure
> instructions.

## The connector workspace

The skills scaffold, test and review connectors inside a local **workspace** —
any directory containing `src/<vendor>/<connector>/` (`appmixer` is only the
default vendor namespace; several vendors can live side by side). Run your
agent from inside it — the skills resolve the workspace and the vendor from
the cwd and from the data at hand (component names carry the vendor as their
first segment). `APPMIXER_SKILL_CONNECTORS_DIR` is an optional override for
running from elsewhere (CI, git worktrees). A clone of
[appmixer-connectors](https://github.com/appmixer-ai/appmixer-connectors)
works as a workspace and doubles as a library of real-world example
connectors, but a customer's own workspace works just as well.

## Design conventions (references sync)

The connector **design conventions** ship inside the skills that use them
(`new-connector`, `review-component-standards`), in each skill's `references/`
directory — including complete example files in `references/examples/`. The
canonical source is `instructions/` at the repo root;
`node scripts/sync-references.mjs` copies it into the skills (the smoke test
checks the copies with `--check`). Edit `instructions/`, never the copies. The
workspace itself does not need to provide any conventions.
