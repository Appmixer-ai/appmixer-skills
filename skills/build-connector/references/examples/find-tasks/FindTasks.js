'use strict';

const lib = require('../../lib');

// The output contract of ONE item. Exported as ITEM_SCHEMA because this port is
// dynamic: component.json declares no schema for it, so this is the only place the
// contract exists. `required` lists what the API ALWAYS returns — everything else is
// optional, and `appmixer connector verify` reports an absent optional leaf as a
// warning instead of a dead variable-picker entry.
// Must be declared ABOVE module.exports: naming it in the exports object while the
// const sits below throws "Cannot access 'ITEM_SCHEMA' before initialization".
const ITEM_SCHEMA = {
    type: 'object',
    required: ['id', 'name'],
    properties: {
        id: { type: 'string', title: 'Task Id', example: '1001' },
        name: { type: 'string', title: 'Name', example: 'Buy groceries' },
        status: { type: 'string', title: 'Status', example: 'open' }
    }
};

module.exports = {

    ITEM_SCHEMA,

    async receive(context) {
        const { searchQuery, outputType } = context.messages.in.content;

        if (context.properties.generateOutputPortOptions) {
            // The helper takes the property map, not the whole schema.
            return lib.getOutputPortOptions(context, outputType, ITEM_SCHEMA.properties, { label: 'Tasks', value: 'tasks' });
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
