module.exports = {
    type: 'oauth2',
    definition: () => ({
        clientId: 'your-client-id',
        clientSecret: 'your-client-secret',
        scope: ['profile', 'email'],

        // Extract account info from profile
        accountNameFromProfileInfo: (context) => context.profileInfo.email,
        emailFromProfileInfo: (context) => context.profileInfo.email,

        // Authorization URL
        authUrl: (context) => {
            const params = new URLSearchParams({
                client_id: 'your-client-id',
                redirect_uri: context.callbackUrl,
                response_type: 'code',
                scope: context.scope.join(' '),
                state: context.ticket,
                access_type: 'offline'
            });
            return `https://service.com/oauth/authorize?${params}`;
        },

        // Exchange authorization code for access token
        requestAccessToken: async (context) => {
            const response = await context.httpRequest({
                method: 'POST',
                url: 'https://service.com/oauth/token',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                data: {
                    code: context.authorizationCode,
                    client_id: 'your-client-id',
                    client_secret: 'your-client-secret',
                    redirect_uri: context.callbackUrl,
                    grant_type: 'authorization_code'
                }
            });

            return {
                accessToken: response.data.access_token,
                accessTokenExpDate: new Date(Date.now() + response.data.expires_in * 1000),
                refreshToken: response.data.refresh_token
            };
        },

        // Get user profile
        requestProfileInfo: async (context) => {
            const response = await context.httpRequest({
                method: 'GET',
                url: 'https://service.com/api/v1/userinfo',
                headers: { Authorization: `Bearer ${context.accessToken}` }
            });
            return response.data;
        },

        // Refresh expired access token
        refreshAccessToken: async (context) => {
            const response = await context.httpRequest({
                method: 'POST',
                url: 'https://service.com/oauth/token',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                data: {
                    client_id: 'your-client-id',
                    client_secret: 'your-client-secret',
                    refresh_token: context.refreshToken,
                    grant_type: 'refresh_token'
                }
            });

            return {
                accessToken: response.data.access_token,
                accessTokenExpDate: new Date(Date.now() + response.data.expires_in * 1000)
            };
        },

        // Validate access token
        validateAccessToken: async (context) => {
            const response = await context.httpRequest({
                method: 'GET',
                url: 'https://service.com/api/v1/tokeninfo',
                params: { access_token: context.accessToken }
            });
            return !!response.data.expires_in;
        }
    })
};
