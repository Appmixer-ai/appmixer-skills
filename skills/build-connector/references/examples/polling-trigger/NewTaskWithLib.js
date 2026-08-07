'use strict';
const lib = require('../../lib');

module.exports = {

    async tick(context) {

        const { projectId } = context.properties;

        const { data } = await context.httpRequest({
            method: 'GET',
            url: `https://api.service.com/projects/${projectId}/tasks`,
            headers: {
                'Authorization': `Bearer ${context.auth.accessToken}`
            }
        });

        // Use lib helper for state comparison
        const known = Array.isArray(context.state.known) ? new Set(context.state.known) : null;
        const { diff, actual } = lib.getNewItems(known, data.tasks, 'id');

        if (diff.length) {
            await Promise.all(diff.map(task => context.sendJson(task, 'out')));
        }

        await context.saveState({ known: actual });
    }
};
