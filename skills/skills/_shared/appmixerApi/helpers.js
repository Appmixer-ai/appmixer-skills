/**
 * Appmixer utility/helper functions (no API calls).
 */

/**
 * Extract E2E result store IDs from a flow object.
 */
export const getE2EResultStoreIds = (flow) => {
    if (!flow?.flow) return { failedStoreId: null, successStoreId: null };
    const comp = Object.values(flow.flow)
        .find(item => item.type === 'appmixer.utils.test.ProcessE2EResults');
    const props = comp?.config?.properties;
    return {
        failedStoreId: props?.failedStoreId || null,
        successStoreId: props?.successStoreId || null
    };
};

/**
 * Clean flow object for comparison (remove runtime/meta fields).
 */
export const cleanFlowForComparison = (flow) => {
    const cleaned = { ...flow };
    delete cleaned.flowId;
    delete cleaned.btime;
    delete cleaned.mtime;
    delete cleaned.userId;
    delete cleaned.runtimeErrors;
    delete cleaned.customFields;
    delete cleaned.stage;
    delete cleaned.description;

    if (cleaned.flow) {
        const comp = Object.values(cleaned.flow)
            .find(item => item.type === 'appmixer.utils.test.ProcessE2EResults');
        if (comp?.config?.properties) {
            delete comp.config.properties.failedStoreId;
            delete comp.config.properties.successStoreId;
        }
    }
    return cleaned;
};

/**
 * Extract connector name from E2E flow name.
 * Patterns: "E2E box - ...", "box E2E", "appmixer.box ..."
 */
export const extractConnectorFromFlowName = (flowName) => {
    if (!flowName) return null;
    const patterns = [
        /e2e[_\s-]+(\w+)/i,
        /(\w+)[_\s-]+e2e/i,
        /appmixer\.(\w+)/i,
    ];
    for (const p of patterns) {
        const m = flowName.match(p);
        if (m?.[1]) return m[1].toLowerCase();
    }
    return null;
};
