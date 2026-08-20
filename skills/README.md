# Appmixer Skills — Architecture

How the skills in this directory work and what they depend on. For installation
and a skill-by-skill overview see the [root README](../README.md).

## Skills — how they work

Every skill is **instructions for the host agent** (e.g. a Claude Code
session) — no skill spawns its own LLM sub-agent. `SKILL.md` describes the
procedure and the agent executes it directly with its own tools:
`build-connector`, `test-connector`, `review-connector`. Where a real tool is
needed (component testing, publishing), the skills drive the external
[`appmixer` CLI](https://www.npmjs.com/package/appmixer) — the only
prerequisite.

Each skill directory is self-contained (`SKILL.md` + `references/`), so
per-skill installs (`npx skills`, manual copy) work without post-install
downloads.

> **E2E flow testing** also runs through the CLI: the flow validator
> (`appmixer flow validate`) and the deterministic runner
> (`appmixer flow run-e2e`) ship with it — the skills bundle no scripts. E2E
> flow *generation* instructions ship with `build-connector`
> (`references/11-e2e-flow-generation.md`).

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
(`build-connector`, `review-connector`), in each skill's `references/`
directory — including complete example files in `references/examples/`. The
canonical source is `instructions/` at the repo root;
`node scripts/sync-references.mjs` copies it into the skills (the smoke test
checks the copies with `--check`). Edit `instructions/`, never the copies. The
workspace itself does not need to provide any conventions.
