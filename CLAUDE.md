# appmixer-skills

Agent skills for Appmixer connector development, distributed as a Claude Code
plugin and via the Open Agent Skills protocol.

## Branching — `dev` is where work goes

**All development targets `dev`. Never open a PR against `main`.**

`main` is release-only: once work on `dev` has been through testing, a release
promotes it to `main`. Nothing lands on `main` by hand.

```
feature branch ──PR──▶ dev ──release──▶ main
```

This is not just convention here — `main` and `dev` genuinely diverge, and a
change sitting only on a local branch is invisible to everything downstream.
Check `git log upstream/dev..HEAD` rather than `upstream/main..HEAD` when
working out what a branch actually adds.

### Why `dev` specifically

`appmixer-connectors` consumes this repo from the **`dev` branch**. Its scheduled
`sync-instructions` workflow downloads
`codeload.github.com/Appmixer-ai/appmixer-skills/tar.gz/refs/heads/dev`,
regenerates `.github/copilot-instructions.md` from `instructions/`, and opens a
PR into that repo's own `dev`. The source comment in
`appmixer-connectors/scripts/build-instructions.js` says it outright: *"The DEV
branch, on purpose: this repo's dev tracks the skills repo's dev."*

So an instructions change only reaches connector development once it is on `dev`
here. Parking it on `main`, or on an unpushed local branch, means the connector
pipeline never sees it.

## Repo layout

- `instructions/` — the canonical rule files. **Edit here.**
- `skills/*/references/` — per-skill copies, generated from `instructions/`.
  Never edit directly; run `node scripts/sync-references.mjs` and commit the
  result. `npm test` fails when they drift.
- `skills/*/SKILL.md` — the skill itself.

### Every reference file must be cited by its SKILL.md

A file in `references/` that no `SKILL.md` names is invisible: the agent is never
told to read it, so the rule silently does not apply — no error, no warning, the
file just sits there looking maintained. This is how `14-async-components.md` went
unused across all three skills and let a whole class of connector defect through
both the build and the review side.

`npm test` enforces this. When you add a reference file, add it to the skill's
Design Reference table **and** give the rule an entry in the relevant checklist —
being listed is necessary but not sufficient, because a reviewer also has to be
told *when* the rule applies.

## Conventions

- **Conventional commits.** `commit-and-tag-version` derives releases and the
  changelog from them, so the prefix matters (`fix:`, `feat:`, `docs:`).
- **Don't hand-edit skill `version:` fields.** `.versionrc.json` bumps them at
  release time.
- **`npm test`** is the smoke test: reference sync, skill manifests, example
  files parse, no stale script-era references, no orphaned references. Fast,
  offline, no LLM. Run it before pushing.
- Examples under `instructions/examples/` are copied into two `references/`
  trees, so a fix there needs applying to all three copies (or synced).
