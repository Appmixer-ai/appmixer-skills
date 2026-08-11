#!/usr/bin/env node
/**
 * Sync the canonical design instructions (instructions/ at the repo root) into
 * the per-skill references/ directories, so every skill ships self-contained
 * (make-skills style: SKILL.md + references/ + examples inside the skill dir).
 *
 * Edit instructions/ only — never the references/ copies. Run:
 *   node scripts/sync-references.mjs           # copy
 *   node scripts/sync-references.mjs --check   # verify copies are in sync (CI)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'instructions');

// skill -> list of files/dirs (relative to instructions/) it ships in references/
const MANIFEST = {
    'build-connector': [
        '00-overview.md', '01-connectors.md', '02-authentication.md',
        '03-plugins.md', '04-components.md', '05-component-config.md',
        '06-component-behavior.md', '07-component-types.md',
        '08-best-practices.md', '09-testing.md', '10-trigger-test-method.md',
        '11-e2e-flow-generation.md', 'examples'
    ],
    'review-connector': [
        '04-components.md', '05-component-config.md', '06-component-behavior.md',
        '07-component-types.md', '08-best-practices.md', '10-trigger-test-method.md',
        'examples'
    ],
    'test-connector': [
        '09-testing.md', '12-e2e-upload.md', '13-e2e-run.md',
        'examples/e2e-test-flow.json'
    ]
};

const check = process.argv.includes('--check');
let drift = [];

function* walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) yield* walk(p);
        else yield p;
    }
}

function expectedFiles(items) {
    const out = new Map(); // rel-in-references -> abs source
    for (const item of items) {
        const abs = path.join(SRC, item);
        if (fs.statSync(abs).isDirectory()) {
            for (const f of walk(abs)) out.set(path.relative(SRC, f), f);
        } else {
            out.set(item, abs);
        }
    }
    return out;
}

for (const [skill, items] of Object.entries(MANIFEST)) {
    const refDir = path.join(ROOT, 'skills', skill, 'references');
    const expected = expectedFiles(items);

    if (check) {
        const actual = new Set(fs.existsSync(refDir)
            ? [...walk(refDir)].map(f => path.relative(refDir, f)) : []);
        for (const [rel, src] of expected) {
            const dst = path.join(refDir, rel);
            if (!fs.existsSync(dst)) drift.push(`${skill}: missing references/${rel}`);
            else if (!fs.readFileSync(src).equals(fs.readFileSync(dst))) {
                drift.push(`${skill}: references/${rel} differs from instructions/${rel}`);
            }
            actual.delete(rel);
        }
        for (const rel of actual) drift.push(`${skill}: stale references/${rel} (not in manifest)`);
    } else {
        fs.rmSync(refDir, { recursive: true, force: true });
        for (const [rel, src] of expected) {
            const dst = path.join(refDir, rel);
            fs.mkdirSync(path.dirname(dst), { recursive: true });
            fs.copyFileSync(src, dst);
        }
        console.log(`synced ${expected.size} file(s) -> skills/${skill}/references/`);
    }
}

if (check) {
    if (drift.length) {
        console.error('References out of sync with instructions/ — run: node scripts/sync-references.mjs');
        for (const d of drift) console.error('  ' + d);
        process.exit(1);
    }
    console.log('references in sync');
}
