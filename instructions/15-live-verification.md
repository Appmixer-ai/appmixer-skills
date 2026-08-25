# Live Verification (`appmixer connector verify`)

`connector validate` proves the connector agrees with our conventions from the
source alone. **`connector verify` proves the source tells the truth about the
service's API** — it executes the connector's behavior files locally
(`require()` + `receive()`, no engine) against the real API. Both of its
checks exist because real bugs shipped with every static gate green: a field
Create Patient accepted that the Patient schema never declared (`medicare`),
and a select whose labels were inverted against the service (`type_code` —
picking "Doctor" created a Standard contact).

## When to run it

After the CLI component test loop passes and before E2E flows. It reuses the
credentials already stored by `appmixer test auth login` (configstore key
`appmixer:<connector>`), so once component testing is set up, verify costs one
command:

```bash
appmixer connector verify <connector>              # schema conformance, read-only
appmixer connector verify <connector> --write      # + enum round-trips (creates records!)
appmixer connector verify <connector> --record     # save sanitized output shapes to artifacts/samples/
appmixer connector verify <connector> --offline    # re-check conformance from samples, no credentials (CI)
appmixer connector verify <c> --auth auth.json     # explicit credentials ({"apiKey": "..."})
```

Exit 0 = no fail/error findings; 1 otherwise.

## The checks and what findings mean

**schema-conformance** — declared outPort contract vs the live payload, for
every List/Find/Get component:

| Finding | Meaning | Action |
|---|---|---|
| FAIL: declared but absent | dead entry in the designer's variable picker | remove the field or fix the mapping |
| WARN: returned but undeclared | data no flow can reach | candidates to declare (link stubs like `links`/relations are expected noise — `expandIds` output is what counts) |
| SKIP: no data in the account | nothing to compare against | seed one record, or accept the gap |

**enum-roundtrip** (`--write` only) — for a `select` input: create a record per
option, read back the stored value AND **the service's own label for it**. The
label comparison is the point — an inverted label/value map round-trips values
perfectly, so value equality alone cannot catch it.

## Authoring `artifacts/verify.json`

Lives with the connector's other non-runtime assets. **Account-agnostic by
rule**: recipes, never concrete IDs — the same file must work on any tenant.

```json
{
  "fixtures": {
    "businessId": { "from": "ListBusinesses", "path": "id" }
  },
  "read": [
    { "component": "FindAvailableTimes", "inputs": { "businessId": "{businessId}" } }
  ],
  "roundtrip": [ {
    "component": "CreateContact", "input": "typeCode",
    "base": { "lastName": "Verify Roundtrip" },
    "valueField": "type_code", "labelField": "type",
    "cleanup": { "component": "MakeApiCall",
                 "inputs": { "url": "/contacts/{id}/archive", "method": "POST" } }
  } ]
}
```

- `fixtures` resolve lazily in declaration order against the connector's own
  List/Find components; `{name}` placeholders fill inputs.
- `read` defaults (without the file) to every List/Find/Get component with no
  required inputs — verify gives signal at zero configuration.
- `roundtrip` REQUIRES a `cleanup` recipe. It runs per created record even
  when the check fails, through the connector's own components — `MakeApiCall`
  covers services with no delete action. Verify must leave the account clean.
- Write a roundtrip spec for every `select` input whose values the service
  echoes back (a `valueField`, ideally also a `labelField`).

## Recorded samples (`artifacts/samples/`)

`--record` saves each read component's output SHAPE with every value replaced
by a type placeholder — live payloads carry PII (patient names, emails) and
none of it may reach the repo; the sanitizer guarantees no original value
survives. Commit the samples: `--offline` then re-checks conformance against
them with no credentials at all, which is the CI leg. Re-record whenever the
service adds fields or a component's mapping changes. Samples capture the
COMPONENT's output (after `expandIds` etc.), not the raw API response — that
is the contract flows actually see.

## Pitfalls

- `--write` creates real records — never run it against a production tenant.
- OAuth connectors work while the stored token is fresh (verify does not
  refresh); API-key connectors are fully supported.
- Roundtrip needs the entity to be retrievable (a Get/Find/List sibling) and
  the create to echo the stored entity; operations merely named `Create*`
  (transcriptions, embeddings) are not roundtrip material.
- Only request/response components run under verify — triggers and webhooks
  belong to E2E flows, not here.
