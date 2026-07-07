/**
 * Layout sanity (relaxed): every connection should flow left→right with a
 * minimum gap, so flows read cleanly without backward/crossing edges. We do NOT
 * enforce the exact 192/128 grid (too brittle) — just: target.x >= source.x + 128.
 */
import { shortType, edges } from './lib/flowutil.js';

const MIN_DX = 128;

export const name = 'layout';
export const description = `Each connection: target.x >= source.x + ${MIN_DX} (left→right, min gap)`;

export const run = (ctx) => {
    for (const { file, json } of ctx.flows) {
        for (const { sourceId, targetId, source, target } of edges(json)) {
            if (!source || typeof source.x !== 'number' || typeof target.x !== 'number') continue;
            if (target.x < source.x + MIN_DX) {
                ctx.addWarning(file,
                    `[layout] ${targetId} (${shortType(target.type)}) is left of / too close to its ` +
                    `source ${sourceId} (${shortType(source.type)}): target.x=${target.x} < source.x=${source.x}+${MIN_DX}`);
            }
        }
    }
};
