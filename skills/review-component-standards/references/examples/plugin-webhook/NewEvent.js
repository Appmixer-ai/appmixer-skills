'use strict';

module.exports = {

    async start(context) {

        // (Optional) Upstream-side per-subscription setup. Mandatory only if
        // the upstream needs to know "this user wants events" — e.g. Meta's
        // POST /{waba-id}/subscribed_apps.

        await context.addListener(`channel:${context.properties.channelId}`, {
            userId: context.profileInfo.userId,
            accessToken: context.auth.accessToken
        });
    },

    async stop(context) {
        await context.removeListener(`channel:${context.properties.channelId}`);
    },

    async receive(context) {
        if (!context.messages.webhook) return;
        const data = context.messages.webhook.content.data;     // payload passed in via triggerListeners
        await context.sendJson(data, 'out');
    }
};
