// The shared inventory builder (scripts/inventory.cjs) is used by scripts/build-content-kit4.mjs in Node and by
// media-admin in the browser. Both must produce exactly the committed inventory.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { nodeFolder } from '../scripts/node-folder.mjs';

const require = createRequire(import.meta.url);
const inventory = require('../scripts/inventory.cjs');
const root = new URL('..', import.meta.url).pathname;
const sha256 = async (bytes) => createHash('sha256').update(bytes).digest('hex');
const kitVersion = JSON.parse(await readFile(new URL('../catalog.json', import.meta.url), 'utf8')).content_kit_version;

test('the inventory builder reproduces the committed manifests, files.json, catalog.json and media.ver', async () => {
  const folder = nodeFolder(root);
  const { writes, count } = await inventory.build({ kitVersion, ...folder, sha256 });
  assert.equal(count, JSON.parse(await readFile(new URL('../files.json', import.meta.url), 'utf8')).files.length);
  assert.ok(writes.has('files.json') && writes.has('catalog.json') && writes.has('media.ver'));
  for (const [path, text] of writes) assert.equal(text, await readFile(new URL(`../${path}`, import.meta.url), 'utf8'), `${path} is current`);
});

test('reusing recorded hashes gives the same inventory, and changed files are always hashed again', async () => {
  const folder = nodeFolder(root);
  const full = await inventory.build({ kitVersion, ...folder, sha256 });
  let hashed = 0;
  const counting = async (bytes) => { hashed += 1; return sha256(bytes); };
  const reused = await inventory.build({ kitVersion, ...folder, sha256: counting, reuseHashes: true });
  assert.deepEqual([...reused.writes], [...full.writes]);
  assert.ok(hashed < 10, `only the rewritten manifests are hashed again (${hashed})`);

  // An edited registry file must not keep its recorded hash, even at the same size.
  const edited = 'registry/contributors.csv';
  const original = await folder.read(edited);
  const changedBytes = Buffer.from(original); changedBytes[changedBytes.length - 2] ^= 1;
  const changed = await inventory.build({ kitVersion, ...folder, read: async (path) => (path === edited ? changedBytes : folder.read(path)), sha256, reuseHashes: true, changed: new Set([edited]) });
  const entry = JSON.parse(changed.writes.get('files.json')).files.find((file) => file.path === edited);
  assert.equal(entry.hash, await sha256(changedBytes));
});

test('which files belong to the inventory', () => {
  assert.equal(inventory.includes('audio/bhagavad-gita/x.mp3'), true);
  assert.equal(inventory.includes('image/profile/acharya/GJ-09VX-E4D8-1.webp'), true);
  assert.equal(inventory.includes('scripts/build-content-kit4.mjs'), false);
  assert.equal(inventory.includes('files.json'), false);
  assert.equal(inventory.includes('image/.DS_Store'), false);
  assert.equal(inventory.includes('book/.git/x'), false);
});
