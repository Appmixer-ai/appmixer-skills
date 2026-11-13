import { mkdirSync, rmSync, writeFileSync, existsSync, symlinkSync, readdirSync, readFileSync, statSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { run } from './util.ts';
import type { Task, Source } from './tasks.ts';

/**
 * Tools the agent may use. Mirrors phase 1 of claude-issue-to-connectors.yml
 * minus git push / gh: the sandbox has no remote and nothing may leave it.
 * `connector verify` is left out on purpose — the CLI configstore may hold real
 * service credentials, and the eval has to stay offline and reproducible.
 * Current Claude Code has no Glob/Grep tools (it searches with find/grep via
 * Bash), so those two are allowed here, unlike in the workflow.
 */
export const ALLOWED_TOOLS = [
    'Read', 'Edit', 'Write', 'MultiEdit', 'WebFetch', 'WebSearch', 'TodoWrite', 'Task', 'Skill',
    'Bash(find:*)',
    'Bash(grep:*)',
    'Bash(node scripts/validate.js:*)',
    'Bash(appmixer connector validate:*)',
    'Bash(npx eslint:*)',
    'Bash(npm run lint)',
    'Bash(git status:*)',
    'Bash(git diff:*)',
    'Bash(base64:*)',
    'Bash(ls:*)',
    'Bash(mkdir:*)'
];

/**
 * appmixer-connectors is public, so the reference solution of every task is
 * one fetch away. Keep the agent off GitHub; anything that slips through is
 * flagged by leakCheck() in the graders.
 */
export const DENIED_TOOLS = [
    'WebFetch(domain:github.com)',
    'WebFetch(domain:api.github.com)',
    'WebFetch(domain:raw.githubusercontent.com)',
    'WebFetch(domain:codeload.github.com)',
    'WebFetch(domain:objects.githubusercontent.com)'
];

/**
 * Build a sandbox: the connectors tree at the pinned ref, WITHOUT the repo's
 * .git (an agent running `git log --all` there would find the reference
 * solution), minus the task's target, with a fresh one-commit git so the
 * agent's work can be diffed afterwards.
 */
export async function createSandbox(task: Task, source: Source, dir: string): Promise<void> {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
    mkdirSync(dir, { recursive: true });

    const archive = await run('bash', ['-c', 'set -o pipefail; git -C "$1" archive "$2" | tar -x -C "$3"', '_', source.repo, source.ref, dir]);
    if (archive.code !== 0) throw new Error(`git archive failed: ${archive.stderr}`);

    for (const p of task.remove) rmSync(join(dir, p), { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
    if (task.size === 'small') scrubArtifacts(task, dir);

    // The repo's own settings enable the published appmixer plugin from GitHub.
    // Replace them, so the only skills in play are the ones under test (--plugin-dir).
    mkdirSync(join(dir, '.claude'), { recursive: true });
    writeFileSync(join(dir, '.claude', 'settings.json'), JSON.stringify({ permissions: { allow: ALLOWED_TOOLS, deny: DENIED_TOOLS } }, null, 2));

    const nodeModules = join(source.repo, 'node_modules');
    if (existsSync(nodeModules)) symlinkSync(nodeModules, join(dir, 'node_modules'));

    const git = (...args: string[]) => run('git', ['-c', 'user.name=eval', '-c', 'user.email=eval@localhost', ...args], { cwd: dir });
    await git('init', '-q');
    appendFileSync(join(dir, '.git', 'info', 'exclude'), '\nnode_modules\n');
    await git('add', '-A');
    const commit = await git('commit', '-q', '--no-verify', '-m', 'base');
    if (commit.code !== 0) throw new Error(`sandbox commit failed: ${commit.stderr}`);
}

/**
 * For a small task the connector stays in place, but its test flows and
 * recorded samples spell out the removed component's inputs and outputs.
 * Delete every artifact file that names it.
 */
function scrubArtifacts(task: Task, dir: string): void {
    const names = task.expect.map((id) => id.split('.').pop()!);
    const artifacts = join(dir, 'src', 'appmixer', task.connector, 'artifacts');
    if (!existsSync(artifacts)) return;
    const walk = (d: string) => {
        for (const entry of readdirSync(d)) {
            const p = join(d, entry);
            if (statSync(p).isDirectory()) walk(p);
            else if (names.some((n) => readFileSync(p, 'utf8').includes(n))) rmSync(p);
        }
    };
    walk(artifacts);
}

/** Everything the agent changed, as one patch (new files included). */
export async function sandboxPatch(dir: string): Promise<string> {
    await run('git', ['add', '-A'], { cwd: dir });
    const diff = await run('git', ['diff', '--cached', '--no-color'], { cwd: dir });
    return diff.stdout;
}
