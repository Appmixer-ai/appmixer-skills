/**
 * Load skill configuration into process.env.
 *
 * Precedence:
 *   1. Variables already exported in the environment always win (dotenv never
 *      overrides existing process.env values).
 *   2. APPMIXER_ENV — explicit path to a .env file, when set.
 *   3. ~/.config/appmixer-skills/env — the well-known default, when it exists.
 *
 * Returns { path, source } describing what was (or wasn't) loaded so callers
 * can announce the effective config target.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import dotenv from 'dotenv';

export const DEFAULT_CONFIG_PATH = path.join(os.homedir(), '.config', 'appmixer-skills', 'env');

export function loadEnv() {
    if (process.env.APPMIXER_ENV) {
        dotenv.config({ path: process.env.APPMIXER_ENV });
        return { path: process.env.APPMIXER_ENV, source: 'APPMIXER_ENV' };
    }
    if (fs.existsSync(DEFAULT_CONFIG_PATH)) {
        dotenv.config({ path: DEFAULT_CONFIG_PATH });
        return { path: DEFAULT_CONFIG_PATH, source: 'default' };
    }
    return { path: null, source: 'process env' };
}

export default loadEnv;
