#!/usr/bin/env node
/**
 * DEPRECATED shim. Flow validation now lives in the generate-E2E-test-flows skill
 * as a validate.js dispatcher (modeled on appmixer-connectors/scripts/validate.js,
 * auto-discovering validators/). This forwards <flows-dir> to it; connectorsDir is
 * derived from $VERO_CONNECTORS_DIR (a legacy 2nd arg is ignored).
 *
 * Prefer calling directly:
 *   node "$VERO_SKILL_ROOT/generate-E2E-test-flows/validate.js" <flows-dir>
 */
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const target = path.resolve(__dirname, '..', '..', 'generate-E2E-test-flows', 'validate.js');
const args = [target, process.argv[2]].filter(Boolean);
const r = spawnSync('node', args, { stdio: 'inherit' });
process.exit(r.status ?? 1);
