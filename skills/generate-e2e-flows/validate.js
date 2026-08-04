#!/usr/bin/env node
/**
 * E2E flow validator — dispatcher modeled on appmixer-connectors/scripts/validate.js.
 *
 * Auto-discovers every validator in ./validators/ (any *.js that does not start
 * with "_"), runs each over the generated test-flow JSONs, and reports failures
 * (hard, exit 1) and warnings (informational). The MAIN agent generates the flow
 * JSONs directly, then runs this to self-check and fix issues — no LLM sub-agent.
 *
 * Each validator exports: { name, description, run(context) }
 * Context:
 *   - flows: [{ file, path, json }]   parsed test-flow-*.json files
 *   - target, connectorsDir           input path + connectors src dir (may be null)
 *   - skillDir                        this skill's directory (for schema/template)
 *   - addFailure(file, message)       hard failure (fails CI)
 *   - addWarning(file, message)       informational only
 *
 * Usage:
 *   node validate.js <path>
 * <path> may be a single flow JSON file OR a directory of test-flow-*.json files.
 * connectorsDir (for coverage validators) comes from $APPMIXER_SKILL_CONNECTORS_DIR/src,
 * or is derived from <path> itself (its src/appmixer ancestor) when unset.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { loadEnv } from '../_shared/loadEnv.js';

loadEnv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VALIDATORS_DIR = path.join(__dirname, 'validators');

// Accept ANY number of file/dir arguments (shell globs expand to multiple argv
// entries — silently validating only argv[2] once cost a whole debugging session).
const targets = process.argv.slice(2).filter((a) => a !== '--');
const target = targets[0];
if (!target || target === '-h' || target === '--help') {
    console.log('Usage: node validate.js <flow.json | flows-dir> [more files/dirs…]   (connectorsDir from $APPMIXER_SKILL_CONNECTORS_DIR/src)');
    process.exit(target ? 0 : 1);
}

// connectorsDir = the src/appmixer parent (used by the coverage validators to
// load component.json). Resolution order:
//   1) $APPMIXER_SKILL_CONNECTORS_DIR/src
//   2) derive from the validated path itself — it lives under <repo>/src/appmixer/…
//   3) null → coverage validators skip with a warning
function deriveConnectorsSrc(p) {
    const marker = `${path.sep}src${path.sep}appmixer${path.sep}`;
    const i = (p + path.sep).indexOf(marker);
    return i === -1 ? null : path.join(p.slice(0, i), 'src');
}
const connectorsDir = process.env.APPMIXER_SKILL_CONNECTORS_DIR
    ? path.join(process.env.APPMIXER_SKILL_CONNECTORS_DIR, 'src')
    : deriveConnectorsSrc(path.resolve(target));

// Resolve the list of flow files: each target is a .json file or a directory
// of test-flow-*.json files.
const flowPaths = [];
for (const t of targets) {
    let stat;
    try {
        stat = fs.statSync(t);
    } catch {
        console.error(`Path not found: ${t}`);
        process.exit(1);
    }
    if (stat.isDirectory()) {
        const found = fs.readdirSync(t)
            .filter((f) => f.startsWith('test-flow-') && f.endsWith('.json'))
            .sort()
            .map((f) => path.join(t, f));
        if (found.length === 0) {
            console.error(`No test-flow-*.json files found in ${t}`);
            process.exit(1);
        }
        flowPaths.push(...found);
    } else if (t.endsWith('.json')) {
        flowPaths.push(t);
    } else {
        console.error(`Not a JSON file or directory: ${t}`);
        process.exit(1);
    }
}

// Load + parse, with a clean error on malformed JSON.
const flows = flowPaths.map((p) => {
    try {
        return { file: path.basename(p), path: p, json: JSON.parse(fs.readFileSync(p, 'utf8')) };
    } catch (e) {
        console.error(`Invalid JSON in ${p}: ${e.message}`);
        process.exit(1);
    }
});

async function discoverValidators() {
    const entries = fs.readdirSync(VALIDATORS_DIR, { withFileTypes: true });
    const validators = [];
    for (const e of entries) {
        if (!e.isFile() || !e.name.endsWith('.js') || e.name.startsWith('_')) continue;
        const mod = await import(pathToFileURL(path.join(VALIDATORS_DIR, e.name)).href);
        if (typeof mod.run !== 'function' || typeof mod.name !== 'string') {
            throw new Error(`Invalid validator ${e.name}: must export { name, run }`);
        }
        validators.push(mod);
    }
    return validators.sort((a, b) => a.name.localeCompare(b.name));
}

async function main() {
    const validators = await discoverValidators();
    console.log(`Validating ${flows.length} flow file(s) (${target})\n`);

    let totalFailures = 0;
    for (const validator of validators) {
        const failures = [];
        const warnings = [];
        const fmt = (file, message) => `[${validator.name}] ${file ? file + ': ' : ''}${message}`;
        await validator.run({
            flows,
            target,
            connectorsDir,
            skillDir: __dirname,
            addFailure: (file, message) => failures.push(fmt(file, message)),
            addWarning: (file, message) => warnings.push(fmt(file, message))
        });

        const warnSuffix = warnings.length ? ` (+${warnings.length} warning(s))` : '';
        console.log(`- ${validator.name}: ${failures.length === 0 ? 'OK' : `${failures.length} issue(s)`}${warnSuffix}`);
        for (const f of failures) console.error(`  - ${f}`);
        for (const w of warnings) console.warn(`  - (warn) ${w}`);
        totalFailures += failures.length;
    }

    if (totalFailures > 0) {
        console.error(`\nValidation failed: ${totalFailures} issue(s). Fix the flows and re-run.`);
        process.exit(1);
    }
    console.log(`\nValidation passed (${validators.length} validators, ${flows.length} flow file(s)).`);
}

main().catch((e) => { console.error('Validation crashed:', e); process.exit(1); });
