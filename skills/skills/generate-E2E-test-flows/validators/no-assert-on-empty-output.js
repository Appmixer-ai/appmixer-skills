/**
 * An Assert must not test the output of a Delete* component.
 *
 * Delete components return an empty object `{}` by contract (the connector
 * delete-returns-empty / delete-update-shape rules enforce a single `out`
 * port returning `{}`), so there is nothing to assert — a `notEmpty` on
 * `$.<deleteId>.out` always fails and `$.<deleteId>.out.<field>` resolves to
 * undefined. Delete is cleanup: wire it straight to AfterAll, don't assert.
 *
 * Note: Update* is NOT included — Update components return the modified entity
 * (e.g. jira UpdateIssue -> {id}, UpdateProject -> the project), so asserting on
 * their output is valid. Past-tense triggers Deleted* are events that DO emit
 * data and are excluded by the negative lookahead.
 */
import { components } from './lib/flowutil.js';

const isEmptyOutput = (type) => /\.Delete(?!d)[A-Z]/.test(type || '');

export const name = 'no-assert-on-empty-output';
export const description = 'Asserts must not test Delete* output (Delete returns {})';

export const run = (ctx) => {
    for (const { file, json } of ctx.flows) {
        const flow = json.flow || {};
        for (const [id, comp] of components(json)) {
            if (!(comp.type || '').endsWith('.Assert')) continue;
            for (const srcId of Object.keys(comp.source?.in || {})) {
                const srcType = flow[srcId]?.type;
                if (isEmptyOutput(srcType)) {
                    ctx.addFailure(file,
                        `[no-assert-on-empty-output] Assert "${id}" tests the output of ` +
                        `"${srcId}" (${srcType}), which returns an empty object {}. ` +
                        `Remove the assert and wire the ${srcType.split('.').pop()} straight to AfterAll ` +
                        `(it is cleanup — there is nothing to assert).`);
                }
            }
        }
    }
};
