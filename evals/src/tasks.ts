import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

export const EVALS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

export interface Task {
    id: string;
    /** small = one component added to an existing connector, large = a whole connector. */
    size: 'small' | 'large';
    connector: string;
    /** Paths (relative to the connectors repo root) deleted from the sandbox before the run. */
    remove: string[];
    /** Component ids the agent is expected to produce, e.g. appmixer.spotify.core.FindTracks. */
    expect: string[];
    prompt: string;
}

export interface Source {
    /** Local clone of appmixer-connectors. EVAL_CONNECTORS_REPO overrides it. */
    repo: string;
    /** Commit every task is cut from. Pinned so runs stay comparable. */
    ref: string;
}

export function loadSource(): Source {
    const s = JSON.parse(readFileSync(join(EVALS_DIR, 'source.json'), 'utf8'));
    const repo = (process.env.EVAL_CONNECTORS_REPO || s.repo).replace(/^~(?=\/)/, homedir());
    return { repo, ref: s.ref };
}

export function loadTasks(filter?: string): Task[] {
    const dir = join(EVALS_DIR, 'tasks');
    const all: Task[] = readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .sort()
        .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
    if (!filter || filter === 'all') return all;
    if (filter === 'small' || filter === 'large') return all.filter((t) => t.size === filter);
    const ids = filter.split(',');
    const missing = ids.filter((id) => !all.some((t) => t.id === id));
    if (missing.length) throw new Error(`unknown task(s): ${missing.join(', ')}`);
    return all.filter((t) => ids.includes(t.id));
}

/** appmixer.spotify.core.FindTracks → src/appmixer/spotify/core/FindTracks */
export function componentDir(id: string): string {
    return join('src', ...id.split('.'));
}
