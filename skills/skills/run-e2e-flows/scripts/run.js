#!/usr/bin/env node
//
// CLI entry point for the deterministic E2E flow runner (explicit state machine, no LLM).
//
import { run } from './orchestrator.js';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
// scripts/ → run-e2e-flows → skills → workspace-vero → openclaw: four hops to the repo root .env.
dotenv.config({ path: process.env.APPMIXER_ENV || resolve(__dirname, '..', '..', '..', '..', '.env') });

const TIMEOUT_MS = parseInt(process.env.AGENT_TIMEOUT_MS || 10 * 60 * 1000, 10);
setTimeout(() => { console.error('Runner timeout exceeded, terminating.'); process.exit(1); }, TIMEOUT_MS).unref();

const [flowPath, baseUrl] = process.argv.slice(2);

if (!flowPath) {
    console.error(`Usage: node run.js <path-to-flow.json> [baseUrl]

Deterministic state-machine E2E flow runner. Reads the flow.json, derives connector(s) and the
repo root from its path, then createOrUpdates the flow on the instance (creates it if no flow with
this name exists, otherwise PUTs the local definition in place), starts it, monitors logs, and
triages deterministically (e.g. rebinding accounts on token errors).

There is NO LLM in this runner. When triage cannot resolve a failure it exits with code 2 and a
structured NEEDS_FIX brief (errors + recent logs + flow path). The calling agent then fixes the
local flow JSON per the run-e2e-flows skill rules and re-runs this script — INIT re-uploads the
local file and rebinds accounts on every run.

Connector publish (appmixer pack/publish) is NOT done here — publish the connector first (via the
upload-e2e-flows skill or manually) so its components are available on the instance.

  path-to-flow.json   Local E2E flow JSON under <repo>/src/appmixer/<connector>/...
  baseUrl             Optional Appmixer API base URL (default: VERO_APPMIXER_BASE_URL)

Exit codes: 0 = flow passed | 1 = hard failure (config/budget) | 2 = NEEDS_FIX (agent fixes + re-runs)

Env: VERO_APPMIXER_BASE_URL, VERO_APPMIXER_USERNAME, VERO_APPMIXER_PASSWORD (or APPMIXER_ENV → .env)`);
    process.exit(1);
}

run({ flowPath: resolve(flowPath), baseUrl: baseUrl || null })
    .then(r => process.exit(r.success ? 0 : (r.needsFix ? 2 : 1)))
    .catch(err => { console.error(err.message); process.exit(1); });
