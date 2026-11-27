import { spawn } from 'node:child_process';
import type { SpawnOptions } from 'node:child_process';

export interface RunResult {
    code: number | null;
    stdout: string;
    stderr: string;
    timedOut: boolean;
}

export interface RunOptions extends SpawnOptions {
    timeoutMs?: number;
    onStdout?: (chunk: string) => void;
}

/** Spawn a command without a shell and collect its output. Never throws on a non-zero exit. */
export function run(cmd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
    const { timeoutMs, onStdout, ...spawnOpts } = opts;
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, args, { ...spawnOpts, stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        let timedOut = false;
        const timer = timeoutMs ? setTimeout(() => {
            timedOut = true;
            child.kill('SIGTERM');
            setTimeout(() => child.kill('SIGKILL'), 10_000).unref();
        }, timeoutMs) : undefined;
        child.stdout!.setEncoding('utf8').on('data', (d: string) => {
            stdout += d;
            onStdout?.(d);
        });
        child.stderr!.setEncoding('utf8').on('data', (d: string) => { stderr += d; });
        child.on('error', reject);
        child.on('close', (code) => {
            if (timer) clearTimeout(timer);
            resolve({ code, stdout, stderr, timedOut });
        });
    });
}

/** Parse the first JSON object/array in a string (CLIs sometimes print a banner before it). */
export function parseJsonLoose(text: string): any {
    const start = text.search(/[{[]/);
    if (start === -1) throw new Error('no JSON in output');
    return JSON.parse(text.slice(start));
}

export function slug(s: string): string {
    return s.replace(/[^a-zA-Z0-9.-]+/g, '-');
}

export function mean(xs: number[]): number {
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
}
