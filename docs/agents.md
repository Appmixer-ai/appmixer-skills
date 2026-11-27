# Agent-by-agent notes

The skills are plain instructions, so any coding agent that can load them can follow them. What differs between agents is how the skills get installed, how you invoke them, how they update, and how much of the pipeline the agent can physically carry out. This page collects those differences. Installation commands themselves live in the [README](../README.md#installation); this page does not repeat them.

## What was actually exercised

The end-to-end run behind the Appmixer guide *Build Connectors with a Coding Agent* — a real connector built, tested, reviewed and published on a live instance — used **Claude Code** with the plugin install. Every other agent below is covered by the installation paths the README documents, not by that run. If you use one of them, the skills should behave the same; where they do not, the differences are most likely in the places listed under [Where agents differ](#where-agents-differ).

## What every agent needs

Whatever the agent, the full pipeline needs four things from it:

* **A shell on the machine where your `appmixer` CLI session lives.** The CLI is the only external tool the skills drive — component tests, live verification, publishing and E2E runs all go through it. An agent that cannot run commands there can scaffold and review, but cannot test or publish.
* **Write access to the connector workspace** — the directory containing `src/<vendor>/`.
* **A way to stop and ask you.** The skills halt before running CLI tests, before each component test run, before the first push of a session, and at several other points. An agent that cannot pause for an answer will either stall or skip the question.
* **A browser on the same machine,** for OAuth. `appmixer test auth login` opens the provider's consent page and receives the callback on a local port. This step is always yours.

## Per agent

| Agent | Install route | Skills land in | Invoke | Update |
| --- | --- | --- | --- | --- |
| Claude Code | plugin (recommended) | the plugin cache | `/appmixer:build-connector`, `/appmixer:test-connector`, `/appmixer:review-connector` — or ask in plain language | `/plugin marketplace update appmixer-skills`; reinstall the plugin if the skills do not refresh |
| Claude Code | `npx skills add … --agent claude-code` | `.claude/skills/` | plain language | `npx skills update` |
| Cursor | `npx skills add` | `.cursor/skills/` | plain language | `npx skills update` |
| GitHub Copilot | `npx skills add` | chosen by the `skills` CLI | plain language | `npx skills update` |
| Windsurf | `npx skills add` | `.windsurf/skills/` | plain language | `npx skills update` |
| Cline | `npx skills add` | `.cline/skills/` | plain language | `npx skills update` |
| any other Open Agent Skills agent | `npx skills add`, or copy by hand | `.agents/skills/` for the generic layout | plain language | `npx skills update`, or copy again |
| Claude Desktop, Claude.ai | zip each skill directory and upload it to a project | the project | plain language | upload again |

"Plain language" means the README's example prompts — *"Create an Appmixer connector for PostHog under vendor `acme`…"*, *"Test the posthog connector."* The agent picks the skill from its description.

**GitHub Copilot the coding agent is not Appmixer's AI Copilot.** The first can run these skills. The second is a flow-building assistant inside the Appmixer Designer and has nothing to do with them.

### Claude Desktop and Claude.ai

A skill uploaded to a project has no shell on your machine and no access to your CLI session. That makes it useful for `review-connector` over files you provide, and for reading the design rules while you write code yourself — but `build-connector` and `test-connector` cannot run their CLI steps there.

## Which version you have

Every `SKILL.md` carries its version in the frontmatter, under `metadata.version`, and all three move together at release time. Open the installed copy and read it:

```yaml
metadata:
  author: Appmixer
  version: "1.0.0"
```

For the matching CLI and Appmixer versions, see [Compatibility](compatibility.md).

## Where agents differ

**The stops you see are not all the skills' own.** The skills define when to stop and ask. On top of that, every agent has its own permission model for running commands. In the Claude Code run, the agent's own safety tooling refused `appmixer remove` — which deletes components from a live instance — before any skill rule came into play. Other agents will draw that line somewhere else, and some not at all. Treat destructive CLI commands (`appmixer remove`, `appmixer publish --replace-all`) as yours to approve regardless of what your agent would allow.

**Never hand an agent a token in the chat.** `appmixer test auth login` prints the access token to the terminal in full. The skills tell the agent never to edit the CLI's credential store (`~/.config/configstore/appmixer.json`) by hand — that file is also your live CLI session — but a token pasted into a conversation is outside anything the skills can protect.

**Pre-release skills install differently per agent.** Claude Code takes `Appmixer-ai/appmixer-skills#dev`; the `skills` CLI needs a `/tree/dev` URL instead and rejects the `#dev` shorthand. See [Working with the pre-release version](../README.md#working-with-the-pre-release-version-dev-branch).
