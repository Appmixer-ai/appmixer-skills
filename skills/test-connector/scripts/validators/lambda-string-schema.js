/**
 * A lambda value must be a STRING when the receiver's inPort schema declares the
 * property as `"type": "string"`. Key-value inspector inputs (MakeApiCall
 * `headers` / `parameters`) are the classic trap: their schema says string, the
 * designer's key-value editor stores a JSON-serialized string, and the runtime
 * parses either — so a raw array
 *   "headers": [{ "key": "Prefer", "value": "return=representation" }]
 * WORKS at runtime but fails the designer's schema validation with a red
 * "must be string" chip. Serialize it instead:
 *   "headers": "[{\"key\": \"Prefer\", \"value\": \"return=representation\"}]"
 *
 * Only object/array values are flagged (numbers/booleans are coerced fine).
 */
import { components, transformIn } from './lib/flowutil.js';
import { loadComponentSchema } from './lib/coverage.js';

export const name = 'lambda-string-schema';
export const description = 'Lambda values for string-typed inPort properties must be strings (serialize arrays/objects as JSON)';

export const run = (ctx) => {
    if (!ctx.connectorsDir) {
        for (const { file } of ctx.flows) {
            ctx.addWarning(file, '[lambda-string-schema] connectorsDir not resolved — skipping');
            break;
        }
        return;
    }

    const cache = new Map();
    const stringPropsOf = (type) => {
        if (!cache.has(type)) {
            const def = loadComponentSchema(type, ctx.connectorsDir);
            const props = {};
            for (const inPort of def?.inPorts || []) {
                if (typeof inPort === 'string') continue;
                for (const [key, prop] of Object.entries(inPort.schema?.properties || {})) {
                    if (prop?.type === 'string') props[key] = true;
                }
            }
            cache.set(type, props);
        }
        return cache.get(type);
    };

    for (const { file, json } of ctx.flows) {
        for (const [id, comp] of components(json)) {
            const stringProps = stringPropsOf(comp.type);
            for (const ports of Object.values(transformIn(comp))) {
                for (const data of Object.values(ports)) {
                    for (const [key, value] of Object.entries(data.lambda || {})) {
                        if (!stringProps[key]) continue;
                        if (value === null || typeof value !== 'object') continue;
                        ctx.addFailure(file,
                            `[lambda-string-schema] component "${id}" (${comp.type}) sends ` +
                            `${Array.isArray(value) ? 'an array' : 'an object'} for "${key}", but the inPort schema ` +
                            `declares it as a string — the designer shows a red "must be string" chip. ` +
                            `Serialize it as a JSON string, e.g. "${key}": ${JSON.stringify(JSON.stringify(value))}`);
                    }
                }
            }
        }
    }
};
