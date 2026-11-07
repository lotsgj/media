import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const kitUrl = pathToFileURL(path.resolve(root, '../mygita/engine/js/content-kit.js')).href;
const contractUrl = pathToFileURL(path.resolve(root, '../mygita/engine/js/media-contract.js')).href;
const { contentTree, openMedia, publish, checkFile } = await import(kitUrl);
const { safeMediaPath, selectMediaMount, validateDeckDescriptor } = await import(contractUrl);
const readJson = async (relative) => JSON.parse(await readFile(path.join(root, relative), 'utf8'));
const readText = (logical) => readFile(path.join(root, logical), 'utf8');
const media = await openMedia(readText);
const catalog = media.catalog;
const catalogBytes = await readFile(path.join(root, 'catalog.json'));
const mediaVersion = (await readFile(path.join(root, 'media.ver'), 'utf8')).trim().split(/\s+/);
if (mediaVersion[0] !== createHash('sha256').update(catalogBytes).digest('hex')) throw new Error('media.ver does not match catalog.json.');
if (mediaVersion[1] !== catalog.content_kit_version) throw new Error('media.ver Content-Kit version does not match catalog.json.');
for (const part of media.inventoryParts) {
  const bytes = await readFile(path.join(root, part.path));
  if (createHash('sha256').update(bytes).digest('hex') !== part.hash) throw new Error(`${part.path} hash is stale.`);
}
const localPath = (logical) => {
  const safe = safeMediaPath(logical);
  const mount = selectMediaMount(catalog, safe);
  const localRoot = mount.local === path.basename(root) ? root : path.resolve(root, '..', mount.local);
  return path.join(localRoot, safe);
};
const assertFile = async (logical) => {
  try { if ((await stat(localPath(logical))).isFile()) return; } catch {}
  throw new Error(`Logical media reference is missing: ${logical}`);
};
const rows = (contents) => {
  const lines = contents.trimEnd().split(/\r?\n/);
  const header = lines.shift().split('#');
  return { header, records: lines.filter(Boolean).map((line) => line.split('#')) };
};
async function validateVerseMasters(book) {
  let canonical = null;
  for (const [language, relative] of Object.entries(book.verses?.masters || {})) {
    const table = rows(await readFile(localPath(relative), 'utf8'));
    const sid = table.header.indexOf('sid');
    if (sid < 0) throw new Error(`${relative} has no sid column.`);
    const sequence = table.records.map((record) => record[sid]);
    if (!sequence.length || sequence.some((value) => !value)) throw new Error(`${relative} has invalid SIDs.`);
    if (!canonical) canonical = sequence;
    else if (sequence.length !== canonical.length || sequence.some((value, index) => value !== canonical[index])) throw new Error(`${book.book_id} ${language} SID order differs from the canonical master.`);
  }
}

for (const entry of catalog.books) {
  await assertFile(entry.manifest);
  const book = media.books.find((candidate) => candidate.id === entry.book_id).manifest;
  if (book.content_kit_version !== catalog.content_kit_version) throw new Error(`${entry.book_id} Content-Kit version does not match the root catalog.`);
  if (book.content_version !== catalog.content_version) throw new Error(`${entry.book_id} content version does not match the root catalog.`);
  for (const file of book.files) {
    const inventory = media.fileIndex.get(file.path);
    if (!inventory) throw new Error(`${file.path} is missing from the mount inventories.`);
    if (inventory.hash !== file.hash) throw new Error(`${file.path} inventory and book-manifest hashes differ.`);
    await assertFile(file.path);
    const bytes = await readFile(localPath(file.path));
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (actual !== file.hash) throw new Error(`${file.path} hash is stale; run npm run publish.`);
    if (file.path.startsWith('deck/') && file.path.endsWith('.json')) validateDeckDescriptor(JSON.parse(bytes));
  }
  for (const group of await contentTree(media, entry.book_id)) for (const file of group.files) {
    if (!file.path.endsWith('.csv') && !file.path.endsWith('.json')) continue;
    const problems = checkFile(file, await readText(file.path));
    if (problems.length) throw new Error(problems[0].message);
  }
  await validateVerseMasters(book);
}
for (const entry of media.fileIndex.values()) {
  await assertFile(entry.path);
  const bytes = await readFile(localPath(entry.path));
  if (bytes.length !== entry.size) throw new Error(`${entry.path} size is stale.`);
  if (createHash('sha256').update(bytes).digest('hex') !== entry.hash) throw new Error(`${entry.path} inventory hash is stale.`);
}
const digest = async (logical, replacement = null) => createHash('sha256').update(replacement ?? await readFile(localPath(logical))).digest('hex');
const dryRun = await publish(media, { readText, hashOf: digest, releaseLabel: catalog.content_version, updatedAt: catalog.updated_at });
if (dryRun.problems.blocking.length) throw new Error(dryRun.problems.blocking[0].message);
if (dryRun.writes.length) throw new Error(`Published metadata is stale: ${dryRun.writes.map((write) => write.path).join(', ')}.`);
console.log(`Validated Content-Kit ${catalog.content_kit_version}, ${media.fileIndex.size} physical files, and ${catalog.books.length} books.`);
