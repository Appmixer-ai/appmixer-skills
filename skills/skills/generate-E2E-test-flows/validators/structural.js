/**
 * Structural E2E flow rules (required components, ProcessE2EResults wiring,
 * assert specificity, variable mapping/paths). Pure deterministic checks.
 */
import { deterministicValidation } from './lib/structural.js';

export const name = 'structural';
export const description = 'Required components, asserts, variable mapping/paths';

export const run = (ctx) => {
    for (const { file, json } of ctx.flows) {
        for (const e of deterministicValidation(json)) {
            const msg = `[${e.rule}] ${e.component || 'flow'}: ${e.message}`;
            (e.severity === 'critical' ? ctx.addFailure : ctx.addWarning)(file, msg);
        }
    }
};
