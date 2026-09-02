# Part 8: Best Practices

## Code Style

- Use 4 spaces for indentation
- Add one empty line after function definitions (including `receive`)
- Use camelCase for variable names in JavaScript behavior files (destructure with aliases if needed)
- Remove all unused variables and imports. If a property is not needed in the behavior logic, do not include it in component.json.
- Property names in component.json must exactly match those used in `context.messages.in.content`
- Property names in component.json must NEVER use a pipe `|`. **New input** property names should be camelCase (no underscore `_`). Existing snake_case inputs are fine and must NOT be renamed — that is a breaking change for connector users (input re-binding). Enforced on changed/new inputs by the `input-property-naming` validator (`appmixer connector validate --changed`).

  ```
  // component.json - WRONG
  "properties": {
    "lock|type": { "type": "string" },      // WRONG - uses pipe |
    "lock|expires_at": { "type": "string" } // WRONG - uses pipe |
  }

  // component.json - CORRECT (new inputs: camelCase)
  "properties": {
    "lockType": { "type": "string" },
    "lockExpiresAt": { "type": "string" }
  }

  // Behavior file - camelCase variables. If component.json uses (legacy)
  // snake_case, destructure with aliases:
  const {
    lock_type: lockType,
    lock_expires_at: lockExpiresAt
  } = context.messages.in.content;

  // If component.json uses camelCase, destructure directly:
  const { lockType, lockExpiresAt } = context.messages.in.content;
  ```

## auth.js Requirements

`auth.js` file with type `apiKey` MUST follow these rules:
- `requestProfileInfo` MUST return either:
    - An object with just the obfuscated apiKey (if profile info is not available via API) or
    - An object with the profile info

**Adding an OAuth scope to an existing connector is a breaking change** —
every existing user has to re-authenticate. Bump `bundle.json` to the next
major version, prefix the changelog entry with `BREAKING:`, and say in the PR
description that users must re-authenticate (example entry in
"OAuth 2.0 Authentication", `02-authentication.md`).

## Component Behavior (JavaScript) Requirements

Behavior JS file MUST follow these rules:
- Every required input in the component.json must be also asserted in the behavior file
- If a required input is missing, throw exception: `throw new context.CancelError('<human_readable_input_name> is required!')`
- Delete components must return an empty object, e.g., `return context.sendJson({}, 'out');` at the end of the function

## component.json Requirements

`component.json` file MUST follow these rules:
- Delete components must have `outPorts: ['out']`
- Update or delete components must have at least one required input, which is the ID of the entity being updated or deleted
- Find and List components must NOT include `limit` or `offset` inputs — pagination is handled internally with the maximum page size (see "Find (Items) Components" in `07-component-types.md`)
- **Unnecessary input fields**: do not create select fields with only one option. If a value is constant, hardcode it in the behavior file instead of making it a user input.
- **Date/time inputs**: schema `"type": "string", "format": "date-time"` with inspector type `"date-time"` (date-only: `"format": "date"` + `config: { "enableTime": false }`). Do NOT use inspector type `"text"` for date/datetime fields. The full schema→inspector mapping is in "Type Mapping for Input Ports" (`05-component-config.md`).

  ```json
  {
    "schema": {
      "properties": {
        "expires_at": {
          "type": "string",
          "format": "date-time"
        }
      }
    },
    "inspector": {
      "inputs": {
        "expires_at": {
          "type": "date-time",
          "label": "Expires At"
        }
      }
    }
  }
  ```

## General Guidelines

- **Authentication**: Store sensitive data in auth configuration, not component code
- **Rate Limiting**: Use quota.js to prevent API abuse
- **Documentation**: Provide clear descriptions and tooltips for all fields

## Performance

- **Caching**: Cache frequently accessed data (e.g., user lists, configuration)
- **Pagination**: Handle large datasets with proper pagination
- **Locking**: Use locking mechanisms for shared resources
- **Batching**: Batch API calls when possible to reduce requests

### Cache TTL using staticCache

When caching data (e.g., folder structures, user lists, property definitions), use `context.staticCache` with a TTL (Time-To-Live) to ensure the cache is refreshed periodically:

```javascript
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

async tick(context) {
    const cacheKey = `myconnector_data_${context.componentId}`;
    let cachedData = await context.staticCache.get(cacheKey);

    if (!cachedData) {
        // Cache miss - fetch fresh data
        cachedData = await fetchData(context);
        // staticCache handles expiration automatically
        await context.staticCache.set(cacheKey, cachedData, CACHE_TTL_MS);
    }

    // ... rest of tick logic using cachedData
}
```

**Best practices for staticCache**:
- Use descriptive cache keys with connector name prefix (e.g., `hubspot_properties_contacts`)
- Include relevant identifiers in the key (e.g., user ID, folder ID) to avoid cache collisions
- Use TTL between 10-60 minutes depending on how frequently the data changes
- Combine with `context.lock()` when the fetch operation is expensive or fires in bursts — the lock-around-fetch shape is `callEndpointCached` in "Response caching" (`07-component-types.md`)

**Why staticCache is preferred over state-based caching**: `staticCache` provides built-in TTL support, handles expiration automatically, and is shared across component instances. State-based caching requires manual timestamp tracking and persists in the database unnecessarily.

### Locking for Long-Running Tick Operations

When a `tick()` function may take a long time to execute (e.g., fetching nested folder structures), use a lock to prevent concurrent execution:

```javascript
async tick(context) {
    let lock;
    try {
        lock = await context.lock(context.componentId, {
            ttl: 5 * 60 * 1000, // 5 minute lock TTL
            maxRetryCount: 0    // Don't wait, skip if already running
        });
    } catch (e) {
        // Another tick is already running, skip this one
        return;
    }

    try {
        // ... long-running tick logic
    } finally {
        lock?.unlock();
    }
}
```

**Why locking is important**: The Appmixer engine calls `tick()` at regular intervals (default: 60 seconds). If a tick operation takes longer than the interval, multiple concurrent tick executions can overwhelm external APIs and cause race conditions.

### Batching Recursive API Calls

When fetching hierarchical data (e.g., recursive folder structures), use batched concurrent requests instead of sequential recursive calls:

```javascript
// ❌ BAD: Sequential recursive calls - slow and can timeout
async function getSubfoldersRecursive(context, folderId, result = []) {
    const { data } = await context.httpRequest({ /* ... */ });
    for (const folder of data.files) {
        result.push(folder.id);
        await getSubfoldersRecursive(context, folder.id, result); // Sequential!
    }
    return result;
}

// ✅ GOOD: Batched breadth-first traversal - faster and more reliable
async function getSubfolders(context, rootFolderId) {
    const allFolderIds = [];
    let foldersToProcess = [rootFolderId];

    while (foldersToProcess.length > 0) {
        // Process in batches of 10 to avoid overwhelming the API
        const batch = foldersToProcess.splice(0, 10);

        const batchResults = await Promise.all(
            batch.map(parentId => context.httpRequest({ /* ... */ }))
        );

        for (const { data } of batchResults) {
            for (const folder of (data.files || [])) {
                allFolderIds.push(folder.id);
                foldersToProcess.push(folder.id);
            }
        }
    }

    return allFolderIds;
}
```

**Why batching is important**: Deep recursive folder structures with hundreds of subfolders can take minutes to traverse sequentially. Batched concurrent requests significantly reduce total execution time and are less likely to timeout.

## Common Patterns

### When Adding New Field to component.json

> Use-case: "I want to add a new number field `itemCount` to the `MyAwesomeComponent` component."

- Add the field to both `schema` and `inspector` sections in the `inPorts` array. Follow JSON schema format.
- Add the fields to behavior JS file, especially in `context.httpRequest` call.

### Dynamic Field Options

Use `source` property to populate field options dynamically. The field type is
`text` (typeahead), never `select` — see "Using `variableFetch` / `isSource`
for Dynamic Source Calls" in `07-component-types.md` for why:

```json
{
    "inspector": {
        "inputs": {
            "projectId": {
                "type": "text",
                "source": {
                    "url": "/component/appmixer/service/core/ListProjects?outPort=out",
                    "data": {
                        "transform": "./transformers#projectsToOptions"
                    }
                }
            }
        }
    }
}
```

### File Handling

#### file input components

```json
{
    "schema": {
        "properties": {
            "file": {
                "type": "string",
                "format": "data-url",
                "title": "File"
            }
        }
    },
    "inspector": {
        "inputs": {
            "file": {
                "type": "filepicker",
                "index": 1
            }
        }
    }
}
```

#### file output components
- use `context.saveFileStream()` in behavior JS
- must return `fileId` in output message
- should return additional info like `fileSize`, `prompt`, etc. — define these as fields in the `outPorts.schema.properties` (JSON Schema), each with a realistic `example`. See `05-component-config.md` § "Output Port Examples" for the canonical pattern.

Examples:

```javascript
const filename = `generated-image-${(new Date).toISOString()}.png`;
const file = await context.saveFileStream(filename, readStream);
return context.sendJson({ fileId: file.fileId, prompt, size }, 'out');
```
```javascript
const outFilename = filename || `${Date.now()}_elevenlabs_soundeffect`;
const file = await context.saveFileStream(outFilename, data);

return context.sendJson({ fileId: file.fileId, input: text, fileSize: file.length }, 'out');
```
