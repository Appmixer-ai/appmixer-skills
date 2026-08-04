/**
 * Per-record output modes must not feed the middle of a chain, and asserting on
 * them directly is fragile.
 *
 * Some connectors' List/Find components emit ONE MESSAGE PER RECORD for certain
 * outputType values ("item" in xero-style connectors, "object" in
 * microsoft-commons-style ones). Two failure classes follow:
 *
 * 1. FAN-OUT (failure): a per-record component wired into a non-test component
 *    re-executes the entire downstream chain once per record. Real case: xero
 *    ListTenants (outputType=item) on an account with two organisations ran the
 *    whole pipeline twice, creating test data in BOTH orgs. Use a
 *    single-message mode ("items"/"array") and extract the first record on the
 *    consumer with a g_jsonPath "$[0].<field>" modifier — or "first" /
 *    maxRecords: 1 where the connector offers it.
 *
 * 2. SILENT STALL (warning): a per-record component with an EMPTY result emits
 *    nothing at all — a directly-wired Assert never fires and AfterAll times
 *    out with zero errors. Prefer "items"/"array" (always emits, even empty)
 *    with an assert on <port>.items notEmpty, or "first" (throws on empty).
 *    With maxRecords: 1 the flow must guarantee the result is non-empty
 *    (filter for data created in the same flow).
 */
import { components, sourceIn, transformIn } from './lib/flowutil.js';

export const name = 'outputtype-fanout';
export const description = 'per-record outputType (item/object) must not fan out mid-chain; asserts on it risk silent stalls';

const PER_RECORD = new Set(['item', 'object']);

const lambdaOf = (comp) => {
    for (const ports of Object.values(transformIn(comp))) {
        for (const data of Object.values(ports || {})) {
            if (data?.lambda && typeof data.lambda.outputType === 'string') return data.lambda;
        }
    }
    return null;
};

export const run = (ctx) => {
    for (const { file, json } of ctx.flows) {
        const flow = json.flow || {};
        for (const [id, comp] of components(json)) {
            const lambda = lambdaOf(comp);
            if (!lambda || !PER_RECORD.has(lambda.outputType)) continue;
            const capped = String(lambda.maxRecords ?? '') === '1';

            const consumers = Object.entries(flow)
                .filter(([, c]) => id in sourceIn(c));
            const chainConsumers = consumers
                .filter(([, c]) => !(c.type || '').startsWith('appmixer.utils.test.'));

            if (chainConsumers.length > 0 && !capped) {
                const names = chainConsumers.map(([cid, c]) => `"${cid}" (${c.type})`).join(', ');
                ctx.addFailure(file,
                    `[outputtype-fanout] component "${id}" (${comp.type}) uses outputType ` +
                    `"${lambda.outputType}" (one message PER RECORD) and feeds ${names} — the whole ` +
                    'downstream chain re-executes once per record (N records = N runs, e.g. one per ' +
                    'Xero organisation). Switch to a single-message outputType ("items"/"array") and ' +
                    'extract the first record on the consumer with a g_jsonPath "$[0].<field>" ' +
                    'modifier, or use "first"/maxRecords: 1 where the connector declares it.');
            }

            const assertConsumers = consumers
                .filter(([, c]) => (c.type || '') === 'appmixer.utils.test.Assert');
            if (assertConsumers.length > 0 && !capped) {
                ctx.addWarning(file,
                    `[outputtype-fanout] component "${id}" (${comp.type}) uses outputType ` +
                    `"${lambda.outputType}" and is asserted directly — an EMPTY result emits no message, ` +
                    'the Assert never fires and AfterAll times out with zero errors. Prefer ' +
                    '"items"/"array" + assert <port>.items notEmpty (loud failure on empty), or "first" ' +
                    '(throws on empty), unless the flow guarantees a non-empty result.');
            }
        }
    }
};
