# Part 1: Connectors

## Overview

Connectors are integrations with external services. Each connector contains authentication logic, service metadata, and one or more components that perform specific actions.

## Connector Structure

```
connector_name/
├── service.json       # Service metadata and description
├── auth.js           # Authentication configuration
├── bundle.json       # Bundle metadata and changelog
├── package.json      # Dependencies (optional)
├── quota.js          # Rate limiting rules (optional)
├── artifacts/
│   └── api-sources.json   # Where the vendor documents the API (required for a new connector)
└── core/             # Default module for components
    ├── ComponentName/
    │   ├── ComponentName.js    # Component behavior/logic
    │   └── component.json      # Component configuration
    └── AnotherComponent/
        ├── AnotherComponent.js
        └── component.json
```

**Documentation**: https://docs.appmixer.com/building-connectors/example-component#component-behaviour-sms-sendsms-sendsms.js

## Core Configuration Files

### package.json (Optional)

Optional file that contains dependencies.

### service.json

Describes the connector service and its metadata.

**Example**:
```json
{
    "name": "appmixer.connectorname",
    "label": "Connector Display Name",
    "category": "applications",
    "description": "Description of what this connector does",
    "version": "1.0.0",
    "icon": "https://example.com/icon.svg"
}
```

**JSON Schema**:
```json
{
    "type": "object",
    "description": "Service JSON file, used to describe the service",
    "properties": {
        "name": {
            "type": "string",
            "description": "The name of the service, lower case, use the `appmixer.${CONNECTOR_NAME}` format "
        },
        "label": {
            "type": "string",
            "description": "The label of the service"
        },
        "category": {
            "type": "string",
            "description": "use default value 'applications'"
        },
        "description": {
            "type": "string",
            "description": "Description of the service, used in the UI to describe the connector."
        },
        "version": {
            "type": "string",
            "description": "Semantic version (e.g., 1.0.0)"
        },
        "icon": {
            "type": "string",
            "description": "SVG icon of the application, as a data:image/svg+xml URI"
        }
    }
}
```

### Icons must be SVG

`service.json` and every `component.json` carry an `icon` as a
`data:image/svg+xml;base64,…` URI. A PNG or JPEG data URI fails the
`component-icon-svg` validator — it is not a style preference, it is a gate.

When the brand only publishes raster art, trace it instead of shipping the
raster or drawing an approximation by hand:

```bash
# 1. split the image into masks: the background, and the glyph inside it
#    (flood-fill from the border to find "outside", glyph = inside AND light)
# 2. trace each mask
potrace -s -o glyph.svg --flat -O 0.4 glyph.pbm
# 3. compose: background path/rect + glyph path, viewBox matching the source
```

**Verify numerically, never by eye** — render the SVG, threshold both images and
compare: mismatch ratio and bounding box. Eyeballing a side-by-side whose panels
sit on different backgrounds reliably produces false "it is distorted" calls.
A good trace lands near 0.1 % mismatched pixels with an identical bounding box.
On macOS `qlmanage -t -s <size> -o <dir> icon.svg` renders faithfully;
ImageMagick's built-in SVG renderer does not.

### bundle.json

Contains bundle metadata and version history.

**Example**:
```json
{
    "name": "appmixer.connectorname",
    "version": "1.0.0",
    "changelog": {
        "1.0.0": ["Initial release."],
        "1.0.1": ["Bug fixes and improvements."],
        "2.0.0": ["(breaking change) Updated API integration."]
    }
}
```

**JSON Schema**:
```json
{
    "type": "object",
    "properties": {
        "name": {
            "type": "string",
            "description": "The name of the bundle, lower case, use the `appmixer.${CONNECTOR_NAME}` format. This is the same as the name in service.json file."
        },
        "version": {
            "type": "string",
            "description": "The version of the bundle, use 1.0.0 by default"
        },
        "changelog": {
            "type": "object",
            "description": "The changelog of the bundle, used to describe the changes in the bundle. For example: {\n        \"1.0.4\": [\n            \"Initial release.\"\n        ],\n        \"1.0.5\": [\n            \"Renamed output variable name in ListBases from Array to Bases and in ListTables from Array to Tables.\"\n        ],\n        \"2.0.1\": [\n            \"(breaking change) Fixed output schema for ListTables and ListBases.\"\n        ]"
        }
    },
    "required": ["name", "version", "changelog"]
}
```

**IMPORTANT - Single Version Rule**: For unreleased connectors (new connectors being developed), the bundle.json must have only ONE version entry (typically 1.0.0). Do NOT pre-create multiple version entries (e.g., 1.0.0, 1.1.0, 1.2.0) before the connector is released. New versions should only be added when actual releases occur, not during initial development.

### quota.js

Defines rate limiting rules to prevent API quota violations.

**Example**:
```javascript
module.exports = {
    rules: [
        {
            limit: 2000,                          // Max calls per window
            throttling: 'window-sliding',         // Throttling method
            window: 1000 * 60 * 60 * 24,          // 24 hours in ms
            scope: 'userId',                      // Per user limits
            resource: 'messages.send'             // Resource identifier
        },
        {
            limit: 3,
            window: 1000,                         // 1 second
            throttling: 'window-sliding',
            queueing: 'fifo',
            resource: 'messages.send',
            scope: 'userId'
        }
    ]
};
```

**Rule Properties**:
- **limit**: Maximum number of calls in the time window specified by window.
- **window**: The time window in milliseconds.
- **throttling**: The throttling mechanism. Can be either a string 'window-sliding' or an object with type and getStartOfNextWindow function.
- **resource**: An identifier of the resource to which the rule applies. This can be referenced in component manifests in the quota.resources section.

---
### artifacts/api-sources.json

Where the vendor documents the API the connector wraps. A scheduled check reads this
file to notice API changes (a deprecated endpoint, a new version, a changed auth
flow), so the links must be the vendor's own pages and must live with the connector,
not only in the issue that asked for it.

```json
{
    "apiReference": "https://developers.example.com/api/reference",
    "authDocs": "https://developers.example.com/api/authentication",
    "changelog": "https://developers.example.com/changelog",
    "openApi": "https://developers.example.com/openapi.json",
    "baseUrl": "https://api.example.com/v2",
    "apiVersion": "v2",
    "checkedAt": "2026-11-11"
}
```

- `apiReference` (required): the API reference you built the components from.
- `authDocs`: the page that describes the authentication you implemented in `auth.js`.
- `changelog`: the vendor's API changelog, release notes or deprecation page (an RSS or
  Atom feed if there is one). `null` when the vendor publishes none.
- `openApi`: a URL of a machine-readable spec (OpenAPI/Swagger JSON or YAML, a GraphQL
  schema, a Postman collection). `null` when there is none. This is the best source
  for a change check, so look for it.
- `baseUrl`, `apiVersion`: what the components call. `apiVersion` is `null` for an
  unversioned API.
- `checkedAt`: the day you last read these pages (`YYYY-MM-DD`).

Rules:

- Only URLs you opened while building. Never a guessed URL, never a competitor's or a
  third party's page about the API.
- The file sits in the connector's `artifacts/` folder, next to `test-flows/`:
  `src/<vendor>/<connector>/artifacts/api-sources.json`. A vendor folder whose modules
  wrap different APIs (`google/gmail`, `google/drive`) keeps one file at the vendor
  level with the shared fields at the top and a `modules` map for what differs:
  `"modules": { "gmail": { "apiReference": "...", "openApi": "..." } }`.
- When the issue you build from carries these links (the Connector research flow
  writes an `api-sources` block into its issues), verify them and copy them.
- When you add components to a connector that has no `api-sources.json`, create it.
  When it exists and you read the docs again, update `checkedAt` and whatever changed.

