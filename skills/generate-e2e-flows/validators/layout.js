/**
 * Layout sanity: flows read cleanly as a left→right staircase.
 *   - horizontal: target.x >= source.x + MIN_DX (no backward / too-close edges)
 *   - vertical: connected components either share a row (Δy === 0) or step by at
 *     least MIN_DY, so rows never visually collide.
 * Minimums are the user-confirmed E2E grid: MIN_DX = 208, MIN_DY = 128.
 * (Warnings, not errors — spacing above the minimum is fine.)
 */
import { shortType, edges } from './lib/flowutil.js';

const MIN_DX = 208;
const MIN_DY = 128;

export const name = 'layout';
export const description = `Each connection: target.x >= source.x + ${MIN_DX}; Δy is 0 or >= ${MIN_DY}`;

export const run = (ctx) => {
    for (const { file, json } of ctx.flows) {
        for (const { sourceId, targetId, source, target } of edges(json)) {
            if (!source || typeof source.x !== 'number' || typeof target.x !== 'number') continue;

            if (target.x < source.x + MIN_DX) {
                ctx.addWarning(file,
                    `[layout] ${targetId} (${shortType(target.type)}) is left of / too close to its ` +
                    `source ${sourceId} (${shortType(source.type)}): target.x=${target.x} < source.x=${source.x}+${MIN_DX}`);
            }

            if (typeof source.y === 'number' && typeof target.y === 'number') {
                const dy = Math.abs(target.y - source.y);
                if (dy > 0 && dy < MIN_DY) {
                    ctx.addWarning(file,
                        `[layout] ${targetId} (${shortType(target.type)}) overlaps its source ${sourceId} ` +
                        `vertically: |Δy|=${dy} < ${MIN_DY} (use the same row or step by >= ${MIN_DY})`);
                }
            }
        }
    }
};
