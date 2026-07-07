/**
 * If a flow creates a resource it should also delete it (cleanup), so repeated
 * runs stay deterministic and don't leave test data behind. Flags a flow with a
 * Create* component but no Delete* component. (09-testing "Deterministic Test
 * Design" → Create + Delete cleanup) — warning only (cleanup may live elsewhere).
 */
import { components, shortType } from './lib/flowutil.js';

const isConnectorComp = (t) => t && t.startsWith('appmixer.') && !t.startsWith('appmixer.utils.');

export const name = 'create-without-cleanup';
export const description = 'Flow that Creates a resource should also Delete it (warning)';

export const run = (ctx) => {
    for (const { file, json } of ctx.flows) {
        const creates = [];
        let hasDelete = false;
        for (const [id, comp] of components(json)) {
            if (!isConnectorComp(comp.type)) continue;
            const last = shortType(comp.type);
            if (/^Create/i.test(last)) creates.push(`${id} (${last})`);
            if (/Delete|Remove/i.test(last)) hasDelete = true;
        }
        if (creates.length && !hasDelete) {
            ctx.addWarning(file,
                `creates resource(s) [${creates.join(', ')}] but has no Delete/Remove component — ` +
                `add cleanup so repeated runs stay deterministic`);
        }
    }
};
