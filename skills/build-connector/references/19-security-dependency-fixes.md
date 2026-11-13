# Security Dependency Fixes

How to fix a vulnerable npm dependency of a connector — a published security
advisory, an `npm audit` finding, a scanner report. The fix is usually
small; what breaks it is the runtime it has to load in. Read this before
touching a `package.json` or `package-lock.json` for a security reason.

## What the engine installs

- The engine installs dependencies **per directory that holds a
  `package.json`** — service, module or component level — not once per
  connector.
- A `package-lock.json` next to the `package.json` makes the engine run
  **`npm ci`**. It fails when the lockfile is out of sync with `package.json`,
  and the connector then cannot be installed at all. Every `package.json` edit
  needs the lockfile regenerated in the same commit.
- So a vulnerability reported **only in a lockfile** (a transitive dependency)
  is a real production version, not noise: `npm ci` installs exactly what the
  lockfile says.
- A `package.json` at the **workspace root** (lint, tests, validators) is dev
  tooling and never ships with a connector. Fix it separately from connector
  changes.

## The runtime is Node 18

Connector dependencies load in the **customer's** engine, and tenants still
run Node 18. A dependency that needs a newer Node breaks the install of every
component that requires it, usually with a misleading error that names an
unrelated component (`File is not defined`, `import.meta.dirname` undefined,
`ERR_REQUIRE_ESM`).

Before choosing a fixed version, check it on Node 18:

- `engines.node` of the fixed version and of its new dependencies
  (`npm view <pkg>@<version> engines`) — it must allow 18.17;
- the module format — an ESM-only release cannot be `require()`d by a
  CommonJS component on Node 18;
- `npx -y node@18 -e "require('./<file that requires it>')"` in the connector
  directory, and the connector's unit tests under `npx -y node@18`.

Known traps: `undici` 7 (needs Node 20.18), `uuid` 13 (ESM only), current
`@aws-sdk/*` lines (Node 20), packages using `import.meta.dirname`.

## Choosing the fix

Pick the first that applies:

1. **The dependency should not be there.** A connector must not ship its own
   HTTP client: replace a bundled `axios` (or `request`, `node-fetch`) with
   `context.httpRequest`, which is the engine's axios 1.x, in components and
   plugins alike. Remove the vulnerable package rather than upgrade it. axios
   1.x rejects a `url.parse()` object as `url`, so pass strings.
2. **A direct dependency with a Node-18 fixed release.** Bump it in
   `package.json` to the lowest fixed version that runs on Node 18 (the
   advisory's *first patched version*, or the last patched line that still
   supports 18), then regenerate the lockfile.
3. **A transitive dependency.** Prefer bumping the direct dependency that pulls
   it in. If no release of the parent fixes it, pin the transitive one with
   **`overrides`** in the same `package.json`, to a fixed version the parent's
   range still accepts or that is API-compatible, and say why in the commit.
4. **Deprecated with no fix** (`request`, `request-promise`). Replace the
   library: `context.httpRequest`, or a maintained client.
5. **No release works on Node 18.** Do not force it and do not silence the
   finding. Leave the dependency and report why it cannot be fixed yet: the
   fixed version, its `engines`, what fails.

Packages not published to npm (for example SheetJS `xlsx`, served from its
own CDN) go into the connector as a vendored tarball next to `package.json`
(`"xlsx": "file:xlsx-0.20.3.tgz"`), never as a CDN URL in `package.json`.

Very large monolith packages (the `googleapis` bundle is over 200 MB per
module and makes the publish fail) are replaced by their scoped packages
(`@googleapis/drive`, `@googleapis/sheets`, …), not upgraded.

## Regenerating the lockfile

In the directory of the `package.json` you changed:

```bash
npm install --package-lock-only --ignore-scripts   # rewrite package-lock.json
npm ci --ignore-scripts                            # what the engine runs — must pass
npm ls <package>                                   # every copy at a fixed version
```

Keep the lockfile's `lockfileVersion`. Commit `package.json` and
`package-lock.json` together; never commit `node_modules`.

A version bump that changes the **file layout** of a package (files moved or
renamed between releases) can fail on warm engine workers with `ENOENT` inside
`node_modules`, because Node caches resolved paths per directory. The engine
unpacks a module into `<module>-<version>` from its `module.json` (or
`service.json`): bump that `version` too, so the new code lands in a new
directory.

## Scope of the change

- Fix **every manifest** that carries the vulnerable package in one change
  (the same package in several connectors), so no connector stays behind.
- Each changed connector gets **one** `bundle.json` patch bump (a minor if
  behaviour changes, for example a replaced HTTP client) and a changelog entry
  a user understands: `Security: updated <package> to <version> (<advisory id>).`
- Do not refactor around the fix. If a replacement changes behaviour, keep the
  component's inputs and outputs identical.

## Verifying

A security fix must not change what the connector does:

- unit tests of each changed connector, on Node 18 as above;
- `node scripts/validate.js --connector <connector>` and eslint, as for any
  change;
- for a replaced library: compare the requests the old and new code send (the
  same URL, method, headers and body for the same input) and the outputs;
- the connector's E2E flows (`09-testing.md`).
