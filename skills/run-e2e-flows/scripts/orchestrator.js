/* eslint-disable max-len */
//
// Explicit state machine. This is the whole control flow in one legible place.
//
// Every step is a named STATE, every transition is logged as `[FSM] FROM → TO  (why)`. There is
// NO LLM in this runner: when deterministic triage cannot resolve a failure, the runner exits
// with a structured FIX BRIEF (exit code 2) and the calling agent — following the run-e2e-flows
// SKILL.md — diagnoses the failure, edits the local flow JSON, and re-runs this script. INIT
// re-uploads the local file and rebinds accounts on every run, so edit → re-run is the whole
// loop. If you want to know "what does this tool actually do", you read the switch below top
// to bottom.
//
//   INIT → ENSURE_STOPPED → START → WAIT → COLLECT → TRIAGE ─┬─ done ─────────→ DONE_OK
//             ▲                                              ├─ reassign → DET_FIX ─┘(retry)
//             └──────────────────────────────────────────────┤
//                                                            ├─ ai-fix ───────→ DONE_NEEDS_FIX (exit 2)
//                                                            ├─ auth/scope ───→ DONE_FAIL (human re-auth)
//                                                            └─ budget spent ─→ DONE_FAIL
//
import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { AppmixerClient } from './appmixerClient.js';
import { triage } from './triage.js';
import { readFlowJson, deriveConnectorsDir, deriveConnectorPrefixes } from './flowFiles.js';

const S = {
    INIT: 'INIT',
    ENSURE_STOPPED: 'ENSURE_STOPPED',
    START: 'START',
    WAIT: 'WAIT',
    COLLECT: 'COLLECT',
    TRIAGE: 'TRIAGE',
    DET_FIX: 'DET_FIX',
    DONE_OK: 'DONE_OK',
    DONE_FAIL: 'DONE_FAIL',
    DONE_NEEDS_FIX: 'DONE_NEEDS_FIX'
};
const TERMINAL = new Set([S.DONE_OK, S.DONE_FAIL, S.DONE_NEEDS_FIX]);

// Designer (UI) URL for a flow. Comes exclusively from APPMIXER_SKILL_UI_URL -
// deriving the UI host from the API host (api.* -> my.*, api-<x> -> <x>) proved
// fragile across instances, so no guessing: without the env var, report the
// flow id instead of a link.
function designerUrl(baseUrl, flowId) {
    const ui = process.env.APPMIXER_SKILL_UI_URL;
    if (!ui) return `(set APPMIXER_SKILL_UI_URL for a designer link) flowId=${flowId}`;
    return `${ui.replace(/\/$/, '')}/designer/${flowId}`;
}

// Required OAuth scopes of a component, read from its component.json on disk.
// Type appmixer.microsoft.calendar.ListEvents → src/appmixer/microsoft/calendar/ListEvents/component.json.
function requiredScopes(connectorsDir, componentType) {
    try {
        const parts = (componentType || '').split('.');
        if (parts[0] !== 'appmixer' || parts.length < 3) return null;
        const file = path.join(connectorsDir, 'src', 'appmixer', ...parts.slice(1), 'component.json');
        const json = JSON.parse(fs.readFileSync(file, 'utf-8'));
        return json.auth?.scope || null;
    } catch { return null; }
}

// Add componentType (resolved from the flow definition when logs only carry the id) and the
// component's required scopes to each parsed error — turns "Access token not found for <uuid>"
// into an actionable diagnosis.
function enrichErrors(errors, flowJson, connectorsDir) {
    const comps = flowJson.flow || {};
    return errors.map(e => {
        const type = (e.componentType && e.componentType !== '?')
            ? e.componentType
            : comps[e.componentId]?.type || e.componentType;
        const scopes = requiredScopes(connectorsDir, type);
        return { ...e, componentType: type, ...(scopes ? { requiredScopes: scopes } : {}) };
    });
}

// Re-point ProcessE2EResults store IDs in the local JSON to whatever the live flow currently uses,
// so a PUT of the (store-stripped) local file doesn't wipe instance-specific store bindings.
function preserveStoreIds(localJson, serverFlow) {
    const serverComps = serverFlow.flow || {};
    for (const [id, comp] of Object.entries(localJson.flow || {})) {
        if (comp.type?.includes('ProcessE2EResults') && serverComps[id]?.config?.properties) {
            comp.config = comp.config || {};
            comp.config.properties = comp.config.properties || {};
            comp.config.properties.successStoreId = serverComps[id].config.properties.successStoreId;
            comp.config.properties.failedStoreId = serverComps[id].config.properties.failedStoreId;
        }
    }
    return localJson;
}

// Which utils.test.Assert components logged anything within this run — a SILENT assert is the
// tell-tale of a clean timeout: something upstream emitted no message (empty per-record output,
// link on a non-existent port), so the assert never fired and AfterAll waited forever.
function assertActivity(flowJson, logs, runStartTs) {
    const asserts = Object.entries(flowJson.flow || {})
        .filter(([, c]) => (c.type || '') === 'appmixer.utils.test.Assert')
        .map(([id]) => id);
    const seen = new Set();
    for (const h of logs?.hits || []) {
        const src = h._source || h;
        if (src.componentId && (!runStartTs || (src.gridTimestamp || '') >= runStartTs)) seen.add(src.componentId);
    }
    return {
        fired: asserts.filter(a => seen.has(a)),
        silent: asserts.filter(a => !seen.has(a))
    };
}

// A flow with NO external trigger (every non-utils component has an upstream link) is fully
// OnStart-driven: nothing outside the instance can "arrive later", so a clean timeout is a real
// defect, not event latency. External triggers sit SOURCELESS in the flow (provoke pattern).
function hasExternalTrigger(flowJson) {
    return Object.values(flowJson.flow || {}).some(c =>
        !(c.type || '').startsWith('appmixer.utils.')
        && Object.keys(c.source?.in || c.source || {}).length === 0);
}

// Best-effort stop of the currently running flow — called by run.js on runner timeout and
// SIGINT/SIGTERM so a killed runner never leaks a running flow (zombie trigger subscriptions
// interfere with later runs).
let CURRENT = null;
export async function emergencyStop(reason) {
    if (!CURRENT || !CURRENT.ctx.flowId) return false;
    try {
        await CURRENT.api.stopFlow(CURRENT.ctx.flowId);
        console.log(chalk.yellow(`Emergency stop: flow ${CURRENT.ctx.flowId} stopped (${reason}).`));
        return true;
    } catch { return false; }
}

// timeoutSec covers the LONGEST legitimate completion. MS Graph change notifications can
// take ~5 minutes to arrive (measured), so webhook-trigger flows legitimately run that long.
// Errors don't wait for it — fail-fast errorHandling stops the flow on the first component error.
export async function run({ flowPath, baseUrl = null, maxAttempts = 5, timeoutSec = 480 }) {
    if (!flowPath) throw new Error('flowPath (path to the flow.json) is required.');

    // Everything is derived from the one input: the flow.json on disk.
    const flowJson = readFlowJson(flowPath);
    const connectorsDir = deriveConnectorsDir(flowPath);
    const connectorPrefixes = deriveConnectorPrefixes(flowJson);
    const connectorLabel = connectorPrefixes.join(', ') || 'unknown';
    if (!flowJson.name) throw new Error(`Flow JSON has no "name": ${flowPath}`);

    const api = new AppmixerClient(baseUrl ? { baseUrl } : {});
    const ctx = {
        flowPath, connectorsDir, connectorPrefixes, connectorLabel, maxAttempts, timeoutSec,
        flowId: null, flowName: flowJson.name, flowJsonPath: flowPath, stage: null,
        runStartTs: null, result: null, logs: null, errors: [],
        attempt: 0,            // deterministic fix attempts consumed
        decision: null,        // last triage decision
        lastRule: null,        // last deterministic rule applied (repeat = escalate)
        timeoutRetried: false, // one clean-timeout re-run allowed (external event latency)
        failReason: null       // human-readable hard-fail explanation
    };
    console.log(chalk.blue(`Flow "${ctx.flowName}" | connectors=${connectorLabel} | repo=${connectorsDir}`));
    CURRENT = { api, ctx };

    let state = S.INIT;
    let steps = 0;
    const STEP_BUDGET = 60; // hard stop against any accidental loop

    const go = (next, note = '') => {
        console.log(chalk.cyan(`[FSM] ${state} → ${next}`) + (note ? chalk.gray(`  (${note})`) : ''));
        state = next;
    };

    while (!TERMINAL.has(state)) {
        if (++steps > STEP_BUDGET) { go(S.DONE_FAIL, 'step budget exhausted'); break; }

        switch (state) {

            case S.INIT: {
                await api.auth();

                // createOrUpdate: the local flow.json is the source of truth, so we always push it to the
                // instance before running. Prepare it once (tag + bind stores), then create if no flow with
                // this name exists yet, otherwise PUT it in place. This is the upload step the agent used to
                // punt on ("upload it first") — it now subsumes the upload-e2e-flows skill's flow upload.
                const storeMap = await api.ensureStores();
                const prepared = AppmixerClient.prepareFlowForUpload(flowJson, ctx.connectorLabel, storeMap);

                ctx.flowId = await api.findFlowIdByName(ctx.flowName);
                if (ctx.flowId) {
                    const stage = await api.getStage(ctx.flowId);
                    if (stage === 'running') { await api.stopFlow(ctx.flowId); await api.waitForCompletion(ctx.flowId, 30); }
                    // Preserve any live store bindings the running flow already had over our freshly-ensured IDs.
                    const serverFlow = await api.getFlow(ctx.flowId);
                    const toUpload = preserveStoreIds(prepared, serverFlow);
                    try {
                        await api.uploadFlow(ctx.flowId, toUpload, { forceUpdate: true });
                    } catch (e) {
                        // Older engines reject the errorHandling property on flow save — strip it and
                        // retry once (the run then relies on log heuristics instead of fail-fast stops).
                        if (!/errorHandling/i.test(e.message)) throw e;
                        console.log(chalk.yellow('Instance rejected errorHandling (older engine) — re-uploading without it.'));
                        await api.uploadFlow(ctx.flowId, AppmixerClient.stripErrorHandling(toUpload), { forceUpdate: true });
                    }
                    console.log(chalk.blue(`Updated existing flow "${ctx.flowName}" (${ctx.flowId}) from local JSON.`));
                } else {
                    ctx.flowId = await api.createFlow(prepared);
                    console.log(chalk.green(`Created flow "${ctx.flowName}" → ${ctx.flowId}`));
                }
                // Newly written / re-uploaded connector nodes are unbound — bind an account before running.
                // APPMIXER_SKILL_ACCOUNT_ID pins a specific account when the service has several
                // (e.g. an old one without the required OAuth scopes next to a re-consented one).
                const { accountIds } = await api.reassignAccounts(ctx.flowId, ctx.connectorPrefixes, process.env.APPMIXER_SKILL_ACCOUNT_ID || null);

                // Preflight: validate every bound account server-side (runs the connector's auth
                // validate()) so expired/revoked tokens fail HERE with a clear reason instead of
                // as a mid-run TokenError. Scope coverage cannot be checked upfront (the API does
                // not expose grants) — that is diagnosed from the first run's TokenError instead.
                for (const accountId of accountIds) {
                    const ok = await api.testAccount(accountId).catch(() => false);
                    if (!ok) {
                        ctx.failReason = `account ${accountId} failed its validity test (expired/revoked token?) — re-authenticate it before running E2E flows.`;
                        break;
                    }
                }
                if (ctx.failReason) { go(S.DONE_FAIL, ctx.failReason); break; }

                const flow = await api.getFlow(ctx.flowId);
                ctx.stage = flow.stage;
                console.log(chalk.blue(`Resolved flowId=${ctx.flowId} (stage=${ctx.stage})`));
                go(S.ENSURE_STOPPED);
                break;
            }

            case S.ENSURE_STOPPED: {
                const stage = await api.getStage(ctx.flowId);
                if (stage === 'running') {
                    await api.stopFlow(ctx.flowId);
                    await api.waitForCompletion(ctx.flowId, 30);
                    go(S.START, 'was running, stopped');
                } else {
                    go(S.START, `stage=${stage}`);
                }
                break;
            }

            case S.START: {
                ctx.runStartTs = new Date().toISOString();
                await api.startFlow(ctx.flowId);
                go(S.WAIT, `runStartTs=${ctx.runStartTs}`);
                break;
            }

            case S.WAIT: {
                ctx.result = await api.waitForCompletion(ctx.flowId, timeoutSec, ctx.runStartTs);
                go(S.COLLECT, `result=${ctx.result}`);
                break;
            }

            case S.COLLECT: {
                await new Promise(r => setTimeout(r, 3000)); // let log indexing catch up
                ctx.logs = await api.getLogs(ctx.flowId, 300);
                ctx.errors = enrichErrors(AppmixerClient.analyzeErrors(ctx.logs, ctx.runStartTs), flowJson, connectorsDir);
                console.log(chalk.blue(`Collected ${ctx.errors.length} error(s).`));
                for (const e of ctx.errors.slice(0, 10)) console.log(chalk.red(`  [${e.componentType}] ${e.message}`));
                go(S.TRIAGE);
                break;
            }

            case S.TRIAGE: {
                ctx.decision = triage({ result: ctx.result, errors: ctx.errors });
                if (ctx.decision.action === 'done') { go(S.DONE_OK, ctx.decision.reason); break; }
                if (ctx.attempt >= maxAttempts) { go(S.DONE_FAIL, `max attempts (${maxAttempts}) reached`); break; }
                if (String(ctx.result).startsWith('timeout') && ctx.errors.length === 0) {
                    // A clean timeout means some Assert never fired. On a flow WITHOUT external
                    // triggers (fully OnStart-driven) nothing can "arrive later" — re-running is
                    // pointless; diagnose immediately: which asserts stayed silent points at the
                    // upstream defect (per-record component emitting nothing on an empty result,
                    // or a link/variable on a non-existent outPort).
                    ctx.assertActivity = assertActivity(flowJson, ctx.logs, ctx.runStartTs);
                    if (!hasExternalTrigger(flowJson)) {
                        const silent = ctx.assertActivity.silent;
                        ctx.decision = {
                            action: 'ai-fix',
                            reason: 'clean timeout on an OnStart-only flow (no external triggers) — '
                                + (silent.length
                                    ? `Assert(s) [${silent.join(', ')}] never fired. Inspect the component(s) feeding them: `
                                    + 'typical causes are a per-record outputType emitting NOTHING on an empty result, '
                                    + 'or a link/variable referencing a non-existent outPort (run the outport-exists and '
                                    + 'outputtype-fanout validators).'
                                    : 'every Assert fired but AfterAll/ProcessE2EResults did not complete — check AfterAll wiring and timeout.')
                        };
                        go(S.DONE_NEEDS_FIX, ctx.decision.reason);
                        break;
                    }
                    // External-trigger flow: event latency varies from seconds to many minutes.
                    // Re-run once deterministically before handing it to the agent.
                    if (!ctx.timeoutRetried) {
                        ctx.timeoutRetried = true;
                        ctx.attempt++;
                        go(S.ENSURE_STOPPED, `attempt ${ctx.attempt}/${maxAttempts}, clean timeout — one re-run (external event latency)`);
                        break;
                    }
                }
                if (ctx.decision.action === 'retry') {
                    // Transient infrastructure failure (quota server unreachable, network blip):
                    // a plain re-run, no rebinding. Repeating without effect = real outage.
                    if (ctx.lastRule === ctx.decision.rule) {
                        ctx.failReason = `transient-infra remedy '${ctx.decision.rule}' repeated without effect — the instance has a real outage (${ctx.decision.reason})`;
                        go(S.DONE_FAIL, ctx.failReason);
                        break;
                    }
                    ctx.attempt++;
                    ctx.lastRule = ctx.decision.rule;
                    go(S.ENSURE_STOPPED, `attempt ${ctx.attempt}/${maxAttempts}, ${ctx.decision.reason}`);
                    break;
                }
                if (ctx.decision.action === 'reassign') {
                    // A deterministic remedy that did not clear the error the first time will not
                    // clear it on repeat — escalate instead of burning the attempt budget.
                    if (ctx.lastRule === ctx.decision.rule) {
                        // TokenError persisting AFTER a successful rebind = the bound account's
                        // grant does not satisfy the component's required scopes. That needs a
                        // human OAuth re-consent — no flow-JSON edit can fix it, so hard-fail
                        // with the exact scopes instead of handing it to the agent.
                        const scoped = ctx.errors.find(e => e.requiredScopes);
                        ctx.failReason = scoped
                            ? `account is bound but its token lacks the scopes required by ${scoped.componentType} `
                              + `(requires: ${scoped.requiredScopes.join(', ')}). `
                              + 'Re-authenticate the connector account with these scopes.'
                            : `deterministic remedy '${ctx.decision.rule}' did not resolve the error`;
                        go(S.DONE_FAIL, ctx.failReason);
                        break;
                    }
                    go(S.DET_FIX, ctx.decision.reason);
                    break;
                }
                // No deterministic rule matched — hand the failure to the calling agent.
                go(S.DONE_NEEDS_FIX, ctx.decision.reason);
                break;
            }

            case S.DET_FIX: {
                ctx.attempt++;
                ctx.lastRule = ctx.decision.rule;
                const { assigned } = await api.reassignAccounts(ctx.flowId, ctx.connectorPrefixes, process.env.APPMIXER_SKILL_ACCOUNT_ID || null);
                if (assigned === 0) { go(S.DONE_FAIL, 'no account to assign'); break; }
                go(S.ENSURE_STOPPED, `attempt ${ctx.attempt}/${maxAttempts}, accounts rebound`);
                break;
            }
        }
    }

    // No terminal download-and-overwrite: the local flow.json is the source of truth. Fixes are
    // made to the file on disk (by the calling agent) and INIT uploads FROM it on the next run,
    // so the repo always reflects what runs.
    const success = state === S.DONE_OK;
    const needsFix = state === S.DONE_NEEDS_FIX;
    const flowUrl = designerUrl(api.baseUrl, ctx.flowId);

    // NEVER leave the flow running (DONE_OK paths already stopped it). A leaked running flow
    // keeps its trigger subscriptions alive and interferes with subsequent runs — e.g. a zombie
    // NewEvent flow will fire on (and its cleanup will DELETE) events created by other flows.
    if (ctx.flowId) {
        try {
            const stage = await api.getStage(ctx.flowId);
            if (stage === 'running') {
                await api.stopFlow(ctx.flowId);
                console.log(chalk.blue('Stopped the still-running flow (no leaked trigger subscriptions).'));
            }
        } catch { /* best-effort */ }
    }

    if (success) {
        console.log(chalk.green(`\nSUCCESS: "${ctx.flowName}" passed after ${ctx.attempt} deterministic retry(ies).`));
    } else if (needsFix) {
        // Structured FIX BRIEF for the calling agent. Everything needed to diagnose and fix.
        const recentLogs = (ctx.logs?.hits || []).slice(0, 50).map(h => {
            const src = h._source || h;
            return { ts: src.gridTimestamp, componentId: src.componentId, componentType: src.componentType, level: src.level, message: src.message?.slice(0, 300) };
        });
        console.log(chalk.yellow('\n═══ NEEDS_FIX — fix brief for the calling agent ═══'));
        console.log(JSON.stringify({
            status: 'NEEDS_FIX',
            reason: ctx.decision?.reason,
            flowId: ctx.flowId,
            flowName: ctx.flowName,
            flowUrl,
            flowJsonPath: ctx.flowJsonPath,
            connector: ctx.connectorLabel,
            errors: ctx.errors.slice(0, 20),
            ...(ctx.assertActivity ? { assertsFired: ctx.assertActivity.fired, assertsSilent: ctx.assertActivity.silent } : {}),
            recentLogs
        }, null, 2));
        console.log(chalk.yellow('Edit the flow JSON on disk per the run-e2e-flows skill rules, then re-run this script.'));
    } else {
        console.log(chalk.red(`\nFAILED: "${ctx.flowName}" did not pass (${ctx.attempt} attempt(s), last result=${ctx.result}).`));
        if (ctx.failReason) console.log(chalk.red(`Reason: ${ctx.failReason}`));
    }

    // One machine-parsable summary line per run — callers looping over many flows collect these
    // into the final "flow | status | url" report.
    const status = success ? 'PASSED' : (needsFix ? 'NEEDS_FIX' : 'FAILED');
    console.log(`RESULT | ${status} | ${ctx.flowName} | ${flowUrl || ctx.flowId}`);

    return { success, needsFix, status, flowId: ctx.flowId, flowName: ctx.flowName, flowUrl, attempts: ctx.attempt, errors: ctx.errors, flowPath: ctx.flowPath, failReason: ctx.failReason || null };
}
