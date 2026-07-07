/**
 * A field that defines `modifiers` MUST bind them in `lambda` with a non-empty
 * value (the {{{var-id}}} pattern) — an empty/missing lambda value silently
 * ignores the modifier. Also: Assert expression clauses must have a non-empty
 * `field`. (09-testing "Critical Variable Mapping Rules" — fails silently.)
 */
import { shortType, transformPorts, assertClauses, components } from './lib/flowutil.js';

const ASSERT_TYPE = 'appmixer.utils.test.Assert';

export const name = 'modifier-lambda-binding';
export const description = 'Modifier fields are bound in lambda (non-empty); Assert clause fields not empty';

export const run = (ctx) => {
    for (const { file, json } of ctx.flows) {
        // (a) Every field with a non-empty modifiers map must have a non-empty lambda value.
        for (const { id, comp, modifiers, lambda } of transformPorts(json)) {
            for (const [field, varMap] of Object.entries(modifiers)) {
                if (!varMap || Object.keys(varMap).length === 0) continue;
                const val = lambda[field];
                const empty = val === undefined || val === null || val === ''
                    || (typeof val === 'object' && Object.keys(val).length === 0);
                if (empty) {
                    ctx.addFailure(file,
                        `${id} (${shortType(comp.type)}): field "${field}" defines modifiers but its ` +
                        `lambda value is empty — bind it (e.g. "{{{var-id}}}"), otherwise the modifier is ignored`);
                }
            }
        }
        // (b) Assert expression clauses must reference a field.
        for (const [id, comp] of components(json)) {
            if (comp.type !== ASSERT_TYPE) continue;
            for (const clause of assertClauses(comp)) {
                if (!clause || clause.field === undefined || clause.field === '') {
                    ctx.addFailure(file,
                        `${id} (Assert): an expression clause has an empty "field" — it must reference a modifier ({{{var-id}}})`);
                }
            }
        }
    }
};
