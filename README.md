# Appmixer Skills for AI Coding Agents

Give your AI coding agent deep Appmixer connector-development expertise — scaffold connectors, run CLI tests, generate and execute E2E test flows, and review components against Appmixer standards. Works with Claude Code via a dedicated plugin, and with Cursor, GitHub Copilot, Windsurf, Cline, and [40+ other agents](https://skills.sh) via the [Open Agent Skills](https://skills.sh) protocol.

> **Recommended:** The Claude Code plugin gives the best experience — all skills and their shared helpers load automatically, with no manual setup.

## Skills

| Skill | What it does |
|-------|-------------|
| **new-connector** | Build a new connector end-to-end — gather requirements, research the API, scaffold components, then drive tests, E2E flows and publish |
| **test-components** | Plan, test and validate connector components with a test+fix cycle |
| **connector-test-method** | Add a `test(context)` method to trigger components for Flow Test Mode |
| **review-component-standards** | Read-only audit of a component against Appmixer standards and best practices |
| **generate-e2e-flows** | Generate E2E test flows for a connector (with a 16-rule flow validator) |
| **upload-e2e-flows** | Publish a connector to a live instance and upload E2E test flows |
| **run-e2e-flows** | Run E2E flows on a live Appmixer instance, monitor logs, evaluate pass/fail, iterate on fixes |

See [skills/README.md](skills/README.md) for architecture details (how the skills work, shared helpers, environment variables).

## Getting Started

The complete zero-to-first-connector path — nothing else is needed:

**1. Install the skills** (Claude Code shown; other agents: [Installation](#installation)):

```bash
claude
/plugin marketplace add Appmixer-ai/appmixer-skills
/plugin install appmixer@appmixer-agents
```

**2. Create a workspace** — a folder with `src/<vendor>/` inside. The vendor is your namespace; pick your company name, or just use `appmixer`:

```bash
mkdir -p my-connectors/src/acme
cd my-connectors
```

**3. Start your agent inside the workspace** (that's how the skills find it — no configuration needed):

```bash
claude
```

**4. Build your first connector** — describe what you want in plain language:

> Create a new connector for the Cat Facts API (https://catfact.ninja), vendor `acme`, with components GetFact and ListBreeds.

The `new-connector` skill reads the API docs and scaffolds everything:

```
my-connectors/
└── src/acme/catfacts/
    ├── service.json          # name: acme.catfacts
    ├── bundle.json
    ├── auth.js
    ├── quota.js
    └── core/
        ├── GetFact/     — component.json + GetFact.js
        └── ListBreeds/  — component.json + ListBreeds.js
```

(Cat Facts needs no API key, so it's a good dry run — for a real service the agent asks for credentials when testing starts.)

**5. Test it** — say:

> Test the catfacts components.

Requires the [`appmixer` CLI](https://www.npmjs.com/package/appmixer) (`npm i -g appmixer`); the agent tells you if anything is missing.

**6. (Optional) Publish + run E2E flows on a live instance** — the first time a live-instance skill runs, the agent asks for your Appmixer API URL and credentials and saves them to `~/.config/appmixer-skills/env` itself. No manual config file editing.

## Prerequisites

- Node.js >= 18
- A local **connector workspace** — any directory containing `src/<vendor>/` that the skills write connector code into (`appmixer` is only the default vendor namespace — a workspace can use any vendor, or several side by side). This can be your own (git-managed) workspace, or a clone of [appmixer-connectors](https://github.com/appmixer-ai/appmixer-connectors) (which also serves as a library of real-world example connectors):
  ```bash
  git clone https://github.com/appmixer-ai/appmixer-connectors.git
  ```
  The connector design conventions ship inside the skills (each skill's `references/` directory) — the workspace does not need to provide them. When the workspace is a git repo, skills commit generated code to feature branches and ask before the first push of a session.
- For skills that talk to a live Appmixer instance (upload-e2e-flows, run-e2e-flows, new-connector): an Appmixer instance URL + credentials — see [Configuration](#configuration)

## Vendors

Connectors live under `src/<vendor>/<connector>/`, and component names mirror the disk layout: `<vendor>.<connector>.<module>.<Component>`. The `<vendor>` segment is a namespace — **`appmixer` is only the default**; a customer workspace can use its own vendor name, or several vendors side by side. (Built-in `appmixer.utils.*` components — OnStart, Assert, ProcessE2EResults — always keep the `appmixer` vendor; they ship with the engine.)

The skills determine the vendor without extra configuration:

1. **From data** — flow JSONs, component names and file paths all carry the vendor; where one is at hand, nothing is asked.
2. **From your location** — running from inside `src/<vendor>/` selects that vendor.
3. **By discovery** — a bare connector name (e.g. `upload-all crm`) is searched across all vendor dirs; a single match wins, an ambiguous one asks you to qualify it as `<vendor>/<connector>` (also accepted: `<vendor>.<connector>`).
4. **When scaffolding a new connector**, `new-connector` asks for the vendor if it can't be inferred (default suggestion: `appmixer`).

## Installation

### Claude Code Plugin ⭐ Recommended

```bash
claude
/plugin marketplace add Appmixer-ai/appmixer-skills
/plugin install appmixer@appmixer-agents
```

All 7 skills and their shared helpers load automatically.

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

By default the CLI opens an interactive skill picker (when it can't auto-detect your agent). For a non-interactive install of everything — scripts, CI, containers — pass the flags explicitly:

```bash
npx skills add Appmixer-ai/appmixer-skills --agent claude-code --skill "*" -y
```

Installs all skills into your agent's skills directory. Works with any agent that supports the [Open Agent Skills](https://skills.sh) protocol. Note: this protocol installs only the skill directories, without the shared helpers (`_shared/`, `e2e-shared/`, `scripts/`) the skills build on — the skills handle that themselves: on first use they download the full bundle to `~/.appmixer-skills/` and run from there (`APPMIXER_SKILL_ROOT` points at it; the setup block in each affected SKILL.md does this automatically).

### Manual Installation (Any Agent)

Copy the contents of the `skills/` directory into your agent's skills folder (copying everything — including `_shared/`, `e2e-shared/` and `scripts/` — keeps the skills self-contained; if you copy only individual skill folders, they download the full bundle to `~/.appmixer-skills/` on first use instead):

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

- `APPMIXER_SKILL_API_URL`, `APPMIXER_SKILL_USERNAME`, `APPMIXER_SKILL_PASSWORD` — the Appmixer API host and credentials (only needed for the live-instance skills).
- `APPMIXER_SKILL_CONNECTORS_DIR` — optional override for the workspace root. Normally you just start your agent from inside the workspace (a directory containing `src/<vendor>/`) and the skills find it from the cwd; set this only when running from elsewhere (CI, git worktrees).

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
