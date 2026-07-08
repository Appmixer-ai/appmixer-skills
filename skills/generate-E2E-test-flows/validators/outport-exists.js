/**
 * Every referenced OUTPUT port must actually exist on the referencing component.
 *
 * Two reference kinds are checked against the sender's component.json outPorts:
 *   1. Links — `source.<localInPort>.<senderId>: [senderOutPort, …]`
 *   2. Variables — every `$.<senderId>.<senderOutPort>.…` in config.transform
 *
 * Why: a link to a non-existent port uploads fine, the flow starts fine, but the
 * listener never receives a message — the component silently never runs, its
 * Assert never fires and AfterAll times out with ZERO errors in the logs. In the
 * designer the variable renders as an invalid chip. Real case: xero's invoice
 * flow listened on utils.files.SaveFile port "out" while the component's only
 * outPort is "file" — the flow "ran" forever with nothing to show.
 *
 * Components whose component.json cannot be resolved (connectorsDir missing or
 * private components) are skipped.
 */
import { components, sourceIn, collectVariables } from './lib/flowutil.js';
import { loadComponentSchema } from './lib/coverage.js';

export const name = 'outport-exists';
export const description = 'links and variable paths must reference real outPorts of the source component';

export const run = (ctx) => {
    if (!ctx.connectorsDir) {
        for (const { file } of ctx.flows) {
            ctx.addWarning(file, '[outport-exists] connectorsDir not resolved — skipping');
            break;
        }
        return;
    }

    const cache = new Map();
    const outPortsOf = (type) => {
        if (!cache.has(type)) {
            const def = loadComponentSchema(type, ctx.connectorsDir);
            cache.set(type, def
                ? (def.outPorts || []).map((p) => (typeof p === 'string' ? p : p.name))
                : null);
        }
        return cache.get(type);
    };

    for (const { file, json } of ctx.flows) {
        const flow = json.flow || {};
        for (const [id, comp] of components(json)) {

            // 1. Links: senderId -> [senderOutPort, ...]
            for (const [senderId, ports] of Object.entries(sourceIn(comp))) {
                const sender = flow[senderId];
                if (!sender) continue; // dangling link — structural's job
                const outPorts = outPortsOf(sender.type);
                if (!outPorts || outPorts.length === 0) continue;
                for (const port of ports || []) {
                    if (!outPorts.includes(port)) {
                        ctx.addFailure(file,
                            `[outport-exists] component "${id}" (${comp.type}) listens on port "${port}" of ` +
                            `"${senderId}" (${sender.type}), but that component's outPorts are ` +
                            `[${outPorts.join(', ')}]. The listener never receives a message — the flow ` +
                            'stalls silently until AfterAll times out. Use the real port name.');
                    }
                }
            }

            // 2. Variables: $.<senderId>.<senderOutPort>... anywhere in the transform
            for (const variable of collectVariables(comp.config?.transform)) {
                const m = variable.match(/^\$\.([^.]+)\.([^.[]+)/);
                if (!m) continue;
                const [, senderId, port] = m;
                const sender = flow[senderId];
                if (!sender) continue;
                const outPorts = outPortsOf(sender.type);
                if (!outPorts || outPorts.length === 0) continue;
                if (!outPorts.includes(port)) {
                    ctx.addFailure(file,
                        `[outport-exists] component "${id}" references variable "${variable}", but ` +
                        `"${senderId}" (${sender.type}) has no outPort "${port}" (outPorts: ` +
                        `[${outPorts.join(', ')}]). The designer renders this as an invalid-variable chip ` +
                        'and the value never resolves at runtime.');
                }
            }
        }
    }
};
