/**
 * Vendor-aware connector lookup, shared by all skills.
 *
 * A workspace holds connectors under src/<vendor>/<connector>/ — "appmixer" is
 * only the default vendor namespace; a customer workspace can use any vendor
 * (and several vendors side by side). Component types mirror the disk layout:
 * <vendor>.<connector>[.<module>].<Component> ↔ src/<vendor>/<connector>/….
 */
import fs from 'fs';
import path from 'path';

export const DEFAULT_VENDOR = 'appmixer';

/**
 * Parse a connector reference the user/agent may pass:
 *   "crm"        → { vendor: null, connector: 'crm' }   (vendor to be discovered)
 *   "acme/crm"   → { vendor: 'acme', connector: 'crm' }
 *   "acme.crm"   → { vendor: 'acme', connector: 'crm' }
 */
export function parseConnectorRef(ref) {
    const s = String(ref || '').trim();
    const m = s.match(/^([\w-]+)[/.]([\w-]+)$/);
    if (m) return { vendor: m[1], connector: m[2] };
    return { vendor: null, connector: s };
}

/** Vendor directories present in the workspace (subdirs of <root>/src). */
export function listVendors(root) {
    const src = path.join(root, 'src');
    if (!fs.existsSync(src)) return [];
    return fs.readdirSync(src, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        .map((e) => e.name);
}

/**
 * Resolve a connector reference to { vendor, connector, dir }.
 * Bare names are searched across all vendor dirs; an ambiguous match (same
 * connector under several vendors) throws with instructions to qualify the
 * reference as <vendor>/<connector>.
 */
export function findConnectorDir(root, ref) {
    const { vendor, connector } = parseConnectorRef(ref);
    if (vendor) {
        const dir = path.join(root, 'src', vendor, connector);
        if (!fs.existsSync(dir)) throw new Error(`Connector not found: ${dir}`);
        return { vendor, connector, dir };
    }
    const matches = listVendors(root)
        .filter((v) => fs.existsSync(path.join(root, 'src', v, connector)))
        .map((v) => ({ vendor: v, connector, dir: path.join(root, 'src', v, connector) }));
    if (matches.length === 1) return matches[0];
    if (matches.length === 0) {
        throw new Error(
            `Connector "${connector}" not found under ${path.join(root, 'src')}/<vendor>/ ` +
            `(vendors present: ${listVendors(root).join(', ') || 'none'})`);
    }
    throw new Error(
        `Connector "${connector}" exists under several vendors ` +
        `(${matches.map((m) => m.vendor).join(', ')}) — qualify it as <vendor>/${connector}.`);
}

export default { DEFAULT_VENDOR, parseConnectorRef, listVendors, findConnectorDir };
