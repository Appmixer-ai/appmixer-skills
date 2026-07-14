# Vero — Appmixer Coding Agent

Vero is an AI coding agent specialized in developing Appmixer connectors and components. It can implement missing components or whole connectors and publish the result directly to a customer's Appmixer instance.

---

## Skills — how they work

The skills in `skills/` are **instructions for the host agent** (a Claude Code /
OpenClaw session) — no skill spawns its own LLM sub-agent. Two shapes:

1. **Pure instructions** — `SKILL.md` describes the procedure and the agent executes
   it directly with its own tools: `init-connector`, `plan-CLI-tests`,
   `run-CLI-tests`, `review-component-standards`, `generate-E2E-test-flows`,
   `connector-pipeline`.
2. **Instructions + deterministic script** — the agent drives a Node script with no
   LLM inside:
   - `run-e2e-flows/scripts/run.js` — E2E runner (explicit state machine;
     exit `0` = passed, `1` = hard fail incl. OAuth-scope diagnosis, `2` = NEEDS_FIX
     brief for the agent; ends with a `RESULT | STATUS | flow | designer URL` line)
   - `e2e-shared/scripts/appmixer-flow.mjs` — CLI for publish/upload workflows
   - `generate-E2E-test-flows/validate.js` — flow validator (16 rules, incl. the
     mandatory `errorHandling: { autoRetry: false, onError: "stopFlow" }`)

Configuration comes from env vars (`APPMIXER_SKILL_*`, `APPMIXER_SKILL_CONNECTORS_DIR`, …) —
see `.env.example`. Node deps are installed by `scripts/ensure-deps.sh` (idempotent).

### Dependency on `appmixer-connectors`

The skills are tooling **for** the [appmixer-connectors](https://github.com/clientIO/appmixer-connectors)
repo — they scaffold, test and review connectors inside a checkout of it. A
checkout is therefore required at runtime: set `APPMIXER_SKILL_CONNECTORS_DIR` to its
root, or run from inside the repo (`skills/_shared/resolveConnectorsDir.js` is
the shared resolver).

The connector **design conventions** (`.github/instructions/*.md`) deliberately
live in that repo, not here: they describe that codebase, are edited in the same
PRs as the connector code, and feed its own tooling (the generated
`copilot-instructions.md`, CI responder, CLAUDE.md). Skills read them from the
checkout like a linter reads a project's config — this plugin carries the
*process*, the target repo carries the *rules*. Skills that need the
conventions verify `<connectors>/.github/instructions/` exists before starting
and abort with a clear message when it's missing.

> **Note:** the `skills/*/agent/` directories are legacy sub-agent implementations —
> current SKILL.md files no longer reference them.

### Installing as a Claude Code plugin

```bash
/plugin marketplace add Appmixer-ai/appmixer-skills
/plugin install appmixer@appmixer-agents
```

Claude Code does NOT run `npm install` or configure secrets during install —
two manual steps (in the plugin directory, printed by `/plugin`):

```bash
cd <plugin-dir>
npm ci                      # Node deps for the runner/validator scripts
cp .env.example .env        # then fill in credentials
```

Required: `APPMIXER_SKILL_API_URL`, `APPMIXER_SKILL_USERNAME`,
`APPMIXER_SKILL_PASSWORD`, `APPMIXER_SKILL_CONNECTORS_DIR`; for `init-connector` also
`APPMIXER_SKILL_GITHUB_PAT`. No LLM API keys are needed — the skills run directly in the
host agent. Full list: `.env.example`. Point the E2E skills at the file via
`export APPMIXER_ENV=<plugin-dir>/.env`.

Note: `APPMIXER_SKILL_ROOT` is derived from `CLAUDE_PLUGIN_ROOT` automatically when
running as a plugin; the SessionStart hook (`hooks/hooks.json` →
`scripts/ensure-deps.sh`) also installs deps idempotently on its own.
Requires Node ≥ 18.

---

## Architecture (multi-tenant)

Every customer gets an **isolated Vero instance** — their own agent, workspace and
credentials. Customers cannot see or hear each other.

```
OpenClaw Gateway
│
├── vero-acme       ← agent for customer ACME
│   └── workspace-vero-acme/
│       ├── appmixer.env          ← credentials of the ACME instance
│       ├── appmixer-connectors/  ← working git repo (ACME)
│       └── skills/ → symlink     ← shared skill definitions
│
├── vero-beta       ← agent for customer BETA
│   └── workspace-vero-beta/
│       ├── appmixer.env          ← credentials of the BETA instance
│       ├── appmixer-connectors/  ← working git repo (BETA)
│       └── skills/ → symlink
│
└── vero            ← base agent (dev/internal)
    └── workspace-vero/
        ├── skills/               ← SOURCE OF TRUTH for skill definitions
        ├── scripts/
        │   └── add-customer.sh   ← onboarding script
        └── README.md             ← this file
```

### Shared vs. isolated

| Component | Shared | Isolated |
|---|---|---|
| Skill definitions (`skills/`) | ✅ symlink | — |
| Bootstrap files (AGENTS.md, SOUL.md...) | ✅ symlink | — |
| LLM auth (Anthropic API key) | ✅ `agentDir` | — |
| GitHub PAT | ✅ `agentDir` | — |
| Appmixer credentials | — | ✅ `appmixer.env` |
| Connectors working repo | — | ✅ `appmixer-connectors/` |
| Session history (chat) | — | ✅ per agentId |

### How configuration works

Skills load Appmixer credentials from the `appmixer.env` file in the workspace
root. The `APPMIXER_ENV` variable defaults to `$(pwd)/appmixer.env` — when run
inside a customer's workspace, the right config loads automatically. No global
env variables are needed.

```bash
# appmixer.env — example
APPMIXER_SKILL_API_URL=https://api-acme.appmixer.ai
APPMIXER_SKILL_USERNAME=admin@acme.com
APPMIXER_SKILL_PASSWORD=secret
APPMIXER_SKILL_CONNECTORS_DIR=/root/.openclaw/workspace-vero-acme/appmixer-connectors
```

---

## Communication channel — Slack

Customers talk to Vero through a **dedicated channel in your Slack**. The customer
gets a workspace invite, joins their channel (`#vero-acme`) and writes there
directly.

### Why not the customer's Slack?

Installing the Slack bot into a customer's workspace requires either distributing
a Slack app or a separate Slack OAuth account in OpenClaw per customer —
unnecessary complexity for a handful of customers.

### How routing works

Each customer channel has a unique Slack Channel ID (`C...`). An OpenClaw binding
matches messages from that channel and routes them to the right agent:

```
message in #vero-acme (C08ABC123)
  → binding: channel=slack, accountId=vero, peer.id=C08ABC123
  → agent: vero-acme
  → workspace: workspace-vero-acme/
  → appmixer.env: credentials of the ACME instance
```

### How to find a Slack Channel ID

1. Open the channel in Slack
2. Click the channel name at the top
3. Scroll down → **Copy link**
4. The URL looks like: `https://app.slack.com/client/TWORKSPACE/C08ABC123`
5. Channel ID = the part starting with `C` (e.g. `C08ABC123`)

---

## Adding a new customer

### Prerequisites

- You know the Appmixer base URL, username and password of the customer's instance
- You have the Slack Channel ID of the dedicated channel (or you'll create one)

### Step by step

**1. Create the Slack channel**

In your Slack workspace create a private channel for the customer, e.g.
`#vero-acme`. Note the Channel ID (see above).

**2. Run the onboarding script**

```bash
cd ~/.openclaw/workspace-vero
bash scripts/add-customer.sh <customer-id> <appmixer-url> <username> <password> <slack-channel-id>
```

Example:
```bash
bash scripts/add-customer.sh acme https://api-acme.appmixer.ai admin@acme.com secret123 C08ABC123
```

The script:
- Creates `~/.openclaw/workspace-vero-acme/`
- Sets up symlinks to the shared files
- Writes `appmixer.env` (chmod 600)
- Creates the `appmixer-connectors/` directory
- Prints config snippets for steps 3 and 4

**3. Add the agent to the OpenClaw config**

```bash
openclaw config set agents.list '<existing array + new entry>' --strict-json --replace
```

Or edit `~/.openclaw/openclaw.json` by hand — add to `agents.list`:

```json
{
  "id": "vero-acme",
  "name": "Vero (ACME)",
  "workspace": "/root/.openclaw/workspace-vero-acme",
  "agentDir": "/root/.openclaw/agents/vero/agent",
  "model": "anthropic/claude-sonnet-4-6"
}
```

**4. Add the routing binding**

Add to `bindings`:

```json
{
  "agentId": "vero-acme",
  "match": {
    "channel": "slack",
    "accountId": "vero",
    "peer": { "kind": "channel", "id": "C08ABC123" }
  }
}
```

`accountId: "vero"` is the bot's Slack account — the same for all customers.
Isolation is provided by `peer.id` (the channel ID).

**5. Reload the gateway**

```bash
openclaw gateway restart
```

**6. Invite the customer to Slack**

Add the customer to the workspace and to their channel (`#vero-acme`). They can
start writing.

---

## Removing a customer

```bash
# 1. Remove the binding and the agent from openclaw.json, then:
openclaw gateway restart

# 2. Delete the workspace (CAUTION — irreversible)
rm -rf ~/.openclaw/workspace-vero-acme
```

---

## Troubleshooting

**Vero does not respond in the channel**
- Check that the Channel ID in the binding matches (`C...`, not `#name`)
- Check that `accountId` in the binding matches the bot's Slack account in OpenClaw
- `openclaw channels status` shows active channels

**A skill reports `File not found: .../appmixer.env`**
- Verify `appmixer.env` exists in the workspace root: `ls -la ~/.openclaw/workspace-vero-acme/appmixer.env`
- Verify the contents: `cat ~/.openclaw/workspace-vero-acme/appmixer.env`

**A customer sees another customer's data**
- Check that every customer has a unique `peer.id` in their binding
- Check that the agents have distinct `id`s in `agents.list`
