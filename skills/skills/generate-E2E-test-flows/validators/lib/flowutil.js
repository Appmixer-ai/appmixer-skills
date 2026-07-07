/**
 * Shared helpers for E2E flow validators. Pure, no deps.
 */

export const shortType = (t) => (t || '?').split('.').pop();

export const isUtil = (t) => (t || '').startsWith('appmixer.utils.');

// [id, comp] for each component in a flow document.
export function* components(json) {
    for (const entry of Object.entries(json.flow || {})) yield entry;
}

// Edges as { sourceId, targetId, source, target }. An edge exists for every
// upstream id listed in a component's source.in.
export function* edges(json) {
    const flow = json.flow || {};
    for (const [targetId, target] of Object.entries(flow)) {
        for (const sourceId of Object.keys(target.source?.in || {})) {
            yield { sourceId, targetId, source: flow[sourceId], target };
        }
    }
}

// Transform ports: { id, comp, srcId, port, modifiers, lambda }.
export function* transformPorts(json) {
    for (const [id, comp] of components(json)) {
        const tin = comp.config?.transform?.in || {};
        for (const [srcId, ports] of Object.entries(tin)) {
            for (const [port, data] of Object.entries(ports)) {
                yield { id, comp, srcId, port, modifiers: data.modifiers || {}, lambda: data.lambda || {} };
            }
        }
    }
}

// All `.variable` strings found anywhere under an object (deep).
export function collectVariables(obj, acc = []) {
    if (!obj || typeof obj !== 'object') return acc;
    if (typeof obj.variable === 'string') acc.push(obj.variable);
    for (const v of Object.values(obj)) collectVariables(v, acc);
    return acc;
}

// Assert expression clauses ({ field, assertion, value, ... }) from a component's
// transform lambda.expression ({ AND: [...] } / { OR: [...] }).
export function* assertClauses(comp) {
    const tin = comp.config?.transform?.in || {};
    for (const ports of Object.values(tin)) {
        for (const data of Object.values(ports)) {
            const expr = data.lambda?.expression;
            if (!expr || typeof expr !== 'object') continue;
            for (const arr of Object.values(expr)) {
                if (Array.isArray(arr)) for (const clause of arr) yield clause;
            }
        }
    }
}

// All string values found under an object (deep) — used for scanning lambdas.
export function collectStrings(obj, acc = []) {
    if (typeof obj === 'string') { acc.push(obj); return acc; }
    if (!obj || typeof obj !== 'object') return acc;
    for (const v of Object.values(obj)) collectStrings(v, acc);
    return acc;
}
