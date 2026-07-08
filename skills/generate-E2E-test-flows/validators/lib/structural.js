/**
 * Structural validation rules for E2E test flows.
 * Pure deterministic checks — no LLM, no external dependencies.
 */

import { sourceIn, transformIn } from './flowutil.js';

// ---------------------------------------------------------------------------
// Individual validators
// ---------------------------------------------------------------------------

const error = (severity, component, rule, message) => ({ severity, component, rule, message });

export const validateFlowName = (flowJson) => {
    if (!flowJson.name) return [error('critical', null, 'flow-name', 'Flow name is missing')];
    if (!flowJson.name.startsWith('E2E '))
        return [error('critical', null, 'flow-name', `Flow name must start with "E2E ". Got: "${flowJson.name}"`)];
    return [];
};

export const validateFlowStructure = (flowJson) => {
    if (!flowJson.flow) return [error('critical', null, 'flow-structure', 'Missing "flow" property')];
    return [];
};

const REQUIRED_TYPES = [
    ['appmixer.utils.controls.OnStart', 'OnStart'],
    ['appmixer.utils.test.AfterAll', 'AfterAll'],
    ['appmixer.utils.test.ProcessE2EResults', 'ProcessE2EResults'],
];

export const validateRequiredComponents = (components) => {
    const types = Object.values(components).map(c => c.type);
    return REQUIRED_TYPES
        .filter(([type]) => !types.includes(type))
        .map(([, name]) => error('critical', null, 'required-component', `Missing ${name} component`));
};

export const validateAfterAllConnections = (components) => {
    const errors = [];
    const afterAll = Object.entries(components).find(([, c]) => c.type === 'appmixer.utils.test.AfterAll');
    if (!afterAll) return errors;

    const afterAllSources = Object.keys(sourceIn(afterAll[1]));
    const assertIds = Object.entries(components)
        .filter(([, c]) => c.type === 'appmixer.utils.test.Assert')
        .map(([id]) => id);

    for (const id of assertIds) {
        if (!afterAllSources.includes(id)) {
            errors.push(error('critical', id, 'afterall-connection',
                `Assert "${id}" is NOT connected to AfterAll's source.in`));
        }
    }
    return errors;
};

export const validateSourceMismatch = (compId, comp) => {
    const errors = [];
    const compSources = Object.keys(sourceIn(comp));

    for (const sourceId of Object.keys(transformIn(comp))) {
        if (!compSources.includes(sourceId)) {
            errors.push(error('critical', compId, 'source-mismatch',
                `Transform references "${sourceId}" but it's not linked in "source" [${compSources.join(', ')}]`));
        }
    }
    return errors;
};

export const validateVariableMapping = (compId, outConfig) => {
    const errors = [];
    if (!outConfig?.modifiers || !outConfig?.lambda) return errors;

    for (const [fieldName, modifierDef] of Object.entries(outConfig.modifiers)) {
        if (typeof modifierDef !== 'object' || Object.keys(modifierDef).length === 0) continue;

        const varIds = Object.keys(modifierDef);
        const lambdaValue = outConfig.lambda[fieldName];

        // Assert expression — check nested AND array
        if (fieldName === 'expression' && typeof lambdaValue === 'object') {
            const serialized = JSON.stringify(lambdaValue?.AND || []);
            for (const varId of varIds) {
                if (!serialized.includes(`{{{${varId}}}}`)) {
                    errors.push(error('critical', compId, 'variable-mapping',
                        `Modifier "${varId}" in expression not referenced in lambda AND array`));
                }
            }
            continue;
        }

        // Normal field
        if (typeof lambdaValue === 'string') {
            for (const varId of varIds) {
                if (!lambdaValue.includes(`{{{${varId}}}}`)) {
                    errors.push(error('critical', compId, 'variable-mapping',
                        `Modifier "${varId}" for "${fieldName}" not referenced in lambda. Lambda: "${lambdaValue}"`));
                }
            }
        } else if (lambdaValue === '' || lambdaValue === undefined) {
            errors.push(error('critical', compId, 'variable-mapping',
                `Lambda for "${fieldName}" is empty but modifier defines: ${varIds.join(', ')}`));
        }
    }
    return errors;
};

export const validateVariablePaths = (compId, outConfig, allComponentIds) => {
    const errors = [];
    if (!outConfig?.modifiers) return errors;

    // Variable path → check referenced component exists in flow.
    // We only check existence, NOT source.in membership.
    // In Appmixer, modifier variables can reference any upstream component.
    const walk = (obj) => {
        if (!obj || typeof obj !== 'object') return;
        if (obj.variable && typeof obj.variable === 'string') {
            const match = obj.variable.match(/^\$\.([^.]+)\./);
            if (match) {
                const ref = match[1];
                if (ref !== compId && !allComponentIds.includes(ref)) {
                    errors.push(error('critical', compId, 'variable-path',
                        `Variable "${obj.variable}" references "${ref}" which doesn't exist in the flow`));
                }
            }
        }
        for (const val of Object.values(obj)) {
            if (typeof val === 'object') walk(val);
        }
    };
    walk(outConfig.modifiers);
    return errors;
};

export const validateProcessE2EResults = (components) => {
    const errors = [];
    const entry = Object.entries(components).find(([, c]) => c.type === 'appmixer.utils.test.ProcessE2EResults');
    if (!entry) return errors;

    const [procId, procComp] = entry;

    // Store IDs are environment-specific and injected at upload time (prepFlow in
    // upload-e2e-flows), so they need not be present in the committed flow JSON.
    if (!procComp.config?.properties?.successStoreId)
        errors.push(error('warning', procId, 'process-config', 'Missing successStoreId (injected at upload time)'));
    if (!procComp.config?.properties?.failedStoreId)
        errors.push(error('warning', procId, 'process-config', 'Missing failedStoreId (injected at upload time)'));

    const tin = transformIn(procComp);
    if (Object.keys(tin).length) {
        const sourceKey = Object.keys(tin)[0];
        const resultModifier = tin[sourceKey]?.out?.modifiers?.result;
        const resultLambda = tin[sourceKey]?.out?.lambda?.result;
        if (resultModifier && Object.keys(resultModifier).length > 0) {
            const varId = Object.keys(resultModifier)[0];
            if (!resultLambda || !resultLambda.includes(`{{{${varId}}}}`)) {
                errors.push(error('critical', procId, 'process-result',
                    `ProcessE2EResults result should be "{{{${varId}}}}" but got "${resultLambda}"`));
            }
        }
    }
    return errors;
};

export const validateNoRawOutputAsserts = (components) => {
    const errors = [];
    for (const [compId, comp] of Object.entries(components)) {
        if (comp.type !== 'appmixer.utils.test.Assert') continue;

        // Check all variable references in transform modifiers.
        // transform is keyed by the component's own inPort, then source id, then
        // the source's OUTPUT PORT name (often "out", but dynamic-output components
        // emit on ports like "templates"). Scan EVERY port's modifiers.
        for (const sourceConfig of Object.values(transformIn(comp))) {
            const modifiers = {};
            for (const portConfig of Object.values(sourceConfig || {})) {
                if (portConfig?.modifiers) Object.assign(modifiers, portConfig.modifiers);
            }
            const walk = (obj) => {
                if (!obj || typeof obj !== 'object') return;
                if (obj.variable && typeof obj.variable === 'string') {
                    // Raw Output pattern: $.component-id.<port> (no further field path).
                    // Port-name-AGNOSTIC: the output port is often named "out", but
                    // dynamic-output/source-helper components expose other port names
                    // (e.g. "templates", "issue", "channels"). Asserting the whole raw
                    // port value is always-true and meaningless regardless of its name.
                    // EXCEPTION: if the modifier extracts a specific field/element via a
                    // path function (g_jsonPath/g_first/g_last), the assertion is on the
                    // extracted value — that IS the recommended pattern, so don't flag it.
                    const EXTRACTORS = new Set(['g_jsonPath', 'g_first', 'g_last']);
                    const extracts = Array.isArray(obj.functions)
                        && obj.functions.some((f) => f && EXTRACTORS.has(f.name));
                    const match = obj.variable.match(/^\$\.([^.]+)\.([^.[]+)$/);
                    if (match && !extracts) {
                        errors.push(error('critical', compId, 'raw-output-assert',
                            `Assert "${compId}" tests Raw Output (${obj.variable}). ` +
                            `Raw Output always contains data, making the assertion meaningless. ` +
                            `Test specific fields instead (e.g. ${obj.variable}.fieldName).`));
                    }
                }
                for (const val of Object.values(obj)) {
                    if (typeof val === 'object') walk(val);
                }
            };
            walk(modifiers);
        }
    }
    return errors;
};

export const validateDynamicOutputAsserts = (components) => {
    const errors = [];

    // Identify components with dynamic output (source URL on outPort = dynamic)
    // These components only expose "Raw Output" ($.comp.out) in the UI,
    // not individual fields like $.comp.out.fieldName
    const dynamicOutputComponents = new Set();
    for (const [compId, comp] of Object.entries(components)) {
        const type = comp.type || '';
        // Components with dynamic output ports (source URL on inPort or outPort)
        // are common in connectors — IssueMetadata, Find*, List*, etc.
        // We can't check component.json here (no FS access in structural validator),
        // but we CAN detect the pattern: if an Assert references $.comp.out.field
        // where comp's outPort is wired to the Assert, AND comp has no static output
        // options defined in the flow, flag it as potentially invalid.
        // This is a heuristic — the definitive check is validate-variables API.
    }

    // Check Assert components referencing fields on components that only have
    // a single "out" port with no known static fields
    for (const [compId, comp] of Object.entries(components)) {
        if (comp.type !== 'appmixer.utils.test.Assert') continue;

        for (const [sourceId, sourceConfig] of Object.entries(transformIn(comp))) {
            const sourceComp = components[sourceId];
            if (!sourceComp) continue;

            // Skip utility components (CodeBlock, SetVariable) — their outputs are well-defined
            const sourceType = sourceComp.type || '';
            if (sourceType.startsWith('appmixer.utils.')) continue;

            // When the flow sets outputType "first"/"object" on the source, it emits a
            // single item with named fields — $.comp.out.field is valid, don't warn.
            // transform is keyed by local inPort, then upstream id, then upstream
            // OUTPUT port name (not always "in"/"out"), so scan every port's lambda.
            let sourceOutputType;
            for (const ports of Object.values(transformIn(sourceComp))) {
                for (const data of Object.values(ports || {})) {
                    if (typeof data?.lambda?.outputType === 'string') sourceOutputType = data.lambda.outputType;
                }
            }
            if (sourceOutputType === 'first' || sourceOutputType === 'object') continue;

            // sourceConfig is keyed by the source's OUTPUT PORT name (not always
            // "out"). Collect modifiers from EVERY port so non-"out" port asserts
            // (e.g. "templates") are inspected too.
            const modifiers = {};
            for (const portConfig of Object.values(sourceConfig || {})) {
                if (portConfig?.modifiers) Object.assign(modifiers, portConfig.modifiers);
            }
            const walk = (obj) => {
                if (!obj || typeof obj !== 'object') return;
                if (obj.variable && typeof obj.variable === 'string') {
                    // Pattern: $.source-comp.<port>.fieldName — referencing a specific
                    // field on a connector component's output. Port-name-AGNOSTIC: the
                    // port is often "out" but dynamic-output components use other names
                    // (e.g. "templates", "issue"). This field access is only valid if the
                    // component has static output port options. For dynamic output
                    // components, only $.comp.<port> (Raw Output) is available.
                    // Also catch numeric array indexing anywhere in the field path
                    // (e.g. $.x.templates[0].label or $.x.out.items.0.id) — that never
                    // resolves on a dynamic/raw port and is a stronger smell.
                    const match = obj.variable.match(/^\$\.([^.]+)\.([^.[]+)[.[](.+)$/);
                    if (match && match[1] === sourceId) {
                        const port = match[2];
                        const field = match[3];
                        const indexed = /\[\d+\]|\.\d+(\.|$)/.test(obj.variable);
                        // This Assert directly reads from a connector component's named field.
                        // If the connector component uses dynamic output ports, this won't work.
                        // Indexed access is escalated to critical; otherwise a warning
                        // (we can't be 100% sure without component.json).
                        errors.push(error(indexed ? 'critical' : 'warning', compId, 'dynamic-output-field-assert',
                            `Assert "${compId}" references field "${field}" on port "${port}" of ` +
                            `"${sourceId}" (${sourceType})${indexed ? ' using numeric array indexing' : ''}. ` +
                            `If this component uses dynamic output ports, only Raw ` +
                            `Output ($.${sourceId}.${port}) is available — prefer a modifier (e.g. ` +
                            `g_jsonPath/g_first on Raw Output) to extract the value and assert on that; ` +
                            `use a CodeBlock only as a last resort.`));
                    }
                }
                for (const val of Object.values(obj)) {
                    if (typeof val === 'object') walk(val);
                }
            };
            walk(modifiers);
        }
    }
    return errors;
};

// ---------------------------------------------------------------------------
// Compose all structural validations
// ---------------------------------------------------------------------------

export const deterministicValidation = (flowJson) => {
    const errors = [
        ...validateFlowName(flowJson),
        ...validateFlowStructure(flowJson),
    ];

    if (!flowJson.flow) return errors;

    const components = flowJson.flow;
    const allComponentIds = Object.keys(components);

    errors.push(
        ...validateRequiredComponents(components),
        ...validateAfterAllConnections(components),
        ...validateProcessE2EResults(components),
        ...validateNoRawOutputAsserts(components),
        ...validateDynamicOutputAsserts(components),
    );

    for (const [compId, comp] of Object.entries(components)) {
        errors.push(...validateSourceMismatch(compId, comp));

        for (const sourceConfig of Object.values(transformIn(comp))) {
            const out = sourceConfig?.out;
            errors.push(
                ...validateVariableMapping(compId, out),
                ...validateVariablePaths(compId, out, allComponentIds),
            );
        }
    }

    return errors;
};
