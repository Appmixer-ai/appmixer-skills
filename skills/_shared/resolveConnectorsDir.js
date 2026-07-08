/**
 * Resolve the appmixer-connectors repo root, shared by all skills.
 *
 * Order:
 *   1) $APPMIXER_SKILL_CONNECTORS_DIR (explicit, e.g. CI)
 *   2) walk up from `start` (default process.cwd()) to the dir containing
 *      src/appmixer — i.e. the connectors repo the agent is working in
 *   3) throw (caller can't proceed without it)
 *
 * This lets the env var be optional: when a skill runs inside the connectors
 * repo, the repo root is discovered automatically.
 */
import fs from 'fs';
import path from 'path';

export function resolveConnectorsDir(start = process.cwd()) {
    if (process.env.APPMIXER_SKILL_CONNECTORS_DIR) {
        return path.resolve(process.env.APPMIXER_SKILL_CONNECTORS_DIR);
    }
    let dir = path.resolve(start);
    for (;;) {
        if (fs.existsSync(path.join(dir, 'src', 'appmixer'))) return dir;
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    throw new Error(
        'Cannot resolve connectors dir: set APPMIXER_SKILL_CONNECTORS_DIR or run from inside an ' +
        'appmixer-connectors checkout (a dir containing src/appmixer).'
    );
}

export default resolveConnectorsDir;
