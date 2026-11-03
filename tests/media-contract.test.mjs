import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { collectManifestGraph } from '../scripts/manifest-files.mjs';

test('the portable media root and every declared book validate', async () => {
  const output = execFileSync(process.execPath, ['scripts/validate-media.mjs'], { encoding: 'utf8' });
  assert.match(output, /Validated media schema 2/);
  const catalog = JSON.parse(await readFile('catalog.json', 'utf8'));
  assert.deepEqual(catalog.books.map(({ book_id }) => book_id), ['bhagavad-gita', 'ganesha-atharva', 'purusha-sukta']);
});

test('media-owned catalog URLs are logical and external URLs live only in deck descriptors', async () => {
  const catalog = await readFile('book/bhagavad-gita/audio/chanting-swami-brahmananda/catalog.csv', 'utf8');
  assert.match(catalog, /#audio\/bhagavad-gita\/chanting-swami-brahmananda\//);
  assert.doesNotMatch(catalog, /https?:\/\//);
  const learning = await readFile('book/bhagavad-gita/audio/chanting-aj-padma-aj-vijay-learn-mode/catalog.csv', 'utf8');
  assert.match(learning, /#audio\/bhagavad-gita\/chanting-aj-padma-aj-vijay-learn-mode\//);
  assert.doesNotMatch(learning, /https?:\/\//);

  const csvFiles = (await readdir('book', { recursive: true })).filter((path) => path.endsWith('.csv'));
  for (const path of csvFiles) {
    const text = await readFile(`book/${path}`, 'utf8');
    const absoluteUrls = text.match(/https?:\/\/[^#\s]+/g) || [];
    assert.deepEqual(absoluteUrls, [], `owned URL in book/${path}`);
  }
  const descriptor = JSON.parse(await readFile('deck/bhagavad-gita/gita-sara/1.1.json', 'utf8'));
  assert.match(descriptor.source, /^https:\/\/docs\.google\.com\//);
});

test('generated manifest file lists are metadata-only and current', async () => {
  const catalog = JSON.parse(await readFile('catalog.json', 'utf8'));
  for (const entry of catalog.books) {
    const manifest = JSON.parse(await readFile(entry.manifest, 'utf8'));
    const generated = (await collectManifestGraph(path.resolve('.'), manifest)).files;
    assert.deepEqual(manifest.files, generated);
    assert.ok(generated.every((value) => /\.(?:csv|json)$/.test(value)));
  }
});
