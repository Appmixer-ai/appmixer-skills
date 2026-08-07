/**
 * Resolve the connector workspace root, shared by all skills.
 *
 * A workspace is any dir whose src/ holds vendor namespaces with connectors:
 * src/<vendor>/<connector>/ ("appmixer" is only the default vendor — customer
 * workspaces can use any vendor name, or several side by side).
 *
 * Order:
 *   1) $APPMIXER_SKILL_CONNECTORS_DIR (explicit override, e.g. CI/worktrees)
 *   2) walk up from `start` (default process.cwd()) to the first dir that
 *      looks like a workspace — i.e. the workspace the agent is working in
 *   3) throw (caller can't proceed without it)
 *
 * This lets the env var be optional: when a skill runs inside the workspace,
 * its root is discovered automatically.
 */
import fs from 'fs';
import path from 'path';

function isWorkspace(dir) {
    const src = path.join(dir, 'src');
    let entries;
    try { entries = fs.readdirSync(src, { withFileTypes: true }); } catch { return false; }
    // The default vendor dir counts even when empty (fresh workspace) …
    if (entries.some((e) => e.isDirectory() && e.name === 'appmixer')) return true;
    // … any other vendor dir counts once it holds a connector manifest.
    for (const v of entries) {
        if (!v.isDirectory() || v.name.startsWith('.')) continue;
        const vd = path.join(src, v.name);
        let connectors;
        try { connectors = fs.readdirSync(vd, { withFileTypes: true }); } catch { continue; }
        for (const c of connectors) {
            if (!c.isDirectory()) continue;
            if (fs.existsSync(path.join(vd, c.name, 'service.json')) ||
                fs.existsSync(path.join(vd, c.name, 'bundle.json'))) return true;
        }
    }
    return false;
}

export function resolveConnectorsDir(start = process.cwd()) {
    if (process.env.APPMIXER_SKILL_CONNECTORS_DIR) {
        return path.resolve(process.env.APPMIXER_SKILL_CONNECTORS_DIR);
    }
    let dir = path.resolve(start);
    for (;;) {
        if (isWorkspace(dir)) return dir;
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    throw new Error(
        'Cannot resolve the connector workspace: set APPMIXER_SKILL_CONNECTORS_DIR or run from ' +
        'inside a workspace (a dir containing src/<vendor>/<connector>, e.g. src/appmixer).'
    );
}

export default resolveConnectorsDir;
