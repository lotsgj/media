import { createHash } from 'node:crypto';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const kitVersionSource = await readFile(path.resolve(root, '../mygita-app/engine/js/content-kit-v4-version.js'), 'utf8');
const kitVersion = kitVersionSource.match(/CONTENT_KIT_V4_VERSION\s*=\s*'([^']+)'/)?.[1];
if (!/^4\.\d{8}-\d{6}$/.test(kitVersion || '')) throw new Error('Unable to read the approved Content-Kit 4 version.');
const namespaces = new Set(['book', 'audio', 'image', 'video', 'deck', 'docs', 'registry']);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
let previousContracts = new Map();
try { previousContracts = new Map(JSON.parse(await readFile(path.join(root, 'files.json'), 'utf8')).files.map((entry) => [entry.path, entry.contract])); } catch {}

function contractFor(logical) {
  if (logical.includes('/runtime/registry/')) {
    if (/\/verses\/collection_[a-z-]+\.csv$/.test(logical)) return 'runtime-verse-details';
    if (/\/verses\/collection\.csv$/.test(logical)) return 'runtime-verse-registry';
    if (/\/audio\/collection\.csv$/.test(logical)) return 'runtime-audio-registry';
    if (/\/image\/collection\.csv$/.test(logical)) return 'runtime-image-registry';
    if (/\/questions\/collection\.csv$/.test(logical)) return 'runtime-text-registry';
    if (/\/deck\/collection\.csv$/.test(logical)) return 'runtime-deck-registry';
  }
  if (/\/registry\/(?:verse|question|image|audio|video|deck)\/collection\.csv$/.test(logical)) return 'ck4-collection-registry';
  if (/\/registry\/(?:verse|question|image|audio|video|deck)\/defaults\.csv$/.test(logical)) return 'ck4-defaults-registry';
  if (/\/registry\/(?:verse|question|image|audio|video|deck)\/.+-variants\.csv$/.test(logical)) return 'ck4-variant-registry';
  if (/\/registry\/(?:verse|question|image|audio|video|deck)\/metadata\/.+\.csv$/.test(logical)) return 'ck4-collection-metadata';
  if (/\/registry\/verses\/collection_[a-z-]+\.csv$/.test(logical)) return 'verse-details';
  if (/^registry\/contributors\.csv$/.test(logical)) return 'ck4-contributors-registry';
  if (/^registry\/cue-purposes\.csv$/.test(logical)) return 'ck4-cue-purposes-registry';
  if (/^registry\/languages\.csv$/.test(logical)) return 'ck4-languages-registry';
  if (previousContracts.has(logical)) return previousContracts.get(logical);
  if (!/\.(?:csv|json)$/i.test(logical)) return 'asset';
  throw new Error(`New structured file ${logical} requires an explicit contract entry before inventory generation.`);
}

function mimeFor(logical) {
  const extension = path.extname(logical).toLowerCase();
  return ({ '.csv': 'text/csv', '.json': 'application/json', '.md': 'text/markdown', '.txt': 'text/plain', '.tsv': 'text/tab-separated-values', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.opus': 'audio/ogg; codecs=opus', '.wav': 'audio/wav', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.webm': 'video/webm', '.pdf': 'application/pdf' })[extension] || 'application/octet-stream';
}

function mediaTypeFor(logical, mime) {
  const namespace = logical.split('/')[0];
  if (['audio', 'image', 'video', 'deck', 'book', 'docs', 'registry'].includes(namespace)) return namespace;
  return mime.split('/')[0] || 'asset';
}

async function listedFiles(directory = root, relative = '') {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (['.git', 'node_modules'].includes(entry.name)) continue;
    const logical = relative ? `${relative}/${entry.name}` : entry.name;
    if (!relative && !namespaces.has(entry.name)) continue;
    if (entry.name === '.DS_Store') continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await listedFiles(absolute, logical));
    else if (entry.isFile()) result.push(logical);
  }
  return result;
}

const catalogPath = path.join(root, 'catalog.json');
const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
for (const book of catalog.books) {
  const manifestPath = path.join(root, book.manifest);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  delete manifest.schema_version;
  manifest.content_kit_version = kitVersion;
  const bookPrefix = `book/${book.book_id}/`;
  const existing = new Map((manifest.files || []).map((entry) => [entry.path, entry]));
  for (const logical of [...existing.keys()]) {
    try { await stat(path.join(root, logical)); } catch { existing.delete(logical); }
  }
  for (const logical of await listedFiles(path.join(root, 'book', book.book_id), bookPrefix.slice(0, -1))) {
    if (!logical.includes('/registry/')) continue;
    existing.set(logical, { path: logical, hash: digest(await readFile(path.join(root, logical))) });
  }
  manifest.files = [...existing.values()].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  book.manifest_hash = digest(await readFile(manifestPath));
}

const files = [];
for (const logical of (await listedFiles()).sort()) {
  const absolute = path.join(root, logical); const bytes = await readFile(absolute); const info = await stat(absolute); const mime = mimeFor(logical);
  files.push({ path: logical, media_type: mediaTypeFor(logical, mime), mime_type: mime, size: info.size, hash: digest(bytes), contract: contractFor(logical), state: 'active' });
}
const inventory = { content_kit_version: kitVersion, mount_id: 'media', files };
const inventoryText = `${JSON.stringify(inventory, null, 2)}\n`;
await writeFile(path.join(root, 'files.json'), inventoryText);

catalog.content_kit_version = kitVersion;
catalog.minimum_kit_version = kitVersion;
delete catalog.schema_version;
catalog.mounts = [{
  mount_id: 'media',
  remote: 'https://media.gitajyoti.org/',
  local: 'media',
  inventories: [{ id: 'all', path: 'files.json', hash: digest(Buffer.from(inventoryText)) }]
}];
const catalogText = `${JSON.stringify(catalog, null, 2)}\n`;
await writeFile(catalogPath, catalogText);
await writeFile(path.join(root, 'media.ver'), `${digest(Buffer.from(catalogText))} ${kitVersion}\n`);
console.log(`Built Content-Kit ${kitVersion} inventory with ${files.length} files.`);
