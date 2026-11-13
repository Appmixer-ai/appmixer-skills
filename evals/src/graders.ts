import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { run, parseJsonLoose, mean } from './util.ts';
import { componentDir } from './tasks.ts';
import type { Task, Source } from './tasks.ts';

export interface Grades {
    /** Every expected component exists, the validator and eslint are clean. */
    gate: boolean;
    coverage: { expected: number; found: number; missing: string[]; extra: string[] };
    validator: { error?: string; failures: number; warnings: number; byRule: Record<string, number> };
    eslint: { error?: string; errors: number; warnings: number };
    /** Jaccard similarity of input / output field names with the reference, averaged over found components. */
    inputOverlap: number | null;
    outputOverlap: number | null;
    /** large tasks: does auth.js use the same auth type as the reference? */
    authMatch: boolean | null;
}

export async function grade(task: Task, sandbox: string, source: Source): Promise<Grades> {
    const coverage = gradeCoverage(task, sandbox);
    const validator = await gradeValidator(task, sandbox);
    const eslint = await gradeEslint(task, sandbox);

    const inputs: number[] = [];
    const outputs: number[] = [];
    for (const id of task.expect) {
        const file = join(componentDir(id), 'component.json');
        if (!existsSync(join(sandbox, file))) continue;
        const ref = await showRef(source, file);
        if (!ref) continue;
        let mine: any;
        try { mine = JSON.parse(readFileSync(join(sandbox, file), 'utf8')); } catch { continue; }
        const theirs = JSON.parse(ref);
        inputs.push(jaccard(inputNames(mine), inputNames(theirs)));
        outputs.push(jaccard(outputNames(mine), outputNames(theirs)));
    }

    let authMatch: boolean | null = null;
    if (task.size === 'large') {
        const authFile = join('src', 'appmixer', task.connector, 'auth.js');
        const ref = await showRef(source, authFile);
        const mine = existsSync(join(sandbox, authFile)) ? readFileSync(join(sandbox, authFile), 'utf8') : null;
        authMatch = !!(ref && mine && authType(ref) === authType(mine));
    }

    return {
        gate: coverage.missing.length === 0 && !validator.error && validator.failures === 0
            && !eslint.error && eslint.errors === 0,
        coverage,
        validator,
        eslint,
        inputOverlap: inputs.length ? mean(inputs) : null,
        outputOverlap: outputs.length ? mean(outputs) : null,
        authMatch
    };
}

export interface TraceStats {
    toolCalls: Record<string, number>;
    /** Tool results flagged as errors, permission denials included. */
    toolErrors: number;
    /** The agent invoked an appmixer:* skill. */
    skillInvoked: boolean;
    /** Skill or instruction files the agent read from the plugin dir. */
    referencesRead: string[];
    /** Tool calls that touched the public reference repo — a run with any is not a fair result. */
    leaks: string[];
}

/** What the agent did, read from its stream-json trace. */
export function traceStats(tracePath: string): TraceStats {
    const stats: TraceStats = { toolCalls: {}, toolErrors: 0, skillInvoked: false, referencesRead: [], leaks: [] };
    if (!existsSync(tracePath)) return stats;
    for (const line of readFileSync(tracePath, 'utf8').split('\n')) {
        if (!line.includes('"tool_')) continue;
        let event: any;
        try { event = JSON.parse(line); } catch { continue; }
        for (const block of event.message?.content ?? []) {
            if (block.type === 'tool_result' && block.is_error) stats.toolErrors++;
            if (block.type !== 'tool_use') continue;
            stats.toolCalls[block.name] = (stats.toolCalls[block.name] ?? 0) + 1;
            const input = JSON.stringify(block.input ?? {});
            if (block.name === 'Skill' && String(block.input?.skill ?? '').startsWith('appmixer:')) stats.skillInvoked = true;
            const path = String(block.input?.file_path ?? '');
            const ref = path.match(/[\\/]plugin[\\/]((?:skills|instructions)[\\/].*)$/);
            if (block.name === 'Read' && ref && !stats.referencesRead.includes(ref[1])) stats.referencesRead.push(ref[1]);
            if (/appmixer-connectors|github\.com\/Appmixer-ai|githubusercontent\.com\/Appmixer-ai/i.test(input)) {
                stats.leaks.push(`${block.name} ${input.slice(0, 200)}`);
            }
        }
    }
    return stats;
}

function gradeCoverage(task: Task, sandbox: string): Grades['coverage'] {
    const found = task.expect.filter((id) => existsSync(join(sandbox, componentDir(id), 'component.json')));
    const extra: string[] = [];
    if (task.size === 'large') {
        // Components the agent added that the reference doesn't have.
        const root = join(sandbox, 'src', 'appmixer', task.connector);
        if (existsSync(root)) {
            for (const f of listComponentJson(root)) {
                try {
                    const name = JSON.parse(readFileSync(f, 'utf8')).name;
                    if (name && !task.expect.includes(name)) extra.push(name);
                } catch { /* invalid JSON is the validator's to report */ }
            }
        }
    }
    return {
        expected: task.expect.length,
        found: found.length,
        missing: task.expect.filter((id) => !found.includes(id)),
        extra
    };
}

async function gradeValidator(task: Task, sandbox: string): Promise<Grades['validator']> {
    const res = await run('appmixer', [
        'connector', 'validate', task.connector,
        '--connectors-dir', sandbox,
        '--rules-dir', 'scripts/validators',
        '--json'
    ], { cwd: sandbox, timeoutMs: 300_000 });
    try {
        const report = parseJsonLoose(res.stdout);
        const byRule: Record<string, number> = {};
        let failures = 0;
        let warnings = 0;
        for (const r of report.results ?? []) {
            failures += r.failures?.length ?? 0;
            warnings += r.warnings?.length ?? 0;
            if (r.failures?.length) byRule[r.name] = r.failures.length;
        }
        return { failures, warnings, byRule };
    } catch (e) {
        return { error: (res.stderr || res.stdout || String(e)).slice(-1000), failures: 0, warnings: 0, byRule: {} };
    }
}

async function gradeEslint(task: Task, sandbox: string): Promise<Grades['eslint']> {
    const dir = join('src', 'appmixer', task.connector);
    if (!existsSync(join(sandbox, dir))) return { error: 'connector directory missing', errors: 0, warnings: 0 };
    const res = await run('npx', ['--no-install', 'eslint', dir, '--ext', '.js', '--format', 'json'], { cwd: sandbox, timeoutMs: 300_000 });
    try {
        const files = parseJsonLoose(res.stdout);
        return {
            errors: files.reduce((a: number, f: any) => a + f.errorCount, 0),
            warnings: files.reduce((a: number, f: any) => a + f.warningCount, 0)
        };
    } catch (e) {
        return { error: (res.stderr || String(e)).slice(-1000), errors: 0, warnings: 0 };
    }
}

async function showRef(source: Source, path: string): Promise<string | null> {
    const res = await run('git', ['-C', source.repo, 'show', `${source.ref}:${path}`]);
    return res.code === 0 ? res.stdout : null;
}

function listComponentJson(dir: string): string[] {
    const res: string[] = [];
    const walk = (d: string) => {
        for (const e of readdirSync(d)) {
            if (e === 'node_modules' || e === 'artifacts') continue;
            const p = join(d, e);
            if (statSync(p).isDirectory()) walk(p);
            else if (e === 'component.json') res.push(p);
        }
    };
    walk(dir);
    return res;
}

function inputNames(c: any): Set<string> {
    const names = new Set<string>();
    for (const port of c.inPorts ?? []) {
        if (typeof port !== 'object') continue;
        Object.keys(port.schema?.properties ?? {}).forEach((k) => names.add(k));
        Object.keys(port.inspector?.inputs ?? {}).forEach((k) => names.add(k));
    }
    Object.keys(c.properties?.schema?.properties ?? {}).forEach((k) => names.add(k));
    return names;
}

function outputNames(c: any): Set<string> {
    const names = new Set<string>();
    for (const port of c.outPorts ?? []) {
        if (typeof port !== 'object') continue;
        Object.keys(port.schema?.properties ?? {}).forEach((k) => names.add(k));
        for (const o of Array.isArray(port.options) ? port.options : []) if (o?.value) names.add(o.value);
    }
    return names;
}

function jaccard(a: Set<string>, b: Set<string>): number {
    if (!a.size && !b.size) return 1;
    let inter = 0;
    for (const x of a) if (b.has(x)) inter++;
    return inter / (a.size + b.size - inter);
}

function authType(src: string): string | null {
    return src.match(/type:\s*['"]([\w-]+)['"]/)?.[1] ?? null;
}
