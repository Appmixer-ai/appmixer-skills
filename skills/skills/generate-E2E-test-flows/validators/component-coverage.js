/**
 * Every connector component should appear in at least one E2E flow. Aggregates
 * the component types used across ALL flows, then for each connector (vendor)
 * under test, lists the components on disk and warns about any not covered.
 * (09-testing Common Mistakes #6) — warning only; needs $VERO_CONNECTORS_DIR.
 */
import fs from 'fs';
import path from 'path';
import { components } from './lib/flowutil.js';

const isConnectorComp = (t) => t && t.startsWith('appmixer.') && !t.startsWith('appmixer.utils.');

// Recursively find component.json files and map each to its dotted type.
// Triggers (trigger:true) are excluded — they are entry-point components covered
// by Flow Test Mode (test()), not by E2E flows.
// Private (private:true) components are also excluded — they are dynamic-output
// source helpers (e.g. ListTemplates, GenerateIssuesOutput) that back dropdowns/
// variable pickers and are never standalone E2E flow nodes, so demanding coverage
// for them is wrong.
function discoverTypes(vendorDir, appmixerRoot) {
    const out = [];
    const walk = (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) walk(p);
            else if (e.name === 'component.json') {
                let isTrigger = false;
                let isPrivate = false;
                try {
                    const cj = JSON.parse(fs.readFileSync(p, 'utf8'));
                    isTrigger = cj.trigger === true;
                    isPrivate = cj.private === true;
                } catch { /* ignore */ }
                if (isTrigger || isPrivate) continue;
                const rel = path.relative(appmixerRoot, path.dirname(p));
                out.push('appmixer.' + rel.split(path.sep).join('.'));
            }
        }
    };
    if (fs.existsSync(vendorDir)) walk(vendorDir);
    return out;
}

export const name = 'component-coverage';
export const description = 'Every connector component appears in at least one flow';

export const run = (ctx) => {
    if (!ctx.connectorsDir) {
        ctx.addWarning(null, 'skipped: VERO_CONNECTORS_DIR not set, cannot list connector components');
        return;
    }
    const appmixerRoot = path.join(ctx.connectorsDir, 'appmixer');

    // Used types + vendors across all flows.
    const used = new Set();
    const vendors = new Set();
    for (const { json } of ctx.flows) {
        for (const [, comp] of components(json)) {
            if (!isConnectorComp(comp.type)) continue;
            used.add(comp.type);
            vendors.add(comp.type.split('.')[1]);
        }
    }
    if (vendors.size === 0) return;

    for (const vendor of vendors) {
        const all = discoverTypes(path.join(appmixerRoot, vendor), appmixerRoot);
        const missing = all.filter((t) => !used.has(t));
        for (const t of missing) {
            ctx.addWarning(null, `component "${t}" is not covered by any E2E flow`);
        }
    }
};
