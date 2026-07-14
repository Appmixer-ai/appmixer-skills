/**
 * Appmixer API client — base HTTP client with auth and token caching.
 *
 * Usage:
 *   import { createClient } from './client.js';
 *   const api = await createClient();                              // uses process.env
 *   const api = await createClient({ baseUrl, username, password }); // explicit config
 */

import axios from 'axios';

const TOKEN_TTL = 55 * 60 * 1000; // 55 minutes
const tokenCache = new Map(); // key → { token, expiry }

/**
 * Authenticate and return a configured axios instance with cached token.
 */
export const createClient = async ({
    baseUrl = process.env.APPMIXER_SKILL_API_URL,
    username = process.env.APPMIXER_SKILL_USERNAME,
    password = process.env.APPMIXER_SKILL_PASSWORD,
    // Escape hatch: skip /user/auth and use a pre-obtained token (e.g. when
    // /user/auth returns 403 for SSO-only accounts or special-char passwords).
    token: explicitToken = process.env.APPMIXER_TOKEN
} = {}) => {
    if (!baseUrl) {
        throw new Error('APPMIXER_SKILL_API_URL is required (renamed from APPMIXER_SKILL_BASE_URL). ' +
            'It must point at the API host, not the designer UI - a 405/HTML response from ' +
            '/user/auth means a UI host was configured.');
    }
    if (!explicitToken && (!username || !password)) {
        throw new Error('APPMIXER_SKILL_USERNAME and APPMIXER_SKILL_PASSWORD (or APPMIXER_TOKEN) are required');
    }

    const normalizedUrl = baseUrl.replace(/\/+$/, '');
    const cacheKey = `${normalizedUrl}:${username}`;

    let token;
    if (explicitToken) {
        token = explicitToken;
    } else {
        // Check cache
        const cached = tokenCache.get(cacheKey);
        if (cached && Date.now() < cached.expiry) {
            token = cached.token;
        } else {
            const authResponse = await axios.post(`${normalizedUrl}/user/auth`, { username, password });
            token = authResponse.data.token;
            tokenCache.set(cacheKey, { token, expiry: Date.now() + TOKEN_TTL });
        }
    }

    const client = axios.create({
        baseURL: normalizedUrl,
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    });

    client.token = token;
    client.baseUrl = normalizedUrl;

    return client;
};

/**
 * Invalidate cached token (e.g. on auth error).
 */
export const invalidateToken = (baseUrl, username) => {
    const key = `${baseUrl?.replace(/\/+$/, '')}:${username}`;
    tokenCache.delete(key);
};
