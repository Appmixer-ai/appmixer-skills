'use strict';

const crypto = require('crypto');

// The webhook URL is public. The service does not sign its calls, so each registration sends a
// random secret in a header, the trigger keeps it in its state and ignores calls without it.
// When the service signs its calls (HMAC over the body), verify that signature instead.
const SECRET_HEADER = 'x-appmixer-webhook-secret';

const isAuthentic = (context) => {

    const expected = context.state && context.state.secret;
    const headers = context.messages.webhook.content.headers || {};
    const name = Object.keys(headers).find(key => key.toLowerCase() === SECRET_HEADER);
    const received = name ? headers[name] : undefined;
    if (typeof expected !== 'string' || !expected || typeof received !== 'string') {
        return false;
    }
    const a = Buffer.from(received);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
};

module.exports = {

    async start(context) {

        // Register webhook with external service when flow starts
        const webhookUrl = context.getWebhookUrl();
        const { listId } = context.properties;
        const secret = crypto.randomBytes(32).toString('hex');

        const { data } = await context.httpRequest({
            method: 'POST',
            url: 'https://api.service.com/webhooks',
            headers: {
                'Authorization': `Bearer ${context.auth.accessToken}`
            },
            data: {
                url: webhookUrl,
                events: ['contact.updated'],
                listId: listId,
                headers: { [SECRET_HEADER]: secret }
            }
        });

        // Save webhook ID for cleanup and the secret for receive()
        return context.saveState({ webhookId: data.id, secret });
    },

    async receive(context) {

        // Handle incoming webhook payload
        if (context.messages.webhook) {
            // Fail closed: verify before any API request or emit.
            if (!isAuthentic(context)) {
                await context.log({ step: 'Ignored a webhook call without the registration secret.' });
                return context.response({ error: 'Forbidden' }, 403);
            }

            const payload = context.messages.webhook.content.data;

            // Optionally fetch additional data from API
            const { data } = await context.httpRequest({
                method: 'GET',
                url: `https://api.service.com/contacts/${payload.contactId}`,
                headers: {
                    'Authorization': `Bearer ${context.auth.accessToken}`
                }
            });

            await context.sendJson(data, 'out');

            // IMPORTANT: Always return context.response() to acknowledge webhook
            return context.response();
        }
    },

    async stop(context) {

        // Clean up: unregister webhook when flow stops
        const { webhookId } = await context.loadState();

        if (webhookId) {
            await context.httpRequest({
                method: 'DELETE',
                url: `https://api.service.com/webhooks/${webhookId}`,
                headers: {
                    'Authorization': `Bearer ${context.auth.accessToken}`
                }
            });
        }
    }
};
