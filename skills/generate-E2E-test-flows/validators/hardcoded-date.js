/**
 * Hardcoded dates make tests expire/flake. Prefer g_now + g_addTimeSpan to
 * compute dates dynamically. Flags literal ISO-ish dates in lambda string
 * values. (09-testing "Deterministic Test Design") — warning only.
 */
import { transformPorts, shortType, collectStrings } from './lib/flowutil.js';

// 2026-06-24 or 2026-06-24T10:00 ... but NOT inside a {{{var}}} template.
const DATE_RE = /\b\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?/;

export const name = 'hardcoded-date';
export const description = 'No hardcoded dates in inputs — use g_now + g_addTimeSpan (warning)';

export const run = (ctx) => {
    for (const { file, json } of ctx.flows) {
        const seen = new Set();
        for (const { id, comp, lambda } of transformPorts(json)) {
            for (const s of collectStrings(lambda)) {
                const m = s.match(DATE_RE);
                if (m && !s.includes('{{{') && !seen.has(id + m[0])) {
                    seen.add(id + m[0]);
                    ctx.addWarning(file,
                        `${id} (${shortType(comp.type)}): hardcoded date "${m[0]}" — compute it with ` +
                        `g_now + g_addTimeSpan so the test does not expire`);
                }
            }
        }
    }
};
