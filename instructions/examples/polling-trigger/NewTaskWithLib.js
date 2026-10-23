'use strict';
const lib = require('../../lib');

module.exports = {

    async tick(context) {

        const { projectId } = context.properties;

        const { data } = await context.httpRequest({
            method: 'GET',
            url: `https://api.service.com/projects/${projectId}/tasks`,
            params: { sort: 'created_at', order: 'desc' },
            headers: {
                'Authorization': `Bearer ${context.auth.accessToken}`
            }
        });

        // Use lib helper for state comparison
        const known = Array.isArray(context.state.known) ? new Set(context.state.known) : null;
        // A degraded answer (partial, or empty while tasks are known) must not become the state:
        // the next tick would fire the whole page again
        if (data.incomplete || (known?.size && !data.tasks.length)) {
            return;
        }
        const { diff, actual } = lib.getNewItems(known, data.tasks, 'id');
        // An unseen task no newer than the floor was pulled onto a truncated page, it is not new
        const { floor } = context.state;
        const newTasks = diff.filter(task => !floor || task.created_at > floor);

        if (newTasks.length) {
            await Promise.all(newTasks.map(task => context.sendJson(task, 'out')));
        }

        const oldest = data.tasks[data.tasks.length - 1];
        await context.saveState({
            known: actual,
            floor: oldest && data.total > data.tasks.length ? oldest.created_at : null
        });
    }
};
