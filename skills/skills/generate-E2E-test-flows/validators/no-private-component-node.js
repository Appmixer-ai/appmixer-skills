/**
 * A `private: true` connector component must NOT be used as a standalone E2E
 * flow node.
 *
 * Private components (ListTemplates, ListField, IssueMetadata, GenerateIssuesOutput, …)
 * are dynamic-output source helpers: they back inspector dropdowns / the variable
 * picker via `source:` URLs in OTHER components. They are not user-facing actions,
 * are excluded from coverage (component-coverage), and produce dynamic output that
 * can't be cleanly asserted — so a flow that wires one as a node is testing the
 * wrong thing (and tends to crash or need source-specific input). Test the real
 * action that uses them instead.
 *
 * Needs $VERO_CONNECTORS_DIR to read each component's `private` flag.
 */
import fs from 'fs';
import path from 'path';
import { components } from './lib/flowutil.js';

const isConnectorComp = (t) => t && t.startsWith('appmixer.') && !t.startsWith('appmixer.utils.');

export const name = 'no-private-component-node';
export const description = 'Private (source-helper) components must not be standalone flow nodes';

export const run = (ctx) => {
    if (!ctx.connectorsDir) {
        ctx.addWarning(null, 'skipped: VERO_CONNECTORS_DIR not set, cannot read component.json private flags');
        return;
    }
    const appmixerRoot = path.join(ctx.connectorsDir, 'appmixer');
    const cache = {};
    const isPrivate = (type) => {
        if (type in cache) return cache[type];
        const rel = type.split('.').slice(1).join(path.sep); // jira/issues/ListField
        let priv = false;
        try { priv = JSON.parse(fs.readFileSync(path.join(appmixerRoot, rel, 'component.json'), 'utf8')).private === true; } catch { /* ignore */ }
        return (cache[type] = priv);
    };

    for (const { file, json } of ctx.flows) {
        for (const [id, comp] of components(json)) {
            if (!isConnectorComp(comp.type)) continue;
            if (isPrivate(comp.type)) {
                ctx.addFailure(file,
                    `[no-private-component-node] component "${id}" (${comp.type}) is private:true — ` +
                    `a dynamic-output source helper, not a testable action. Remove it from the flow ` +
                    `(test the real action that consumes it via its inspector source instead).`);
            }
        }
    }
};
