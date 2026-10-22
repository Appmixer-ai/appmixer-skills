'use strict';

module.exports = async context => {

    // Runs every time a trigger calls context.addListener().
    // Use it to validate params, transform them, or perform per-subscription
    // setup against the upstream API.
    context.onListenerAdded(async listener => {
        // listener.eventName, listener.params  — mutable
        // throw to reject the subscription
        // Resolve the tenant the subscription belongs to (e.g. via the upstream
        // "who am I" call with the listener's token) and store it on the params:
        // listener.params.tenantId = ...
    });

    context.http.router.register({
        method: 'POST',
        path: '/events',                        // → /plugins/<vendor>/<service>/events
        options: {
            auth: false,
            handler: async (req, h) => {
                if (!isValidSignature(context, req)) {
                    return h.response(undefined).code(401);
                }

                // Optional verification handshake (GET hub.challenge etc.)
                if (req.payload?.challenge) {
                    return { challenge: req.payload.challenge };
                }

                // One endpoint serves every tenant that installed the app: scope each
                // event to its tenant (here by filter, or put the tenant id into the
                // event name). No tenant id = deliver nothing, never to everyone.
                const tenantId = extractTenantId(req.payload);
                if (!tenantId) {
                    context.log('error', 'plugin-route-event-without-tenant', { payload: req.payload });
                    return {};
                }

                await context.triggerListeners({
                    eventName: extractEventName(req.payload),
                    payload: extractEventBody(req.payload),
                    // listener.params.tenantId is resolved in onListenerAdded above
                    filter: listener => listener.params?.tenantId === tenantId
                });
                return {};
            }
        }
    });
};
