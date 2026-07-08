/**
 * Legacy env-var compatibility: the VERO_* names were renamed to APPMIXER_SKILL_*
 * (2026-07-10), but .env files in the wild (connectors repo root, openclaw
 * workspaces, CI secrets) still carry the old names. Without this shim every
 * script fails with "APPMIXER_BASE_URL is required" / "instance=MISSING" even
 * though the .env is perfectly valid — a confusing failure mode.
 *
 * Call AFTER dotenv.config(). New names always win; legacy values only fill
 * gaps, with a one-line deprecation note on stderr.
 */

const LEGACY_MAP = {
    VERO_APPMIXER_BASE_URL: 'APPMIXER_SKILL_BASE_URL',
    VERO_APPMIXER_USERNAME: 'APPMIXER_SKILL_USERNAME',
    VERO_APPMIXER_PASSWORD: 'APPMIXER_SKILL_PASSWORD',
    VERO_APPMIXER_ACCOUNT_ID: 'APPMIXER_SKILL_ACCOUNT_ID',
    VERO_APPMIXER_UI_URL: 'APPMIXER_SKILL_UI_URL',
    VERO_CONNECTORS_DIR: 'APPMIXER_SKILL_CONNECTORS_DIR'
};

export function applyEnvCompat() {
    const applied = [];
    for (const [legacy, current] of Object.entries(LEGACY_MAP)) {
        if (!process.env[current] && process.env[legacy]) {
            process.env[current] = process.env[legacy];
            applied.push(`${legacy}→${current}`);
        }
    }
    if (applied.length) {
        process.stderr.write(`[env-compat] using legacy env name(s): ${applied.join(', ')} — rename them in your .env\n`);
    }
    return applied;
}
