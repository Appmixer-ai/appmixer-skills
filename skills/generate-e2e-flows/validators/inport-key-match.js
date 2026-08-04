/**
 * Every port key under a component's `source` and `config.transform` must be one
 * of that component's actual inPort names from component.json.
 *
 * Most components name their single inPort "in", but NOT all — e.g. salesforce
 * CreateLead/UpdateLead use "lead", CreateContact/UpdateContact use "contact".
 * A flow keyed on the wrong port name uploads fine and passes the variables
 * check, but the engine rejects flow START with an opaque
 * 400 "Component transformation validation error" / "Malformed transformation"
 * (no componentId in the response) — this rule pinpoints the culprit statically.
 *
 * Components without a resolvable component.json (utils on some setups) or with
 * no inPorts (pure triggers) are skipped.
 */
import { components } from './lib/flowutil.js';
import { loadComponentSchema } from './lib/coverage.js';

export const name = 'inport-key-match';
export const description = 'source/transform port keys must match the component\'s inPort names (component.json)';

export const run = (ctx) => {
    if (!ctx.connectorsDir) {
        for (const { file } of ctx.flows) {
            ctx.addWarning(file, '[inport-key-match] connectorsDir not resolved — skipping');
            break;
        }
        return;
    }

    const cache = new Map();
    const inPortsOf = (type) => {
        if (!cache.has(type)) {
            const def = loadComponentSchema(type, ctx.connectorsDir);
            cache.set(type, def
                ? (def.inPorts || []).map((p) => (typeof p === 'string' ? p : p.name))
                : null);
        }
        return cache.get(type);
    };

    for (const { file, json } of ctx.flows) {
        for (const [id, comp] of components(json)) {
            const inPorts = inPortsOf(comp.type);
            if (!inPorts || inPorts.length === 0) continue; // unknown component or trigger without inPorts

            const check = (keys, where) => {
                for (const key of keys) {
                    if (!inPorts.includes(key)) {
                        ctx.addFailure(file,
                            `[inport-key-match] component "${id}" (${comp.type}) keys its ${where} on port ` +
                            `"${key}", but the component's inPorts are [${inPorts.join(', ')}]. The engine ` +
                            'rejects flow start with 400 "Malformed transformation" on such flows — ' +
                            'rename the key to the real inPort name.');
                    }
                }
            };
            check(Object.keys(comp.source || {}), 'link (source)');
            check(Object.keys(comp.config?.transform || {}), 'transform');
        }
    }
};
