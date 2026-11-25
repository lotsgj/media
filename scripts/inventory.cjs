// Media inventory builder, shared by scripts/build-content-kit4.mjs (Node) and media-admin (browser, as a classic
// script: globalThis.MediaInventory). It has no Node or browser dependencies: the caller lists, reads and hashes files.
//
// build({ kitVersion, list, read, sha256, reuseHashes, changed }) returns { writes: Map<path, text>, count }:
// the book manifests, files.json, catalog.json and media.ver, as they should be for the files listed.
//   list()        → [{ path, size }] for every file under the media folder (filtered here with includes()).
//   read(path)    → bytes (Uint8Array or Buffer).
//   sha256(bytes) → lowercase hex digest.
//   reuseHashes   → keep the hash recorded in files.json for a file of the same size that is not in `changed`
//                   (the admin uses this so it does not reread 290 MB of audio; the Node script hashes everything).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MediaInventory = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  const NAMESPACES = new Set(['book', 'audio', 'image', 'video', 'deck', 'docs', 'registry']);
  const SKIPPED = new Set(['.git', 'node_modules', '.DS_Store']);
  const MIME = { '.csv': 'text/csv', '.json': 'application/json', '.md': 'text/markdown', '.txt': 'text/plain', '.tsv': 'text/tab-separated-values', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.opus': 'audio/ogg; codecs=opus', '.wav': 'audio/wav', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.webm': 'video/webm', '.pdf': 'application/pdf' };

  // A logical path belongs to the inventory when it sits under a media namespace and no part of it is skipped.
  function includes(logical) {
    const parts = String(logical).split('/');
    return parts.length > 1 && NAMESPACES.has(parts[0]) && !parts.some((part) => SKIPPED.has(part));
  }

  function contractFor(logical, previousContracts = new Map()) {
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
    const name = logical.split('/').at(-1);
    const dot = name.lastIndexOf('.');
    return MIME[dot > 0 ? name.slice(dot).toLowerCase() : ''] || 'application/octet-stream';
  }

  function mediaTypeFor(logical, mime) {
    const namespace = logical.split('/')[0];
    if (['audio', 'image', 'video', 'deck', 'book', 'docs', 'registry'].includes(namespace)) return namespace;
    return mime.split('/')[0] || 'asset';
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder('utf-8');
  const byPath = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

  async function build({ kitVersion, list, read, sha256, reuseHashes = false, changed = new Set() }) {
    if (!/^4\.\d{8}-\d{6}$/.test(kitVersion || '')) throw new Error('Unable to read the approved Content-Kit 4 version.');
    const listed = (await list()).filter((file) => includes(file.path));
    const sizes = new Map(listed.map((file) => [file.path, file.size]));
    let previous = new Map();
    try { previous = new Map(JSON.parse(decoder.decode(await read('files.json'))).files.map((entry) => [entry.path, entry])); } catch {}
    const previousContracts = new Map([...previous].map(([path, entry]) => [path, entry.contract]));
    const writes = new Map();
    const rewritten = new Map(); // path → hash of a text this build writes

    // The hash of a listed file: recorded when allowed and plainly unchanged, otherwise read and hashed.
    async function hashOf(path) {
      if (rewritten.has(path)) return rewritten.get(path);
      const recorded = previous.get(path);
      if (reuseHashes && recorded && !changed.has(path) && recorded.size === sizes.get(path)) return recorded.hash;
      return sha256(await read(path));
    }
    async function write(path, text) {
      writes.set(path, text);
      const hash = await sha256(encoder.encode(text));
      rewritten.set(path, hash);
      return hash;
    }

    const catalog = JSON.parse(decoder.decode(await read('catalog.json')));
    for (const book of catalog.books) {
      const manifest = JSON.parse(decoder.decode(await read(book.manifest)));
      delete manifest.schema_version;
      manifest.content_kit_version = kitVersion;
      const bookPrefix = `book/${book.book_id}/`;
      const existing = new Map((manifest.files || []).map((entry) => [entry.path, entry]));
      for (const path of [...existing.keys()]) if (!sizes.has(path)) existing.delete(path);
      for (const { path } of listed) {
        if (!path.startsWith(bookPrefix) || !path.includes('/registry/')) continue;
        existing.set(path, { path, hash: await hashOf(path) });
      }
      manifest.files = [...existing.values()].sort((left, right) => byPath(left.path, right.path));
      book.manifest_hash = await write(book.manifest, `${JSON.stringify(manifest, null, 2)}\n`);
    }

    const files = [];
    for (const path of listed.map((file) => file.path).sort()) {
      const mime = mimeFor(path);
      const size = rewritten.has(path) ? encoder.encode(writes.get(path)).length : sizes.get(path);
      files.push({ path, media_type: mediaTypeFor(path, mime), mime_type: mime, size, hash: await hashOf(path), contract: contractFor(path, previousContracts), state: 'active' });
    }
    const inventoryHash = await write('files.json', `${JSON.stringify({ content_kit_version: kitVersion, mount_id: 'media', files }, null, 2)}\n`);

    catalog.content_kit_version = kitVersion;
    catalog.minimum_kit_version = kitVersion;
    delete catalog.schema_version;
    catalog.mounts = [{
      mount_id: 'media',
      remote: 'https://media.gitajyoti.org/',
      local: 'media',
      inventories: [{ id: 'all', path: 'files.json', hash: inventoryHash }]
    }];
    const catalogHash = await write('catalog.json', `${JSON.stringify(catalog, null, 2)}\n`);
    writes.set('media.ver', `${catalogHash} ${kitVersion}\n`);
    return { writes, count: files.length };
  }

  return Object.freeze({ includes, contractFor, mimeFor, mediaTypeFor, build });
});
