/**
 * Validate each flow JSON against flow-schema.json (Ajv).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Ajv from 'ajv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'flow-schema.json'), 'utf8'));
const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);

export const name = 'flow-schema';
export const description = 'Each flow JSON conforms to flow-schema.json';

export const run = (ctx) => {
    for (const { file, json } of ctx.flows) {
        // flow-schema.json describes the inner `flow` map (componentId -> descriptor),
        // not the top-level flow document.
        if (!validate(json.flow || {})) {
            for (const e of validate.errors) {
                ctx.addFailure(file, `flow${e.instancePath || ''} ${e.message}`);
            }
        }
    }
};
