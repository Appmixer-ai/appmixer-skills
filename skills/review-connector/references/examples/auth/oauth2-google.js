module.exports = {
    type: 'oauth2',
    definition: () => {
        return {
            clientId: initData.clientId,
            clientSecret: initData.clientSecret,
            scope: ['profile', 'email'],

            accountNameFromProfileInfo: function(context) {
                return context.profileInfo.email;
            },

            emailFromProfileInfo: function(context) {
                return context.profileInfo.email;
            },

            authUrl: function(context) {
                const params = new URLSearchParams({
                    client_id: initData.clientId,
                    redirect_uri: context.callbackUrl,
                    response_type: 'code',
                    scope: context.scope.join(' '),
                    state: context.ticket,
                    access_type: 'offline',
                    approval_prompt: 'force'
                }).toString();

                return `https://accounts.google.com/o/oauth2/auth?${params}`;
            },

            requestAccessToken: async function(context) {
                const data = {
                    code: context.authorizationCode,
                    client_id: initData.clientId,
                    client_secret: initData.clientSecret,
                    redirect_uri: context.callbackUrl,
                    grant_type: 'authorization_code'
                };

                const response = await context.httpRequest({
                    method: 'POST',
                    url: 'https://oauth2.googleapis.com/token',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    data
                });

                return {
                    accessToken: response.data.access_token,
                    accessTokenExpDate: new Date(Date.now() + response.data.expires_in * 1000),
                    refreshToken: response.data.refresh_token
                };
            },

            requestProfileInfo: async function(context) {
                const response = await context.httpRequest({
                    method: 'GET',
                    url: 'https://www.googleapis.com/oauth2/v2/userinfo',
                    headers: {
                        Authorization: `Bearer ${context.accessToken}`
                    }
                });

                if (!response.data) {
                    throw new Error('Failed to retrieve profile info');
                }

                return response.data;
            },

            refreshAccessToken: async function(context) {
                const data = {
                    client_id: initData.clientId,
                    client_secret: initData.clientSecret,
                    refresh_token: context.refreshToken,
                    grant_type: 'refresh_token'
                };

                const response = await context.httpRequest({
                    method: 'POST',
                    url: 'https://oauth2.googleapis.com/token',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    data
                });

                return {
                    accessToken: response.data.access_token,
                    accessTokenExpDate: new Date(Date.now() + response.data.expires_in * 1000)
                };
            },

            validateAccessToken: async function(context) {
                const response = await context.httpRequest({
                    method: 'GET',
                    url: 'https://www.googleapis.com/oauth2/v2/tokeninfo',
                    params: {
                        access_token: context.accessToken
                    }
                });

                if (response.data.expires_in) {
                    return !!response.data.expires_in;
                }

                return false;
            }
        };
    }
};
