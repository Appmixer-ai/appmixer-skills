---
name: ship-connector
description: Run the whole connector pipeline in one command — pre-flight, build, review, CLI tests, E2E on a live instance, publish, and open the PR — with one upfront budget approval instead of per-step questions. Use when the user wants a connector built and tested end to end without babysitting, an unattended/automated/CI connector run, or to ship a connector from a GitHub requirements issue. Triggers on "ship connector", "connector pipeline", "build and test end to end", "unattended connector build", "ship from issue".
license: MIT
metadata:
  author: Appmixer
  version: "0.2.2"
  homepage: https://www.appmixer.com
  repository: https://github.com/Appmixer-ai/appmixer-skills
---

# Ship Connector

One command from requirements to an open PR. This skill is a **thin
orchestrator**: all connector knowledge lives in the three skills it chains —
`build-connector` (scaffold + components + E2E flow generation),
`review-connector` (standards audit), `test-connector` (CLI tests + E2E on a
live instance). This file adds only the gate policy (one upfront approval, a
budget, deterministic stop conditions) and the final ship steps (commit, push,
PR).

**Read `references/15-unattended-mode.md` first** — it is the contract this
skill runs under: activation rules, budget semantics, gate resolutions,
pre-flight checks, stop brief format. Everything below assumes it.

## Inputs

- **Connector name + vendor** — as in `build-connector` Step 1a, OR
- **A GitHub requirements issue** — number or URL. Read it with
  `gh issue view <n> --repo <owner>/<repo> --json title,body`; a well-formed
  connector issue carries auth type, API surface, suggested components and
  triggers — use it as the requirements input to `build-connector` Step 1a
  instead of interrogating the user.
- **Target instance** (API URL) and **e2e user** for the E2E phase.
- **Budget** — `maxCredits` / `maxMinutes` / `maxFixAttempts`
  (defaults per `15-unattended-mode.md`; state whatever is used).

## The one gate

Before anything runs, present a single approval containing: connector name,
component list (or the issue link that defines it), target instance, push
remote + branch, and the budget. The user's approval of THIS summary is the
activation described in `15-unattended-mode.md` — after it, no further
questions until the run ends or a stop condition fires. When the skill is
invoked from an already-unattended context (CI, a scheduled run whose setup
approved the budget), the approval is carried by that context — print the same
summary into the report instead of asking.

## Pipeline

Progress is tracked in the connector's
`artifacts/ai-artifacts/pipeline-state.json` (the same file `build-connector`
maintains). On invocation, read it first — a previous partial run resumes at
its first non-`done` step instead of starting over.

### Step 0 — Pre-flight

Run the full pre-flight from `15-unattended-mode.md` (CLI version, instance,
fresh login, service credentials in the configstore, instance account, budget,
git safety). Any failure → stop brief, nothing spent.

### Step 1 — Build

`build-connector` Steps 1a–1f (requirements → research → scaffold →
components), sourcing requirements from the issue when one was given. Then its
Step 2 (review via `review-connector`, fix every error finding, re-run until
clean) and the workspace validator/lint when the workspace ships them.

Commit after this step (feature branch `feature/<connector>-connector`).

### Step 2 — CLI tests

`test-connector` Step 0a (test plan) and the test+fix loop — the "ask first"
gates resolve per `15-unattended-mode.md` (budget check instead of a
question). Async components: test the submit path (`wait=false`) plus their
status components; the wait path is E2E's job. A component still failing after
`maxFixAttempts` is marked failed in the plan and the run continues.

Commit after this step.

### Step 3 — E2E

1. Generate flows if missing (`build-connector` Step 3b /
   `11-e2e-flow-generation.md`), `appmixer e2e validate` until clean.
2. Publish + prepare per `12-e2e-upload.md` (login as the e2e user is already
   done in pre-flight; account creation rules per `15-unattended-mode.md`
   pre-flight item 5).
3. `appmixer e2e import <flows> --account <id>` — treat import as the
   authoritative validation; fix flow JSONs on INVALID variables and
   re-import.
4. `appmixer e2e run <flowId> --fix` per flow (per `13-e2e-run.md`), long
   timeouts for polling flows. `NEEDS_FIX` → diagnose, fix, re-import, re-run;
   the same flow needing a second undiagnosed fix → stop condition.
5. Verify results in the E2E results store (`appmixer e2e results`) — the
   runner's PASSED line alone is not the evidence the report cites.

Commit after this step.

### Step 4 — Ship

1. Bundle version check per `build-connector`'s publish rules (initial release
   stays 1.0.0; changes to an existing connector bump + changelog).
2. Push the feature branch to the approved remote.
3. `gh pr create` against the approved base. PR body: summary, component
   table, auth/quota, test evidence (validator, CLI x/y, E2E x/y with the
   instance name), links to the flow JSONs in the branch, notes for reviewers.
4. When the run started from an issue: `gh issue comment` with the PR link.
5. Final report per `15-unattended-mode.md` (per-step outcomes, budget spent,
   everything skipped or failed stated explicitly). **Never merge the PR.**

## Failure semantics

Stop conditions and the stop brief are defined in
`references/15-unattended-mode.md`. The short version: budgets are hard
ceilings; per-component failures degrade the run (finish the rest, report),
run-level failures (auth needing a human, infra errors, repeated NEEDS_FIX)
stop it; every stop leaves `pipeline-state.json` resumable and prints the
exact next action.
