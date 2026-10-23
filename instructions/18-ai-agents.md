# AI Agent components

An **AI Agent** is the component of an LLM connector (`ai/openai`, `ai/claude`,
`ai/gemini`, `ai/mistral`, …) that answers a prompt by calling tools wired to
it in the flow. All agents share one shape so that flows and templates can
swap the provider. This file is the contract; the reference implementation is
`ai/mistral/AIAgent` in appmixer-connectors (the newest one, with no legacy
ports).

## Ports and inputs

- **`in` port** — everything a flow may want to bind to a variable is an input,
  not a property: `model`, `instructions`, `prompt` (required), `threadId`,
  `fileId`, `storeId`. The only property is `stream` (toggle).
  - `model`: `text` with a dynamic source on the connector's `ListModels`,
    filtered to models that support function calling; a sensible default.
  - `instructions`: `textarea`, the system prompt. Sent with **every** request
    and kept out of the stored history, so a thread always runs on the current
    instructions and they survive a history summary.
  - `threadId`: without it the agent has no memory. With it the history is kept
    per thread — in the component state, or in the data store named by
    `storeId` (`thread_summary_<threadId>` holds the running history,
    `thread_memory_<threadId>_<ts>` every turn's new messages).
  - `fileId`: `filepicker`; images go to the model directly (vision model
    needed), a PDF is converted to text first when the provider's chat API
    takes no PDFs (Mistral: OCR endpoint), anything else is sent as text
    (CSV, JSON, source code).
- **`out` port** — `answer`, `prompt`, `time` (ms) and `usage`
  (`prompt_tokens`, `completion_tokens`, `total_tokens`, aggregated over every
  turn of the message), as a JSON Schema with examples.
- **`tool` port** — the tools. What is connected decides the mechanism (see
  below). Its only output option is `modelDefinedParameter`
  ("Model Defined Parameter").
- **Legacy ports `tools` and `mcp`** — kept on openai/claude for existing
  flows. **Do not add them to a new agent.** A `Tool Start` and an MCP server
  both go on `tool`.

## The `tool` port: three kinds of tools

The shared code lives in `tool.js`, `toolChain.js` and `mcp.js`, copied
per connector (keep the copies identical; the agent itself only calls
`collectComponentTools`, `getComponentToolDefs`, `executeComponentTool`,
`toPublicToolDef`).

1. **A plain action component.** Its fields mapped to the agent's
   `Model Defined Parameter` variable become the tool parameters (type and
   description from the port schema and the inspector label + tooltip), literal
   fields are sent on every call. It is run as a **static component call**
   (`context.callAppmixer` on `/component/<type>`), so nothing flows through the
   engine. Components connected behind it are further steps of the same tool
   (`toolChain.js`), each fed from the previous one the way the flow maps it;
   the output of the last step goes back to the model. The chain must be a
   straight line — a Switch or Condition behind a plain tool fails the agent
   start with a message pointing to `Tool Start`.
   The tool description the model sees is `<component label> - <manifest
   description>`: tell users to **label the component** with what the tool is
   for ("Order lookup"), the manifest description only says what the component
   does.
2. **A `Tool Start` (`appmixer.ai.agenttools.ToolStart`).** For a tool that
   needs its own description, named parameters or logic inside: the user
   describes the tool and its parameters on the Tool Start, builds anything
   behind it (branches, loops, waits — the **engine** runs it) and ends every
   branch in a `Tool Output`. The agent calls the one Tool Start through the
   engine's webhook route — `POST /flows/{flowId}/components/{id}?enqueueOnly=true&correlationId=<agent correlation>` —
   and polls `context.flow.stateGet(toolCallId)` for the Tool Output (120 s,
   `TOOLS_OUTPUT_POLL_TIMEOUT`). **Never `sendJson` on the `tool` port**: the
   engine enqueues one copy per link, so every plain tool on the port would run
   too. Tool Start is `webhook: true` and reads the call from
   `context.messages.webhook` (the legacy `tools` port fans out through `in`).
3. **An MCP server (`appmixer.mcpservers.*.MCPServer`).** Its tools are listed
   with `?action=listTools` and called with `?action=callTool`; the component id
   is shortened (`short-uuid`) to keep the function name under 64 characters.

Rules that hold for every kind:

- Every function definition carries `parameters` (an empty object schema when
  the tool takes none) — Mistral answers 422 without; OpenAI tolerates it.
- Every tool call of a turn gets an answer in the next request (a timeout or a
  parse error becomes the output text), or the provider rejects the request.
- `executeComponentTool` **never throws**: an error is returned as the output
  for the model to deal with, so a failing tool never triggers a component
  retry.
- Stop after `AI_AGENT_MAX_ATTEMPTS` (20) turns with a fixed "maximum number of
  iterations" answer.

## Provider mapping

Only the request/response mapping differs per provider; the loop is the same.

- OpenAI-compatible chat completions (openai, mistral, openrouter, groq):
  `tools` as `{ type: 'function', function }`, tool results as
  `{ role: 'tool', tool_call_id, content: <string> }`, `finish_reason`
  `tool_calls` | `stop`. Content may come as a **list of chunks** from
  reasoning models (Mistral `magistral`: `thinking` + `text`) — take the text
  parts.
- Anthropic: `tools` with `input_schema`, `tool_use` / `tool_result` blocks,
  all tool uses of a turn answered in one user message.
- Streaming (`stream` property): accumulate `tool_calls` deltas by `index`,
  publish text deltas to `stream:agent:events:<threadId>` with
  `context.pubSubPublish`, read `usage` from the last chunk (OpenAI needs
  `stream_options.include_usage`, Mistral sends it anyway).

## Testing an agent

Unit tests (`artifacts/test/AIAgent.test.js`, mocha + sinon, mock context):
the Tool Start definition is built from its properties; a plain component next
to it is a tool of its own; every function has `parameters`; a Tool Start is
called through `/flows/<flowId>/components/<id>` with the agent's correlation
id and `sendJson` is never called; a missing Tool Output ends as an error text,
not a throw; a full turn feeds every tool call back to the model and sums
`usage`.

E2E flows (one concern per flow, prompts that force the tool and assert on
the tool's text, not on the model's prose):

- **Tool port**: a fixed-output plain tool, a two-step chain with a
  `Model Defined Parameter`, and a Tool Start whose chain branches on a
  Condition — assert the exact texts the tools return.
- **Tool Start and memory**: two cities in one prompt → two Tool Start calls
  taking both Condition branches; a second agent on the same `threadId`
  (no tools) recalls something from the first turn; with `storeId` from a
  `Create Store` (fixed name, `clear` on) read `thread_summary_<threadId>` back
  with `storage.Get` and assert on it.
- **File context**: a PNG (`DataUri2File`) to the vision model, a CSV as text;
  `RemoveFile` after `AfterAll` (its output port is `deleted`).

Condition clauses are `input` / `operator` / `value` — not Assert's
`field` / `expected`. A clause with the wrong keys compares `undefined` with
`undefined` and is always true, so a branching test passes by accident.

## Checklist for a new agent

- `in` port with `model`, `instructions`, `prompt`, `threadId`, `fileId`,
  `storeId`; `stream` property; `out` schema with `answer`, `prompt`, `time`,
  `usage`; ports `out` and `tool` only.
- `tool.js`, `toolChain.js`, `mcp.js` copied unchanged from the newest agent;
  the agent maps `toPublicToolDef(def).function` to the provider's tool format
  and always sets `parameters`.
- `ListModels` filters the agent dropdown to function-calling models.
- History: instructions outside the stored messages; summary when the history
  exceeds `AI_AGENT_MAX_HISTORY_SIZE` (512 kB), a failed summary keeps the
  history instead of throwing the answer away.
- `package.json` declares `short-uuid` and `uuid`.
- Unit tests and the three E2E flows above.
