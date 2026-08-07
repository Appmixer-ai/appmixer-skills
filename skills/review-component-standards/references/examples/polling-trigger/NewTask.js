'use strict';

module.exports = {

    async tick(context) {

        const { projectId } = context.properties;

        // Fetch items from API
        const { data } = await context.httpRequest({
            method: 'GET',
            url: `https://api.service.com/projects/${projectId}/tasks`,
            headers: {
                'Authorization': `Bearer ${context.auth.accessToken}`
            }
        });

        // Load previously known items from state
        const state = await context.loadState();
        const known = state.known ? new Set(state.known) : null;

        // Find new items by comparing with known items
        const tasks = data.tasks || [];
        const newItems = [];
        const actual = [];

        for (const task of tasks) {
            actual.push(task.id);
            if (known && !known.has(task.id)) {
                newItems.push(task);
            }
        }

        // Send new items to output port
        for (const item of newItems) {
            await context.sendJson(item, 'out');
        }

        // Save current state for next tick
        await context.saveState({ known: actual });
    }
};
