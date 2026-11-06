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
  if (book.schema_version !== catalog.schema_version) throw new Error(`${entry.book_id} schema does not match the root catalog.`);
  if (book.content_version !== catalog.content_version) throw new Error(`${entry.book_id} content version does not match the root catalog.`);
  for (const file of book.files) {
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
const digest = async (logical, replacement = null) => createHash('sha256').update(replacement ?? await readFile(localPath(logical))).digest('hex');
const dryRun = await publish(media, { readText, hashOf: digest, releaseLabel: catalog.content_version, updatedAt: catalog.updated_at });
if (dryRun.problems.blocking.length) throw new Error(dryRun.problems.blocking[0].message);
if (dryRun.writes.length) throw new Error(`Published metadata is stale: ${dryRun.writes.map((write) => write.path).join(', ')}.`);
console.log(`Validated media schema ${catalog.schema_version}, content ${catalog.content_version}, and ${catalog.books.length} books.`);
