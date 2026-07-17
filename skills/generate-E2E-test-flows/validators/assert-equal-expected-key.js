/**
 * `equal` assertions must carry the comparison value in the `expected` key.
 * The Assert component ignores `value` — the assertion then compares against
 * undefined and fails at runtime with the misleading message
 * "expected undefined to equal <field>", while the flow still reaches
 * ProcessE2EResults (a silent test failure). Real case: epic MakeApiCall
 * status assert, 2026-07-17.
 */
import { components, assertClauses } from './lib/flowutil.js';

const ASSERT_TYPE = 'appmixer.utils.test.Assert';

export const name = 'assert-equal-expected-key';
export const description = 'equal assertions use `expected` (not `value`) for the comparison value';

export const run = (ctx) => {
    for (const { file, json } of ctx.flows) {
        for (const [id, comp] of components(json)) {
            if (comp.type !== ASSERT_TYPE) continue;
            for (const clause of assertClauses(comp)) {
                if (clause?.assertion !== 'equal') continue;
                if ('value' in clause && !('expected' in clause)) {
                    ctx.addFailure(file,
                        `${id} (Assert): equal assertion uses key "value" — the component reads "expected"; ` +
                        'rename the key or the assert compares against undefined');
                } else if (!('expected' in clause)) {
                    ctx.addFailure(file,
                        `${id} (Assert): equal assertion has no "expected" key — it will compare against undefined`);
                }
            }
        }
    }
};
