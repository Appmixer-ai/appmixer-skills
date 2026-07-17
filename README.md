# Appmixer Skills for AI Coding Agents

Give your AI coding agent deep Appmixer connector-development expertise — scaffold connectors, run CLI tests, generate and execute E2E test flows, and review components against Appmixer standards. Works with Claude Code via a dedicated plugin, and with Cursor, GitHub Copilot, Windsurf, Cline, and [40+ other agents](https://skills.sh) via the [Open Agent Skills](https://skills.sh) protocol.

> **Recommended:** The Claude Code plugin gives the best experience — all skills and their shared helpers load automatically, with no manual setup.

## Skills

| Skill | What it does |
|-------|-------------|
| **init-connector** | Scaffold a new connector from a GitHub issue — fetch requirements, research the API, write the files |
| **connector-pipeline** | End-to-end connector development pipeline — from scaffold through tests to publish |
| **plan-CLI-tests** | Create a test plan for all components in a connector |
| **run-CLI-tests** | Test and validate connector components with a test+fix cycle |
| **connector-test-method** | Add a `test(context)` method to trigger components for Flow Test Mode |
| **review-component-standards** | Read-only audit of a component against Appmixer standards and best practices |
| **generate-E2E-test-flows** | Generate E2E test flows for a connector (with a 16-rule flow validator) |
| **upload-e2e-flows** | Publish a connector to a live instance and upload E2E test flows |
| **run-e2e-flows** | Run E2E flows on a live Appmixer instance, monitor logs, evaluate pass/fail, iterate on fixes |

See [skills/README.md](skills/README.md) for architecture details (how the skills work, shared helpers, environment variables).

## Prerequisites

- Node.js >= 18
- A local clone of [appmixer-connectors](https://github.com/clientIO/appmixer-connectors) — the repo the skills read conventions from and write connector code into:
  ```bash
  git clone https://github.com/clientIO/appmixer-connectors.git
  ```
- For skills that talk to a live Appmixer instance (upload-e2e-flows, run-e2e-flows, connector-pipeline): an Appmixer instance URL + credentials — see [Configuration](#configuration)
- For `init-connector`: an authenticated `gh` CLI (`gh auth login`) — used to fetch the source issue and push the branch

## Installation

### Claude Code Plugin ⭐ Recommended

```bash
claude
/plugin marketplace add Appmixer-ai/appmixer-skills
/plugin install appmixer@appmixer-agents
```

All 9 skills and their shared helpers load automatically.

### Claude Code Plugin (Manual)

```bash
git clone https://github.com/Appmixer-ai/appmixer-skills.git
claude
/plugin add /path/to/appmixer-skills/skills
```

### Claude Desktop / Claude.ai

Download the [complete bundle](https://raw.githubusercontent.com/Appmixer-ai/appmixer-skills/main/dist/appmixer-skills.zip) and upload it to your project. Individual skill zips are not provided — the skills share runtime helpers, so they only work as a bundle.

### Cursor, GitHub Copilot, Windsurf, Cline, and others (via Open Agent Skills)

```bash
npx skills add Appmixer-ai/appmixer-skills
```

Installs all skills into your agent's skills directory. Works with any agent that supports the [Open Agent Skills](https://skills.sh) protocol. Note: skills reference shared helpers (`_shared/`, `e2e-shared/`, `scripts/`) — if your agent installs skills individually, copy those directories alongside them. For non-Claude-Code installs also `export APPMIXER_SKILL_ROOT=<path-to-the-installed-skills-directory>` — the SKILL.md commands use it to locate the shared scripts (in the Claude Code plugin it is derived automatically).

### Manual Installation (Any Agent)

Copy the contents of the `skills/` directory into your agent's skills folder:

| Agent | Skills directory |
|-------|-----------------|
| Claude Code | `.claude/skills/` |
| Cursor | `.cursor/skills/` |
| Windsurf | `.windsurf/skills/` |
| Cline | `.cline/skills/` |
| Generic | `.agents/skills/` |

## Configuration

Skills read configuration from environment variables (`APPMIXER_SKILL_*`), loaded from `~/.config/appmixer-skills/env` automatically.

**Zero-setup path (recommended):** just install and start using a skill. On first use the agent detects the missing configuration, asks you for the values, and writes `~/.config/appmixer-skills/env` itself. Every later session picks it up automatically.

**Manual path:** copy [skills/.env.example](skills/.env.example) to `~/.config/appmixer-skills/env` and fill in:

- `APPMIXER_SKILL_CONNECTORS_DIR` — absolute path to your `appmixer-connectors` clone (its root, the directory containing `src/appmixer`). This is the minimal config — without a connectors clone the skills have nothing to work on. If unset, skills fall back to searching upward from the current working directory, so starting your agent from inside the clone also works.
- `APPMIXER_SKILL_API_URL`, `APPMIXER_SKILL_USERNAME`, `APPMIXER_SKILL_PASSWORD` — the Appmixer API host and credentials (only needed for the live-instance skills).

Precedence: variables exported in your shell always win; `APPMIXER_ENV` can point to an alternate file (useful for switching between instances); `~/.config/appmixer-skills/env` is the default.

Node dependencies are installed automatically by `skills/scripts/ensure-deps.sh` on session start.

## Releasing (maintainers)

```bash
npm install
npm test               # smoke tests: script syntax, env-var contract, no-config failure modes
npm run release        # bumps version everywhere, updates CHANGELOG, tags, builds dist/
git push --follow-tags
gh release create v<VERSION> dist/*-v<VERSION>.zip
```

Versions are kept in sync across `package.json`, `skills/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, and every `SKILL.md` frontmatter via [.versionrc.json](.versionrc.json). Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, …) so the changelog generates itself.

## License

MIT
