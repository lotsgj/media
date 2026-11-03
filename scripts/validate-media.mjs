import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { collectManifestGraph } from './manifest-files.mjs';

const root = path.resolve(import.meta.dirname, '..');
const contractUrl = pathToFileURL(path.resolve(root, '../mygita/engine/js/media-contract.js')).href;
const { normalizeMediaCatalog, safeMediaPath, selectMediaMount, validateBookManifest, validateDeckDescriptor } = await import(contractUrl);
const readJson = async (relative) => JSON.parse(await readFile(path.join(root, relative), 'utf8'));
const catalog = normalizeMediaCatalog(await readJson('catalog.json'), { catalogRoot: 'https://media.gitajyoti.org/' });
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
  const book = validateBookManifest(await readJson(entry.manifest), entry.book_id);
  if (book.schema_version !== catalog.schema_version) throw new Error(`${entry.book_id} schema does not match the root catalog.`);
  if (book.content_version !== catalog.content_version) throw new Error(`${entry.book_id} content version does not match the root catalog.`);
  const graph = await collectManifestGraph(root, book);
  if (JSON.stringify(book.files) !== JSON.stringify(graph.files)) throw new Error(`${entry.book_id} files list is stale; run npm run generate:manifests.`);
  for (const logical of graph.references) await assertFile(logical);
  for (const logical of graph.files.filter((value) => value.startsWith('deck/') && value.endsWith('.json'))) validateDeckDescriptor(await readJson(logical));
  await validateVerseMasters(book);
}
console.log(`Validated media schema ${catalog.schema_version}, content ${catalog.content_version}, and ${catalog.books.length} books.`);
