/**
 * Input coverage — checks flow component fields against their component.json
 * input schemas. Requires the connectors source dir (ctx.connectorsDir).
 */
import { inputCoverageValidation } from './lib/coverage.js';

export const name = 'input-coverage';
export const description = 'Flow fields vs component.json schemas (data quality, required/unknown fields, assert coverage)';

export const run = (ctx) => {
    if (!ctx.connectorsDir) {
        ctx.addWarning(null, 'skipped: APPMIXER_SKILL_CONNECTORS_DIR not set, cannot load component schemas');
        return;
    }
    for (const { file, json } of ctx.flows) {
        for (const e of inputCoverageValidation(json, ctx.connectorsDir)) {
            const msg = `[${e.rule}] ${e.component || 'flow'}: ${e.message}`;
            (e.severity === 'critical' ? ctx.addFailure : ctx.addWarning)(file, msg);
        }
    }
};
