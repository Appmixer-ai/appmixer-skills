'use strict';

const API_BASE_URL = 'https://api.service.com';

module.exports = {

    API_BASE_URL,

    /**
     * Resolve a user supplied endpoint (relative path or absolute URL) against
     * the service's API base and refuse anything that would send the account's
     * credential somewhere else.
     *
     * Resolving through the WHATWG URL parser and comparing the resulting origin
     * also rejects protocol-relative input such as `//example.com/x`, which would
     * otherwise silently resolve to a foreign host.
     * @param {object} context Appmixer component context (for CancelError)
     * @param {string} url relative path (e.g. '/v1/projects') or absolute URL on the API host
     * @returns {string} absolute URL on the API host
     */
    resolveApiUrl(context, url) {

        const candidate = /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//')
            ? url
            : `${url.startsWith('/') ? '' : '/'}${url}`;

        let parsed;
        try {
            parsed = new URL(candidate, API_BASE_URL);
        } catch (error) {
            throw new context.CancelError(`API Endpoint Path is not a valid URL: ${url}`);
        }

        if (parsed.username || parsed.password) {
            throw new context.CancelError('API Endpoint Path must not contain credentials.');
        }

        if (parsed.origin !== API_BASE_URL) {
            throw new context.CancelError(
                `API Endpoint Path must target ${API_BASE_URL}, got ${parsed.origin}.`
            );
        }

        return parsed.toString();
    },

    /**
     * The one place that turns a connected account into request headers.
     * OAuth 2 connectors use `context.auth.accessToken`, API key connectors
     * `context.auth.apiKey` (or whatever auth.js stores).
     * @param {object} context Appmixer component context
     * @returns {object} headers carrying the credential
     */
    authHeaders(context) {

        return { 'Authorization': `Bearer ${context.auth.accessToken}` };
    },

    /**
     * Parse a textarea JSON input. Empty input means "no body"; an object is
     * passed through (the designer may already have parsed a variable).
     * @param {object} context Appmixer component context (for CancelError)
     * @param {string|object} value raw input
     * @param {string} label human readable input name for the error message
     * @returns {object|undefined}
     */
    parseJsonInput(context, value, label) {

        if (value === null || value === undefined || value === '') {
            return undefined;
        }

        if (typeof value === 'object') {
            return value;
        }

        try {
            return JSON.parse(value);
        } catch (error) {
            throw new context.CancelError(`${label} must be valid JSON.`);
        }
    },

    /**
     * Convert Appmixer key-value inspector rows into a plain object.
     * @param {Array<{key: string, value: *}>} rows
     * @returns {object}
     */
    kvToObject(rows) {

        if (!Array.isArray(rows)) {
            return {};
        }
        const result = {};
        for (const row of rows) {
            if (!row || typeof row.key !== 'string' || !row.key) {
                continue;
            }
            result[row.key] = row.value;
        }
        return result;
    }
};
