# Development Instructions for Agents

## Fixing a Bug in an Existing Component

1. **Measure the cause before you write it down.** Reproduce it against the live
   API or read it out of the flow logs. A cause that goes into your report or
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

The files you read these rules from (a skill's `references/`) are copies of
the skills' instructions and are replaced on the next update, so a learning
written into them is lost.

1. **Capture insights** where they last: in the connector itself (a comment
   at the code it concerns, its README) and in your report to the user, as a
   suggested note for the instructions with the file it belongs in.
2. **Be concise**: brief and actionable.
3. **Include context**: explain *why* it matters, not just *what* it is.

### Example

Instead of:
> "The email quota endpoint sometimes times out"

Write:
> "The email quota endpoint can time out when the database is under heavy
> load. If tests show timeout errors, raise the query timeout or check for
> long-running queries first."
