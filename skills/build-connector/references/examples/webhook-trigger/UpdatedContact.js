'use strict';

module.exports = {

    async start(context) {

        // Register webhook with external service when flow starts
        const webhookUrl = context.getWebhookUrl();
        const { listId } = context.properties;

        const { data } = await context.httpRequest({
            method: 'POST',
            url: 'https://api.service.com/webhooks',
            headers: {
                'Authorization': `Bearer ${context.auth.accessToken}`
            },
            data: {
                url: webhookUrl,
                events: ['contact.updated'],
                listId: listId
            }
        });

        // Save webhook ID for cleanup
        return context.saveState({ webhookId: data.id });
    },

    async receive(context) {

        // Handle incoming webhook payload
        if (context.messages.webhook) {
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
