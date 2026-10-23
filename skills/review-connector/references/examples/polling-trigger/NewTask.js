'use strict';

module.exports = {

    async tick(context) {

        const { projectId } = context.properties;

        // Fetch items from API, newest first
        const { data } = await context.httpRequest({
            method: 'GET',
            url: `https://api.service.com/projects/${projectId}/tasks`,
            params: { sort: 'created_at', order: 'desc' },
            headers: {
                'Authorization': `Bearer ${context.auth.accessToken}`
            }
        });

        // Load previously known items from state
        const state = await context.loadState();
        const known = state.known ? new Set(state.known) : null;
        const { floor } = state;
        const tasks = data.tasks || [];

        // A degraded answer (partial, or empty while tasks are known) must not become the state:
        // the next tick would fire the whole page again
        if (data.incomplete || (known?.size && !tasks.length)) {
            return;
        }

        // Find new items by comparing with known items
        const newItems = [];
        const actual = [];

        for (const task of tasks) {
            actual.push(task.id);
            // An unseen task no newer than the floor was pulled onto a truncated page, it is not new
            if (known && !known.has(task.id) && (!floor || task.created_at > floor)) {
                newItems.push(task);
            }
        }

        // Send new items to output port
        for (const item of newItems) {
            await context.sendJson(item, 'out');
        }

        // Save current state for next tick; floor only when there are more tasks than were read
        const oldest = tasks[tasks.length - 1];
        await context.saveState({
            known: actual,
            floor: oldest && data.total > tasks.length ? oldest.created_at : null
        });
    }
};
