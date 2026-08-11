# Upload E2E Flows

Publish a connector and upload E2E test flows to a live Appmixer instance.

> **Paths:** all `"$APPMIXER_SKILL_ROOT"/test-connector/scripts/...` invocations below
> require `APPMIXER_SKILL_ROOT` to point at the full skills directory (the one
> containing `_shared/`). Run the Node-dependencies block in Prerequisites first —
> it resolves the root (plugin root in Claude Code, or the real path of the
> skill dir) and exports the variable; keep prefixing later commands with that export.
> `appmixer-flow.mjs` is a Node CLI built on `_shared/appmixerApi`
> (deps installed by `scripts/ensure-deps.sh`);

## Prerequisites

- **Node dependencies** — install once (idempotent, skips if already present):
  ```bash
  # APPMIXER_SKILL_ROOT = the skills/ directory of the appmixer-skills checkout
  # (the folder that contains _shared/).
  #  - Claude Code plugin install: $CLAUDE_PLUGIN_ROOT/skills
  #  - skill symlinked/copied into a project's .claude/skills/: the real path of
  #    the skill directory, one level up (substitute <skill-dir> below)
  export APPMIXER_SKILL_ROOT="${APPMIXER_SKILL_ROOT:-${CLAUDE_PLUGIN_ROOT:+$CLAUDE_PLUGIN_ROOT/skills}}"
  if [ -z "$APPMIXER_SKILL_ROOT" ]; then
      export APPMIXER_SKILL_ROOT="$(dirname "$(readlink -f <skill-dir>)")"
  fi
  bash "$APPMIXER_SKILL_ROOT/scripts/ensure-deps.sh"
  ```
- Configuration — `~/.config/appmixer-skills/env`, an `APPMIXER_ENV` file, or exported vars (see below)
- **Run from the connector workspace** — the current directory (or a parent)
  contains `src/<vendor>/<connector>/`; the Node scripts resolve the workspace
  from the cwd. `APPMIXER_SKILL_CONNECTORS_DIR` is an optional override for
  running from elsewhere (see the worktree section below). `<vendor>` is the namespace directory under `src/` — `appmixer` is only the
  default; a workspace can hold several vendors side by side. Bare connector
  names are searched across all vendor dirs; when ambiguous, qualify as
  `<vendor>/<connector>`.
- Test flow JSON files in `artifacts/test-flows/` (generated per `11-e2e-flow-generation.md`, shipped with `build-connector`)
- Appmixer CLI configured (`appmixer url` + login)

**Configuration**

The Node scripts load configuration themselves, in this precedence: exported
`APPMIXER_SKILL_*` variables → the file `APPMIXER_ENV` points to → the default
`~/.config/appmixer-skills/env`.

**First-run setup:** when none of those sources provide the required values, ask
the user for them and write `~/.config/appmixer-skills/env` yourself
(`mkdir -p ~/.config/appmixer-skills`, KEY=value lines, `chmod 600`), then
continue — every later session picks it up automatically.

**⚠️ Instance check:** the effective config decides WHICH INSTANCE every command
talks to; a wrong source looks like auth breakage (fresh tokens get 401 "Invalid
JWT", `ensure-stores`/`list-e2e-flows` return foreign IDs/empty lists).
`appmixer-flow.mjs` prints the effective env + instance on stderr as its first
line (`[appmixer-flow] env=... instance=...`) — **read it** and abort if it is
not the instance you expect.

The config file must contain:

```
APPMIXER_SKILL_API_URL=https://api.appmixer.com
APPMIXER_SKILL_USERNAME=your@email.com
APPMIXER_SKILL_PASSWORD=yourpassword
```

For the shell steps in this skill (appmixer CLI login etc.), export the same
values — **never `source` the file directly**: passwords with `&`, `|`, `!`
etc. break the shell parse (`parse error near…`). Export via a safe parser
instead:

```bash
: "${APPMIXER_ENV:=$HOME/.config/appmixer-skills/env}"
test -f "$APPMIXER_ENV" || { echo "Config not found: $APPMIXER_ENV — run first-run setup"; exit 1; }
eval "$(python3 -c "
import shlex
for line in open('$APPMIXER_ENV'):
    line = line.strip()
    if not line or line.startswith('#') or '=' not in line: continue
    k, v = line.split('=', 1)
    print(f'export {k}={shlex.quote(v)}')
")"
: "${APPMIXER_SKILL_API_URL:?APPMIXER_SKILL_API_URL missing in $APPMIXER_ENV}"
: "${APPMIXER_SKILL_USERNAME:?APPMIXER_SKILL_USERNAME missing in $APPMIXER_ENV}"
: "${APPMIXER_SKILL_PASSWORD:?APPMIXER_SKILL_PASSWORD missing in $APPMIXER_ENV}"
test -n "$(ls -d "${APPMIXER_SKILL_CONNECTORS_DIR:-.}"/src/*/ 2>/dev/null)" || { echo "Not in a connector workspace (no src/<vendor>/): run from the workspace root or set APPMIXER_SKILL_CONNECTORS_DIR"; exit 1; }
```

Only `APPMIXER_SKILL_*` names are supported.

## Helper Script

`"$APPMIXER_SKILL_ROOT"/test-connector/scripts/appmixer-flow.mjs` wraps all API calls.

For the current, authoritative list of commands and their signatures, read the comment block at the top of the script:

```
"$APPMIXER_SKILL_ROOT"/test-connector/scripts/appmixer-flow.mjs
```

## Quick Start

```bash
# 1. Publish the connector
cd src/<vendor>   # from the workspace root
appmixer pack <connector>
appmixer publish <vendor>.<connector>.zip   # pack outputs <vendor>.<connector>.zip

# 2. Ensure stores exist (first time only)
node "$APPMIXER_SKILL_ROOT"/test-connector/scripts/appmixer-flow.mjs ensure-stores

# 3. Upload all test flows (does NOT assign the account — see step 3b below)
node "$APPMIXER_SKILL_ROOT"/test-connector/scripts/appmixer-flow.mjs upload-all <connector>

# 4. Assign the auth account to each uploaded flow (REQUIRED to run)
node "$APPMIXER_SKILL_ROOT"/test-connector/scripts/appmixer-flow.mjs patch-accounts "$FLOW_ID" "$ACCOUNT_ID" "<vendor>.<connector>."

# 5. Validate flow JSONs locally
node "$APPMIXER_SKILL_ROOT"/test-connector/scripts/validate.js \
    src/<vendor>/<connector>/artifacts/test-flows
```

## Workflow

### Step 1: Publish Connector

**⚠️ Components are per-user copies.** `appmixer publish`/`remove` act on the copies
owned by whoever the CLI is logged in as — if that is NOT the e2e user
(`APPMIXER_SKILL_USERNAME`), the publish looks successful but the e2e user's designer,
flows and API keep serving **their own stale copy**. ALWAYS align the CLI login with
the e2e user before publishing (idempotent, do it every session — "already logged in"
may mean logged in as someone else):

```bash
appmixer url "$APPMIXER_SKILL_API_URL"    # values via the python-parsed env, see Prerequisites
printf '%s\n' "$APPMIXER_SKILL_PASSWORD" | appmixer login "$APPMIXER_SKILL_USERNAME"
```

**Run the workspace validators for the WHOLE connector first** (when the
workspace ships them — the appmixer-connectors repo does; skip otherwise) —
pre-commit only validates CHANGED files, so long-standing bugs (e.g. a dynamic
outPort source missing a required input → empty variable pickers / invalid
chips in the designer) survive for months until someone runs the full check:

```bash
node scripts/validate.js --connector <connector>   # from the workspace root
# triage the failures for the components you are about to test; legacy findings
# on untouched components are threshold-gated and may be left alone
```

Pack and publish (absolute zip path — `pack` writes the zip into the CWD and stale
zips from earlier sessions may exist elsewhere in the repo; a relative `publish`
after a cwd reset silently publishes the wrong one):

```bash
cd src/<vendor>   # from the workspace root
rm -f <vendor>.<connector>.zip
appmixer pack <connector>
appmixer publish "$PWD/<vendor>.<connector>.zip"
```

**⚠️ `appmixer remove` can fail with a transient 502/504 (Bad Gateway / Gateway
Timeout) — the remove did NOT happen.** A publish right after appends a stale
duplicate instead of refreshing (see the stale-snapshot section). Retry every
failed remove until it prints `… removed.`, and only then publish.

**Verify what the server actually stored** (as the e2e user):
`GET /components/<full.component.name>` returns the stored component **zip** — unzip
it and compare a marker (version, a changed URL) with your local component.json.
The zip may legitimately contain the SAME file several times (each publish of an
existing version appends a copy): that is harmless **only when all copies are
byte-identical AND carry your marker** — otherwise remove + publish again:

```bash
TOKEN=$(node "$APPMIXER_SKILL_ROOT"/test-connector/scripts/appmixer-flow.mjs auth | tail -1)
curl -s -H "Authorization: Bearer $TOKEN" \
  "$APPMIXER_SKILL_API_URL/components/<vendor>.<connector>.<module>.<Component>" -o /tmp/comp.zip
python3 - <<'EOF'
import zipfile
z = zipfile.ZipFile('/tmp/comp.zip')
infos = [i for i in z.infolist() if i.filename.endswith('component.json')]
contents = [z.read(i) for i in infos]
marker = b'<some string unique to your change>'
print(f'copies={len(contents)} identical={all(c == contents[0] for c in contents)} '
      f'marker_in_all={all(marker in c for c in contents)}')
EOF
```

### Step 2: Ensure Auth Account Exists

List existing accounts or create one:

```bash
# List existing accounts
node "$APPMIXER_SKILL_ROOT"/test-connector/scripts/appmixer-flow.mjs list-accounts <vendor>:<connector>

# Or create from local configstore (appmixer CLI stores auth here after `appmixer test auth`)
CONFIGSTORE="$HOME/.config/configstore/appmixer.json"
AUTH_JSON=$(python3 -c "
import json
d = json.load(open('$CONFIGSTORE'))
fields = d.get('<vendor>:<connector>', {}).get('authFields', {})
print(json.dumps(fields))
")
ACCOUNT_ID=$(node "$APPMIXER_SKILL_ROOT"/test-connector/scripts/appmixer-flow.mjs create-account <connector> "$AUTH_JSON")

# For OAuth2 connectors, pass the tokens instead of authFields:
# AUTH_JSON='{"accessToken":"...","refreshToken":"..."}'
```

**OAuth2 specifics** (all handled by `create-account`, listed for manual/curl debugging):

- The engine validates scopes on `POST /accounts` and reads them from **`token.scope`
  (singular, array)** — `token.scopes` or a top-level `scopes` field is silently
  ignored and the request fails with `400 "Scopes provided have missing required
  scopes"`. `create-account` fills `token.scope` from the connector's `auth.js`
  automatically when the auth JSON doesn't carry it.
- **Service config must exist** (`GET /service-config/<vendor>:<connector>` must
  return a `clientId`) — the engine instantiates the connector's auth module during
  account creation and needs it. Without it the API fails with an opaque 500.
  `create-account` checks this and tells you to set it:
  `PUT /service-config/<vendor>:<connector> {"clientId":"...","clientSecret":"..."}`.
- **500 wrapping `Request failed with status code 404`** on account creation means
  the connector's `requestProfileInfo` makes an HTTP call that fails server-side
  (e.g. the service has no userinfo endpoint). Fix the connector: derive profile
  info without HTTP (decode JWT claims locally) or guard the call — then
  remove + republish the connector (stale auth-module snapshots survive plain
  publishes; a worker restart may be needed).

Test the account is valid:
```bash
TOKEN=$(node "$APPMIXER_SKILL_ROOT"/test-connector/scripts/appmixer-flow.mjs auth | tail -1)
curl -s -X POST "$APPMIXER_SKILL_API_URL/accounts/$ACCOUNT_ID/test" -H "Authorization: Bearer $TOKEN"
# Should return {"ok":true}
```

**⚠️ `{"ok":true}` may prove nothing.** The test runs the connector's
`validateAccessToken`, and some connectors (e.g. salesforce) only compare a stored
expiry date — a revoked/dead token still returns ok. Confirm with a REAL service
call: hit a cheap component source endpoint with the account bound, the way the
designer does:

```bash
curl -s -X POST "$APPMIXER_SKILL_API_URL/component/<vendor>/<connector>/<module>/<ListComponent>?outPort=out" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"componentId":"<any-component-id-with-this-account>","flowId":"<flowId>"}'
# Options/data back = token really works. 401/403 (Bad_OAuth_Token, INVALID_SESSION_ID) = dead account.
```

Dead-account symptom downstream: flow START fails with 400 wrapping an inner 401
AxiosError whose `config.url` points at the service (trigger `start()` calls), or
components fail mid-run with 401/403. When several accounts exist for the service,
test each and pin the working one with `APPMIXER_SKILL_ACCOUNT_ID`.

### Step 3: Upload Test Flows

```bash
# Upload all test flows for a connector (dir resolved from connector name)
node "$APPMIXER_SKILL_ROOT"/test-connector/scripts/appmixer-flow.mjs upload-all <connector>

# Or upload a single flow
node "$APPMIXER_SKILL_ROOT"/test-connector/scripts/appmixer-flow.mjs upload-flow \
    /abs/path/to/test-flow-xxx.json <connector>
```

`upload-all <connector>` / `upload-flow <file> <connector>` take **no account
argument**. `prepFlow` only sets, on each flow:
- `customFields.category: "E2E_test_flow"` — for filtering
- `description: "E2E test flow for <connector>"`
- **ProcessE2EResults stores** — `config.properties.failedStoreId` / `successStoreId` injected from the instance stores

The upload commands use the createOrUpdate pattern: if a flow with the same name exists, it is stopped and updated in place (with `?forceUpdate=true`). Flows are never deleted and recreated.

**⚠️ Account assignment is NOT automatic.** `upload-all`/`upload-flow` do **not**
set `config.properties.account` and do **not** call the auth API. After upload
you MUST assign the account yourself, otherwise the engine has no access token
and the flow fails at runtime:
```bash
node "$APPMIXER_SKILL_ROOT"/test-connector/scripts/appmixer-flow.mjs patch-accounts "$FLOW_ID" "$ACCOUNT_ID" "<vendor>.<connector>."
```
This sets `config.properties.account` on every matching component **and** calls
`PUT /auth/component/:componentId/:accountId`.

**Account IDs in flow JSONs are tolerated but instance-specific.** Flows
downloaded from a live instance (`download-E2E-flows.js`) carry that instance's
`config.properties.account` values — do not strip them (they keep the file in
sync with the download output), but never rely on them either: they are
meaningless on any other tenant and rot when accounts are deleted. Binding is
always re-done at upload/run time — patch-accounts here, or the E2E run step
runner, which ignores flow-authored IDs that don't exist on the target instance
and rebinds a live account (`APPMIXER_SKILL_ACCOUNT_ID` overrides everything).

**⚠️ Recipients are NOT injected.** If you want ProcessE2EResults to notify
someone, set `recipients` in the flow JSON's ProcessE2EResults lambda yourself.

### Step 4: Validate Before Running

#### 4a: Validate Flow JSONs Locally

Run structural + coverage validation on test flow JSONs before uploading:

```bash
node "$APPMIXER_SKILL_ROOT"/test-connector/scripts/validate.js \
    src/<vendor>/<connector>/artifacts/test-flows
```

This catches issues like:
- Assert testing Raw Output (meaningless — always passes)
- Missing AfterAll connections
- Variable path referencing non-existent components
- Required input fields not provided
- ProcessE2EResults missing storeIds

**Common issues in generated flows to check manually:**

1. **Missing required fields** — The generator sometimes omits fields in `inPorts[0].schema.required`. Cross-check every Create component's transform against `component.json` and ensure all required fields are present.

2. **Hardcoded IDs that don't exist on the test account** — Dynamic-select fields (stage ID, view ID, pipeline ID) may be hardcoded with placeholder values like `1` or `12345`. These will 403/404 at runtime. Fetch real IDs from the API or use upstream List* components.

3. **Wrong `view_id` for Find* components** — If a component uses a view-based search (e.g. `FindDeals`), the generated flow may use `view_id: 1`. Always verify a valid view ID exists.

#### 4b: Validate Variable References (After Upload)

After uploading, **validate that all variable references are resolvable**:

```bash
node "$APPMIXER_SKILL_ROOT"/test-connector/scripts/appmixer-flow.mjs validate-variables "$FLOW_ID"
```

This calls `POST /variables/$FLOW_ID/fetch` — the SAME endpoint the designer
uses to render variable chips — and checks every transform variable against
what the designer would offer. Output is one `OK`/`INVALID` line per mapping
(INVALID = red chip in the designer, typically unresolvable at runtime), plus
any fetch errors; **exit code 1 when anything is invalid**. If the fetch
endpoint is unavailable it falls back to a plain listing and says so — a
listing is NOT a validation.

Response internals (for manual digging): with `compress=true` the offered
variables are deduplicated into `dynamicComponentVariables[]` and each
`components.<id>.links.in.<sender>.<port>.variables` carries `refs` — indices
into that array; entry values look like `{{{$.<id>.<port>.<field>}}}`.
`variables.errors` entries mean the source's options call failed.

**NEVER assert on Raw Output** (`$.comp-id.out`) — it always contains something, making the assertion meaningless. Always test specific fields (e.g. `$.comp-id.out.ManualJournalID` notEmpty).

## Auth Token — When `/user/auth` Returns 403

`appmixer-flow.mjs` authenticates by calling `POST /user/auth`. If that returns
403 (e.g. password has special chars, or an SSO-only account), provide a
pre-obtained token via the `APPMIXER_TOKEN` env var — the client then skips
`/user/auth` entirely:

```bash
# Reuse the appmixer CLI's stored token
export APPMIXER_TOKEN=$(node -e "console.log(require(require('os').homedir()+'/.config/configstore/appmixer.json').token)")
node "$APPMIXER_SKILL_ROOT"/test-connector/scripts/appmixer-flow.mjs auth   # echoes the token in use
```

## Running Outside the Workspace (worktrees, CI)

The Node scripts resolve the workspace by walking up from the cwd. When you
must run from elsewhere — or target a specific git worktree different from your
cwd — set the override explicitly for those commands:

```bash
export APPMIXER_SKILL_CONNECTORS_DIR=/path/to/worktree
```

## Stale Worker OAuth State After Re-authentication

Engine workers also cache per-account OAuth state (the refresh-token lineage).
After a user re-authenticates an OAuth account to gain NEW permissions (e.g.
Epic: re-consent after adding app APIs), workers still holding the old lineage
keep minting **fresh access tokens with the OLD entitlements** — the token's
`iat` looks current, yet some calls 403 while identical calls from another
worker succeed (search 200 + read 403 within one flow run; scratch flows
pass/fail per worker). Rebinding accounts, new flowIds or new componentIds do
NOT help. Fix: **restart the engine workers**, or create a brand-new account
(new accountId) and rebind. Real case: epic GetAppointment, 2026-07-17.

## Stale Component Definition / Code After Publish

`appmixer publish` **does not refresh already-existing component versions** — neither
their definitions (`inPorts`/`outPorts`/inspector) nor their **runtime code,
including shared files like `lib.js`** that components `require()`. Each
(component, version) is snapshotted at first publish; re-publishing the connector
only adds NEW components/versions.

Symptoms:
- `/components` returns old `inPorts`/`outPorts`/`source` URLs after a "successful" publish.
- Newly added components work while an old sibling crashes at runtime with
  `Cannot read properties of undefined (reading 'someApiFn')` — its frozen snapshot
  pre-dates a function you added to `lib.js`.
- Flow start rejected with 400 `Component transformation validation error` because
  stale inPort schemas are validated against current flow transforms.

**Fix: remove + publish, as the e2e user** (see Step 1 — removes/publishes by a
different CLI login do NOT touch the e2e user's copies), for every affected component:

```bash
appmixer remove <vendor>.<connector>.<module>.<Component>
sleep 1
appmixer publish "$PWD/<vendor>.<connector>.zip"
```

Whack-a-mole warning: each publish of an existing version **appends a duplicate
copy** into the stored package of every non-removed component — removing A+B and
publishing refreshes A+B but appends a dupe to the just-cleaned C+D. Duplicates
are harmless **when byte-identical** (verify with the zipfile snippet in Step 1);
only content that differs across copies needs another remove+publish round. And
retry any `appmixer remove` that fails with 502/504 — a gateway error means the
remove did NOT happen.

Alternative when definitions refuse to update in place: **bump the component
`version`** in component.json (new version = new snapshot) and update the flows'
`version` pins to match.

Verify after:
```bash
TOKEN=...
curl -s -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/components?limit=500" | python3 -c "
import sys,json; items=json.loads(sys.stdin.read()); items=items if isinstance(items,list) else items.get('components',[])
for i in items:
    if i.get('name')=='<vendor>.<connector>.<module>.<Component>':
        print(json.dumps({k:i[k] for k in ['inPorts','outPorts']}, indent=2)[:400]); break
"
```

## Known Gotchas

### Stores must exist
The `E2E Failed Tests` and `E2E Succeeded Tests` stores must exist before upload. Auto-create them:
```bash
node "$APPMIXER_SKILL_ROOT"/test-connector/scripts/appmixer-flow.mjs ensure-stores
```

### Flows must be stopped before PUT update
`PUT /flows/:flowId` rejects updates on running flows. The upload commands handle this automatically (stop → update → re-assign accounts). Never update a running flow manually without stopping first.

### Dynamic output ports show "Raw Output" — fix source URL
If `validate-variables` shows a component only exposes "Raw Output" instead of individual fields, the component's `generateOutputPortOptions` is failing. Common causes:
1. **The source call fails server-side** — reproduce it directly (the way the designer does) and read the actual error:
   ```bash
   curl -s -X POST "$APPMIXER_SKILL_API_URL/component/<vendor>/<connector>/<module>/<SourceComponent>?outPort=out" \
     -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
     -d '{"messages":{"in":{...}},"transform":"./transformers#...","componentId":"<comp-id>","flowId":"<flow-id>"}'
   ```
2. **Missing `dummy` for required fields**: If inPort schema has required fields not needed for schema generation, send `"dummy"` as their value in source messages.
3. **`ignoreAuth=true` — only for sources that genuinely need NO auth.** ⚠️ Do NOT
   cargo-cult it: with `ignoreAuth=true` the engine calls the source component
   WITHOUT the account, so a source that needs auth (describe/list endpoints reading
   `context.auth.accessToken` / `context.profileInfo.instanceUrl`) builds its URL from
   `undefined` and fails with 500 `"Invalid URL"` — the designer then renders red
   **"Invalid URL" chips** in the inspector and all output variables show as invalid.
   The designer sends the caller's bound account automatically; auth-requiring
   sources must keep the default (no `ignoreAuth`).
After fixing, re-publish the connector (remove + publish — see the stale-snapshot section) and re-upload the flow.

### `validate-variables` checks designer offerings, not runtime data
It validates that every transform variable is among what the designer's
variables-fetch endpoint offers (red-chip detection). It does NOT validate
runtime VALUES — a variable like `$.codeblock.out.result.field` can be offered
yet empty at runtime. Always confirm by running the flow.

### Special characters in `.env` passwords
Passwords with `&`, `!`, `|` etc. break `source .env`. Always use the helper script commands — they use Python to parse the `.env` safely.

## Key API Endpoints

| Action | Method | Endpoint |
|--------|--------|----------|
| List E2E flows | GET | `/flows?filter=customFields.category:E2E_test_flow&limit=500` |
| Get flow | GET | `/flows/:flowId?projection=flow` (always use projection!) |
| Create flow | POST | `/flows` |
| Update flow | PUT | `/flows/:flowId?forceUpdate=true` |
| Assign account | PUT | `/auth/component/:componentId/:accountId` |
| List accounts | GET | `/accounts` |
| Test account | POST | `/accounts/:accountId/test` |
| Get stores | GET | `/stores` |
| Validate variables | POST | `/variables/:flowId/fetch?compress=true` |

## References

- **API details**: `skills/_shared/appmixerApi/*.js` — the shared HTTP client library is the single source of truth for Appmixer API calls
