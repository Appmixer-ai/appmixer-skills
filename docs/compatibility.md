# Compatibility

Three things have versions here: these skills, the `appmixer` CLI they drive, and the Appmixer instance you publish to. This page says which combination has been exercised end to end, and what each feature needs as a minimum. It changes with every release of any of the three, which is why it lives here rather than in the product docs.

## The combination that was exercised

| | Version | Where it comes from |
| --- | --- | --- |
| appmixer-skills | **1.0.0** | tag `v1.0.0`; `metadata.version` in every `SKILL.md` |
| `appmixer` CLI | **2.6.0** | the npm `latest` tag |
| Appmixer | **6.5** | the instance the end-to-end run published to |
| Node.js | **18.15.0 or newer** | the CLI's `engines` field |

This is the triple the Appmixer guide *Build Connectors with a Coding Agent* was written and run against: a real connector built, component-tested, schema-verified, reviewed, published and run as E2E flows. Other combinations may work; they have not been run.

The README says Node 18. The CLI declares `>=18.15.0`, and that is the one that is enforced.

## What the CLI needs to be

Every CLI-side feature the skills rely on beyond basic testing and publishing arrived in **2.6.0**:

| Feature | Command | First CLI version |
| --- | --- | --- |
| E2E flow testing | `appmixer e2e import`, `run`, `list`, `results`, … | 2.6.0 |
| live schema verification | `appmixer connector verify` | 2.6.0 |
| offline source validation | `appmixer connector validate` | 2.6.0 |
| a trigger's `test()` run locally | `appmixer test component <dir> --test` | 2.6.0 |
| checking your own account, incl. `vendor` and `scope` | `appmixer user me` | 2.6.0 |

On 2.5.0 or older, `test-connector` falls back as its *Known CLI limitations* section describes, and the E2E steps stop with an upgrade hint. Check with `appmixer --version`.

### One limitation 2.6.0 did not lift

`test-connector` lists `context.staticCache` and `context.lock` as unavailable in `appmixer test component` on **2.3.4 and older**. As far as the CLI source shows, **2.6.0 has the same limitation**: the component runtime `test component` uses is byte-identical in 2.3.4, 2.5.0 and 2.6.0, and `test component` itself wires no static cache. A cached code path — most often a dynamic dropdown source — still fails locally with `Missing static cache.` and has to be verified on a live instance. Record it as `not-cli-testable (staticCache)` in the test plan, as the skill says, and do not rewrite the component to dodge it.

## What the instance needs to be

| Feature | Needs | First Appmixer version |
| --- | --- | --- |
| Flow Test Mode — a trigger's `test()` run from the Designer | engine test mode | 6.5.0 |
| conditional auth fields (`when` in `auth.js`) | engine | 6.5 |
| AI Copilot choosing components by `aiDescription` | the Copilot system plugin | 6.5.1 |
| E2E flow runs | the `appmixer.utils.test` module installed on the instance | — |

The 6.4 line has none of the first three. A connector that uses conditional auth fields, or a trigger whose `test()` you want reachable from the Designer, needs 6.5.

**E2E runs need a module, not an engine version.** The E2E flows the skills generate end in `appmixer.utils.test` components — `Assert`, `AfterAll`, `ProcessE2EResults` — and `appmixer e2e run` decides that a run has finished by finding `ProcessE2EResults` in the logs. Those components belong to the `appmixer.utils` connector's `test` module, not to the engine, so an instance without that module cannot run the flows at all. Check before you start:

```bash
appmixer component ls appmixer.utils.test
```

## When this page changes

A new release of any of the three updates this page — the tested triple first, then whichever minimum moved. If a combination here stops being true, that is a documentation bug; please open an issue.
