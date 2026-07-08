/**
 * Assert components may only use the supported assertion types:
 * equal, notEmpty, regex. (09-testing Required Components → Assert)
 */
import { components, assertClauses } from './lib/flowutil.js';

const ALLOWED = new Set(['equal', 'notEmpty', 'regex']);
const ASSERT_TYPE = 'appmixer.utils.test.Assert';

export const name = 'assert-assertion-type';
export const description = 'Assert clauses use only equal / notEmpty / regex';

export const run = (ctx) => {
    for (const { file, json } of ctx.flows) {
        for (const [id, comp] of components(json)) {
            if (comp.type !== ASSERT_TYPE) continue;
            for (const clause of assertClauses(comp)) {
                const a = clause?.assertion;
                if (a !== undefined && !ALLOWED.has(a)) {
                    ctx.addFailure(file,
                        `${id} (Assert): unsupported assertion "${a}" — use one of equal, notEmpty, regex`);
                }
            }
        }
    }
};
