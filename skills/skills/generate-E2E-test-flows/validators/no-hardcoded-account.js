/**
 * Committed flow JSONs must not hardcode `config.properties.account` — account
 * IDs are instance-specific and rot (revoked tokens, deleted accounts). A stale
 * hardcoded account keeps being re-uploaded with the flow and then fails at
 * runtime with 401/403 (e.g. salesforce "Bad_OAuth_Token") or as a flow-start
 * 400 wrapping an inner 401, even though `POST /accounts/:id/test` reports ok
 * (some connectors' validateAccessToken only checks a stored expiry date).
 *
 * Account binding belongs to upload time: `patch-accounts` (upload-e2e-flows)
 * or the run-e2e-flows runner (pin with VERO_APPMIXER_ACCOUNT_ID) assign a
 * live account to every connector component. Warning-level: multi-account
 * flows (two different users in one flow) are a legitimate reason to keep
 * explicit accounts — but then expect to maintain them per instance.
 */
import { components } from './lib/flowutil.js';

export const name = 'no-hardcoded-account';
export const description = 'flow JSONs should not hardcode config.properties.account (instance-specific, rots)';

export const run = (ctx) => {
    for (const { file, json } of ctx.flows) {
        for (const [id, comp] of components(json)) {
            const account = comp.config?.properties?.account;
            if (typeof account === 'string' && account.length > 0) {
                ctx.addWarning(file,
                    `[no-hardcoded-account] component "${id}" (${comp.type}) hardcodes account ` +
                    `"${account}". Remove it and let patch-accounts / the runner ` +
                    '(VERO_APPMIXER_ACCOUNT_ID) bind a live account at upload time — hardcoded ' +
                    'IDs rot and shadow the pinned account.');
            }
        }
    }
};
