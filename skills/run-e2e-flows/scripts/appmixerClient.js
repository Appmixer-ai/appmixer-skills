/* eslint-disable max-len */
//
// Deterministic action layer of the E2E runner.
//
// Every Appmixer interaction the orchestrator can take lives here as an explicit,
// named method. There is NO AI in this file. Generic API primitives (auth, flows,
// accounts, logs, stores) come from the shared client library `_shared/appmixerApi`
// — the single place that talks HTTP. What stays here is the RUNNER'S DOMAIN LOGIC:
// completion detection, error triage parsing, fail-fast flow preparation, and the
// account (re)binding policy.
//
import chalk from 'chalk';
import { createClient } from '../../_shared/appmixerApi/client.js';
import {
    createFlow, upsertFlow, getFlow, listFlows, startFlow, stopFlow, getLogs
} from '../../_shared/appmixerApi/flows.js';
import { listAccounts, testAccount, assignComponentAccount } from '../../_shared/appmixerApi/accounts.js';
import { listStores, createStore } from '../../_shared/appmixerApi/store.js';

const IGNORE_COMPONENTS = new Set([
    'appmixer.utils.controls.OnError',
    'appmixer.utils.controls.StopFlow'
]);

// Safe timestamp → ms (handles ISO strings, numeric strings, numbers).
function tsToMs(ts) {
    if (!ts) return 0;
    const n = Number(ts);
    if (!isNaN(n)) return n;
    const d = new Date(ts);
    return isNaN(d.getTime()) ? 0 : d.getTime();
}

function afterRunStart(ts, runStartTs) {
    if (!runStartTs || !ts) return true;
    return tsToMs(ts) >= tsToMs(runStartTs);
}

// Axios error → readable message including the server-side detail (axios only says
// "Request failed with status code 400"; the reason lives in response.data, and for
// flow-start rejections the specifics live one level deeper in response.data.details).
function describeError(e) {
    const detail = e.response?.data;
    let msg = detail?.message || (typeof detail === 'string' ? detail.slice(0, 300) : '');
    if (detail?.details) {
        try { msg += ` — details: ${JSON.stringify(detail.details).slice(0, 400)}`; } catch { /* ignore */ }
    }
    return msg ? `${e.message}: ${msg}` : e.message;
}

export class AppmixerClient {

    constructor({ baseUrl, username, password } = {}) {
        this.baseUrl = (baseUrl || process.env.APPMIXER_SKILL_API_URL || '').replace(/\/+$/, '');
        this.username = username || process.env.APPMIXER_SKILL_USERNAME;
        this.password = password || process.env.APPMIXER_SKILL_PASSWORD;
        this.client = null;
        if (!this.baseUrl) throw new Error('APPMIXER_SKILL_API_URL is not set');
    }

    async auth() {
        this.client = await createClient({
            baseUrl: this.baseUrl, username: this.username, password: this.password
        });
        return this.client.token;
    }

    async api() {
        if (!this.client) await this.auth();
        return this.client;
    }

    async getFlow(flowId) {
        return getFlow(await this.api(), flowId, 'flowId,name,stage,flow,customFields,description,runtimeErrors');
    }

    // Resolve a server-side flowId from the flow's name. Local flow JSONs intentionally carry no
    // flowId (they're portable across instances), so this is how a flow.json path maps to a live flow.
    // GET /flows defaults to limit 100 — always ask for 500. Returns flowId or null.
    async findFlowIdByName(name) {
        const data = await listFlows(await this.api(), {
            filter: 'customFields.category:E2E_test_flow', limit: 500, projection: 'flowId,name'
        });
        const list = Array.isArray(data) ? data : (data?.flows || data?.hits || []);
        const matches = list
            .map(f => f._source || f)
            .filter(f => f.name === name);
        if (matches.length === 0) return null;
        if (matches.length > 1) console.log(chalk.yellow(`Warning: ${matches.length} flows named "${name}" — using the first.`));
        return matches[0].flowId || matches[0].id;
    }

    // Flow start rejections carry the actual reason in the response body (e.g.
    // "Component transformation validation error" = a source/transform port key does
    // not match the component's inPort name; an inner 401/AxiosError = the engine's
    // start-time call to the service failed, typically a dead/wrong account on a
    // trigger). Surface it — a bare "status code 400" hides the diagnosis.
    async startFlow(flowId) {
        try {
            return await startFlow(await this.api(), flowId);
        } catch (e) {
            throw new Error(`startFlow failed: ${describeError(e)}`);
        }
    }

    async stopFlow(flowId) {
        return stopFlow(await this.api(), flowId);
    }

    async getLogs(flowId, size = 200) {
        return getLogs(await this.api(), { flowId, from: 0, size, sort: 'gridTimestamp:desc' });
    }

    async getStage(flowId) {
        const flow = await getFlow(await this.api(), flowId, 'stage');
        return flow?.stage || 'unknown';
    }

    async assignAccount(componentId, accountId) {
        return assignComponentAccount(await this.api(), componentId, accountId);
    }

    // Validity check of an account: runs the connector's auth validate() server-side.
    // Catches expired/revoked tokens BEFORE a flow run (it does NOT verify OAuth scopes —
    // those are diagnosed from the first run's TokenError). Returns true when ok.
    async testAccount(accountId) {
        const resp = await testAccount(await this.api(), accountId);
        return resp?.ok === true;
    }

    // PUT the updated flow definition in place. We never delete+recreate (would change the flowId
    // and orphan account bindings). `forceUpdate` is required when the flow may still be running
    // (the engine otherwise rejects the PUT). Store-ID injection is handled by prepareFlowForUpload.
    // Throws with the server-side detail so callers can react (e.g. errorHandling schema fallback).
    async uploadFlow(flowId, flowJson, { forceUpdate = false } = {}) {
        try {
            return await upsertFlow(await this.api(), flowId, flowJson, { forceUpdate });
        } catch (e) {
            throw new Error(`uploadFlow failed: ${describeError(e)}`);
        }
    }

    // POST a brand-new flow. Returns the assigned flowId. Used when no flow with this name exists yet
    // (the create half of createOrUpdate — see orchestrator INIT).
    async createFlow(flowJson) {
        const resp = await createFlow(await this.api(), flowJson).catch(e => {
            throw new Error(`createFlow failed: ${describeError(e)}`);
        });
        const id = resp?.flowId || resp?._id || resp?.id;
        if (!id) throw new Error(`createFlow: no flowId in response: ${JSON.stringify(resp).slice(0, 300)}`);
        return id;
    }

    // Ensure the two E2E result stores exist on this instance, creating any that are missing.
    // Returns { 'E2E Failed Tests': storeId, 'E2E Succeeded Tests': storeId }.
    async ensureStores() {
        const list = await listStores(await this.api());
        const map = {};
        for (const s of list) map[s.name] = s.storeId;
        for (const name of ['E2E Failed Tests', 'E2E Succeeded Tests']) {
            if (!map[name]) {
                const resp = await createStore(await this.api(), name);
                map[name] = resp.storeId;
                console.log(chalk.blue(`Created store "${name}" → ${map[name]}`));
            }
        }
        return map;
    }

    // Prepare a local flow JSON for upload: drop server-only fields, tag it as an E2E test flow,
    // bind the ProcessE2EResults stores to this instance, and enforce fail-fast error handling.
    // Returns a fresh object (no mutation).
    static prepareFlowForUpload(flowJson, connectorLabel, storeMap) {
        const SERVER_FIELDS = ['err', 'flowId', 'userId', 'stage', 'createdAt', 'modifiedAt', 'btime', 'mtime', 'runtimeErrors', 'thumbnail'];
        const prepared = JSON.parse(JSON.stringify(flowJson));
        for (const f of SERVER_FIELDS) delete prepared[f];
        prepared.description = prepared.description || `E2E test flow for ${connectorLabel}`;
        prepared.customFields = prepared.customFields || {};
        prepared.customFields.category = 'E2E_test_flow';
        const pinnedAccount = process.env.APPMIXER_SKILL_ACCOUNT_ID;
        for (const comp of Object.values(prepared.flow || {})) {
            if (comp.type?.includes('ProcessE2EResults')) {
                comp.config = comp.config || {};
                comp.config.properties = comp.config.properties || {};
                comp.config.properties.failedStoreId = storeMap['E2E Failed Tests'];
                comp.config.properties.successStoreId = storeMap['E2E Succeeded Tests'];
            }
            // An explicitly pinned account must also win at RUNTIME: the engine reads
            // config.properties.account from the flow definition, so a stale flow-authored
            // account would shadow the pin even after the auth grant is rebound.
            if (pinnedAccount && comp.config?.properties?.account) {
                comp.config.properties.account = pinnedAccount;
            }
            // Fail-fast E2E semantics (Configurable Error Handling): no auto-retries, any component
            // error stops the flow — the run gets a clear terminal state instead of retry noise.
            // Flow-authored settings win; this only fills the gap for flows generated before the rule.
            if (!comp.errorHandling) {
                comp.errorHandling = { autoRetry: false, onError: 'stopFlow' };
            }
        }
        return prepared;
    }

    // Strip errorHandling from every component — fallback for older engines whose flow
    // schema rejects the property on save.
    static stripErrorHandling(flowJson) {
        const stripped = JSON.parse(JSON.stringify(flowJson));
        for (const comp of Object.values(stripped.flow || {})) delete comp.errorHandling;
        return stripped;
    }

    // Best-effort: first existing account for any of the connector prefixes. Tries the dotted service
    // (appmixer:microsoft.dynamics) and the top-level service (appmixer:microsoft) since nested
    // connectors often authenticate at the top level. Lists GET /accounts (the reliable listing
    // endpoint) and filters here.
    async getFirstAccount(connectorPrefixes) {
        const services = new Set();
        for (const p of connectorPrefixes) {
            services.add(`appmixer:${p}`);
            services.add(`appmixer:${p.split('.')[0]}`);
        }
        const data = await listAccounts(await this.api());
        const accounts = Array.isArray(data) ? data : (data?.accounts || []);
        for (const service of services) {
            const match = accounts.find(a => a.service === service);
            if (match) return match.accountId || match.id;
        }
        return null;
    }

    // All account IDs that exist on this instance (any service) — used to tell
    // flow-authored account IDs from stale/foreign ones.
    async listAccountIds() {
        const data = await listAccounts(await this.api());
        const accounts = Array.isArray(data) ? data : (data?.accounts || []);
        return new Set(accounts.map(a => a.accountId || a.id).filter(Boolean));
    }

    // Bind an account to every connector component in the flow. Required after any PUT update
    // (newly written nodes are unbound) and the deterministic remedy for TokenError.
    // `connectorPrefixes` is the set of dotted prefixes derived from the flow (e.g. ['microsoft.dynamics']),
    // so this works for nested and multi-connector flows alike.
    // Precedence per component: explicit override (APPMIXER_SKILL_ACCOUNT_ID — operator intent,
    // beats everything, incl. flow-authored accounts, which may be stale/dead) >
    // the component's OWN `config.properties.account` (how multi-account flows work,
    // e.g. organizer creates an event, attendee accepts it) > first flow-authored
    // account > first existing account of the service.
    // Flow-authored accounts only count if they exist on THIS instance: flows
    // downloaded from a server (download-E2E-flows.js) carry that instance's
    // account IDs, which are meaningless on any other tenant — a foreign/deleted
    // ID must fall through to a live account, not be re-bound and fail preflight.
    async reassignAccounts(flowId, connectorPrefixes, overrideAccountId = null) {
        const flow = await this.getFlow(flowId);
        const components = flow.flow || {};
        const isConnectorComp = type => connectorPrefixes.some(p => type?.startsWith(`appmixer.${p}.`));

        const liveIds = await this.listAccountIds();
        const flowAccount = (comp) => {
            const id = comp.config?.properties?.account;
            if (!id) return null;
            if (liveIds.has(id)) return id;
            console.log(chalk.yellow(`Flow-authored account ${id} does not exist on this instance — ignoring it.`));
            return null;
        };

        let sharedAccountId = overrideAccountId;
        if (!sharedAccountId) {
            for (const comp of Object.values(components)) {
                if (isConnectorComp(comp.type)) {
                    sharedAccountId = flowAccount(comp);
                    if (sharedAccountId) break;
                }
            }
        }
        if (!sharedAccountId) sharedAccountId = await this.getFirstAccount(connectorPrefixes);
        if (!sharedAccountId) {
            console.log(chalk.yellow('No account ID found — skipping account assignment.'));
            return { assigned: 0, accountIds: [] };
        }

        // Resolve the account per component and fix the flow DEFINITION where it
        // differs: the engine reads config.properties.account from the definition
        // at runtime, so a foreign/stale ID left there would shadow the rebound
        // auth grant (same reason patch-accounts rewrites the definition).
        const resolved = {};
        let definitionChanged = false;
        for (const [compId, comp] of Object.entries(components)) {
            if (!isConnectorComp(comp.type)) continue;
            const accountId = overrideAccountId || flowAccount(comp) || sharedAccountId;
            resolved[compId] = accountId;
            if (comp.config?.properties?.account !== accountId) {
                comp.config = comp.config || {};
                comp.config.properties = comp.config.properties || {};
                comp.config.properties.account = accountId;
                definitionChanged = true;
            }
        }
        if (definitionChanged) {
            try {
                await this.uploadFlow(flowId, { flow: components }, { forceUpdate: true });
                console.log(chalk.blue('Rewrote flow definition with resolved account IDs.'));
            } catch (e) {
                console.log(chalk.yellow(`Warning: failed to rewrite accounts in flow definition: ${describeError(e)}`));
            }
        }

        let assigned = 0;
        const used = new Set();
        for (const [compId, accountId] of Object.entries(resolved)) {
            try {
                await this.assignAccount(compId, accountId);
                assigned++;
                used.add(accountId);
            } catch (e) {
                console.log(chalk.yellow(`Warning: failed to assign account to ${compId}: ${describeError(e)}`));
            }
        }
        console.log(chalk.blue(`Assigned account(s) ${[...used].join(', ')} to ${assigned} component(s).`));
        return { assigned, accountIds: [...used] };
    }

    // Poll logs until the flow completes. Completion = ProcessE2EResults in current-run logs (success),
    // or errors that stop growing for two polls (stuck/failed), or stage stopped/error, or timeout.
    // Returns one of: 'done' | 'error' | 'stopped' | 'timeout (...)'.
    async waitForCompletion(flowId, timeoutSec = 120, runStartTs) {
        const start = Date.now();
        let lastErrorCount = 0;
        let stableErrorTicks = 0;

        while (true) {
            const elapsed = (Date.now() - start) / 1000;
            const hits = (await this.getLogs(flowId, 50))?.hits || [];

            const done = hits.some(h => {
                const src = h._source || h;
                if (!afterRunStart(src.gridTimestamp || src.timestamp, runStartTs)) return false;
                return src.componentType?.includes('ProcessE2EResults') && !src.err;
            });
            if (done) { await this.stopFlow(flowId); return 'done'; }

            const errorCount = hits.filter(h => {
                const src = h._source || h;
                if (!afterRunStart(src.gridTimestamp || src.timestamp, runStartTs)) return false;
                if (IGNORE_COMPONENTS.has(src.componentType || '')) return false;
                return !!src.err;
            }).length;

            if (errorCount > 0 && errorCount === lastErrorCount) {
                if (++stableErrorTicks >= 2) { await this.stopFlow(flowId); return 'error'; }
            } else {
                stableErrorTicks = 0;
            }
            lastErrorCount = errorCount;

            const stage = await this.getStage(flowId);
            if (stage === 'stopped' || stage === 'error') {
                if (elapsed < 4) { await new Promise(r => setTimeout(r, 5000)); continue; }
                return stage;
            }

            if (elapsed >= timeoutSec) return `timeout (stage=${stage} after ${Math.round(elapsed)}s)`;
            await new Promise(r => setTimeout(r, 5000));
        }
    }

    // Parse /logs hits into structured errors that occurred after the run started.
    // Flow-level entries (e.g. start-time TokenErrors) carry the component only inside the
    // serialized err.data, not at the top level — extract from both places.
    static analyzeErrors(logs, runStartTs) {
        const errors = [];
        for (const hit of logs?.hits || []) {
            const src = hit._source || hit;
            if (!afterRunStart(src.gridTimestamp || src.timestamp, runStartTs)) continue;
            if (!src.err) continue;
            let message = '';
            let errData = null;
            try {
                const err = typeof src.err === 'string' ? JSON.parse(src.err) : src.err;
                message = err.message || JSON.stringify(err).slice(0, 200);
                errData = err.data || null;
            } catch {
                message = String(src.err).slice(0, 200);
            }
            const componentId = src.componentId || errData?.componentId;
            const componentType = src.componentType || errData?.componentType || componentId || '?';
            if (IGNORE_COMPONENTS.has(componentType)) continue;
            errors.push({ componentId, componentType, message, timestamp: src.gridTimestamp || src.timestamp });
        }
        return errors;
    }
}
