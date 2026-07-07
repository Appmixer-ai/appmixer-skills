//
// Local flow-file I/O. Deterministic, no AI, no network.
// Maps a server-side flow to/from its JSON file under <connector>/artifacts/test-flows/.
//
import fs from 'fs';
import path from 'path';
import chalk from 'chalk';

function testFlowsDir(connectorsDir, connector) {
    return path.join(connectorsDir, 'src', 'appmixer', connector, 'artifacts', 'test-flows');
}

// Derive the connectors repo root from a flow.json path by anchoring on the `src/appmixer` segment.
// e.g. /repo/src/appmixer/microsoft/dynamics/test-flow-contact.json → /repo
export function deriveConnectorsDir(flowPath) {
    const abs = path.resolve(flowPath);
    const marker = `${path.sep}src${path.sep}appmixer${path.sep}`;
    const idx = abs.indexOf(marker);
    if (idx === -1) throw new Error(`Flow path is not under src/appmixer: ${abs}`);
    return abs.slice(0, idx);
}

// Derive the set of dotted connector prefixes from the flow's component types (authoritative — handles
// nested like microsoft.dynamics and multi-connector flows). Excludes appmixer.utils.* infrastructure.
// type `appmixer.microsoft.dynamics.CreateContact` → prefix `microsoft.dynamics`.
export function deriveConnectorPrefixes(flowJson) {
    const prefixes = new Set();
    for (const comp of Object.values(flowJson.flow || {})) {
        const type = comp.type || '';
        if (!type.startsWith('appmixer.') || type.startsWith('appmixer.utils.')) continue;
        prefixes.add(type.split('.').slice(1, -1).join('.'));
    }
    return [...prefixes];
}

// Find the local JSON whose `name` matches the server-side flow name.
export function findFlowJsonOnDisk(connectorsDir, connector, flowName) {
    const dir = testFlowsDir(connectorsDir, connector);
    if (!fs.existsSync(dir)) return null;
    for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.json'))) {
        try {
            const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'));
            if (data.name === flowName) return path.join(dir, file);
        } catch { /* skip unparseable */ }
    }
    return null;
}

// Persist the current server-side flow back to disk (used on every terminal state so the repo
// always reflects what actually ran). Strips server-only fields and instance-specific store IDs.
export function saveFlowToDisk(connectorsDir, connector, serverFlow, knownPath = null) {
    const flowName = serverFlow.name;
    let flowJsonPath = knownPath || findFlowJsonOnDisk(connectorsDir, connector, flowName);

    if (!flowJsonPath) {
        const slug = flowName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const dir = testFlowsDir(connectorsDir, connector);
        fs.mkdirSync(dir, { recursive: true });
        flowJsonPath = path.join(dir, `test-flow-${slug}.json`);
        console.log(chalk.yellow(`No local file for "${flowName}" — creating ${flowJsonPath}`));
    }

    const SERVER_FIELDS = ['err', 'flowId', 'userId', 'stage', 'createdAt', 'modifiedAt', 'customFields', 'description', 'runtimeErrors'];
    const toSave = Object.fromEntries(Object.entries(serverFlow).filter(([k]) => !SERVER_FIELDS.includes(k)));

    for (const comp of Object.values(toSave.flow || {})) {
        if (comp.type?.includes('ProcessE2EResults') && comp.config?.properties) {
            delete comp.config.properties.successStoreId;
            delete comp.config.properties.failedStoreId;
        }
    }

    fs.writeFileSync(flowJsonPath, JSON.stringify(toSave, null, 4), 'utf-8');
    console.log(chalk.green(`Saved flow "${flowName}" → ${flowJsonPath}`));
    return flowJsonPath;
}

export function readFlowJson(flowJsonPath) {
    return JSON.parse(fs.readFileSync(flowJsonPath, 'utf-8'));
}
