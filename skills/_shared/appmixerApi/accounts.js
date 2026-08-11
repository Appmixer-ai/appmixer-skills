/**
 * Appmixer Account API
 *
 * Endpoints for managing service accounts: list, create, delete, test, share/unshare.
 */

/**
 * List accounts for the authenticated user.
 * @param {AxiosInstance} client
 * @param {Object} [query] - query-builder compatible params
 * @returns {Promise<Array>}
 */
export const listAccounts = async (client, query = {}) => {
    const { data } = await client.get('/accounts', { params: query });
    return data;
};

/**
 * Inject (create) an account directly.
 * @param {AxiosInstance} client
 * @param {Object} accountData - { service, token, profileInfo, ... }
 * @returns {Promise<Object>}
 */
export const createAccount = async (client, accountData) => {
    const { data } = await client.post('/accounts', accountData);
    return data;
};

/**
 * Update account display name.
 * @param {AxiosInstance} client
 * @param {string} accountId
 * @param {string} displayName
 * @returns {Promise<Object>}
 */
export const updateAccount = async (client, accountId, displayName) => {
    const { data } = await client.put(`/accounts/${accountId}`, { displayName });
    return data;
};

/**
 * Test (validate) an account.
 * @param {AxiosInstance} client
 * @param {string} accountId
 * @returns {Promise<Object>}
 */
export const testAccount = async (client, accountId) => {
    const { data } = await client.post(`/accounts/${accountId}/test`);
    return data;
};

/**
 * Revoke (delete) an account.
 * @param {AxiosInstance} client
 * @param {string} accountId
 * @returns {Promise<{ accountId: string }>}
 */
export const deleteAccount = async (client, accountId) => {
    const { data } = await client.delete(`/accounts/${accountId}`);
    return data;
};

/**
 * Get flows using an account.
 * @param {AxiosInstance} client
 * @param {string} accountId
 * @returns {Promise<Array<{ flowId: string, name: string }>>}
 */
export const getAccountFlows = async (client, accountId) => {
    const { data } = await client.get(`/accounts/${accountId}/flows`);
    return data;
};

/**
 * Share an account with components in a flow.
 * @param {AxiosInstance} client
 * @param {string} accountId
 * @param {Object} payload - { componentIds: string[], flowId: string }
 * @returns {Promise<{ accountId: string, flowId: string, shared: Array }>}
 */
export const shareAccount = async (client, accountId, payload) => {
    const { data } = await client.post(`/accounts/${accountId}/share`, payload);
    return data;
};

/**
 * Unshare an account from a flow.
 * @param {AxiosInstance} client
 * @param {string} accountId
 * @param {Object} payload - { flowId: string }
 * @returns {Promise<{ accountId: string, flowId: string }>}
 */
export const unshareAccount = async (client, accountId, payload) => {
    const { data } = await client.post(`/accounts/${accountId}/unshare`, payload);
    return data;
};

/**
 * Get account profile info field.
 * @param {AxiosInstance} client
 * @param {string} fieldName
 * @param {Object} [query] - { componentId }
 * @returns {Promise<{ response: any }>}
 */
export const getProfileInfo = async (client, fieldName, query = {}) => {
    const { data } = await client.get(`/accounts/profile-info/${fieldName}`, { params: query });
    return data;
};

/**
 * Get account assignments for a flow (which components have which accounts).
 * @param {AxiosInstance} client
 * @param {string} flowId
 * @returns {Promise<Object>} - { componentId: accountId | null }
 */
export const getFlowAccounts = async (client, flowId) => {
    const { data } = await client.get(`/accounts/flow/${flowId}`);
    return data;
};

/**
 * Bind an account to a single flow component (the designer "Connect account" binding).
 * Required after any flow PUT (newly written nodes are unbound).
 * @param {AxiosInstance} client
 * @param {string} componentId
 * @param {string} accountId
 * @returns {Promise<Object>} - { accountId, componentId }
 */
export const assignComponentAccount = async (client, componentId, accountId) => {
    const { data } = await client.put(`/auth/component/${componentId}/${accountId}`);
    return data;
};
