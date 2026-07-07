/**
 * Appmixer Store API
 */

/**
 * Fetch store records.
 * @param {AxiosInstance} client
 * @param {string} storeId
 * @param {Object} [options] - { offset, limit, sort }
 * @returns {Promise<Array>}
 */
export const fetchStoreRecords = async (client, storeId, options = {}) => {
    if (!storeId) return [];
    const { data } = await client.get('/store', {
        params: {
            storeId,
            offset: options.offset ?? 0,
            limit: options.limit ?? 200,
            sort: options.sort ?? 'updatedAt:-1'
        }
    });
    return Array.isArray(data) ? data : [];
};

/**
 * List data stores.
 * @param {AxiosInstance} client
 * @returns {Promise<Array>} - [{ storeId, name, ... }]
 */
export const listStores = async (client) => {
    const { data } = await client.get('/stores');
    return Array.isArray(data) ? data : (data?.stores || []);
};

/**
 * Create a data store.
 * @param {AxiosInstance} client
 * @param {string} name
 * @returns {Promise<Object>} - { storeId, name, ... }
 */
export const createStore = async (client, name) => {
    const { data } = await client.post('/stores', { name });
    return data;
};
