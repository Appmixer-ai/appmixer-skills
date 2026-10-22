'use strict';

// The subdomain is typed by the user and becomes the request host, and the API key
// is sent to that host. Accept a plain subdomain only: "evil.example/x?" would
// otherwise send the key to evil.example. Check the value as typed, without
// normalizing it - components build their URLs from the stored context.auth.domain.
// In a real connector this lives in lib.js and the components call it too.
const SUBDOMAIN_PATTERN = /^[a-z0-9][a-z0-9-]*$/i;

const serviceOrigin = function(subdomain) {
    if (typeof subdomain !== 'string' || !SUBDOMAIN_PATTERN.test(subdomain)) {
        throw new Error('Invalid subdomain. Enter the subdomain only, e.g. "example" for example.service.com.');
    }
    return `https://${subdomain}.service.com`;
};

module.exports = {
    type: 'apiKey',
    definition: {
        tokenType: 'authentication-token',

        // Authentication fields shown to user
        auth: {
            domain: {
                type: 'text',
                name: 'Domain',
                tooltip: 'Your subdomain (e.g., "example" for example.service.com)'
            },
            apiKey: {
                type: 'text',
                name: 'API Key',
                tooltip: 'Find your API key in your account settings'
            }
        },

        // How to extract account name from profile
        accountNameFromProfileInfo: 'contact.email',

        // Fetch user profile information
        requestProfileInfo: async (context) => {
            return context.httpRequest({
                method: 'GET',
                url: `${serviceOrigin(context.domain)}/api/v1/me`,
                auth: {
                    user: context.apiKey,
                    password: 'X'
                }
            });
        },

        // Validate credentials
        validate: async (context) => {
            const credentials = `${context.apiKey}:X`;
            const encoded = Buffer.from(credentials).toString('base64');

            await context.httpRequest({
                method: 'GET',
                url: `${serviceOrigin(context.domain)}/api/v1/me`,
                headers: {
                    'Authorization': `Basic ${encoded}`
                }
            });

            return true; // If request succeeds, credentials are valid
        }
    }
};
