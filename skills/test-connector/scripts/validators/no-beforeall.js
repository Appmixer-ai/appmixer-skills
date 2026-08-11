/**
 * E2E flows must NOT contain a BeforeAll component
 * (appmixer.utils.test.BeforeAll).
 *
 * The canonical flow shape is OnStart -> SetVariable -> component(s) under test
 * -> Assert -> AfterAll -> ProcessE2EResults (see test-flow-template.json).
 * BeforeAll is not part of it: it adds an unnecessary harness node between
 * SetVariable and the components, complicates wiring/transforms, and keeps
 * creeping back into generated flows. Wire components straight from SetVariable
 * (or their real upstream) instead.
 */
import { components } from './lib/flowutil.js';

export const name = 'no-beforeall';
export const description = 'Flows must not use appmixer.utils.test.BeforeAll (wire from SetVariable directly)';

export const run = (ctx) => {
    for (const { file, json } of ctx.flows) {
        for (const [id, comp] of components(json)) {
            if ((comp.type || '').endsWith('.BeforeAll')) {
                ctx.addFailure(file,
                    `[no-beforeall] component "${id}" is a BeforeAll (${comp.type}). ` +
                    `Remove it and wire its downstream components straight from their upstream ` +
                    `(SetVariable / the real source). The flow shape is OnStart -> SetVariable -> ` +
                    `component(s) -> Assert -> AfterAll -> ProcessE2EResults — no BeforeAll.`);
            }
        }
    }
};
