# Development Instructions for Agents

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
