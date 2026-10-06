# Development Instructions for Agents

## Fixing a Bug in an Existing Component

1. **Measure the cause before you write it down.** Reproduce it against the live
   API or read it out of the flow logs. A cause that goes into a PR description or
   a changelog must be an observation, not a guess.
2. **Keep the fix inside the existing structure and limit it to what the bug
   needs.** No refactoring, no new capability, no handling of states you have not
   seen. Report further improvements separately and let the user decide.
3. **One regression test that fails on the old code**, plus a test of the
   behaviour that must stay. Not a suite.

Why: the reviewer has to see the fix. Real case: a trigger fired old records as
new. The first fix was +327 lines — pagination, a state migration, a query helper
and ten tests — and was sent back as too big. The migration guarded against an
ordering problem that was assumed, not measured, and did not exist. The fix that
replaced it is about 15 lines in the original `tick()`.

## Capturing New Learnings

As you work on connectors, you will discover information that is not yet
documented: gotchas, undocumented API behaviors, edge cases, patterns that
turned out to matter.

These instructions are the **single source of truth** — this repo's
`instructions/` directory. Consumer repositories (appmixer-connectors' Copilot
instructions, each skill's `references/`) are generated or synced copies; a
learning written into a copy is lost on the next sync.

1. **Capture insights** where they belong: add them to the appropriate
   `instructions/*.md` file **in this repository** (a pull request when you
   work elsewhere).
2. **Be concise**: brief and actionable.
3. **Include context**: explain *why* it matters, not just *what* it is.

### Example

Instead of:
> "The email quota endpoint sometimes times out"

Write:
> "The email quota endpoint can time out when the database is under heavy
> load. If tests show timeout errors, raise the query timeout or check for
> long-running queries first."

Commit such updates as documentation improvements:

```
docs(instructions): add note about email quota endpoint timeouts
```

After a change here, run `node scripts/sync-references.mjs` so the skills'
`references/` copies stay in sync (CI checks this with `--check`).
