'use strict';

const lib = require('../../lib');

// schema of the single item
const schema = {
    'id': { 'type': 'string', 'title': 'Task Id' },
    'name': { 'type': 'string', 'title': 'Name' },
    'status': { 'type': 'string', 'title': 'Status' }
};

module.exports = {
    async receive(context) {
        const { searchQuery, outputType } = context.messages.in.content;

        if (context.properties.generateOutputPortOptions) {
            return lib.getOutputPortOptions(context, outputType, schema, { label: 'Tasks', value: 'tasks' });
        }

        // any required inputs validation can be done here

        let url = 'https://api.service.com/tasks';
        const params = {};

        if (searchQuery) {
            params.q = searchQuery;
        }

        const { data } = await context.httpRequest({
            method: 'GET',
            url,
            headers: {
                'Authorization': `Bearer ${context.auth.accessToken}`
            },
            params
        });

        const tasks = data.tasks || [];

        if (tasks.length === 0) {
            return context.sendJson({}, 'notFound');
        }

        return lib.sendArrayOutput({ context, records: tasks, outputType });
    }
};
