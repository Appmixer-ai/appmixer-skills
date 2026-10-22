'use strict';

// Only a plain subdomain may reach the request host - see api-key.js.
const freshdeskOrigin = function(domain) {
    if (typeof domain !== 'string' || !/^[a-z0-9][a-z0-9-]*$/i.test(domain)) {
        throw new Error('Invalid Freshdesk domain. Enter the subdomain only, e.g. "example" for example.freshdesk.com.');
    }
    return `https://${domain}.freshdesk.com`;
};

module.exports = {
    type: 'apiKey',
    definition: {
        tokenType: 'authentication-token',
        auth: {
            domain: {
                type: 'text',
                name: 'Domain',
                tooltip: 'Your Freshdesk subdomain - e.g. if the domain is <i>https://example.freshdesk.com</i> just type <b>example</b> inside this field'
            },
            apiKey: {
                type: 'text',
                name: 'API Key',
                tooltip: 'Log into your Freshdesk account and find <i>Your API Key</i> in Profile settings page.'
            }
        },
        accountNameFromProfileInfo: 'contact.email',
        requestProfileInfo: async (context) => {
            return context.httpRequest({
                method: 'GET',
                url: `${freshdeskOrigin(context.domain)}/api/v2/agents/me`,
                auth: {
                    user: context.apiKey,
                    password: 'X'
                }
            });
        },
        validate: async context => {
            const credentials = `${context.apiKey}:X`;
            const encoded = Buffer.from(credentials).toString('base64');
            await context.httpRequest({
                method: 'GET',
                url: `${freshdeskOrigin(context.domain)}/api/v2/agents/me`,
                headers: {
                    'Authorization': `Basic ${encoded}`
                }
            });
            return true;
        }
    }
};
