# Publish & Prepare for E2E

Publish a connector to a live Appmixer instance and prepare it for E2E runs
(auth account, validation). Flow upload is `appmixer e2e import`'s job — it
createOrUpdates every flow from the local JSON by its E2E identity
(customFields `category`/`connector`/`name`), injects the E2E stores, binds
accounts (+ validity preflight) and validates variables server-side. Running
is `appmixer e2e run` (see `13-e2e-run.md`).

## Prerequisites

- **`appmixer` CLI** — installed (`npm i -g appmixer`) at version **2.6.0 or
  newer** (the first with the `e2e` commands). This is the ONLY dependency —
  there is no other tooling and no required environment variable.
  **Verify the version before anything else** and stop with an upgrade hint
  when it is too old:

  ```bash
  V=$(appmixer --version 2>/dev/null) || { echo "appmixer CLI not installed — npm i -g appmixer"; exit 1; }
  [ "$(printf '%s\n2.6.0\n' "$V" | sort -V | head -1)" = "2.6.0" ] \
    || { echo "appmixer >= 2.6.0 required (found $V) — npm i -g appmixer@latest"; exit 1; }
  ```
- **CLI configured against the target instance:**
  ```bash
  appmixer url https://api.your-instance.com
  appmixer login your@email.com          # the e2e user — see Step 1
  ```
  If the CLI is not configured yet, ask the user for the API URL and the e2e
  user's credentials and run the two commands. Every command in this skill
  (publish, `e2e import/run/...`) uses this session.
- **Run from the connector workspace** — the current directory (or a parent)
  contains `src/<vendor>/<connector>/`; the e2e commands resolve the
  workspace from the cwd (`--connectors-dir <dir>` overrides it when running
  from elsewhere — see the worktree section below). `<vendor>` is the
  namespace directory under `src/` — `appmixer` is only the default; a
  workspace can hold several vendors side by side. Bare connector names are
  searched across all vendor dirs; when ambiguous, qualify as
  `<vendor>/<connector>`.
- Test flow JSON files in `artifacts/test-flows/` (generated per `11-e2e-flow-generation.md`, shipped with `build-connector`)

**⚠️ Instance check:** the CLI session decides WHICH INSTANCE every command
talks to; a wrong one looks like auth breakage (fresh tokens get 401 "Invalid
JWT", flow/store listings return foreign IDs/empty lists). Before anything
else, confirm `appmixer url` prints the instance you expect — abort if it
doesn't.

> **Optional env overrides (CI, dedicated e2e user):** the e2e commands also
> honor `APPMIXER_TOKEN` (pre-obtained JWT) and the `APPMIXER_SKILL_*`
> variables (`_API_URL`, `_USERNAME`, `_PASSWORD`, `_ACCOUNT_ID`,
> `_CONNECTORS_DIR`, `_UI_URL`) — CLI features documented in the CLI README.
> When any are exported they take precedence over the CLI session; make sure
> they point at the same instance and user, or unset them.

## Quick Start

```bash
# 1. Publish the connector (as the e2e user — see Step 1)
cd src/<vendor>   # from the workspace root
appmixer pack <connector>
appmixer publish <vendor>.<connector>.zip   # pack outputs <vendor>.<connector>.zip

# 2. Make sure an auth account exists for the connector (Step 2)
appmixer account ls --json

# 3. Import the flows — local validation, upload, store injection, account
#    binding and server-side variable validation in one step (exit 1 = fix first)
appmixer e2e import src/<vendor>/<connector>/artifacts/test-flows

# 4. Run each flow by its ID (see 13-e2e-run.md)
appmixer e2e list -c <vendor>:<connector> --json
appmixer e2e run <flowId> --fix
```

## Workflow

### Step 1: Publish Connector

**⚠️ Components are per-user copies.** `appmixer publish`/`remove` act on the copies
owned by whoever the CLI is logged in as — if that is NOT the user who runs the
E2E flows, the publish looks successful but the e2e user's designer, flows and
API keep serving **their own stale copy**. ALWAYS make sure the CLI login is
the e2e user before publishing (idempotent, do it every session — "already
logged in" may mean logged in as someone else):

```bash
appmixer url https://api.your-instance.com
appmixer login <e2e-user@email>     # prompts for the password
# non-interactive alternative: printf '%s\n' "$PASSWORD" | appmixer login <e2e-user@email>
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
# Reuse the CLI's stored login token and API URL (aligned with the e2e user in Step 1)
TOKEN=$(node -e "console.log(require(require('os').homedir()+'/.config/configstore/appmixer.json').token)")
BASE_URL=$(node -e "console.log(require(require('os').homedir()+'/.config/configstore/appmixer.json')['appmixer-url'].default.url)")
curl -s -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/components/<vendor>.<connector>.<module>.<Component>" -o /tmp/comp.zip
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

List existing accounts (filter by service yourself — service is
`<vendor>:<connector>`, nested connectors often authenticate at the top level,
e.g. `appmixer:microsoft`):

```bash
appmixer account ls --json
```

**Creating an account is a user step.** The reliable path is a human
authenticating in the Appmixer designer UI ("Connect account" on any component
of the connector) — ask the user to do it and then re-list. Injecting an
account directly (`appmixer account create <file>` with
`{ "name": ..., "service": "<vendor>:<connector>", "token": {...}, "profileInfo": {} }`)
also works, but mind the engine's requirements:

- **OAuth2 scopes**: the engine validates scopes on account creation and reads
  them from **`token.scope` (singular, array)** — `token.scopes` or a top-level
  `scopes` field is silently ignored and the request fails with `400 "Scopes
  provided have missing required scopes"`. Fill `token.scope` with the scope
  array from the connector's `auth.js` if the token payload doesn't carry it.
- **Service config must exist** (`GET /service-config/<vendor>:<connector>` must
  return a `clientId`) — the engine instantiates the connector's auth module during
  account creation and needs it. Without it the API fails with an opaque 500.
  Set it first: `PUT /service-config/<vendor>:<connector>
  {"clientId":"...","clientSecret":"..."}` (or via Backoffice > Services).
- **500 wrapping `Request failed with status code 404`** on account creation means
  the connector's `requestProfileInfo` makes an HTTP call that fails server-side
  (e.g. the service has no userinfo endpoint). Fix the connector: derive profile
  info without HTTP (decode JWT claims locally) or guard the call — then
  remove + republish the connector (stale auth-module snapshots survive plain
  publishes; a worker restart may be needed).

Test the account is valid:
```bash
appmixer account test <accountId>
# Should return {"ok":true}
```

**⚠️ `{"ok":true}` may prove nothing.** The test runs the connector's
`validateAccessToken`, and some connectors (e.g. salesforce) only compare a stored
expiry date — a revoked/dead token still returns ok. Confirm with a REAL service
call: hit a cheap component source endpoint with the account bound, the way the
designer does:

```bash
TOKEN=$(node -e "console.log(require(require('os').homedir()+'/.config/configstore/appmixer.json').token)")
BASE_URL=$(node -e "console.log(require(require('os').homedir()+'/.config/configstore/appmixer.json')['appmixer-url'].default.url)")
curl -s -X POST "$BASE_URL/component/<vendor>/<connector>/<module>/<ListComponent>?outPort=out" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"componentId":"<any-component-id-with-this-account>","flowId":"<flowId>"}'
# Options/data back = token really works. 401/403 (Bad_OAuth_Token, INVALID_SESSION_ID) = dead account.
```

Dead-account symptom downstream: flow START fails with 400 wrapping an inner 401
AxiosError whose `config.url` points at the service (trigger `start()` calls), or
components fail mid-run with 401/403. When several accounts exist for the service,
test each and pin the working one with `appmixer e2e import --account <accountId>`.

### Step 3: Flow Upload & Account Binding — `appmixer e2e import` Does It

`appmixer e2e import <file|dir>` handles the whole upload-and-bind cycle:

- **createOrUpdate by identity**: flows are identified on the instance by
  customFields `category: "E2E_test_flow"`, `connector` (a ref like
  `appmixer:google:gdrive`, derived from the file path or given via
  `--connector`) and `name` (the flow's test-case name). A matching flow is
  stopped and updated in place (`?forceUpdate=true`); flows are never deleted
  and recreated. Legacy flows carrying only the category are matched by
  display name and adopted (the identity fields are written on update).
- Sets a description, strips server-only fields, enforces fail-fast
  `errorHandling`.
- **E2E stores**: creates `E2E Failed Tests` / `E2E Succeeded Tests` if missing
  and injects their IDs into ProcessE2EResults.
- **Account binding**: binds an account to every connector component
  (precedence: `--account <id>` / `APPMIXER_SKILL_ACCOUNT_ID` override > the
  component's own `config.properties.account` > first flow-authored account
  that exists on the instance > first existing account of the service), then
  validity-tests every bound account — a plain flow PUT always drops bindings,
  which is why re-import after every edit is the rule.
- **Server-side variable validation**: checks every transform variable against
  what the designer's variables-fetch endpoint offers ("red chip" detection).
  Any INVALID variable fails the import with exit 1.
- Local validation (`appmixer e2e validate` rules) runs first by default;
  `--no-validate` skips it.

**Uploading without running** (rare — e.g. handing a flow to someone in the
designer): `appmixer flow import <file>` creates the flow as-is — no E2E
tagging, no store injection, no account binding. The user must then connect
accounts in the designer by hand (or bind per component:
`appmixer auth bind <componentId> <accountId>`).

**Account IDs in flow JSONs are tolerated but instance-specific.** Flows
exported from a live instance (`appmixer e2e export`) carry that instance's
`config.properties.account` values — do not strip them (they keep the file in
sync with the export output), but never rely on them either: they are
meaningless on any other tenant and rot when accounts are deleted. Binding is
always re-done at import time, which ignores flow-authored IDs that don't
exist on the target instance and rebinds a live account
(`appmixer e2e import --account <accountId>` overrides everything).

**⚠️ Recipients are NOT injected.** If you want ProcessE2EResults to notify
someone, set `recipients` in the flow JSON's ProcessE2EResults lambda yourself.

### Step 4: Validate Before Running

#### 4a: Validate Flow JSONs Locally

`appmixer e2e import` runs this automatically; run it standalone while
iterating on flow JSONs:

```bash
appmixer e2e validate src/<vendor>/<connector>/artifacts/test-flows
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

#### 4b: Validate Variable References (Automatic at Import)

`appmixer e2e import` performs this check automatically after upload and fails
with exit 1 on any INVALID variable (with hints about what IS offered). For a
manual deep-dive on a live flow:

```bash
appmixer flow variables "$FLOW_ID" --json
```

This calls the variables-fetch endpoint (`POST /variables/$FLOW_ID/fetch`) —
the SAME endpoint the designer uses to render variable chips. Compare every
variable used in the flow's `config.transform.*` / `lambda` values against what
the response offers: a transform variable that is NOT among the offered ones
renders as an invalid (red) chip in the designer and typically never resolves
at runtime.

Response internals: with `compress=true` the offered variables are deduplicated
into `dynamicComponentVariables[]` and each
`components.<id>.links.in.<sender>.<port>.variables` carries `refs` — indices
into that array; entry values look like `{{{$.<id>.<port>.<field>}}}`.
`variables.errors` entries mean the source's options call failed.

**NEVER assert on Raw Output** (`$.comp-id.out`) — it always contains something, making the assertion meaningless. Always test specific fields (e.g. `$.comp-id.out.ManualJournalID` notEmpty).

## Auth — When `appmixer login` Is Not Possible

With the default setup the e2e commands reuse the CLI's stored login token —
no extra auth happens. For an account that cannot `appmixer login` (SSO-only,
or `POST /user/auth` rejects the password), provide a pre-obtained JWT via the
`APPMIXER_TOKEN` env var — it takes precedence over everything:

```bash
export APPMIXER_TOKEN=<jwt>
```

## Running Outside the Workspace (worktrees, CI)

The e2e commands resolve the workspace by walking up from the cwd (or
from the flow path). When you must run from elsewhere — or target a specific
git worktree different from your cwd — set the override explicitly:

```bash
appmixer e2e import  <dir> --connectors-dir /path/to/worktree
appmixer e2e validate <dir> --connectors-dir /path/to/worktree
# or once per shell: export APPMIXER_SKILL_CONNECTORS_DIR=/path/to/worktree
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

### Stores are created at import
The `E2E Failed Tests` and `E2E Succeeded Tests` stores must exist with their
IDs injected into ProcessE2EResults — `appmixer e2e import` creates and
injects them automatically; there is nothing to do manually.
(`appmixer store ls` / `appmixer store create <name>` exist for manual work;
`appmixer e2e results [--clean]` reads/prunes the stored per-test-case results.)

### Flows must be stopped before PUT update
`PUT /flows/:flowId` rejects updates on running flows. `appmixer e2e import` handles this automatically (stop → update → re-bind accounts). Never update a running flow manually without stopping first.

### Dynamic output ports show "Raw Output" — fix source URL
If the variables check shows a component only exposes "Raw Output" instead of individual fields, the component's `generateOutputPortOptions` is failing. Common causes:
1. **The source call fails server-side** — reproduce it directly (the way the designer does) and read the actual error:
   ```bash
   curl -s -X POST "$BASE_URL/component/<vendor>/<connector>/<module>/<SourceComponent>?outPort=out" \
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
After fixing, re-publish the connector (remove + publish — see the stale-snapshot section) and re-run the flow.

### The variables check reads designer offerings, not runtime data
It validates that every transform variable is among what the designer's
variables-fetch endpoint offers (red-chip detection). It does NOT validate
runtime VALUES — a variable like `$.codeblock.out.result.field` can be offered
yet empty at runtime. Always confirm by running the flow.

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

- **API details**: the appmixer CLI's `src/api/` modules are the single source of truth for Appmixer API calls; the raw endpoints are in the table above
