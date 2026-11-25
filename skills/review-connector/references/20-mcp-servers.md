# MCP Server Connectors

How to build or rewrite an `appmixer.mcpservers.<module>` connector — an MCP
server that AI agents use through their `tools` port (see `18-ai-agents.md`
for the agent side). Read this before adding a new MCP server or touching the
`lib.js` / auth of an existing one.

## Remote first

**If the vendor runs an official remote MCP server, the connector calls it.**
Do not bundle, port or spawn a local copy of a server the vendor already hosts.

Decide in this order and write the outcome into the change description:

1. **Official remote server** (hosted by the vendor, Streamable HTTP or SSE) →
   use it. This is the default.
2. **Only an official local package** (npm / Docker, stdio) → stdio is allowed,
   under the dependency rules in `19-security-dependency-fixes.md` (Node 18 — a
   bundled `server.js` when the package needs a newer Node).
3. **No vendor server at all** (community package, or no external service) →
   only with a stated reason; prefer an action connector instead.

"Official" means documented on the vendor's own domain or published from the
vendor's own GitHub organisation. A hosted endpoint run by a third party
(Apify, Composio, Smithery, Merge, …) is not official. Check it live as well:
an `initialize` POST to the URL must answer — an unauthenticated `401` with a
`WWW-Authenticate: Bearer resource_metadata=…` header counts as live.

Why: the stdio copies pin a snapshot of the vendor's tools, have to be
re-ported by hand on every vendor change (upstream packages mostly need
Node 20+, tenants run Node 18), carry their own dependency tree and security
advisories, and start one child process per call with the account's
credentials in its environment. Most of them were ports of the reference
servers that `modelcontextprotocol/servers` archived in May 2025.

## Shape

The same three components as every MCP connector — `MCPServer` (what the agent's
`tools` port links to; answers `?action=listTools` / `?action=callTool`),
`ListTools` and `CallTool`. Reference implementation:
`appmixer.mcpservers.teamwork_mcp` in appmixer-connectors.

```
src/appmixer/mcpservers/<module>/
├── module.json          # label "<Vendor> (MCP Server)", description names the remote URL + vendor docs link
├── bundle.json
├── package.json         # @modelcontextprotocol/sdk + zod only
├── lib.js               # mcpCall() against the fixed vendor URL
├── auth.js              # only when no existing service can be reused (see Auth)
├── MCPServer/
├── ListTools/
└── CallTool/
```

No `server.js`, no vendor MCP package, no `pidusage`, no `StdioClientTransport`.

### lib.js

```javascript
'use strict';

const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

// Fixed vendor endpoint. Never taken from component inputs.
const MCP_URL = 'https://mcp.example.com/mcp';

module.exports = {

    mcpCall: async (context, method, args) => {

        const client = new Client({ name: `appmixer:${context.flowId}:${context.componentId}`, version: '1.0.0' });
        const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
            requestInit: {
                headers: { Authorization: `Bearer ${context.auth.apiKey}` }
            }
        });

        try {
            await client.connect(transport);
            return await client[method](...args);
        } finally {
            await client.close();
        }
    }
};
```

- **The URL is a constant.** The account's credential goes only to the vendor's
  origin. The one exception is a vendor with self-managed instances (GitLab):
  the account holds the instance base URL, `lib.js` appends the fixed path, and
  the base is validated in `auth.js` (`https:` only). A URL taken from a
  component input is what the generic `streamable_http_mcp` connector is for —
  never combine a user-supplied URL with a stored credential.
- **Close the client in `finally`**, including when `connect` throws.
- **Streamable HTTP.** Use `SSEClientTransport` only when the vendor offers SSE
  and nothing else.
- **Do not log headers or the transport options** — they hold the credential.
- **Vendor tool filters** (toolset headers such as `X-MCP-Toolsets` or
  `X-Gitlab-Enabled-Mcp-Server-Toolsets`, `?features=` query parameters, a
  read-only path) are exposed as `MCPServer` properties when the full tool list
  is large. An agent pays for every tool definition in its context.

## Auth

1. **Reuse the main connector's service** when the vendor's remote server
   accepts that credential — `"auth": { "service": "appmixer:<vendor>" }` on all
   three components, as `teamwork_mcp` uses `appmixer:teamwork`. One account then
   serves the connector and its MCP server. Extra OAuth scopes the MCP server
   needs go into the components' `auth.scope`, not into the service defaults.
2. **Otherwise an own service** `appmixer:mcpservers:<module>`. Use the
   credential the remote server documents for server-to-server use: an API key
   or token in a header (`Authorization: Bearer …` or the vendor's header).
   `validate` sends `initialize` (or `tools/list`) to the MCP URL, so a
   credential the MCP server rejects fails at connect time — not at the first
   tool call. GitLab, for example, rejects legacy PATs on its MCP server while
   its REST API accepts them.
3. **OAuth-only remote servers.** If the vendor lets you pre-register an OAuth
   app, write a normal `oauth2` auth.js against the vendor's authorization server
   (the protected-resource metadata at `/.well-known/oauth-protected-resource`
   names it). If the server only supports **dynamic client registration** (no
   app you can pre-register), it needs the engine auth type `mcpOauth`
   (discovery + registration + PKCE in the engine, `auth.js` names only the MCP
   URL — Appmixer-ai/appmixer-core#5249). Until that type is available, stop and
   raise it; do not hand-roll registration or PKCE in `auth.js`.
4. **Never put a credential in the URL**, even where the vendor still accepts it
   (Firecrawl once documented `/{API_KEY}/v2/mcp`): URLs end up in logs.

## Rewriting an existing stdio connector

A rewrite to the remote server is a **major** `bundle.json` bump with a
`BREAKING:` changelog entry that names what changes for the user:

- **Tool names and arguments.** They come from the vendor now. Agent flows
  mostly survive (tools are listed at run time), but the `MCPServer` **Tools**
  selection and every `CallTool` store tool names — list the removed and renamed
  tools.
- **Account.** Keep the service name and auth field names whenever the remote
  server takes the same credential, so existing accounts keep working. When the
  rewrite switches to the main connector's service, say that users reconnect
  once.
- **Removed options** (a self-hosted base URL the remote server no longer
  supports, a concurrency setting, …).

Keep the directory and component names — renaming them breaks every saved flow.

## Testing

- `ListTools` against the live server with a real account — the tool list is
  the vendor's, so check the names the description and E2E flow rely on.
- `CallTool` with one read-only tool.
- An agent flow with `MCPServer` on the `tools` port, as in `18-ai-agents.md`.
- A wrong credential: `validate` rejects it with the vendor's message.
