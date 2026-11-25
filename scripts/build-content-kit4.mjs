// Rebuilds the inventory: book manifests, files.json, catalog.json and media.ver, for the approved Content-Kit 4 version.
// The rules live in scripts/inventory.cjs, which media-admin also uses in the browser.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { nodeFolder } from './node-folder.mjs';

const require = createRequire(import.meta.url);
const inventory = require('./inventory.cjs');
const root = path.resolve(import.meta.dirname, '..');
const kitVersionSource = await readFile(path.resolve(root, '../mygita-app/engine/js/content-kit-v4-version.js'), 'utf8');
const kitVersion = kitVersionSource.match(/CONTENT_KIT_V4_VERSION\s*=\s*'([^']+)'/)?.[1];
const sha256 = async (bytes) => createHash('sha256').update(bytes).digest('hex');

const { writes, count } = await inventory.build({ kitVersion, ...nodeFolder(root), sha256 });
for (const [logical, text] of writes) await writeFile(path.join(root, logical), text);
console.log(`Built Content-Kit ${kitVersion} inventory with ${count} files.`);
