/**
 * Appmixer Flow API
 *
 * Endpoints for managing flows: CRUD, start/stop, clone, validate, trigger.
 */

/**
 * Create a new flow.
 * @param {AxiosInstance} client
 * @param {Object} flowData - { name, flow, type, categories, ... }
 * @returns {Promise<{ flowId: string }>}
 */
export const createFlow = async (client, flowData) => {
    const { data } = await client.post('/flows', flowData);
    return data;
};

/**
 * Create or update a flow by ID.
 * @param {AxiosInstance} client
 * @param {string} flowId
 * @param {Object} flowData
 * @param {Object} [options] - { validate, forceUpdate, inProgressData }
 * @returns {Promise<Object>}
 */
export const upsertFlow = async (client, flowId, flowData, options = {}) => {
    const params = new URLSearchParams();
    if (options.validate !== undefined) params.set('validate', options.validate);
    if (options.forceUpdate) params.set('forceUpdate', 'true');
    if (options.inProgressData) params.set('inProgressData', options.inProgressData);

    const { data } = await client.put(`/flows/${flowId}?${params}`, flowData);
    return data;
};

/**
 * Get a flow by ID.
 * @param {AxiosInstance} client
 * @param {string} flowId
 * @param {string} [projection] - comma-separated fields
 * @returns {Promise<Object>}
 */
export const getFlow = async (client, flowId, projection) => {
    const params = projection ? { projection } : {};
    const { data } = await client.get(`/flows/${flowId}`, { params });
    return data;
};

/**
 * List flows.
 * @param {AxiosInstance} client
 * @param {Object} [query] - { limit, offset, sort, filter, projection, pattern }
 * @returns {Promise<Array>}
 */
export const listFlows = async (client, query = {}) => {
    const { data } = await client.get('/flows', { params: query });
    return data;
};

/**
 * Get flow count.
 * @param {AxiosInstance} client
 * @param {Object} [query] - { filter, pattern }
 * @returns {Promise<{ count: number }>}
 */
export const getFlowCount = async (client, query = {}) => {
    const { data } = await client.get('/flows/count', { params: query });
    return data;
};

/**
 * Delete a flow.
 * @param {AxiosInstance} client
 * @param {string} flowId
 * @returns {Promise<{ flowId: string }>}
 */
export const deleteFlow = async (client, flowId) => {
    const { data } = await client.delete(`/flows/${flowId}`);
    return data;
};

/**
 * Start a flow.
 * @param {AxiosInstance} client
 * @param {string} flowId
 * @returns {Promise<{ flowId: string }>}
 */
export const startFlow = async (client, flowId) => {
    const { data } = await client.post(`/flows/${flowId}/coordinator`, { command: 'start' });
    return data;
};

/**
 * Stop a flow.
 * @param {AxiosInstance} client
 * @param {string} flowId
 * @param {Object} [options] - { background: boolean }
 * @returns {Promise<{ flowId: string, ticket?: string }>}
 */
export const stopFlow = async (client, flowId, options = {}) => {
    const { data } = await client.post(`/flows/${flowId}/coordinator`, {
        command: 'stop',
        ...(options.background ? { background: true } : {})
    });
    return data;
};

/**
 * Get flow coordinator status.
 * @param {AxiosInstance} client
 * @param {string} flowId
 * @returns {Promise<Object>}
 */
export const getFlowStatus = async (client, flowId) => {
    const { data } = await client.get(`/flows/${flowId}/coordinator/status`);
    return data;
};

/**
 * Clone a flow.
 * @param {AxiosInstance} client
 * @param {string} flowId
 * @param {Object} [payload] - { additional: { name, type }, ... }
 * @returns {Promise<{ cloneId: string }>}
 */
export const cloneFlow = async (client, flowId, payload = {}) => {
    const { data } = await client.post(`/flows/${flowId}/clone`, payload);
    return data;
};

/**
 * Validate a flow.
 * @param {AxiosInstance} client
 * @param {string} flowId
 * @returns {Promise<Object>} - validation result
 */
export const validateFlow = async (client, flowId) => {
    const { data } = await client.get(`/flows/${flowId}/validate`);
    return data;
};

/**
 * Send a message to a flow (trigger).
 * @param {AxiosInstance} client
 * @param {string} flowId
 * @param {Object} message - { componentId, inputPort, content }
 * @returns {Promise<Object>}
 */
export const sendFlowMessage = async (client, flowId, message) => {
    const { data } = await client.post(`/flows/${flowId}`, message);
    return data;
};

/**
 * Trigger a flow component webhook (POST).
 * @param {AxiosInstance} client
 * @param {string} flowId
 * @param {string} triggerId
 * @param {Object} payload
 * @returns {Promise<Object>}
 */
export const triggerComponent = async (client, flowId, triggerId, payload = {}) => {
    const { data } = await client.post(`/flows/${flowId}/components/${triggerId}`, payload);
    return data;
};

/**
 * Update flow thumbnail.
 * @param {AxiosInstance} client
 * @param {string} flowId
 * @param {string} thumbnail - base64 encoded thumbnail
 * @returns {Promise<Object>}
 */
export const updateFlowThumbnail = async (client, flowId, thumbnail) => {
    const { data } = await client.put(`/flows/${flowId}/thumbnail`, { thumbnail });
    return data;
};

/**
 * Fetch flow logs (raw Elasticsearch hits).
 * @param {AxiosInstance} client
 * @param {Object} query - { flowId, from, size, sort } (e.g. sort: 'gridTimestamp:desc')
 * @returns {Promise<Object>} - { hits: [...] }
 */
export const getLogs = async (client, query = {}) => {
    const { data } = await client.get('/logs', { params: query });
    return data;
};
