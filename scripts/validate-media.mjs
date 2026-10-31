import { access, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const requiredDirectories = ['book', 'audio', 'image', 'video'];

function resolveRootPath(relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || /^[a-z]+:/i.test(relative)) {
    throw new Error(`Media paths must be non-empty root-relative paths: ${relative}`);
  }
  const resolved = path.resolve(root, relative);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) throw new Error(`Media path escapes the root: ${relative}`);
  return resolved;
}

async function json(relative) {
  return JSON.parse(await readFile(resolveRootPath(relative), 'utf8'));
}

async function assertFile(relative) {
  const target = resolveRootPath(relative);
  if (!(await stat(target)).isFile()) throw new Error(`Declared media file is not a file: ${relative}`);
  if (relative.endsWith('.csv')) {
    const firstLine = (await readFile(target, 'utf8')).split(/\r?\n/, 1)[0];
    if (!firstLine || !firstLine.includes('#')) throw new Error(`CSV has no #-delimited header: ${relative}`);
  }
}

function rows(contents) {
  const lines = contents.trimEnd().split(/\r?\n/);
  const header = lines.shift().split('#');
  return { header, records: lines.filter(Boolean).map((line) => line.split('#')) };
}

async function validateVerseMasters(book) {
  const entries = Object.entries(book.verses?.masters || {});
  if (!entries.length) throw new Error(`${book.book_id} has no verse masters.`);
  let canonical = null;
  for (const [language, relative] of entries) {
    const table = rows(await readFile(resolveRootPath(relative), 'utf8'));
    const sid = table.header.indexOf('sid');
    if (sid < 0) throw new Error(`${relative} has no sid column.`);
    const sequence = table.records.map((record) => record[sid]);
    if (!sequence.length || sequence.some((value) => !value)) throw new Error(`${relative} has invalid SIDs.`);
    if (!canonical) canonical = sequence;
    else if (sequence.length !== canonical.length || sequence.some((value, index) => value !== canonical[index])) {
      throw new Error(`${book.book_id} ${language} SID order differs from the canonical master.`);
    }
  }
}

for (const directory of requiredDirectories) {
  if (!(await stat(path.join(root, directory))).isDirectory()) throw new Error(`Missing media directory: ${directory}`);
}

const catalog = await json('catalog.json');
if (catalog.schema_version !== 1) throw new Error('Unsupported media catalog schema.');
if (!String(catalog.content_version || '').trim()) throw new Error('Media catalog has no content version.');
if (!Array.isArray(catalog.books) || !catalog.books.length) throw new Error('Media catalog has no books.');

const ids = new Set();
for (const entry of catalog.books) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.book_id || '')) throw new Error(`Invalid book ID: ${entry.book_id}`);
  if (ids.has(entry.book_id)) throw new Error(`Duplicate book ID: ${entry.book_id}`);
  ids.add(entry.book_id);
  const book = await json(entry.manifest);
  if (book.schema_version !== catalog.schema_version) throw new Error(`${entry.book_id} schema does not match the root catalog.`);
  if (book.book_id !== entry.book_id) throw new Error(`${entry.manifest} declares the wrong book ID.`);
  if (!Array.isArray(book.files) || !book.files.length) throw new Error(`${entry.book_id} has no declared files.`);
  if (new Set(book.files).size !== book.files.length) throw new Error(`${entry.book_id} declares duplicate files.`);
  for (const relative of book.files) await assertFile(relative);
  await validateVerseMasters(book);
}

await access(path.join(root, 'audio'));
console.log(`Validated media schema ${catalog.schema_version}, content ${catalog.content_version}, and ${catalog.books.length} books.`);
