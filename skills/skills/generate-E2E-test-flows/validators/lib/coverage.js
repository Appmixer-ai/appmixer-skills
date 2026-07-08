/**
 * Input coverage validation — checks flow fields against component.json schemas.
 * Requires access to the connectors directory.
 */

import fs from 'fs';
import path from 'path';
import { sourceIn, transformIn } from './flowutil.js';

// ---------------------------------------------------------------------------
// Schema loading
// ---------------------------------------------------------------------------

export const loadComponentSchema = (componentType, connectorsDir) => {
    const parts = componentType.split('.');
    const componentPath = path.join(connectorsDir, ...parts, 'component.json');
    try {
        return JSON.parse(fs.readFileSync(componentPath, 'utf-8'));
    } catch {
        return null;
    }
};

export const getInputSchema = (componentJson) => {
    const schema = componentJson?.inPorts?.[0]?.schema || {};
    return {
        properties: schema.properties || {},
        required: schema.required || []
    };
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GENERIC_VALUES = new Set([
    '', 'test', 'string', 'value', 'example', 'foo', 'bar', 'baz',
    'undefined', 'null', 'none', 'n/a', 'todo', 'placeholder', 'xxx', 'abc', '123'
]);

const UTIL_PREFIXES = [
    'appmixer.utils.controls.',
    'appmixer.utils.test.',
];

const error = (severity, component, rule, message) => ({ severity, component, rule, message });

// ---------------------------------------------------------------------------
// Individual validators
// ---------------------------------------------------------------------------

// The outputType a flow sets on a component (first/object/array/file), read from
// its transform lambda. Used to know whether a dynamic-output component emits
// individual item fields ("first"/"object") rather than an array wrapper.
const getComponentOutputType = (comp) => {
    // transform is keyed by the component's own inPort name, then upstream id,
    // then that upstream's OUTPUT port name (neither is always "in"/"out" —
    // e.g. CreateContact emits on "contact"). Scan every port's lambda.
    for (const ports of Object.values(transformIn(comp))) {
        for (const data of Object.values(ports || {})) {
            const ot = data?.lambda?.outputType;
            if (typeof ot === 'string') return ot;
        }
    }
    return undefined;
};

const getUsedFields = (comp) => {
    const fields = new Set();
    // transform is keyed by the component's own inPort, then upstream id, then
    // that upstream's OUTPUT port name (not always "in"/"out" — e.g.
    // CreateContact emits on "contact"). Scan every port's lambda.
    for (const ports of Object.values(transformIn(comp))) {
        for (const data of Object.values(ports || {})) {
            for (const name of Object.keys(data?.lambda || {})) fields.add(name);
        }
    }
    return fields;
};

export const validateRequiredFields = (compId, usedFields, requiredFields, type) => {
    return requiredFields
        .filter(f => !usedFields.has(f))
        .map(f => error('critical', compId, 'input-coverage-required',
            `Required field "${f}" is not provided (schema: ${type})`));
};

export const validateOptionalCoverage = (compId, usedFields, schemaFieldNames, requiredFields) => {
    const missing = schemaFieldNames
        .filter(f => !requiredFields.includes(f) && !usedFields.has(f));
    if (missing.length === 0) return [];
    return [error('warning', compId, 'input-coverage-optional',
        `Optional fields not tested: [${missing.join(', ')}] (${missing.length}/${schemaFieldNames.length} missing)`)];
};

export const validateUnknownFields = (compId, usedFields, schemaFieldNames) => {
    return [...usedFields]
        .filter(f => !schemaFieldNames.includes(f))
        .map(f => error('critical', compId, 'unknown-field',
            `Field "${f}" is not defined in component schema. Available: [${schemaFieldNames.join(', ')}]`));
};

export const validateDataQuality = (compId, comp, schemaProps) => {
    const errors = [];
    const lambdas = [];
    for (const ports of Object.values(transformIn(comp))) {
        for (const data of Object.values(ports || {})) {
            if (data?.lambda) lambdas.push(data.lambda);
        }
    }
    for (const lambda of lambdas) {
        for (const [fieldName, value] of Object.entries(lambda)) {
            if (typeof value !== 'string' || value.includes('{{{')) continue;

            const trimmed = value.trim().toLowerCase();
            const fieldSchema = schemaProps[fieldName];

            if (GENERIC_VALUES.has(trimmed)) {
                errors.push(error('warning', compId, 'meaningless-data',
                    `Field "${fieldName}" has generic/empty value "${value}". Use realistic test data.`));
            }

            if (fieldSchema?.enum && !fieldSchema.enum.includes(value)) {
                errors.push(error('critical', compId, 'invalid-enum',
                    `Field "${fieldName}" value "${value}" not in enum: [${fieldSchema.enum.join(', ')}]`));
            }

            if (fieldSchema?.type === 'integer' && !/^-?\d+$/.test(value)) {
                errors.push(error('warning', compId, 'type-mismatch',
                    `Field "${fieldName}" expects integer but got "${value}"`));
            }

            if (fieldSchema?.type === 'boolean' && !['true', 'false'].includes(trimmed)) {
                errors.push(error('warning', compId, 'type-mismatch',
                    `Field "${fieldName}" expects boolean but got "${value}"`));
            }
        }
    }
    return errors;
};

// ---------------------------------------------------------------------------
// Assert coverage — components with output data should have asserts
// ---------------------------------------------------------------------------

const hasOutputData = (componentJson) => {
    const outPort = componentJson?.outPorts?.[0];
    return outPort?.options?.length > 0 || outPort?.schema?.properties;
};

/**
 * Validate that Assert components reference specific output fields (not Raw Output)
 * when the component has known static output port options.
 */
export const validateAssertFieldSpecificity = (flowJson, connectorsDir) => {
    const errors = [];
    if (!flowJson.flow || !connectorsDir) return errors;

    for (const [compId, comp] of Object.entries(flowJson.flow)) {
        if (comp.type !== 'appmixer.utils.test.Assert') continue;

        // Find what connector component this assert checks
        for (const [sourceId, sourceConfig] of Object.entries(transformIn(comp))) {
            const sourceComp = flowJson.flow[sourceId];
            if (!sourceComp) continue;
            const sourceType = sourceComp.type || '';
            if (!sourceType.startsWith('appmixer.') || sourceType.startsWith('appmixer.utils.')) continue;

            const schema = loadComponentSchema(sourceType, connectorsDir);
            if (!schema) continue;

            const outPort = schema.outPorts?.[0];
            const hasStaticOptions = outPort?.options?.length > 0;
            const hasDynamicSource = !!outPort?.source?.url;

            // A dynamic-output (outputType) component emits individual item fields
            // when the flow sets outputType to "first" or "object" — its dynamic
            // source then returns per-field options, so $.comp.out.field IS valid.
            const sourceOutputType = getComponentOutputType(sourceComp);
            const emitsItemFields = sourceOutputType === 'first' || sourceOutputType === 'object';

            // Check if assert uses Raw Output on a component with static options.
            // sourceConfig is keyed by the source's OUTPUT PORT name (not always
            // "out"); collect modifiers from every port so non-"out" ports count.
            const modifiers = {};
            for (const portConfig of Object.values(sourceConfig || {})) {
                if (portConfig?.modifiers) Object.assign(modifiers, portConfig.modifiers);
            }
            const walk = (obj) => {
                if (!obj || typeof obj !== 'object') return;
                if (obj.variable && typeof obj.variable === 'string') {
                    // A path-extraction function (g_jsonPath/g_first/g_last) turns raw
                    // output into a specific field — the recommended pattern, not a raw assert.
                    const EXTRACTORS = new Set(['g_jsonPath', 'g_first', 'g_last']);
                    const extracts = Array.isArray(obj.functions)
                        && obj.functions.some((f) => f && EXTRACTORS.has(f.name));
                    // Port-name-AGNOSTIC raw-output match: $.id.<port> for ANY port name,
                    // not just "out" (dynamic-output helpers use e.g. "templates").
                    const rawMatch = obj.variable.match(/^\$\.([^.]+)\.([^.[]+)$/);
                    if (rawMatch && rawMatch[1] === sourceId && hasStaticOptions && !extracts) {
                        const availableFields = outPort.options.map(o => o.value || o.label).join(', ');
                        errors.push(error('critical', compId, 'assert-raw-output-with-static-fields',
                            `Assert "${compId}" uses Raw Output on "${sourceId}" (${sourceType}) ` +
                            `which has static output fields: [${availableFields}]. ` +
                            `Assert specific fields instead.`));
                    }

                    // Field reference on dynamic-only component — port-name-AGNOSTIC and
                    // also matching numeric array indexing ($.x.templates[0].label or
                    // $.x.out.items.0.id). Either dot- or bracket-separated field path.
                    const fieldMatch = obj.variable.match(/^\$\.([^.]+)\.([^.[]+)[.[](.+)$/);
                    if (fieldMatch && fieldMatch[1] === sourceId && hasDynamicSource && !hasStaticOptions && !emitsItemFields) {
                        // Numeric array indexing in the path ([0] or .0.) never resolves on
                        // a raw/dynamic port → critical. A plain nested field (e.g.
                        // issue.key) DOES resolve at runtime (the emitted object has it);
                        // only the variable-picker UI lacks it, so that is a warning,
                        // consistent with structural's dynamic-output-field-assert.
                        const indexed = /\[\d+\]|\.\d+(\.|$)/.test(obj.variable);
                        errors.push(error(indexed ? 'critical' : 'warning', compId, 'assert-field-on-dynamic-output',
                            `Assert "${compId}" references field "${fieldMatch[3]}" on port "${fieldMatch[2]}" of "${sourceId}" ` +
                            `(${sourceType})${indexed ? ' using numeric array indexing' : ''} which has dynamic output ports (no static options). ` +
                            `Set outputType "first" on "${sourceId}" so it emits a single item with ` +
                            `named fields, then assert $.${sourceId}.${fieldMatch[2]}.${fieldMatch[3]} directly.`));
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

export const validateAssertCoverage = (flowJson, connectorsDir) => {
    const errors = [];
    if (!flowJson.flow || !connectorsDir) return errors;

    // Collect which components have asserts checking their output
    const assertedComponents = new Set();
    for (const comp of Object.values(flowJson.flow)) {
        if (comp.type !== 'appmixer.utils.test.Assert') continue;
        // Check what component this assert reads from (links + transform, any inPort)
        for (const srcId of Object.keys(sourceIn(comp))) {
            assertedComponents.add(srcId);
        }
        for (const srcId of Object.keys(transformIn(comp))) {
            assertedComponents.add(srcId);
        }
    }

    for (const [compId, comp] of Object.entries(flowJson.flow)) {
        const type = comp.type || '';
        if (UTIL_PREFIXES.some(p => type.startsWith(p))) continue;
        if (!type.startsWith('appmixer.')) continue;

        const schema = loadComponentSchema(type, connectorsDir);
        if (!schema) continue;

        if (hasOutputData(schema) && !assertedComponents.has(compId)) {
            errors.push(error('warning', compId, 'missing-assert',
                `Component "${compId}" (${type}) returns output data but has no Assert checking its results`));
        }
    }

    return errors;
};

// ---------------------------------------------------------------------------
// Compose all coverage validations
// ---------------------------------------------------------------------------

export const inputCoverageValidation = (flowJson, connectorsDir) => {
    const errors = [];
    if (!flowJson.flow || !connectorsDir) return errors;

    for (const [compId, comp] of Object.entries(flowJson.flow)) {
        const type = comp.type || '';
        if (UTIL_PREFIXES.some(p => type.startsWith(p))) continue;
        if (!type.startsWith('appmixer.')) continue;

        const schema = loadComponentSchema(type, connectorsDir);
        if (!schema) continue;

        const { properties: schemaProps, required: requiredFields } = getInputSchema(schema);
        const schemaFieldNames = Object.keys(schemaProps);
        if (schemaFieldNames.length === 0) continue;

        const usedFields = getUsedFields(comp);

        // Components whose inPort has a top-level dynamic `source` build their
        // real inspector at runtime from metadata (e.g. UpdateIssue pulls Jira
        // field definitions via IssueMetadata). They legitimately accept fields
        // (summary, status, ...) that aren't enumerable in the static
        // schema.properties, so the unknown-field check is a false positive here.
        const hasDynamicInPortSource = !!schema?.inPorts?.[0]?.source;

        errors.push(
            ...validateRequiredFields(compId, usedFields, requiredFields, type),
            ...validateOptionalCoverage(compId, usedFields, schemaFieldNames, requiredFields),
            ...(hasDynamicInPortSource
                ? []
                : validateUnknownFields(compId, usedFields, schemaFieldNames)),
            ...validateDataQuality(compId, comp, schemaProps),
        );
    }

    errors.push(...validateAssertCoverage(flowJson, connectorsDir));
    errors.push(...validateAssertFieldSpecificity(flowJson, connectorsDir));

    return errors;
};
