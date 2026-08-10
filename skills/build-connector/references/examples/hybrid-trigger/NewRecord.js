'use strict';

module.exports = {

    async start(context) {

        const { id, expirationTime } = await registerWebhook(context);

        return context.saveState({
            webhookId: id,
            expirationTime: Date.parse(expirationTime)
        });
    },

    async receive(context) {

        if (context.messages.webhook) {
            const payload = context.messages.webhook.content.data;
            await context.sendJson(payload, 'out');
            return context.response();
        }
    },

    async tick(context) {

        // Use tick to refresh webhook before expiration
        let lock;
        try {
            lock = await context.lock(context.componentId);
            const state = await context.loadState();
            const { webhookId, expirationTime } = state;

            if (!webhookId) return;

            // Refresh 3 days before expiration
            const renewDate = expirationTime - (3 * 24 * 60 * 60 * 1000);
            const now = Date.now();

            if (now >= renewDate) {
                const { data } = await context.httpRequest({
                    method: 'POST',
                    url: `https://api.service.com/webhooks/${webhookId}/refresh`,
                    headers: {
                        'Authorization': `Bearer ${context.auth.accessToken}`
                    }
                });
                state.expirationTime = Date.parse(data.expirationTime);
                await context.saveState(state);
            }
        } finally {
            if (lock) await lock.unlock();
        }
    },

    async stop(context) {

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
