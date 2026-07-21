# Teach Your AI Coding Agent to Build Appmixer Connectors

*Introducing Appmixer Skills - an open-source skill pack that turns Claude Code, Cursor, Copilot and 40+ other AI agents into Appmixer connector engineers.*

---

Building a quality Appmixer connector has always involved more than writing code. You research the service's API, scaffold components with the right structure, wire up OAuth scopes, test every component against the live API, generate end-to-end test flows, publish to an instance, and iterate until everything passes. The knowledge of *how to do this well* used to live in our heads, in scattered docs, and in code review comments.

Now it lives in your AI agent.

**[Appmixer Skills](https://github.com/Appmixer-ai/appmixer-skills)** is an open-source pack of nine agent skills that encode our entire connector development process - from a GitHub issue to a published, E2E-tested connector. Install it into Claude Code (or any agent supporting the [Open Agent Skills](https://skills.sh) protocol) and your agent knows exactly how we build, test, review and ship connectors.

## What's in the box

| Skill | What your agent can do with it |
|---|---|
| **init-connector** | Scaffold a complete connector from a GitHub issue - fetch requirements, research the API, write the files |
| **connector-pipeline** | Run the whole pipeline end-to-end: scaffold → test → publish |
| **plan-CLI-tests** | Build a test plan covering every component |
| **run-CLI-tests** | Test components against the real API, diagnose failures, fix and re-test |
| **connector-test-method** | Add Flow Test Mode support to trigger components |
| **review-component-standards** | Audit any component against Appmixer standards - read-only, review-style |
| **generate-E2E-test-flows** | Generate end-to-end test flows, validated by 16 deterministic rules |
| **upload-e2e-flows** | Publish the connector and upload test flows to a live instance |
| **run-e2e-flows** | Execute flows on a live instance, monitor logs, evaluate pass/fail, iterate on fixes |

## Not just prompts - deterministic where it matters

A common failure mode of "AI-powered" tooling is letting the model improvise everything. We took the opposite approach: **the agent follows the process, but the critical checks are plain code.**

- The E2E flow validator enforces 16 structural rules (fail-fast error handling, real port names, UUID component ids, assertion quality) - the agent loops until the validator prints `Validation passed`, not until it *feels* done.
- The E2E runner is an explicit state machine with no LLM inside: it uploads the flow, binds accounts, starts, monitors logs, and triages failures deterministically. When it can't resolve a failure, it exits with a structured brief - and *that's* where the agent steps in, diagnoses, edits the flow, and re-runs.
- OAuth-scope failures, expired tokens, stale published components - the runner detects these and either fixes them (account rebinding) or tells the agent precisely what human action is needed.

The result: the model does what models are good at (reading API docs, writing components, diagnosing failures), and the deterministic layer guarantees the parts that must never be improvised.

## Install in one minute

**Claude Code (recommended):**

```
/plugin marketplace add Appmixer-ai/appmixer-skills
/plugin install appmixer@appmixer-agents
```

**Cursor, Copilot, Windsurf, Cline and others:**

```
npx skills add Appmixer-ai/appmixer-skills
```

**Claude Desktop / Claude.ai:** download the [bundle](https://github.com/Appmixer-ai/appmixer-skills/releases) and upload it to your project.

There's no configuration ceremony. On first use, the skills detect what's missing - your `appmixer-connectors` checkout, instance credentials - ask you for the values, and store them in `~/.config/appmixer-skills/env`. Every later session picks them up automatically. Per-skill installs even fetch their own shared runtime on demand, so the skills work no matter how (or where) you installed them.

## What this looks like in practice

You open your agent and say:

> *"Init a connector from clientIO/appmixer-connectors#4021."*

The agent fetches the issue, researches the service's API docs, scaffolds the connector with auth, quota rules and components matching our conventions, and pushes a branch. Then:

> *"Plan and run CLI tests."*

It builds a test plan, resolves real test inputs by calling the service's own List/Find components (no guessed IDs, no placeholders), runs each component against the live API, and fixes what fails. Then:

> *"Generate E2E flows and run them."*

It writes test flows from the canonical template, validates them until clean, publishes the connector to your instance, uploads the flows, and drives the runner - reading its structured failure briefs and iterating until the flows pass on a live Appmixer instance.

What used to take a developer days of context-switching now runs as a guided, verifiable pipeline - with a human reviewing the results instead of typing the boilerplate.

## Battle-tested conventions, one source of truth

The skills don't carry their own copy of our design rules. They read the canonical conventions straight from the `appmixer-connectors` repository (`.github/instructions/`) - the same rules that drive our CI, code review and Copilot setup. When the rules evolve, every agent using the skills follows the new rules immediately. The plugin carries the *process*; the repo carries the *rules*.

## Open source, from day one

Everything is MIT-licensed and public: [github.com/Appmixer-ai/appmixer-skills](https://github.com/Appmixer-ai/appmixer-skills). The repo includes the full smoke-test suite and a Docker clean-box harness we use to verify that a brand-new user - no checkout, no config, even no network - gets actionable guidance instead of cryptic errors.

If you build Appmixer connectors, point your agent at the skills and let it carry the process. If you're building your own agent skill pack, the repo is a working example of patterns we found essential: deterministic validators around LLM work, self-bootstrapping shared runtime, zero-setup configuration, and multi-agent distribution from a single source.

*Questions, ideas, connectors you want covered? Open an issue - or ask your agent to do it for you.*
