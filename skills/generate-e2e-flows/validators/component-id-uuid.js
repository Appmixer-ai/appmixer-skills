/**
 * Component ids MUST be globally-unique UUIDs (as the designer assigns), never
 * human-readable slugs like "create-project" / "get-project".
 *
 * Why this is a hard failure, not cosmetics: when a user connects an OAuth
 * account from a component, the engine resolves the component's required scopes
 * via Flow.findByComponentId(userId, componentId) — a GLOBAL lookup keyed only
 * on the componentId that ignores the flowId. Readable ids are reused across
 * every generated E2E flow, so the lookup binds to an arbitrary flow and
 * aggregates the wrong (often empty) scope. The authorize URL then ships with
 * only the base scope and the provider rejects it ("no supported scopes"). UUID
 * ids are globally unique, so they always resolve to the right component.
 *
 * The canonical template (test-flow-template.json) already uses UUID ids — copy
 * that convention. Generate ids with crypto.randomUUID().
 */
import { components } from './lib/flowutil.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const name = 'component-id-uuid';
export const description = 'Every component id is a unique UUID (not a readable slug) — readable ids break OAuth account connection';

export const run = (ctx) => {
    for (const { file, json } of ctx.flows) {
        for (const [id] of components(json)) {
            if (!UUID_RE.test(id)) {
                ctx.addFailure(file,
                    `[component-id-uuid] component id "${id}" is not a UUID. Use a unique UUID ` +
                    `(crypto.randomUUID()) for every component key — readable/reused ids break OAuth ` +
                    `account connection (engine resolves auth scope by global componentId lookup).`);
            }
        }
    }
};
