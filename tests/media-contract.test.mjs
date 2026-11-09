import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';

test('the portable media root and every declared book validate', async () => {
  const output = execFileSync(process.execPath, ['scripts/validate-media.mjs'], { encoding: 'utf8' });
  assert.match(output, /Validated Content-Kit 4\.\d{8}-\d{6}/);
  const catalog = JSON.parse(await readFile('catalog.json', 'utf8'));
  assert.match(catalog.content_kit_version, /^4\.\d{8}-\d{6}$/);
  assert.equal(catalog.minimum_kit_version, catalog.content_kit_version);
  assert.equal(catalog.mounts.length, 1);
  assert.equal(catalog.mounts[0].prefixes, undefined);
  assert.equal(catalog.mounts[0].inventories.length, 1);
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

test('generated manifests contain a complete hashed inventory and experience subsets', async () => {
  const catalog = JSON.parse(await readFile('catalog.json', 'utf8'));
  assert.equal(catalog.schema_version, undefined);
  for (const entry of catalog.books) {
    assert.match(entry.manifest_hash, /^[a-f0-9]{64}$/);
    const manifest = JSON.parse(await readFile(entry.manifest, 'utf8'));
    assert.equal(manifest.schema_version, undefined);
    assert.equal(manifest.content_kit_version, catalog.content_kit_version);
    assert.ok(manifest.collections.some(({ content_type }) => content_type === 'verse'));
    assert.ok(manifest.runtime_view?.verses, 'renderer compatibility is explicitly separated from CK4 authority');
    assert.ok(manifest.files.length > 0);
    assert.ok(manifest.files.every(({ path, hash }) => path && /^[a-f0-9]{64}$/.test(hash)));
    assert.equal(new Set(manifest.files.map(({ path }) => path)).size, manifest.files.length);
    const declared = new Set(manifest.files.map(({ path }) => path));
    for (const experience of manifest.experiences) {
      assert.ok(experience.id);
      assert.ok(experience.files.every((file) => declared.has(file)));
    }
  }
  const gita = JSON.parse(await readFile(catalog.books[0].manifest, 'utf8'));
  assert.ok(gita.files.some(({ path }) => path.endsWith('.ogg')), 'binary audio is hash-addressed');
  assert.ok(gita.files.some(({ path }) => path.endsWith('.webp')), 'binary images are hash-addressed');
});

test('the mount inventory explicitly declares every physical contract', async () => {
  const inventory = JSON.parse(await readFile('files.json', 'utf8'));
  assert.match(inventory.content_kit_version, /^4\.\d{8}-\d{6}$/);
  assert.ok(inventory.files.length > 1000);
  assert.equal(new Set(inventory.files.map(({ path }) => path)).size, inventory.files.length);
  assert.ok(inventory.files.every((entry) => entry.path && entry.contract && entry.mime_type && entry.media_type && entry.size >= 0 && /^[a-f0-9]{64}$/.test(entry.hash)));
  assert.ok(inventory.files.some((entry) => entry.contract === 'source-master'));
  assert.ok(inventory.files.some((entry) => entry.contract === 'deck'));
  assert.ok(inventory.files.some((entry) => entry.contract === 'ck4-variant-registry'));
});
