import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mean } from './util.ts';
import type { Grades, TraceStats } from './graders.ts';
import type { AgentResult } from './agent.ts';

export interface RunRecord {
    task: string;
    size: 'small' | 'large';
    variant: string;
    model: string;
    skills: string;
    repeat: number;
    startedAt: string;
    agent: AgentResult | null;
    grades: Grades;
    trace: TraceStats | null;
}

export function loadRecords(dir: string): RunRecord[] {
    return readdirSync(dir)
        .filter((f) => f.endsWith('.result.json'))
        .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
}

const pct = (x: number) => (Number.isNaN(x) ? '–' : `${Math.round(x * 100)} %`);
const num = (x: number, d = 1) => (Number.isNaN(x) ? '–' : x.toFixed(d));
const usd = (x: number) => (Number.isNaN(x) ? '–' : `$${x.toFixed(2)}`);
const defined = (xs: (number | null | undefined)[]) => xs.filter((x): x is number => typeof x === 'number');

/** Markdown summary: one row per task × variant, then totals per variant. */
export function renderReport(records: RunRecord[]): string {
    const out: string[] = [];
    const variants = [...new Set(records.map((r) => r.variant))].sort();
    const tasks = [...new Set(records.map((r) => r.task))].sort();

    out.push('# Connector eval report', '');
    out.push(`${records.length} runs · ${tasks.length} tasks · variants: ${variants.join(', ')}`, '');
    out.push('Gate = every expected component exists, `connector validate` and eslint are clean.', '');

    out.push('## Per task', '');
    out.push('| Task | Variant | Runs | Gate | Coverage | Validator fails | ESLint errs | Input overlap | Output overlap | Skill used | Tool errors | Cost | Turns | Minutes |');
    out.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const task of tasks) {
        for (const variant of variants) {
            const rs = records.filter((r) => r.task === task && r.variant === variant);
            if (!rs.length) continue;
            out.push(`| ${task} | ${variant} | ${rs.length} | ${pct(mean(rs.map((r) => +r.grades.gate)))} `
                + `| ${pct(mean(rs.map((r) => r.grades.coverage.found / r.grades.coverage.expected)))} `
                + `| ${num(mean(rs.map((r) => r.grades.validator.failures)))} `
                + `| ${num(mean(rs.map((r) => r.grades.eslint.errors)))} `
                + `| ${pct(mean(defined(rs.map((r) => r.grades.inputOverlap))))} `
                + `| ${pct(mean(defined(rs.map((r) => r.grades.outputOverlap))))} `
                + `| ${pct(mean(defined(rs.map((r) => (r.trace ? +(r.trace.skillInvoked || r.trace.referencesRead.length > 0) : null)))))} `
                + `| ${num(mean(defined(rs.map((r) => r.trace?.toolErrors))))} `
                + `| ${usd(mean(defined(rs.map((r) => r.agent?.costUsd))))} `
                + `| ${num(mean(defined(rs.map((r) => r.agent?.numTurns))), 0)} `
                + `| ${num(mean(defined(rs.map((r) => r.agent?.durationMs))) / 60000)} |`);
        }
    }

    out.push('', '## Per variant', '');
    out.push('| Variant | Runs | Gate pass | Total cost | $ per passing run | Agent errors / timeouts |');
    out.push('|---|---|---|---|---|---|');
    for (const variant of variants) {
        const rs = records.filter((r) => r.variant === variant);
        const passed = rs.filter((r) => r.grades.gate).length;
        const cost = defined(rs.map((r) => r.agent?.costUsd)).reduce((a, b) => a + b, 0);
        const errors = rs.filter((r) => r.agent?.isError).length;
        out.push(`| ${variant} | ${rs.length} | ${passed}/${rs.length} | ${usd(cost)} | ${passed ? usd(cost / passed) : '–'} | ${errors} |`);
    }

    const leaky = records.filter((r) => r.trace?.leaks.length);
    if (leaky.length) {
        out.push('', '## ⚠ Possible reference leaks', '');
        for (const r of leaky) out.push(`- ${r.task} / ${r.variant} #${r.repeat}: ${r.trace!.leaks[0]}`);
    }

    const rules: Record<string, number> = {};
    for (const r of records) for (const [k, v] of Object.entries(r.grades.validator.byRule)) rules[k] = (rules[k] ?? 0) + v;
    if (Object.keys(rules).length) {
        out.push('', '## Validator failures by rule (all runs)', '');
        for (const [k, v] of Object.entries(rules).sort((a, b) => b[1] - a[1])) out.push(`- \`${k}\`: ${v}`);
    }
    return out.join('\n') + '\n';
}
