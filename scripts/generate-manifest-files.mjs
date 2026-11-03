import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { collectManifestGraph } from './manifest-files.mjs';

const root = path.resolve(import.meta.dirname, '..');
const catalog = JSON.parse(await readFile(path.join(root, 'catalog.json'), 'utf8'));
for (const entry of catalog.books) {
  const filename = path.join(root, entry.manifest);
  const manifest = JSON.parse(await readFile(filename, 'utf8'));
  manifest.files = (await collectManifestGraph(root, manifest)).files;
  await writeFile(filename, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`${entry.book_id}: ${manifest.files.length} metadata files`);
}
