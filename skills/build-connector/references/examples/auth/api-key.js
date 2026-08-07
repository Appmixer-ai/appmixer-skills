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
                url: `https://${context.domain}.service.com/api/v1/me`,
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
                url: `https://${context.domain}.service.com/api/v1/me`,
                headers: {
                    'Authorization': `Basic ${encoded}`
                }
            });

            return true; // If request succeeds, credentials are valid
        }
    }
};
