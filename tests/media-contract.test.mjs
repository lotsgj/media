import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

test('the portable media root and every declared book validate', async () => {
  const output = execFileSync(process.execPath, ['scripts/validate-media.mjs'], { encoding: 'utf8' });
  assert.match(output, /Validated media schema 1/);
  const catalog = JSON.parse(await readFile('catalog.json', 'utf8'));
  assert.deepEqual(catalog.books.map(({ book_id }) => book_id), ['bhagavad-gita', 'ganesha-atharva', 'purusha-sukta']);
});

test('the compatibility audio roots remain present during migration', async () => {
  const catalog = await readFile('book/bhagavad-gita/audio/chanting-swami-brahmananda/catalog.csv', 'utf8');
  assert.match(catalog, /https:\/\/media\.gitajyoti\.org\/audio\/chanting-swami-brahmananda\//);
  const learning = await readFile('book/bhagavad-gita/audio/chanting-aj-padma-aj-vijay-learn-mode/catalog.csv', 'utf8');
  assert.match(learning, /https:\/\/media\.gitajyoti\.org\/audio\/chanting-aj-padma-aj-vijay-learn-mode\//);
});
