#!/usr/bin/env node
/**
 * appmixer-flow.mjs — Appmixer Flow API CLI (built on _shared/appmixerApi).
 *
 * Uses the shared JS API client (_shared/appmixerApi) instead of bash + curl +
 * python, so there is no .env parsing / token-cache / shell-quoting fragility.
 *
 * Usage: node appmixer-flow.mjs <command> [args...]
 *
 * Commands:
 *   auth
 *   get <flowId> [projection]
 *   start <flowId> | stop <flowId> | delete <flowId>
 *   patch-accounts <flowId> <accountId> <service-prefix>
 *   logs <flowId> [size]
 *   wait-done <flowId> [timeoutSeconds]
 *   create-account <connector> <auth-json>
 *   list-accounts [service]
 *   list-e2e-flows [filter]
 *   list-local-e2e-flows <connector>
 *   logs-summary <flowId> [size] [sinceTimestamp]
 *   ensure-stores
 *   validate-variables <flowId>
 *   upload-flow <flow.json> <connector>
 *   upload-all <connector>
 *
 * Config comes from process.env (APPMIXER_SKILL_BASE_URL / USERNAME / PASSWORD,
 * APPMIXER_SKILL_CONNECTORS_DIR). If APPMIXER_ENV points at a .env file it is loaded first
 * (dotenv never overrides values already in process.env).
 */

import { dirname, resolve, join, basename } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync, readdirSync } from 'fs';
import dotenv from 'dotenv';
import { createClient } from '../../_shared/appmixerApi/index.js';
import {
    createFlow, upsertFlow, getFlow, listFlows, deleteFlow, startFlow, stopFlow
} from '../../_shared/appmixerApi/flows.js';
import { listAccounts, createAccount, assignComponentAccount } from '../../_shared/appmixerApi/accounts.js';
import { resolveConnectorsDir } from '../../_shared/resolveConnectorsDir.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// The env file decides WHICH INSTANCE every command talks to. Node resolves this
// script through symlinks (e.g. a connectors-repo .claude/skills symlink into the
// openclaw workspace), so the fallback .env may belong to a DIFFERENT checkout and
// silently point at another instance — fresh tokens then fail with 401 "Invalid JWT"
// on the instance you thought you were using, and ensure-stores/list-e2e-flows
// return data from the wrong one. Always announce the effective target on stderr.
const envPath = process.env.APPMIXER_ENV || resolve(__dirname, '..', '..', '..', '..', '.env');
dotenv.config({ path: envPath });
process.stderr.write(`[appmixer-flow] env=${envPath}${process.env.APPMIXER_ENV ? '' : ' (fallback — set APPMIXER_ENV explicitly)'} instance=${process.env.APPMIXER_SKILL_BASE_URL || 'MISSING'}\n`);

const E2E_STORES = ['E2E Failed Tests', 'E2E Succeeded Tests'];
const E2E_FILTER = { filter: 'customFields.category:E2E_test_flow', limit: 500, projection: 'flowId,name,stage' };
const SERVER_FIELDS = ['err', 'flowId', 'userId', 'stage', 'createdAt', 'modifiedAt', 'btime', 'mtime', 'runtimeErrors', 'thumbnail'];

const out = (s) => process.stdout.write(s + '\n');
const err = (s) => process.stderr.write(s + '\n');

// Surface axios HTTP errors with the response body (like the bash api_call helper).
const httpErr = (e, label) => {
    if (e.response) {
        const body = JSON.stringify(e.response.data).slice(0, 500);
        err(`ERROR ${label}: HTTP ${e.response.status} — ${body}`);
    } else {
        err(`ERROR ${label}: ${e.message}`);
    }
    return e;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getStores(client) {
    const { data } = await client.get('/stores');
    return data;
}

async function ensureStores(client) {
    const stores = await getStores(client);
    const map = Object.fromEntries(stores.map((s) => [s.name, s.storeId]));
    const result = {};
    for (const name of E2E_STORES) {
        if (map[name]) {
            result[name] = map[name];
            out(`${name}: ${map[name]} (exists)`);
        } else {
            const { data } = await client.post('/stores', { name });
            result[name] = data.storeId;
            out(`${name}: ${data.storeId} (created)`);
        }
    }
    return result;
}

// Prepare a flow object for upload: strip server fields, set description/category,
// wire E2E store IDs onto ProcessE2EResults. Returns the flow name.
function prepFlow(flowData, connector, stores) {
    for (const f of SERVER_FIELDS) delete flowData[f];
    flowData.description = 'E2E test flow for ' + connector;
    flowData.customFields = flowData.customFields || {};
    flowData.customFields.category = 'E2E_test_flow';
    const flow = flowData.flow || {};
    for (const comp of Object.values(flow)) {
        if ((comp.type || '').includes('ProcessE2EResults')) {
            comp.config = comp.config || {};
            comp.config.properties = comp.config.properties || {};
            comp.config.properties.failedStoreId = stores['E2E Failed Tests'];
            comp.config.properties.successStoreId = stores['E2E Succeeded Tests'];
        }
    }
}

async function listE2EFlows(client) {
    return await listFlows(client, E2E_FILTER);
}

// Create or update an E2E flow, matched by name. Returns flowId.
async function upsertByName(client, flowData, existingByName) {
    const name = flowData.name;
    const existing = existingByName[name];
    if (existing) {
        if (existing.stage === 'running') {
            try {
                await client.post(`/flows/${existing.flowId}/coordinator`, { command: 'stop' });
                await sleep(2000);
            } catch (e) { err(`Warning: failed to stop flow: ${e.message}`); }
        }
        const payload = { ...flowData };
        delete payload.flowId;
        // Carry the server-resolved per-component `version` onto matching
        // components before re-uploading. Without it the backend re-resolves a
        // dynamic component's inPort schema against a default version and strips
        // transform/lambda keys that are not in the static schema (e.g. fields
        // built from a metadata-driven inspector like jira CreateIssue/UpdateIssue).
        // Local flow files do not carry `version`, so copy it from the live flow.
        await carryComponentVersions(client, existing.flowId, payload);
        await upsertFlow(client, existing.flowId, payload, { forceUpdate: true })
            .catch((e) => { throw httpErr(e, `update ${existing.flowId}`); });
        err(`Updated existing flow: ${name}`);
        return existing.flowId;
    }
    const resp = await createFlow(client, flowData)
        .catch((e) => { throw httpErr(e, `create ${name}`); });
    const flowId = resp.flowId || resp._id;
    err(`Created new flow: ${name}`);
    return flowId;
}

// Stamp each uploaded component with the `version` the backend already holds
// for it (matched by component id), so the server keeps dynamic-inspector
// transforms instead of stripping them on update. Best-effort: a failure here
// must not block the upload.
async function carryComponentVersions(client, flowId, payload) {
    if (!payload || !payload.flow) return;
    try {
        const live = await getFlow(client, flowId, 'flow');
        const liveFlow = (live && live.flow) || {};
        for (const [id, comp] of Object.entries(payload.flow)) {
            if (comp && comp.version == null && liveFlow[id] && liveFlow[id].version != null) {
                comp.version = liveFlow[id].version;
            }
        }
    } catch (e) {
        err(`Warning: could not carry component versions for ${flowId}: ${e.message}`);
    }
}

function flowsDirFor(connector) {
    const root = resolveConnectorsDir();
    const dir = join(root, 'src', 'appmixer', connector, 'artifacts', 'test-flows');
    if (!existsSync(dir)) throw new Error(`Directory not found: ${dir}`);
    return dir;
}

function localFlowFiles(dir) {
    return readdirSync(dir)
        .filter((f) => f.startsWith('test-flow-') && f.endsWith('.json'))
        .sort()
        .map((f) => join(dir, f));
}

async function main() {
    const [cmd, ...args] = process.argv.slice(2);
    if (!cmd) { err('Usage: node appmixer-flow.mjs <command> [args...]'); process.exit(1); }

    const client = await createClient();

    switch (cmd) {
        case 'auth':
            out(client.token);
            break;

        case 'get': {
            const [flowId, projection] = args;
            if (!flowId) throw new Error('Usage: get <flowId> [projection]');
            const data = await getFlow(client, flowId, projection || 'flowId,name,stage,flow,customFields,description');
            out(JSON.stringify(data));
            break;
        }

        case 'start': out(JSON.stringify(await startFlow(client, req(args[0], 'start <flowId>')))); break;
        case 'stop': out(JSON.stringify(await stopFlow(client, req(args[0], 'stop <flowId>')))); break;
        case 'delete': out(JSON.stringify(await deleteFlow(client, req(args[0], 'delete <flowId>')))); break;

        case 'patch-accounts': {
            const [flowId, accountId, prefix] = args;
            if (!flowId || !accountId || !prefix) throw new Error('Usage: patch-accounts <flowId> <accountId> <service-prefix>');
            const flowData = await getFlow(client, flowId, 'flow');
            const flow = flowData.flow || {};
            const compIds = [];
            for (const [id, comp] of Object.entries(flow)) {
                const t = comp.type || '';
                if (t.startsWith(prefix) && !t.startsWith('appmixer.utils.')) {
                    comp.config = comp.config || {};
                    comp.config.properties = comp.config.properties || {};
                    comp.config.properties.account = accountId;
                    compIds.push(id);
                }
            }
            await upsertFlow(client, flowId, { flow }, { forceUpdate: true });
            let assigned = 0;
            for (const id of compIds) {
                try { await assignComponentAccount(client, id, accountId); assigned++; }
                catch (e) { err(`Warning: failed to assign account to ${id}: ${e.message}`); }
            }
            out(`Patched ${compIds.length} components, assigned account to ${assigned} via auth API`);
            break;
        }

        case 'logs': {
            const flowId = req(args[0], 'logs <flowId> [size]');
            const size = args[1] || 100;
            const { data } = await client.get('/logs', { params: { flowId, from: 0, size, sort: 'gridTimestamp:desc' } });
            out(JSON.stringify(data));
            break;
        }

        case 'wait-done': {
            const flowId = req(args[0], 'wait-done <flowId> [timeoutSeconds]');
            const timeout = parseInt(args[1] || '120', 10) * 1000;
            const start = Date.now();
            for (;;) {
                const { data } = await client.get('/logs', { params: { flowId, from: 0, size: 50, sort: 'gridTimestamp:desc' } });
                const hits = data.hits || [];
                const done = hits.some((h) => {
                    const s = h._source || h;
                    return (s.componentType || '').includes('ProcessE2EResults') && !s.err;
                });
                if (done) {
                    await client.post(`/flows/${flowId}/coordinator`, { command: 'stop' }).catch(() => {});
                    out('stopped');
                    return;
                }
                const f = await getFlow(client, flowId, 'stage');
                const stage = f.stage || 'unknown';
                if (stage === 'stopped' || stage === 'error') { out(stage); return; }
                if (Date.now() - start >= timeout) { out(`timeout (stage=${stage})`); process.exit(1); }
                await sleep(5000);
            }
        }

        case 'create-account': {
            const [connector, authJson] = args;
            if (!connector || !authJson) throw new Error('Usage: create-account <connector> <auth-json>');
            const service = `appmixer:${connector}`;
            const token = JSON.parse(authJson);

            // The engine validates OAuth2 scopes on POST /accounts and reads them
            // from token.scope (singular, array). The CLI login does not store the
            // granted scopes anywhere, so resolve the requested scopes from the
            // connector's auth.js — the same source the CLI used for the consent.
            if (!token.scope) {
                try {
                    const connectorsDir = resolveConnectorsDir();
                    const authModule = (await import(
                        join(connectorsDir, 'src', 'appmixer', connector, 'auth.js'))).default;
                    const definition = typeof authModule.definition === 'function'
                        ? authModule.definition() : authModule.definition;
                    if (Array.isArray(definition?.scope)) {
                        token.scope = definition.scope;
                        process.stderr.write(`[create-account] token.scope filled from auth.js (${token.scope.length} scopes)\n`);
                    }
                } catch (e) {
                    process.stderr.write(`[create-account] could not resolve scopes from auth.js: ${e.message}\n`);
                }
            }

            // OAuth2 account creation instantiates the connector's auth module on the
            // engine, which needs the service config (clientId/clientSecret). Check it
            // exists first — without it the API fails with an opaque 500.
            try {
                const { data: cfg } = await client.get(`/service-config/${service}`);
                if (!cfg || (!cfg.clientId && !cfg.clientID)) {
                    throw new Error(`Service config for ${service} has no clientId. ` +
                        `Set it first: PUT /service-config/${service} {"clientId": "...", "clientSecret": "..."} ` +
                        '(or via Backoffice > Services).');
                }
            } catch (e) {
                if (e.response?.status === 404 || !e.response) throw e;
                throw new Error(`Service config check failed for ${service}: ${e.message}`);
            }

            const resp = await createAccount(client, {
                name: `${connector} e2e test`,
                service,
                token,
                profileInfo: {}
            });
            out(resp.accountId || resp._id || JSON.stringify(resp));
            break;
        }

        case 'list-accounts': {
            const service = args[0];
            const accounts = await listAccounts(client);
            for (const a of accounts) {
                if (service && !(a.service || '').includes(service)) continue;
                out(JSON.stringify({ accountId: a.accountId, name: a.name || '', service: a.service || '' }));
            }
            break;
        }

        case 'list-e2e-flows': {
            const filter = (args[0] || '').toLowerCase();
            const flows = await listE2EFlows(client);
            if (!flows.length) { out('No E2E flows found'); break; }
            for (const f of flows) {
                const name = f.name || '';
                if (filter && !name.toLowerCase().includes(filter)) continue;
                out(`${f.flowId}  ${(f.stage || '?').padEnd(10)}  ${name}`);
            }
            break;
        }

        case 'list-local-e2e-flows': {
            const connector = req(args[0], 'list-local-e2e-flows <connector>');
            const files = localFlowFiles(flowsDirFor(connector));
            if (!files.length) { out('No test-flow-*.json files found'); break; }
            for (const file of files) {
                const name = JSON.parse(readFileSync(file, 'utf8')).name || 'unknown';
                out(`${file}  ${name}`);
            }
            break;
        }

        case 'ensure-stores':
            await ensureStores(client);
            break;

        case 'validate-variables': {
            // REAL validation: ask the engine which variables the designer would
            // offer (POST /variables/:flowId/fetch — the same endpoint the designer
            // uses to render chips) and check every transform variable against it.
            // A variable that is not offered renders as an invalid (red) chip in the
            // designer and typically never resolves at runtime.
            const flowId = req(args[0], 'validate-variables <flowId>');
            const flowDoc = await getFlow(client, flowId);
            const flow = flowDoc.flow || {};
            if (!Object.keys(flow).length) { out('No components found in flow'); break; }

            // Collect all transform variable mappings per component.
            const mappingsById = {};
            for (const [id, comp] of Object.entries(flow)) {
                const mappings = [];
                for (const senders of Object.values(comp.config?.transform || {})) {
                    for (const ports of Object.values(senders || {})) {
                        for (const tdata of Object.values(ports || {})) {
                            for (const [field, varsMap] of Object.entries(tdata?.modifiers || {})) {
                                for (const varDef of Object.values(varsMap || {})) {
                                    if (varDef && varDef.variable) mappings.push([field, varDef.variable]);
                                }
                            }
                        }
                    }
                }
                if (mappings.length) mappingsById[id] = mappings;
            }

            let fetched = null;
            try {
                const { data } = await client.post(`/variables/${flowId}/fetch?compress=true`, {
                    useCache: false,
                    flow: false,
                    components: { IDs: Object.keys(mappingsById), properties: true, links: true }
                });
                fetched = data;
            } catch (e) {
                err(`Warning: /variables/${flowId}/fetch failed (${e.message}) — falling back to a static listing (NO validation).`);
            }

            // Offered variable paths per component: union of every link's variables.
            // compress=true dedups entries into dynamicComponentVariables[] and links
            // carry `refs` (indices); uncompressed responses inline the entries.
            // Entry values look like "{{{$.<id>.<port>.<field>}}}".
            const stripBraces = (v) => String(v || '').replace(/^\{\{\{|\}\}\}$/g, '');
            const collectValues = (node, acc) => {
                if (!node || typeof node !== 'object') return acc;
                if (typeof node.value === 'string' && node.value.includes('$.')) acc.push(stripBraces(node.value));
                for (const v of Object.values(node)) collectValues(v, acc);
                return acc;
            };
            const offeredById = {};
            const fetchErrors = [];
            if (fetched) {
                const dcv = fetched.dynamicComponentVariables || [];
                for (const [id, compData] of Object.entries(fetched.components || {})) {
                    const offered = new Set();
                    for (const [senderId, ports] of Object.entries(compData.links?.in || {})) {
                        for (const [port, pdata] of Object.entries(ports || {})) {
                            const vars = pdata?.variables || {};
                            for (const i of vars.refs || []) {
                                if (dcv[i]) offered.add(stripBraces(dcv[i].value));
                            }
                            for (const v of collectValues({ s: vars.static, d: vars.dynamic }, [])) offered.add(v);
                            if (vars.errors && (!Array.isArray(vars.errors) || vars.errors.length)) {
                                fetchErrors.push(`${id} <- ${senderId}.${port}: ${JSON.stringify(vars.errors)}`);
                            }
                        }
                    }
                    offeredById[id] = offered;
                }
            }

            let invalid = 0;
            for (const [id, mappings] of Object.entries(mappingsById).sort()) {
                out(`${id} (${(flow[id].type || '?').split('.').pop()}):`);
                const offered = offeredById[id];
                for (const [field, path] of mappings) {
                    if (!fetched || !offered) { out(`  ${field} <- ${path}`); continue; }
                    if (offered.has(path)) {
                        out(`  OK       ${field} <- ${path}`);
                    } else {
                        invalid++;
                        const sender = (path.match(/^\$\.([^.]+)\./) || [])[1];
                        const hints = [...offered].filter((o) => sender && o.startsWith(`$.${sender}.`)).slice(0, 4);
                        out(`  INVALID  ${field} <- ${path}${hints.length ? `  (offered from that component: ${hints.join(', ')})` : '  (nothing offered from that component)'}`);
                    }
                }
            }
            for (const fe of fetchErrors) out(`FETCH ERROR: ${fe}`);
            if (fetched) {
                out(invalid || fetchErrors.length
                    ? `validate-variables: ${invalid} INVALID variable(s), ${fetchErrors.length} fetch error(s)`
                    : 'validate-variables: all variables offered by the designer — OK');
                if (invalid || fetchErrors.length) process.exit(1);
            }
            break;
        }

        case 'upload-flow': {
            const [file, connector] = args;
            if (!file || !connector) throw new Error('Usage: upload-flow <flow.json> <connector>');
            const stores = await ensureStoresQuiet(client);
            const existingByName = byName(await listE2EFlows(client));
            const flowData = JSON.parse(readFileSync(file, 'utf8'));
            prepFlow(flowData, connector, stores);
            out(await upsertByName(client, flowData, existingByName));
            break;
        }

        case 'upload-all': {
            const connector = req(args[0], 'upload-all <connector>');
            const files = localFlowFiles(flowsDirFor(connector));
            if (!files.length) { err(`No test-flow-*.json files for ${connector}`); process.exit(1); }
            err(`Found ${files.length} flow file(s)`);
            const stores = await ensureStoresQuiet(client);
            const existingByName = byName(await listE2EFlows(client));
            for (const file of files) {
                err(`\n--- Processing ${basename(file)} ---`);
                const flowData = JSON.parse(readFileSync(file, 'utf8'));
                prepFlow(flowData, connector, stores);
                out(await upsertByName(client, flowData, existingByName));
            }
            err(`\nAll ${files.length} flows processed.`);
            break;
        }

        default:
            err(`Unknown command: ${cmd}`);
            process.exit(1);
    }
}

function req(v, usage) { if (!v) throw new Error('Usage: ' + usage); return v; }
function byName(flows) { return Object.fromEntries(flows.map((f) => [f.name || '', f])); }
async function ensureStoresQuiet(client) {
    const stores = await getStores(client);
    const map = Object.fromEntries(stores.map((s) => [s.name, s.storeId]));
    for (const name of E2E_STORES) {
        if (!map[name]) { const { data } = await client.post('/stores', { name }); map[name] = data.storeId; }
    }
    return map;
}

main().catch((e) => { err(e.stack || e.message); process.exit(1); });
