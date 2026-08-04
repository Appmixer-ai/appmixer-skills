/**
 * Forbid array indexing in variable paths (e.g. $.x.out.items.0.id or
 * $.x.templates[0].label). Neither dot-form `.N.` nor bracket-form `[N]`
 * indexing resolves in Appmixer variable paths — use a modifier
 * (g_jsonPath "$[0].id", or g_first / g_last) instead. (09-testing Common Mistakes #3)
 */
import { collectVariables } from './lib/flowutil.js';

// Match dot-form numeric index (.0. / trailing .0) OR bracket-form ([0]).
const INDEX_RE = /\.\d+(\.|$)|\[\d+\]/;

export const name = 'variable-array-index';
export const description = 'No numeric array indexing (.N.) in variable paths';

export const run = (ctx) => {
    for (const { file, json } of ctx.flows) {
        const seen = new Set();
        for (const v of collectVariables(json)) {
            if (INDEX_RE.test(v) && !seen.has(v)) {
                seen.add(v);
                ctx.addFailure(file,
                    `variable path "${v}" uses numeric array indexing — use a modifier ` +
                    `(g_jsonPath "$[0].field", or g_first / g_last) on the array instead`);
            }
        }
    }
};
