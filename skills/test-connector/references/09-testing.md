# Testing Guidelines

### Unit Tests

- Use `mocha` for unit tests
- Place tests in `src/<vendor>/<connector_name>/artifacts/test/` directory (colocated with connector source)
- Use `assert` from Node.js for assertions
- Name test files with `.test.js` extension (e.g., `AIAgent.test.js`)

When working on a single connector, run its tests with mocha directly:

```bash
npx mocha src/<vendor>/<connector_name>/artifacts/test/*.test.js
```

(Workspaces may ship their own test runner script — e.g. the appmixer-connectors
repo's `npm run test-unit` discovers all `artifacts/test/` files — but plain
mocha works everywhere.)

### End-to-End (E2E) Test Flows

E2E test flows are automated workflow tests stored as `test-flow-*.json` files in the connector's `artifacts/test-flows/` directory (`src/<vendor>/<connector_name>/artifacts/test-flows/`). These flows test the complete integration by executing components in a realistic sequence.

**Important**: Connectors should have **multiple smaller test flows** rather than one large flow. Each flow should test a specific feature or workflow (e.g., `test-flow-crud.json`, `test-flow-search.json`, `test-flow-webhooks.json`). This approach makes tests easier to maintain, debug, and understand.

**Full Coverage Requirement**: All components in a connector MUST be tested. Verify that every component in the connector appears in at least one test flow.

**Data assumptions get a designer sticky note**: a flow that assumes tenant
data (hardcoded entity IDs that must exist), provokes its own data, or carries
a timing constraint (a Wait that must not be removed) MUST carry a top-level
`notes` entry — a designer sticky note with the warning and the setup steps for
a fresh tenant. See `11-e2e-flow-generation.md` rule 19 for the shape.

#### Test Flow Structure

Test flows are JSON files that define a workflow using the Appmixer flow format. Each flow consists of:

1. **Metadata**: Flow name and description
2. **Components**: Dictionary of component instances with unique IDs
3. **Connections**: Data flow between components via source/target ports
4. **Configuration**: Input values and transformations

**Naming Convention**:
- Test flow names MUST follow the format: `"E2E Connector Name - test type"`
- Examples: `"E2E Google Docs - images"`, `"E2E Slack - messages"`, `"E2E GitHub - pull requests"`
- The testCase field in ProcessE2EResults should match this format

**Component IDs MUST be freshly generated UUIDs** (`crypto.randomUUID()`) —
never readable slugs like `create-task`. The engine resolves OAuth scopes via a
global componentId lookup that ignores the flow id, so readable ids reused
across flows bind accounts to the wrong flow (see `11-e2e-flow-generation.md`,
rule 0b; enforced by the `component-id-uuid` validator). The JSON snippets in
THIS document use short readable ids purely for legibility — do not copy them
into real flows.

**Basic Structure**:
```json
{
    "name": "E2E Connector Name - feature",
    "description": "End-to-end test for Connector Name - tests specific feature",
    "flow": {
        "component-id-1": {
            "type": "appmixer.utils.controls.OnStart",
            "x": 64,
            "y": 16,
            "source": {},
            "version": "1.0.0",
            "config": {}
        },
        "component-id-2": {
            "type": "appmixer.connector.core.ComponentName",
            "x": 256,
            "y": 16,
            "version": "1.0.0",
            "source": {
                "in": {
                    "component-id-1": ["out"]
                }
            },
            "config": {
                "transform": {
                    "in": {
                        "component-id-1": {
                            "out": {
                                "type": "json2new",
                                "modifiers": {
                                    "fieldName": {}
                                },
                                "lambda": {
                                    "fieldName": "value"
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
```

#### Component Layout Rules (IMPORTANT)

For clean, readable flows without crossing lines or cycles, lay flows out as a
**left→right staircase** (checked, as warnings, by the `layout` validator —
same rules as `11-e2e-flow-generation.md` rule 14):

**Grid minimums**:
- `MIN_DX = 208px` — horizontal gap between connected components
- `MIN_DY = 128px` — vertical gap between rows
- First component: `x = 64, y = 16`

**Rule 1: Linear Sequence (A → B)**
```
B.x = A.x + 208   (horizontal spacing)
B.y = A.y         (same row)
```

**Rule 2: Staircase (one row per tested component)** — a tested component and
**its** Assert share the same `y` (the Assert sits at `x + 208`); the NEXT
tested component steps down to `y + 128` (and right), so each
component→Assert pair gets its own row. Connected components either share a
row (Δy = 0) or are ≥ 128 apart — never backward or overlapping edges.

**Example (staircase)**:
```
OnStart (64, 16) → Create (272, 16)
Get (480, 144) → Assert (688, 144)
AfterAll (896, 144) → Delete cleanup (1104, 144) → ProcessE2EResults (1312, 144)
```
AfterAll → cleanup (Delete) → ProcessE2EResults continue to the right after
the last Assert (see Required Components below).

#### Required Components

Every E2E test flow MUST include these components in sequence — and **every
component in the flow MUST carry fail-fast error handling**:
`"errorHandling": { "autoRetry": false, "onError": "stopFlow" }` (see
`11-e2e-flow-generation.md` rule 0; enforced by the `error-handling`
validator).

1. **OnStart** (`appmixer.utils.controls.OnStart`)
    - Triggers the flow execution
    - First component in the flow
    - No configuration needed

2. **Your Components Under Test**
    - The actual connector components being tested
    - Should test main CRUD operations (Create, Read, Update, Delete)
    - Chain components to test realistic workflows

3. **Assert Components** (`appmixer.utils.test.Assert`)
    - Validate component outputs (assertion types: see "Assert Component
      Configuration" below)
    - Multiple assertions can be used throughout the flow
    - **Layout rule**: a tested component and its Assert share the same row
      (Assert at x + 208); the next tested component starts a new row (see
      Layout Rules above)
    - Each Assert MUST be connected to AfterAll to report test results

4. **AfterAll** (`appmixer.utils.test.AfterAll`)
    - Aggregation point that receives the outputs of **ALL Assert components**
      in the flow
    - Critical for proper flow termination and cleanup
    - **Connection rule**: every Assert feeds AfterAll; **cleanup (Delete)
      components come AFTER AfterAll** (AfterAll → cleanup →
      ProcessE2EResults), so cleanup runs once all assertions have reported
    - Should include a `timeout` property (e.g. 180 seconds; use 420–600 for
      trigger flows waiting on webhooks or manual steps — see
      `11-e2e-flow-generation.md` rule 18)
    - Position: `x = last_assert.x + 208, y = last_row.y` (continues the sequence)

5. **ProcessE2EResults** (`appmixer.utils.test.ProcessE2EResults`)
    - Final component that processes test results
    - REQUIRED for all E2E test flows
    - Connected after the cleanup components (or directly after AfterAll when
      the flow creates nothing to clean up)
    - Reports success/failure to test infrastructure

#### ProcessE2EResults Component Configuration

The ProcessE2EResults component is REQUIRED and must be configured with:

**Required Properties**:
```json
{
    "type": "appmixer.utils.test.ProcessE2EResults",
    "source": {
        "in": {
            "cleanup-component": ["out"]
        }
    },
    "config": {
        "properties": {
            "successStoreId": "64f6f1f9193228000754082f",
            "failedStoreId": "64f6f1f0193228000754082e"
        },
        "transform": {
            "in": {
                "cleanup-component": {
                    "out": {
                        "type": "json2new",
                        "modifiers": {
                            "recipients": {},
                            "testCase": {},
                            "result": {
                                "result-var": {
                                    "variable": "$.after-all.out",
                                    "functions": []
                                }
                            }
                        },
                        "lambda": {
                            "recipients": "jirka@client.io",
                            "testCase": "E2E Connector Name - feature",
                            "result": "{{{result-var}}}"
                        }
                    }
                }
            }
        }
    }
}
```

**Key Fields**:
- `successStoreId`: Store ID for successful test results (use standard value)
- `failedStoreId`: Store ID for failed test results (use standard value)
- `recipients`: Email address for test result notifications
- `testCase`: Human-readable test name (e.g., "Google Docs E2E")
- `result`: Variable reference to AfterAll component output

#### Modifier Functions (Prefer Over CodeBlock)

Appmixer transforms support **modifier functions** in the `functions` array of a variable reference. These run natively in the engine without needing a CodeBlock component. **Always prefer modifiers over CodeBlock** — they are simpler, faster, and don't have the `result` wrapping issue.

| Function | Description | Parameters |
|----------|-------------|------------|
| `g_uuid4` | Generate UUID v4 | none |
| `g_timestamp` | Current Unix timestamp (ms) | none |
| `g_now` | Current ISO 8601 date | none |
| `g_addTimeSpan` | Add time to a date | `hashParams: { days: {value: N}, hours: {value: N}, minutes: {value: N} }` |
| `g_random` | Random number (0-1) | none |
| `g_flowName` | Current flow name | none |
| `g_flowId` | Current flow ID | none |
| `g_userId` | Current user ID | none |
| `g_jsonPath` | Extract from JSON via JSONPath | `params: [{value: "$.path"}]` |
| `g_regex` | Regex matching | `params` for pattern, `hashParams` for flags |
| `g_first` | First element of array | none |
| `g_last` | Last element of array | none |
| `g_length` | Length of string/array | none |
| `g_javascript` | Run arbitrary JS code | `params: [{value: "code"}]` |
| `g_stringify` | Object to JSON string | none |
| `g_split` | Split string by delimiter | `params: [{value: "delimiter"}]` |
| `g_add` | Addition | `params: [{value: N}]` |
| `g_mul` | Multiplication | `params: [{value: N}]` |
| `g_floor` | Floor rounding | none |
| `g_greaterThan` | Comparison (greater than) | `params: [{value: N}]` |

**Common E2E patterns using modifiers:**

**Unique email per run** (instead of CodeBlock):
```json
"email": {
    "email-var": {
        "variable": "$.set-variables.out.emailPrefix",
        "functions": []
    },
    "ts-var": {
        "variable": "$.on-start.out.started",
        "functions": [{ "name": "g_timestamp" }]
    }
}
```
With lambda: `"email": "{{{email-var}}}-{{{ts-var}}}@appmixer-test.com"`

**Future date** (instead of CodeBlock):
```json
"startTime": {
    "start-var": {
        "variable": "$.on-start.out.started",
        "functions": [
            { "name": "g_now" },
            { "name": "g_addTimeSpan", "hashParams": { "days": {"value": 14} } }
        ]
    }
}
```

**UUID as unique identifier**:
```json
"uniqueName": {
    "name-var": {
        "variable": "$.set-variables.out.baseName",
        "functions": [{ "name": "g_uuid4" }]
    }
}
```
With lambda: `"uniqueName": "E2E-{{{name-var}}}"`

**When to use CodeBlock instead:**
Use CodeBlock only when modifiers can't express the logic: complex string formatting requiring multiple transformations chained, conditional logic (if/else), math beyond simple add/multiply, parsing complex nested structures.

**CodeBlock gotchas:**
- Output wraps the return value under `result` field. Access via `$.code-block-id.out.result`. Deep access like `$.code-block-id.out.result.field` does NOT work — return simple strings/numbers.
- Code runs in `isolated-vm`, **synchronously** (`evalSync`) — no `await`, no `setTimeout`, no Promises, so a CodeBlock cannot delay. Input variables are exposed on **`$data`** (e.g. `$data.body`), not as bare identifiers. Bare `return` statements are illegal. Use expressions directly (e.g. `'value-' + Date.now()`) or IIFEs.

#### Deterministic Test Design

Tests must pass on repeated runs without input changes:

- **Unique inputs**: Use `g_timestamp` or `g_uuid4` modifier functions for unique identifiers (e.g. `e2e-{{{ts-var}}}@test.com`). Prefer modifiers over CodeBlock.
- **Avoid hardcoded dates**: Use `g_now` + `g_addTimeSpan` to compute future dates dynamically. Hardcoded dates expire and tests break.
- **Create + Delete cleanup**: If the API rejects duplicates (e.g. contacts by email), the test MUST delete created resources at the end — after AfterAll (see Required Components).
- **Search/Find race conditions**: Many APIs have eventual consistency. A record created 1 second ago may not appear in search results. Best approach: search for a pre-existing test record instead of a just-created one. Alternatives: insert `appmixer.utils.timers.Wait` with `interval: "1m"` (minimum unit is minutes — a CodeBlock cannot delay, see its gotchas above), or put a Get-by-ID between Create and Find.
- **Cross-component variable references**: When referencing variables from indirect upstream components (2+ hops), prefer direct upstream references. E.g. use `$.find-items.out.id` instead of `$.create-item.out.id` when the update is triggered by find.

#### Provider Latency Is a Design Input

Before authoring a flow around a polling trigger, **measure how long the
provider takes to make a new record visible**, and size the `AfterAll` timeout
from that. Do not assume "a few seconds".

Real case: Deepgram's request log lags **12–17 minutes** — records created at
13:39 were absent at 13:50 and present at 13:56, and a job's detail endpoint
answers `200` with an empty body immediately after the submit. Every trigger
flow authored with a 420 s window was structurally unable to pass, no matter
what the component code did.

When the window is long, the runner needs a matching one:

```bash
AGENT_TIMEOUT_MS=3600000 appmixer e2e run <flowId> --fix --timeout 1700
```

(Budget the overall `AGENT_TIMEOUT_MS` for TWO windows plus overhead — a clean
timeout on a trigger flow triggers one deterministic re-run, and a budget that
only covers one window kills the runner mid-retry; see `13-e2e-run.md`.)

If a component can get its result via a callback instead (see
`14-async-components.md`), that lag disappears — 4 seconds instead of 17 minutes
— and it is worth changing the component rather than nursing the timeouts.

#### Provoking Failure States

A trigger that watches a **failure** (failed job, rejected request, bounced
message) needs a provocation the provider **accepts** and then fails. Verify
that at design time.

Real case: the Deepgram Failed Request flow submitted an unreachable audio URL.
The provider fetches that URL while handling the submit and rejects the whole
call synchronously (`415`), so the component throws, the flow stops on first
error the way E2E flows must, and the trigger never sees anything — and a
rejected submit is not logged as a failed request either. The flow could never
pass.

If no deterministic provocation exists, do not ship a flow that cannot pass.
Remove it, cover the component with review plus its `test()` method, and write
down why in `artifacts/test-flows/README.md` so the next person does not re-add
it.

#### Tenant-Bound Values in Flows

`appmixer e2e import` re-resolves **account** bindings, but nothing else. A
trigger's `config.properties` (e.g. `projectId`, `boardId`, `viewId`) is a plain
string that belongs to whoever's credentials authored the flow. Swap the E2E
account and those flows fail with `404 … cannot be found`.

- Keep the list of tenant-bound properties in `artifacts/test-flows/README.md`.
- Remember that swapping the account also resets the **data** the flows rely on:
  a fresh API key can mean an empty project, so `Find*` components correctly
  return `notFound` and the asserts never fire.

#### Component Configuration Pattern

**Setting Static Values**:
```json
{
    "config": {
        "transform": {
            "in": {
                "source-component": {
                    "out": {
                        "type": "json2new",
                        "modifiers": {
                            "fieldName": {}
                        },
                        "lambda": {
                            "fieldName": "static-value"
                        }
                    }
                }
            }
        }
    }
}
```

**Passing Data from Previous Component**:
```json
{
    "config": {
        "transform": {
            "in": {
                "source-component": {
                    "out": {
                        "type": "json2new",
                        "modifiers": {
                            "fieldName": {
                                "variable-id": {
                                    "variable": "$.source-component.out.fieldName",
                                    "functions": []
                                }
                            }
                        },
                        "lambda": {
                            "fieldName": "{{{variable-id}}}"
                        }
                    }
                }
            }
        }
    }
}
```

#### Assert Component Configuration

Assert components validate outputs using expressions:

```json
{
    "type": "appmixer.utils.test.Assert",
    "source": {
        "in": {
            "component-to-test": ["out"]
        }
    },
    "config": {
        "transform": {
            "in": {
                "component-to-test": {
                    "out": {
                        "type": "json2new",
                        "modifiers": {
                            "expression": {
                                "check-var": {
                                    "variable": "$.component-to-test.out.fieldName",
                                    "functions": []
                                }
                            }
                        },
                        "lambda": {
                            "expression": {
                                "AND": [
                                    {
                                        "field": "{{{check-var}}}",
                                        "assertion": "equal",
                                        "expected": "expected-value"
                                    }
                                ]
                            }
                        }
                    }
                }
            }
        }
    }
}
```

**Supported Assertion Types**:
- `equal`: Exact match comparison (e.g., field equals "expected-value")
- `notEmpty`: Checks that a field is not empty/null/undefined
- `regex`: Regular expression pattern match (e.g., field matches pattern "^[0-9]+$")

#### Critical Variable Mapping Rules

These rules are **CRITICAL** and must be followed exactly. Failure to follow these rules will cause test flows to fail silently.

**1. Lambda Values MUST Reference Modifiers with `{{{variable-id}}}` Pattern**

When a modifier defines a variable mapping, the lambda value MUST use the corresponding `{{{variable-id}}}` pattern (for example, `{{{check-var}}}`) - NEVER use an empty string.

**WRONG:**
```json
"modifiers": {
    "taskId": {
        "var-1": {
            "variable": "$.create-task.out.id",
            "functions": []
        }
    }
},
"lambda": {
    "taskId": ""  // WRONG! This ignores the modifier
}
```

**CORRECT:**
```json
"modifiers": {
    "taskId": {
        "var-task-id": {
            "variable": "$.create-task.out.id",
            "functions": []
        }
    }
},
"lambda": {
    "taskId": "{{{var-task-id}}}"  // CORRECT! References the modifier
}
```

**2. Assert `field` Property MUST Use Variable Reference**

The `field` property in Assert expressions must ALWAYS use `{{{uuid}}}` pattern that references a modifier. Never leave it empty.

**WRONG:**
```json
"modifiers": {
    "expression": {
        "check-id": {
            "variable": "$.create-task.out.id",
            "functions": []
        }
    }
},
"lambda": {
    "expression": {
        "AND": [{
            "field": "",  // WRONG! Empty field ignores the modifier
            "assertion": "notEmpty"
        }]
    }
}
```

**CORRECT:**
```json
"modifiers": {
    "expression": {
        "field-id": {
            "variable": "$.create-task.out.id",
            "functions": []
        }
    }
},
"lambda": {
    "expression": {
        "AND": [{
            "field": "{{{field-id}}}",  // CORRECT! References the modifier
            "assertion": "notEmpty"
        }]
    }
}
```

**3. Assert `expected` Property for Dynamic Values**

For `equal` assertions comparing dynamic values (from SetVariable or component outputs), BOTH `field` AND `expected` must use variable references.

**CORRECT PATTERN for comparing component output to SetVariable:**
```json
"modifiers": {
    "expression": {
        "field-content": {
            "variable": "$.get-task.out.content",
            "functions": []
        },
        "expected-content": {
            "variable": "$.set-variables.out.taskContent",
            "functions": []
        }
    }
},
"lambda": {
    "expression": {
        "AND": [{
            "field": "{{{field-content}}}",
            "assertion": "equal",
            "expected": "{{{expected-content}}}"
        }]
    }
}
```

**4. SetVariable Component Best Practices**

- Place SetVariable component early in flow (immediately after OnStart)
- Define ALL values that will be used in Assert comparisons
- Use descriptive variable names (e.g., `taskContent`, `updatedTaskContent`)
- For unique test data, use `{{{g_timestamp()}}}` or `{{{g_now()}}}` functions

**Example SetVariable Configuration:**
```json
"set-variables": {
    "type": "appmixer.utils.controls.SetVariable",
    "source": {"in": {"on-start": ["out"]}},
    "config": {
        "transform": {
            "in": {
                "on-start": {
                    "out": {
                        "type": "json2new",
                        "modifiers": {"variables": {}},
                        "lambda": {
                            "variables": {
                                "ADD": [
                                    {"type": "text", "name": "taskContent", "text": "E2E Test Task"},
                                    {"type": "text", "name": "updatedContent", "text": "E2E Test Task Updated"}
                                ]
                            }
                        }
                    }
                }
            }
        }
    }
}
```

**5. Component Dependencies and Source Connections**

Components that need data from another component MUST have that component in their `source.in`. The source component's output is accessed via `$.component-id.out.fieldName`.

**WRONG - GetTask sources from wrong component:**
```json
"get-task": {
    "source": {"in": {"before-all": ["out"]}},  // WRONG! Can't access create-task.out
    "config": {
        "modifiers": {
            "taskId": {"var-1": {"variable": "$.create-task.out.id"}}  // This won't work!
        }
    }
}
```

**CORRECT - GetTask sources from CreateTask:**
```json
"get-task": {
    "source": {"in": {"create-task": ["out"]}},  // CORRECT! Can access create-task.out
    "config": {
        "modifiers": {
            "taskId": {"var-1": {"variable": "$.create-task.out.id"}}  // This works!
        }
    }
}
```

**6. ProcessE2EResults `result` Field**

The `result` property MUST use `{{{uuid}}}` pattern referencing `$.after-all.out`. Never leave it empty.

**CORRECT:**
```json
"modifiers": {
    "result": {
        "result-var": {
            "variable": "$.after-all.out",
            "functions": []
        }
    }
},
"lambda": {
    "recipients": "test@appmixer.ai",
    "testCase": "E2E Connector - feature",
    "result": "{{{result-var}}}"
}
```

**7. AfterAll Must Receive ALL Assert Outputs - CRITICAL**

**EVERY** Assert component in the flow MUST have its output connected to the AfterAll component's `source.in`. This is **CRITICAL** - missing any Assert connection will cause that assertion's result to be lost and not included in the test report.

**Common Mistake**: Assert components that are in the middle of the flow (not at the end) are often forgotten. Even if an Assert flows to another component first, it MUST ALSO connect to AfterAll.

**WRONG - Missing assert-create connection:**
```json
"after-all": {
    "source": {
        "in": {
            "assert-get": ["out"],
            "assert-update": ["out"]
            // WRONG! assert-create is missing - its result will be lost!
        }
    }
}
```

**CORRECT - All Asserts connected:**
```json
"after-all": {
    "source": {
        "in": {
            "assert-create": ["out"],   // First assert
            "assert-get": ["out"],      // Second assert
            "assert-update": ["out"],   // Third assert
            "assert-list": ["out"]      // Fourth assert - ALL included!
        }
    }
}
```

**Verification Checklist**: Before finalizing any test flow:
1. Count the number of Assert components in the flow
2. Count the number of Assert connections in AfterAll's `source.in`
3. These numbers MUST match exactly
4. If counts don't match, the missing Assert results will not appear in the test report, causing silent test failures.

#### Best Practices for Test Flows

(Multiple smaller flows, full coverage, cleanup after AfterAll, layout and UUID
component ids are specified at the top of this document and not repeated here.)

1. **Test Realistic Workflows**
    - Create → Modify → Read → Delete sequence
    - Test main user journeys
    - Include error cases where appropriate

2. **Multiple Assert Components - Separate Branches**
    - **CRITICAL**: If a flow has more than one Assert component, they MUST be in separate branches
    - Each Assert should test a different aspect or operation
    - Branches sit on different rows (Δy ≥ 128) and all feed into AfterAll:
      ```
      Component A (y=16)  → Assert 1 (y=16)  ─┐
        └─> Component B (y=144) → Assert 2 (y=144) ─┴─> AfterAll
      ```

3. **Field Name Accuracy**
    - Use EXACT field names from component.json
    - Match required vs optional fields
    - Example: `paragraphText` not `text`, `oldText` not `searchText`

4. **Variable References**
    - Reference outputs using `$.component-id.out.fieldName`
    - Use consistent variable IDs in modifiers
    - Pass data between components via variables

5. **File Naming**
    - Name test flow files: `test-flow-<feature>.json` (e.g., `test-flow-crud.json`, `test-flow-list.json`)
    - Use clear, descriptive flow names that indicate what the flow tests

#### Example Test Flow Pattern

See [`examples/e2e-test-flow.json`](examples/e2e-test-flow.json).

#### Creating a Test Flow: Step-by-Step

1. **Plan** — list ALL components (actions and triggers) and group them into
   scenarios, e.g. `test-flow-crud.json` (Create, Update, Get, Delete),
   `test-flow-list.json` (List and Find), `test-flow-advanced.json` (complex
   operations). Every component appears in at least one flow.
2. **Create the file** at
   `src/<vendor>/<connector>/artifacts/test-flows/test-flow-<feature>.json`
   with OnStart → connector components → Assert(s) → AfterAll → cleanup →
   ProcessE2EResults.
3. **Configure each component** from its `component.json`: exact field names,
   every `required` input populated, data passed via variable references.
4. **Test locally first** — run individual components with
   `appmixer test component` and verify outputs before wiring the full flow.
5. **Validate** with `appmixer e2e validate` (rules in
   `11-e2e-flow-generation.md`).

#### Common Mistakes to Avoid

1. **Incorrect Field Names**
    - ❌ Using `text` instead of `paragraphText`
    - ❌ Using `searchText` instead of `oldText`
    - ✅ Always check component.json for exact names

2. **Missing Required Fields**
    - ❌ Omitting required inputs
    - ✅ Verify all `required` fields from schema are populated

3. **Wrong Variable References** — Raw Output (`$.component.out`), numeric
   array indexing (`.items.0.id`), paths deeper than the sender's static
   outPort contract, and raw arrays in string-typed inputs. The correct forms
   (`g_jsonPath` / `g_first` / `g_last` modifiers, JSON-serialized strings) are
   rules 3, 6b, 8 and 9b in `11-e2e-flow-generation.md`.

4. **Forgetting ProcessE2EResults**
    - ❌ Ending flow without ProcessE2EResults
    - ✅ Always include as final component

5. **Skipping Cleanup**
    - ❌ Leaving test data in the service
    - ✅ Delete all created test data in cleanup phase

#### Reference Test Flows

`examples/e2e-test-flow.json` is the only structural reference. Do NOT copy
patterns from other connectors' committed test flows — many pre-date the current
rules (`BeforeAll`, missing `errorHandling`, readable component ids); see
`11-e2e-flow-generation.md`.

---
