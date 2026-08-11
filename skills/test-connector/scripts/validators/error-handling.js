/**
 * E2E flows must be fail-fast and deterministic: every component carries
 *
 *   "errorHandling": { "autoRetry": false, "onError": "stopFlow" }
 *
 * (Configurable Error Handling, engine issue #3802). With autoRetry:false the
 * engine makes no retries (maxAttempts = 0) — the first failure triggers the
 * onError action; with onError:"stopFlow" any component error stops the flow
 * immediately. That makes a failed run visible in seconds (flow stage flips to
 * stopped), keeps logs free of retry noise, and removes retry-induced
 * non-determinism from test results.
 *
 * Without this, a failing component silently retries with backoff and the
 * flow keeps "running" — the runner then has to infer failure from log
 * heuristics instead of reading the flow state.
 */
import { components } from './lib/flowutil.js';

export const name = 'error-handling';
export const description = 'Every component must set errorHandling { autoRetry:false, onError:"stopFlow" } (fail-fast E2E)';

export const run = (ctx) => {
    for (const { file, json } of ctx.flows) {
        for (const [id, comp] of components(json)) {
            const eh = comp.errorHandling;
            if (!eh) {
                ctx.addFailure(file,
                    `[error-handling] component "${id}" (${comp.type}) has no "errorHandling". ` +
                    'Add "errorHandling": { "autoRetry": false, "onError": "stopFlow" } — E2E flows ' +
                    'must fail fast and deterministically (no retries, stop on first error).');
                continue;
            }
            if (eh.autoRetry !== false) {
                ctx.addFailure(file,
                    `[error-handling] component "${id}" (${comp.type}) must set "autoRetry": false ` +
                    '(retries mask failures and delay E2E results non-deterministically).');
            }
            if (eh.onError !== 'stopFlow') {
                ctx.addFailure(file,
                    `[error-handling] component "${id}" (${comp.type}) must set "onError": "stopFlow" ` +
                    `(got ${JSON.stringify(eh.onError)}) — any component error must stop the flow ` +
                    'so the run has a clear terminal state.');
            }
        }
    }
};
