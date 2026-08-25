# Unattended Mode

The build/test skills contain interactive gates ("ask the user before CLI
tests", "confirm the push target") because connector runs cost provider
credits, take time, and touch live instances. Those gates exist for good
reasons — unattended mode does not remove them, it **moves them to the front**:
one upfront approval with an explicit budget replaces the per-step questions.

Unattended mode is what makes a single-command pipeline (`ship-connector`) and
scheduled/CI runs possible.

## Activation — always explicit, never inferred

Unattended mode is active ONLY when the user explicitly requested an
unattended/automated run **in their own words** ("run unattended", "no
questions, budget X", "ship it end to end", a CI job invoking the pipeline
skill), or the invoking skill's arguments carry an explicit unattended flag.

- The agent NEVER activates unattended mode on its own judgement — a task that
  would merely go faster without questions does not qualify.
- Activation without a budget is incomplete: ask for (or default and state) the
  budget before starting, then proceed without further questions.
- One activation covers ONE pipeline run for ONE connector. It does not carry
  over to the next connector or the next session.

## The budget

An unattended run declares, before anything executes:

| Budget item | Meaning | Suggested default |
|---|---|---|
| `maxCredits` | Provider API credits/cost the run may consume (component tests + E2E) | 50 |
| `maxMinutes` | Wall-clock ceiling for the whole run | 45 |
| `maxFixAttempts` | Fix→re-test iterations per component / per flow | 3 |

State the budget in the run's opening report. When the provider exposes a
cheap usage endpoint (e.g. Firecrawl `GET /v2/team/credit-usage`), read it
before and after the run and report the actual spend; otherwise estimate from
the number of API calls made.

**The budget is a hard ceiling.** Crossing any item stops the run at the next
step boundary — finish the in-flight CLI command, then stop and report. Never
start a new E2E flow or component test past the ceiling.

## Gate behavior in unattended mode

Every "ask the user first" gate in the skills resolves as follows:

| Gate (interactive meaning) | Unattended resolution |
|---|---|
| "Ask before CLI tests" (build-connector Step 3a) | Pre-approved by the budget; check `maxCredits`/`maxMinutes` remaining and continue |
| "Ask before each component test run" | Same — budget check, continue |
| "Confirm push target before first push" | Pre-approved ONLY if the activation named the remote+branch (or the pipeline skill's pre-flight printed them and the activation covers pushing); otherwise stop and ask — this one is about publishing, not cost |
| "Ask about consistently failing components: remove or keep?" | Keep the component, mark it failed in the report, continue with the rest — removal is a human decision |

Gates NOT covered by unattended mode (always stop):

- Anything requiring a browser or human consent: `appmixer test auth login`,
  OAuth re-consent, designer "Connect account" flows.
- Merging a PR, force-pushing, deleting branches.
- Publishing to a **production** instance (unattended runs target dev/e2e
  instances; the activation must name the instance).
- Deleting accounts or data the run did not create.

## Pre-flight — MUST pass before the first paid call

Run these checks first; any failure stops the run immediately with a report of
what is missing (a failed pre-flight costs nothing):

1. **CLI version** — `appmixer --version` ≥ 2.6.0.
2. **Instance** — `appmixer url` prints the instance the activation named.
   A wrong instance looks like auth breakage later; abort here instead.
3. **Login** — `appmixer login <e2e-user>` executed THIS run (non-interactive:
   pipe the password on stdin). "Already logged in" may mean logged in as
   someone else; publishes are per-user copies, so this is not optional.
4. **Service credentials** — the connector's auth entry exists in
   `~/.config/configstore/appmixer.json` under `<vendor>:<connector>`
   (`authFields` non-empty). If missing, STOP: obtaining a key and running
   `appmixer test auth login` is a human step — report exactly what to run.
5. **Instance account** — an account for `<vendor>:<connector>` exists on the
   instance (`appmixer account ls --json`), or the credentials from (4) allow
   creating one — preferred (CLI newer than 2.6.x):
   `appmixer account create --from-auth <vendor>:<connector>`; fallback on
   older CLIs: `POST /accounts` with `token.type` and `profileInfo` set
   explicitly. OAuth services without an existing account: STOP —
   consent needs a human.
6. **Budget declared** — all three budget items have values, stated in the
   opening report.
7. **Git safety** — working tree clean or only the connector's files dirty;
   target branch is a feature branch, never `dev`/`main`/`master`.

## Stop conditions and the stop brief

Beyond the budget, stop immediately on:

- Auth failures that need a human (401 on validated key, OAuth consent, scopes
  a key does not have).
- A component failing after `maxFixAttempts` fix iterations — mark it failed,
  finish the OTHER components, and report (one bad endpoint must not zero out
  the run).
- `appmixer e2e run --fix` exiting `NEEDS_FIX` twice for the same flow after
  an attempted fix.
- Infrastructure errors the skills already treat as fatal
  (`Mongo DB not connected!`, unexplained 403s).

Every stop — budget, gate, or error — produces a **stop brief**:

```
STOPPED | <reason>
done:      <steps completed, with results>
remaining: <steps not run>
spent:     <credits/time vs budget>
next:      <the exact command or human action that unblocks the run>
```

The brief goes into the run report AND into
`artifacts/ai-artifacts/pipeline-state.json` (the resumable state file the
build skill already maintains), so a human — or the next run — can continue
from where the run stopped instead of starting over.

## Reporting

An unattended run ends with a report containing:

- per-step outcomes (build / review / CLI tests per component / E2E per flow /
  publish / PR URL),
- budget spent vs declared (credits from the provider's usage endpoint when
  available),
- everything that was SKIPPED or marked failed, explicitly — an unattended run
  must never present partial success as full success.
