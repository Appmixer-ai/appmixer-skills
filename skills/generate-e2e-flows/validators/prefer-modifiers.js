/**
 * CodeBlock is a LAST resort — modifiers (g_jsonPath, g_first, g_now,
 * g_addTimeSpan, g_uuid4, …) handle most extraction/formatting natively and
 * avoid the CodeBlock `result` wrapping. Flag CodeBlock usage so it gets a second
 * look. (09-testing "Modifier Functions (Prefer Over CodeBlock)") — warning only.
 */
import { components, shortType } from './lib/flowutil.js';

export const name = 'prefer-modifiers';
export const description = 'CodeBlock present — prefer modifiers where possible (warning)';

export const run = (ctx) => {
    for (const { file, json } of ctx.flows) {
        for (const [id, comp] of components(json)) {
            if ((comp.type || '').includes('CodeBlock')) {
                ctx.addWarning(file,
                    `${id} (${shortType(comp.type)}): CodeBlock is a last resort — check whether a ` +
                    `modifier (g_jsonPath / g_first / g_now+g_addTimeSpan / g_uuid4 …) can do this instead`);
            }
        }
    }
};
