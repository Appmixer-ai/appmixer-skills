# Appmixer Skills for AI Coding Agents

Give your AI coding agent deep Appmixer connector-development expertise — scaffold connectors, run CLI tests, and review components against Appmixer standards. Works with Claude Code via a dedicated plugin, and with Cursor, GitHub Copilot, Windsurf, Cline, and [40+ other agents](https://skills.sh) via the [Open Agent Skills](https://skills.sh) protocol.

> **Recommended:** The Claude Code plugin gives the best experience — all skills load automatically, with no manual setup.

## Skills

| Skill | What it does |
|-------|-------------|
| **build-connector** | The end-to-end pipeline: build (requirements → research → scaffold incl. trigger `test()`) → review → test → publish |
| **test-connector** | Test a connector: CLI component test+fix cycle today; E2E flow testing folds in here once the appmixer CLI ships it |
| **review-connector** | Read-only audit of connector components against Appmixer standards (incl. trigger `test()` rules) |

Every skill is pure instructions — no bundled scripts, no install steps, no
environment variables. The only external tool the skills drive is the
[`appmixer` CLI](https://www.npmjs.com/package/appmixer).

> **E2E skills** (generate/upload/run E2E test flows against a live instance)
> live on the [`dev` branch](https://github.com/Appmixer-ai/appmixer-skills/tree/dev)
> while their tooling moves into the appmixer CLI — they'll land here as pure
> instructions once the CLI commands exist.

See [skills/README.md](skills/README.md) for architecture details (how the skills work, the references sync).

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

The `build-connector` skill reads the API docs and scaffolds everything:

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

**6. (Optional) Publish to your Appmixer instance** — say "publish the catfacts connector"; the agent drives `appmixer pack` + `appmixer publish` (and tells you how to configure the CLI if it isn't yet).

## Prerequisites

- Node.js >= 18
- A local **connector workspace** — any directory containing `src/<vendor>/` that the skills write connector code into (`appmixer` is only the default vendor namespace — a workspace can use any vendor, or several side by side). This can be your own (git-managed) workspace, or a clone of [appmixer-connectors](https://github.com/appmixer-ai/appmixer-connectors) (which also serves as a library of real-world example connectors):
  ```bash
  git clone https://github.com/appmixer-ai/appmixer-connectors.git
  ```
  The connector design conventions ship inside the skills (each skill's `references/` directory) — the workspace does not need to provide them. When the workspace is a git repo, skills commit generated code to feature branches and ask before the first push of a session.
- The [`appmixer` CLI](https://www.npmjs.com/package/appmixer) (`npm i -g appmixer`) — used for component testing and publishing; configure with `appmixer url` + `appmixer login`

## Vendors

Connectors live under `src/<vendor>/<connector>/`, and component names mirror the disk layout: `<vendor>.<connector>.<module>.<Component>`. The `<vendor>` segment is a namespace — **`appmixer` is only the default**; a customer workspace can use its own vendor name, or several vendors side by side. (Built-in `appmixer.utils.*` components — OnStart, Assert, ProcessE2EResults — always keep the `appmixer` vendor; they ship with the engine.)

The skills determine the vendor without extra configuration:

1. **From data** — flow JSONs, component names and file paths all carry the vendor; where one is at hand, nothing is asked.
2. **From your location** — running from inside `src/<vendor>/` selects that vendor.
3. **By discovery** — a bare connector name is searched across all vendor dirs; a single match wins, an ambiguous one asks you to qualify it as `<vendor>/<connector>`.
4. **When scaffolding a new connector**, `build-connector` asks for the vendor if it can't be inferred (default suggestion: `appmixer`).

## Installation

### Claude Code Plugin ⭐ Recommended

```bash
claude
/plugin marketplace add Appmixer-ai/appmixer-skills
/plugin install appmixer@appmixer-agents
```

All 3 skills load automatically, namespaced as `appmixer:build-connector`, `appmixer:test-connector`, `appmixer:review-connector`.

### Claude Code Plugin (Manual)

```bash
git clone https://github.com/Appmixer-ai/appmixer-skills.git
claude
/plugin add /path/to/appmixer-skills
```

### Claude Desktop / Claude.ai

Each skill directory under `skills/` is self-contained (SKILL.md + `references/`) — zip the ones you want and upload them to your project.

### Cursor, GitHub Copilot, Windsurf, Cline, and others (via Open Agent Skills)

```bash
npx skills add Appmixer-ai/appmixer-skills
```

By default the CLI opens an interactive skill picker (when it can't auto-detect your agent). For a non-interactive install of everything — scripts, CI, containers — pass the flags explicitly:

```bash
npx skills add Appmixer-ai/appmixer-skills --agent claude-code --skill "*" -y
```

Installs all skills into your agent's skills directory. Works with any agent that supports the [Open Agent Skills](https://skills.sh) protocol. Each skill directory is fully self-contained — no shared helpers, no post-install downloads.

### Manual Installation (Any Agent)

Copy the skill directories from `skills/` into your agent's skills folder — each one is self-contained:

| Agent | Skills directory |
|-------|-----------------|
| Claude Code | `.claude/skills/` |
| Cursor | `.cursor/skills/` |
| Windsurf | `.windsurf/skills/` |
| Cline | `.cline/skills/` |
| Generic | `.agents/skills/` |

## Configuration

There is none. The skills find the workspace from the directory you run your agent in, and instance access goes through the `appmixer` CLI (`appmixer url` + `appmixer login`).

The only knob is `APPMIXER_SKILL_CONNECTORS_DIR` — an optional override for the workspace root when running your agent from outside the workspace (CI, git worktrees).

## Releasing (maintainers)

```bash
npm install
npm test               # smoke tests: references sync, manifest consistency, example files parse
npm run release        # bumps version everywhere, updates CHANGELOG, tags
git push --follow-tags
```

The full skill set including the E2E skills is developed on the `dev` branch; `main` carries only the dependency-free skills.

Versions are kept in sync across `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, and every `SKILL.md` frontmatter via [.versionrc.json](.versionrc.json). Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, …) so the changelog generates itself.

## License

MIT
