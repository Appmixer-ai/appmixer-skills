# Part 2: Authentication

## Overview

Appmixer supports multiple authentication methods. The `auth.js` file defines how users authenticate with the external service.

## Authentication Types

### API Key Authentication

For services that use API keys or tokens.

**Generic Example**:
See [`examples/auth/api-key.js`](examples/auth/api-key.js).

**Real-World Example (Freshdesk)**:
See [`examples/auth/api-key-freshdesk.js`](examples/auth/api-key-freshdesk.js).

### Auth Fields That Become Part of the Request Host

A subdomain, instance, region or store field (`https://${context.domain}.service.com`)
puts user input into the host of a request that carries a credential: the API
key, the access token, and in `requestAccessToken` the **client secret of the
OAuth app**. Typed as `evil.example/x?`, the field sends that credential to
`evil.example`. Applies to API-key and OAuth connectors alike (appmixer-core#4752,
Zendesk).

- **Allowlist the value before building any URL.** A subdomain is
  `/^[a-z0-9][a-z0-9-]*$/i`; a region is one of a fixed list. Throw before the
  request, never after it.
- **Check it as typed, do not normalize it.** Components later build URLs from
  the stored `context.auth.<field>`. A value cleaned up at login but stored raw
  would pass the check in `auth.js` and still reach the components unchecked.
- **One helper for every request.** Put it in `lib.js` (`serviceOrigin()` in
  [`examples/auth/api-key.js`](examples/auth/api-key.js)) and call it from `auth.js`
  (`requestAccessToken`, `requestProfileInfo`, `validate`) and from every
  component, uploads included.
- **A full-URL field** (self-hosted instance) is parsed with the WHATWG `URL`
  parser: `https:` only, no username or password, and only `url.origin` is used,
  the same way MakeApiCall pins the origin (`07-component-types.md`).
- **Test it:** with an invalid value, no request is made at all. Record the
  requests in a mocked `context.httpRequest` and assert that none was made.

### OAuth 2.0 Authentication

For services using OAuth 2.0 flow.

> ⚠️ **Breaking Change Warning — OAuth Scopes**
>
> Adding new OAuth scopes to an existing connector is a **breaking change**. Existing users will need to re-authenticate to grant the new permissions. This must be reflected in the connector's `bundle.json`:
> - Bump the **major** version (e.g. `2.2.0` → `3.0.0`)
> - Document the scope change clearly in the changelog entry
> - Include a note in the PR description warning reviewers that existing users will be asked to re-authenticate
>
> Example `bundle.json` changelog entry:
> ```json
> "3.0.0": [
>     "BREAKING: Added w_organization_social OAuth scope to support posting as an organization page. Existing users must re-authenticate."
> ]
> ```

#### Simplified URL-Based Format

For services with standard OAuth 2.0 endpoints, you can use a simplified URL-based format where URLs are provided as strings instead of functions:

**Example (ClickUp)**:
```javascript
module.exports = {
    type: 'oauth2',

    definition: () => {
        return {
            scope: [],

            authUrl: 'https://app.clickup.com/api',

            requestAccessToken: 'https://api.clickup.com/api/v2/oauth/token',

            requestProfileInfo: 'https://api.clickup.com/api/v2/user',

            accountNameFromProfileInfo: 'user.username',

            validateAccessToken: 'https://api.clickup.com/api/v2/user'
        };
    }
};
```

**Key Differences from Function-Based Format**:
- `authUrl`: String URL instead of function - Appmixer handles OAuth parameters automatically
- `requestAccessToken`: String URL instead of async function - Appmixer handles the token exchange
- `requestProfileInfo`: String URL instead of async function - Appmixer makes GET request with Bearer token
- `accountNameFromProfileInfo`: Dot-notation path to extract account name from profile response (e.g., `'user.username'`)
- `validateAccessToken`: String URL instead of async function - Appmixer makes GET request to validate token

This format is simpler and works when the service follows standard OAuth 2.0 conventions. Use the function-based format (below) when you need custom logic for token handling or non-standard endpoints.

#### Function-Based Format

For services that require custom OAuth logic or have non-standard endpoints:

**Generic Example**:
See [`examples/auth/oauth2-generic.js`](examples/auth/oauth2-generic.js).

**Real-World Example (Google OAuth2)**:
See [`examples/auth/oauth2-google.js`](examples/auth/oauth2-google.js).

---
