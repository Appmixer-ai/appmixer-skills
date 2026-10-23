# Connector evals

How well does a coding agent build an Appmixer connector with these skills,
what does it cost, and did the last change to the skills, the prompt or the
model make it better or worse?

`npm test` checks that the skills are well-formed. This measures whether they
work: an agent gets a task in a sandboxed connectors checkout, and its output
is graded by the same tools that gate a real PR.

## Running

```bash
# Grade the reference solutions themselves: no agent, no cost.
# Every task must pass. If one doesn't, the task or a grader is broken.
npm run eval -- oracle

# Baseline: every task, two models, three runs each
npm run eval -- run --models claude-opus-5-5,claude-sonnet-5-5 --k 3

# The skills on another branch, e.g. before merging a change into dev
git worktree add /tmp/skills-feature my-branch
npm run eval -- run --tasks small --skills /tmp/skills-feature --label my-branch

# Rewrite the report for a results directory
npm run eval -- report evals/results/<stamp>
```

Results go to `evals/results/<stamp>/` (git-ignored): per run a
`.result.json`, the agent's full `.trace.jsonl` and its `.patch`, plus a
`report.md` for the whole batch.

Prerequisites: a local clone of appmixer-connectors with `node_modules`
installed (`EVAL_CONNECTORS_REPO` points elsewhere than `~/Projects/appmixer-connectors`)
and that contains the pinned commit, the `appmixer` CLI and `claude` on the PATH.

## Tasks

Every task is cut from appmixer-connectors at the commit pinned in
`source.json`: the target is deleted from the tree, and the agent has to build
it back from an issue-style prompt.

- **small** — one component deleted from a connector that is otherwise intact.
  Cheap, so there can be many of them, and quick to give a signal.
- **large** — the whole connector deleted. The prompt is the original issue.

Only connectors that pass `connector validate` cleanly at the pinned commit
are used. At the time of writing that is 25 of 166: most connectors predate
some of the rules. Grading an agent against a reference that fails the
validator itself would make the numbers meaningless.

## Graders

- **coverage** — the expected component ids exist (and, for large tasks, any
  extra components the agent added)
- **validator** — `appmixer connector validate --json`, failures by rule
- **eslint** — the repo's config over the connector
- **input / output overlap** — Jaccard similarity of field names against the
  reference `component.json`. A soft signal of how faithfully the agent
  modelled the API, not a pass/fail.
- **auth match** — large tasks: same auth type as the reference

**Gate** = every expected component exists, and the validator and eslint are
clean. The report gives gate pass rate, cost, turns and time per task and
model, and **$ per passing run** per variant.

The validator checks structure, not behaviour. A component can pass the gate
and still crash on an empty result. Behavioural graders (`connector verify
--offline` against recorded samples, an LLM judge calibrated on past review
findings) are the next step.

## Keeping it fair

- The sandbox is a `git archive` of the pinned commit with a fresh one-commit
  git. The real history isn't there, so `git log --all` cannot reveal the
  solution.
- For small tasks, artifact files (test flows, samples) that name the deleted
  component are removed too.
- The connectors repo is public, so WebFetch to GitHub is denied, and any
  tool call that touches the reference repo is flagged in the report as a
  possible leak.
- Agent isolation:
  - Its own `.claude/settings.json`: the repo's settings would load the
    published plugin next to the one under test.
  - No user settings or MCP servers, auto-memory off, no GitHub tokens in the
    environment.
  - The skills come only from `--plugin-dir`, a copy of the skills checkout
    without `evals/` (task definitions and earlier runs' patches would give
    the answers away).
  - With `ANTHROPIC_API_KEY` set, the run also uses `--bare`.
- Tools are an allow-list modelled on the issue-to-connectors workflow, minus
  push, PR creation and `connector verify`. The CLI configstore may hold real
  credentials, and the eval stays offline. `find` and `grep` are allowed via
  Bash, because current Claude Code has no Glob/Grep tools.

Known confound: the sandbox carries `.github/copilot-instructions.md`, which
is generated from `instructions/` on dev. When you compare skills variants,
that copy stays the same across them.
