import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { run } from './util.ts';
import type { Task } from './tasks.ts';

export interface AgentOptions {
    model: string;
    pluginDir: string;
    maxBudgetUsd: number;
    timeoutMs: number;
}

export interface AgentResult {
    exitCode: number | null;
    timedOut: boolean;
    isError: boolean;
    costUsd: number | null;
    numTurns: number | null;
    durationMs: number | null;
    resultText: string;
}

export function buildPrompt(task: Task): string {
    const c = task.connector;
    return `You are working in a checkout of the Appmixer connectors repository (the current working directory).

=== TASK ===
${task.prompt}
=== END TASK ===

Constraints for this run:
- Implement the change in this checkout only. There is no git remote: do not create branches, commits or pull requests.
- Do not publish to an Appmixer instance, do not run components or E2E flows against a live instance, and do not log in anywhere. No credentials are available. Do not generate E2E test flows.
- Use the \`appmixer\` skills plugin (build-connector and its references) for conventions, and follow .claude/CLAUDE.md.
- Bash is restricted to: \`find ...\`, \`grep ...\`, \`ls\`, \`mkdir\`, \`node scripts/validate.js ...\`, \`appmixer connector validate ...\`, \`npx eslint ...\`, \`npm run lint\`, \`git status\`, \`git diff\`, \`base64 ...\`. One simple command per call, no pipes or chaining. Read files with the Read tool.
- Before finishing, run \`node scripts/validate.js --connector ${c}\` and \`npx eslint src/appmixer/${c} --ext .js\` and fix what they report.
- Work autonomously; nobody will answer questions. When done, reply with a short summary of what you built.`;
}

/**
 * Run headless Claude Code in the sandbox. The stream-json trace is written
 * to tracePath; the final `result` event carries cost, turns and duration.
 *
 * Isolation from the operator's own setup: project settings only (the sandbox
 * writes its own), no MCP servers, no persisted session, no auto-memory, and
 * the skills come solely from --plugin-dir. With ANTHROPIC_API_KEY set, --bare
 * additionally skips hooks and keychain, with CLAUDE.md passed via --add-dir.
 */
export async function runAgent(task: Task, sandbox: string, tracePath: string, opts: AgentOptions): Promise<AgentResult> {
    const args = [
        '-p', buildPrompt(task),
        '--output-format', 'stream-json',
        '--verbose',
        '--model', opts.model,
        '--plugin-dir', opts.pluginDir,
        '--max-budget-usd', String(opts.maxBudgetUsd),
        '--permission-mode', 'dontAsk',
        '--settings', join(sandbox, '.claude', 'settings.json'),
        '--setting-sources', 'project',
        '--strict-mcp-config',
        '--no-session-persistence'
    ];
    if (process.env.ANTHROPIC_API_KEY) args.push('--bare', '--add-dir', sandbox);

    // Nothing in the sandbox needs GitHub; don't hand the agent a token.
    const env = { ...process.env, CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' };
    for (const k of ['GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_VERO_TOKEN']) delete env[k];

    const trace = createWriteStream(tracePath);
    let final: any = null;
    let pending = '';
    const res = await run('claude', args, {
        cwd: sandbox,
        env,
        timeoutMs: opts.timeoutMs,
        onStdout: (chunk) => {
            trace.write(chunk);
            pending += chunk;
            const lines = pending.split('\n');
            pending = lines.pop()!;
            for (const line of lines) {
                if (!line.includes('"type":"result"')) continue;
                try { final = JSON.parse(line); } catch { /* partial or foreign line */ }
            }
        }
    });
    await new Promise((r) => trace.end(r));

    return {
        exitCode: res.code,
        timedOut: res.timedOut,
        isError: !final || !!final.is_error || res.timedOut,
        costUsd: final?.total_cost_usd ?? null,
        numTurns: final?.num_turns ?? null,
        durationMs: final?.duration_ms ?? null,
        resultText: final?.result ?? res.stderr.slice(-2000)
    };
}
