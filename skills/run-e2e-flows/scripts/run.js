#!/usr/bin/env node
//
// CLI entry point for the deterministic E2E flow runner (explicit state machine, no LLM).
//
import { run, emergencyStop } from './orchestrator.js';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Config comes from APPMIXER_ENV (a .env file) or from variables already exported
// in the environment — there is deliberately no path fallback: a guessed .env can
// silently point at a different instance.
if (process.env.APPMIXER_ENV) dotenv.config({ path: process.env.APPMIXER_ENV });

// On ANY forced exit (runner timeout, Ctrl-C, kill) stop the flow first — a leaked running flow
// keeps trigger subscriptions alive and interferes with every subsequent run. Cap the stop
// attempt so a hung API cannot block the exit.
const stopThenExit = async (label, code) => {
    console.error(label);
    await Promise.race([emergencyStop(label), new Promise(r => setTimeout(r, 10000))]);
    process.exit(code);
};

const TIMEOUT_MS = parseInt(process.env.AGENT_TIMEOUT_MS || 10 * 60 * 1000, 10);
setTimeout(() => { stopThenExit('Runner timeout exceeded, terminating.', 1); }, TIMEOUT_MS).unref();
process.on('SIGINT', () => stopThenExit('SIGINT received — stopping the flow before exit.', 130));
process.on('SIGTERM', () => stopThenExit('SIGTERM received — stopping the flow before exit.', 143));

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
  baseUrl             Optional Appmixer API base URL (default: APPMIXER_SKILL_API_URL)

Exit codes: 0 = flow passed | 1 = hard failure (config/budget) | 2 = NEEDS_FIX (agent fixes + re-runs)

Env: APPMIXER_SKILL_API_URL, APPMIXER_SKILL_USERNAME, APPMIXER_SKILL_PASSWORD (or APPMIXER_ENV → .env)`);
    process.exit(1);
}

run({ flowPath: resolve(flowPath), baseUrl: baseUrl || null })
    .then(r => process.exit(r.success ? 0 : (r.needsFix ? 2 : 1)))
    .catch(err => { console.error(err.message); process.exit(1); });
