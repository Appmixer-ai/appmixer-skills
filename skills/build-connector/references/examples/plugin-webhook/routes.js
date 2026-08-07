'use strict';

module.exports = async context => {

    // Runs every time a trigger calls context.addListener().
    // Use it to validate params, transform them, or perform per-subscription
    // setup against the upstream API.
    context.onListenerAdded(async listener => {
        // listener.eventName, listener.params  — mutable
        // throw to reject the subscription
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

                // Parse the payload then dispatch per-listener.
                await context.triggerListeners({
                    eventName: extractEventName(req.payload),
                    payload: extractEventBody(req.payload),
                    filter: listener => listener.params.userId === extractUserId(req.payload)
                });
                return {};
            }
        }
    });
};
