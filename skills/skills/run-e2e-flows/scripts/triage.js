//
// Deterministic triage layer.
//
// Pure function. Given the outcome of a run (result string + parsed errors), decide what to do
// next WITHOUT calling AI. This is where the "explicit, cheap, reliable" handling lives — AI is
// only reached when nothing here matches.
//
// To make the tool cheaper and more predictable over time, you ADD RULES HERE. Every error class
// you can resolve mechanically (rebind an account, re-point a store, add a delay) is one less
// reason to spin up an LLM. Keep this table growing; treat an AI fix as the fallback, not the norm.
//

// Ordered rules. First match wins. Each rule: { name, match(errors) → bool, action, reason }.
// action is one of: 'reassign' (deterministic remedy) | 'ai-fix' (escalate to LLM).
const RULES = [
    {
        name: 'token-error',
        action: 'reassign',
        reason: 'Account not bound to a component — re-assign accounts and retry (no AI needed).',
        match: errors => errors.some(e =>
            e.message.includes('TokenError') || e.message.includes('Access token not found'))
    }
    // Add more deterministic rules here as you discover repeatable failures, e.g.:
    // {
    //     name: 'store-not-found',
    //     action: 'fix-store',
    //     reason: 'ProcessE2EResults points at a store ID from another instance — re-point to a local store.',
    //     match: errors => errors.some(e => /Store .* not found/.test(e.message))
    // }
];

/**
 * @param {{ result: string, errors: Array<{componentType?:string, message:string}> }} outcome
 * @returns {{ action: 'done'|'reassign'|'ai-fix', reason: string, rule?: string }}
 */
export function triage({ result, errors }) {
    if (result === 'done' && errors.length === 0) {
        return { action: 'done', reason: 'ProcessE2EResults completed with no errors.' };
    }

    for (const rule of RULES) {
        if (rule.match(errors)) {
            return { action: rule.action, reason: rule.reason, rule: rule.name };
        }
    }

    return {
        action: 'ai-fix',
        reason: errors.length
            ? `${errors.length} error(s), no deterministic rule matched — escalating to AI.`
            : `Run did not complete (result=${result}) and no errors parsed — escalating to AI.`
    };
}
