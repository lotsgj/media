import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';

test('the portable media root and every declared book validate', async () => {
  const output = execFileSync(process.execPath, ['scripts/validate-media.mjs'], { encoding: 'utf8' });
  assert.match(output, /Validated media schema 1/);
  const catalog = JSON.parse(await readFile('catalog.json', 'utf8'));
  assert.deepEqual(catalog.books.map(({ book_id }) => book_id), ['bhagavad-gita', 'ganesha-atharva', 'purusha-sukta']);
});

test('media-owned catalog URLs are root-relative and external Google Deck URLs remain absolute', async () => {
  const catalog = await readFile('book/bhagavad-gita/audio/chanting-swami-brahmananda/catalog.csv', 'utf8');
  assert.match(catalog, /#audio\/chanting-swami-brahmananda\//);
  assert.doesNotMatch(catalog, /https?:\/\//);
  const learning = await readFile('book/bhagavad-gita/audio/chanting-aj-padma-aj-vijay-learn-mode/catalog.csv', 'utf8');
  assert.match(learning, /#audio\/chanting-aj-padma-aj-vijay-learn-mode\//);
  assert.doesNotMatch(learning, /https?:\/\//);

  const csvFiles = (await readdir('book', { recursive: true })).filter((path) => path.endsWith('.csv'));
  for (const path of csvFiles) {
    const text = await readFile(`book/${path}`, 'utf8');
    const absoluteUrls = text.match(/https?:\/\/[^#\s]+/g) || [];
    if (absoluteUrls.length) {
      assert.match(path, /^bhagavad-gita\/deck\//);
      assert.ok(absoluteUrls.every((url) => url.startsWith('https://docs.google.com/')));
    }
  }
});
