import { mkdirSync, writeFileSync, existsSync, cpSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { parseArgs } from 'node:util';
import { EVALS_DIR, loadSource, loadTasks } from './tasks.ts';
import type { Task } from './tasks.ts';
import { createSandbox, sandboxPatch } from './sandbox.ts';
import { runAgent } from './agent.ts';
import { grade, traceStats } from './graders.ts';
import { loadRecords, renderReport } from './report.ts';
import type { RunRecord } from './report.ts';
import { run, slug } from './util.ts';

const USAGE = `Usage:
  node evals/src/cli.ts run    [--tasks all|small|large|id,id] [--models m1,m2] [--k 3]
                               [--skills <plugin dir>] [--label <name>] [--parallel 2]
                               [--budget-small 4] [--budget-large 20] [--out <dir>] [--keep]
  node evals/src/cli.ts oracle [--tasks ...]     grade the reference solution itself (no agent, no cost)
  node evals/src/cli.ts report <results dir>     (re)write report.md for a results directory`;

const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
        tasks: { type: 'string', default: 'all' },
        models: { type: 'string', default: 'claude-sonnet-5-5' },
        k: { type: 'string', default: '1' },
        skills: { type: 'string', default: join(EVALS_DIR, '..') },
        label: { type: 'string' },
        parallel: { type: 'string', default: '2' },
        'budget-small': { type: 'string', default: '4' },
        'budget-large': { type: 'string', default: '20' },
        out: { type: 'string' },
        keep: { type: 'boolean', default: false },
        help: { type: 'boolean', default: false }
    }
});

const [command, arg] = positionals;
if (values.help || !command) {
    console.log(USAGE);
    process.exit(command ? 0 : 1);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const workRoot = join(tmpdir(), 'appmixer-evals');

if (command === 'report') {
    if (!arg) throw new Error('report needs a results directory');
    writeReport(resolve(arg));
} else if (command === 'oracle') {
    await oracle();
} else if (command === 'run') {
    await runAll();
} else {
    console.error(USAGE);
    process.exit(1);
}

async function runAll(): Promise<void> {
    const source = loadSource();
    const tasks = loadTasks(values.tasks);
    const models = values.models!.split(',');
    const k = Number(values.k);
    const skillsDir = resolve(values.skills!);
    const skillsLabel = values.label ?? await skillsVersion(skillsDir);
    // The agent may read anything in its plugin dir (that's how it reaches the
    // references). The skills checkout also holds evals/ — task definitions and
    // earlier runs' patches — so hand it a copy without them.
    const pluginDir = join(workRoot, stamp, 'plugin');
    cpSync(skillsDir, pluginDir, {
        recursive: true,
        filter: (src) => !/[\\/](evals|\.git|node_modules)$/.test(src)
    });
    const outDir = resolve(values.out ?? join(EVALS_DIR, 'results', stamp));
    mkdirSync(outDir, { recursive: true });

    const jobs: { task: Task; model: string; repeat: number }[] = [];
    for (const task of tasks) for (const model of models) for (let i = 1; i <= k; i++) jobs.push({ task, model, repeat: i });
    console.log(`${jobs.length} runs → ${outDir}`);

    let next = 0;
    const worker = async () => {
        while (next < jobs.length) {
            const job = jobs[next++];
            const variant = `${job.model}@${skillsLabel}`;
            const name = `${job.task.id}__${slug(variant)}__${job.repeat}`;
            const sandbox = join(workRoot, stamp, name);
            const t0 = Date.now();
            console.log(`▶ ${name}`);
            try {
                await createSandbox(job.task, source, sandbox);
                const agent = await runAgent(job.task, sandbox, join(outDir, `${name}.trace.jsonl`), {
                    model: job.model,
                    pluginDir,
                    maxBudgetUsd: Number(job.task.size === 'large' ? values['budget-large'] : values['budget-small']),
                    timeoutMs: (job.task.size === 'large' ? 90 : 30) * 60_000
                });
                writeFileSync(join(outDir, `${name}.patch`), await sandboxPatch(sandbox));
                const grades = await grade(job.task, sandbox, source);
                const trace = traceStats(join(outDir, `${name}.trace.jsonl`));
                const record: RunRecord = {
                    task: job.task.id, size: job.task.size, variant, model: job.model, skills: skillsLabel,
                    repeat: job.repeat, startedAt: new Date(t0).toISOString(), agent, grades, trace
                };
                writeFileSync(join(outDir, `${name}.result.json`), JSON.stringify(record, null, 2));
                const cost = agent.costUsd == null ? '?' : agent.costUsd.toFixed(2);
                console.log(`✔ ${name} gate=${grades.gate} coverage=${grades.coverage.found}/${grades.coverage.expected} `
                    + `validator=${grades.validator.failures} eslint=${grades.eslint.errors} $${cost} ${Math.round((Date.now() - t0) / 60000)}min`);
            } catch (e) {
                console.error(`✘ ${name}: ${(e as Error).stack}`);
            } finally {
                if (!values.keep) rmSync(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
            }
        }
    };
    await Promise.all(Array.from({ length: Number(values.parallel) }, worker));
    rmSync(pluginDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
    writeReport(outDir);
}

/**
 * Sanity check for the graders: put the reference implementation back into a
 * fresh sandbox and grade it. Every task should pass the gate with full
 * coverage and 100 % overlap — if not, the task or a grader is broken.
 */
async function oracle(): Promise<void> {
    const source = loadSource();
    const outDir = resolve(values.out ?? join(EVALS_DIR, 'results', `oracle-${stamp}`));
    mkdirSync(outDir, { recursive: true });
    for (const task of loadTasks(values.tasks)) {
        const sandbox = join(workRoot, stamp, `oracle-${task.id}`);
        await createSandbox(task, source, sandbox);
        const full = join(workRoot, stamp, `oracle-${task.id}-full`);
        rmSync(full, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
        mkdirSync(full, { recursive: true });
        await run('bash', ['-c', 'git -C "$1" archive "$2" | tar -x -C "$3"', '_', source.repo, source.ref, full]);
        for (const p of task.remove) if (existsSync(join(full, p))) cpSync(join(full, p), join(sandbox, p), { recursive: true });
        const grades = await grade(task, sandbox, source);
        const record: RunRecord = {
            task: task.id, size: task.size, variant: 'oracle', model: 'reference', skills: '-', repeat: 1,
            startedAt: new Date().toISOString(), agent: null, grades, trace: null
        };
        writeFileSync(join(outDir, `${task.id}__oracle__1.result.json`), JSON.stringify(record, null, 2));
        console.log(`${task.id}: gate=${grades.gate} coverage=${grades.coverage.found}/${grades.coverage.expected} `
            + `validator=${grades.validator.failures}${grades.validator.error ? ' ERROR' : ''} eslint=${grades.eslint.errors}${grades.eslint.error ? ' ERROR' : ''} `
            + `in=${grades.inputOverlap} out=${grades.outputOverlap} auth=${grades.authMatch}`);
        if (!values.keep) {
            rmSync(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
            rmSync(full, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
        }
    }
    writeReport(outDir);
}

function writeReport(dir: string): void {
    const md = renderReport(loadRecords(dir));
    writeFileSync(join(dir, 'report.md'), md);
    console.log(`\n${md}`);
}

async function skillsVersion(dir: string): Promise<string> {
    const res = await run('git', ['-C', dir, 'describe', '--always', '--dirty']);
    return res.code === 0 ? res.stdout.trim() : 'unknown';
}
