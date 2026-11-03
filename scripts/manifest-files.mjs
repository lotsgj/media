import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const METADATA_EXTENSIONS = new Set(['.csv', '.json']);
const LOGICAL_PREFIX = /^(?:book|audio|image|video|deck|docs)\//;

function cells(text, extension) {
  if (extension === '.json') {
    const values = [];
    const visit = (value) => {
      if (typeof value === 'string') values.push(value);
      else if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') Object.values(value).forEach(visit);
    };
    visit(JSON.parse(text));
    return values;
  }
  return text.split(/\r?\n/).flatMap((line) => line.split('#'));
}

async function walkMetadata(root, relative) {
  const found = [];
  try {
    for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
      const child = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) found.push(...await walkMetadata(root, child));
      else if (METADATA_EXTENSIONS.has(path.extname(entry.name))) found.push(child);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return found;
}

export async function collectManifestGraph(root, manifest) {
  const metadata = new Set();
  const references = new Set();
  const queue = [];
  const add = (value) => {
    if (typeof value !== 'string' || !LOGICAL_PREFIX.test(value)) return;
    references.add(value);
    if (METADATA_EXTENSIONS.has(path.extname(value)) && !metadata.has(value)) queue.push(value);
  };
  add(manifest.verses?.catalog);
  Object.values(manifest.verses?.masters || {}).forEach(add);
  const registries = manifest.registries || {};
  add(registries.verses?.structural);
  Object.values(registries.verses?.localized || {}).forEach(add);
  ['audio', 'images', 'deck', 'text'].forEach((key) => add(registries[key]));
  for (const experienceId of manifest.experiences || []) {
    for (const relative of await walkMetadata(root, `book/${manifest.book_id}/experience/${experienceId}`)) add(relative);
  }
  while (queue.length) {
    const relative = queue.shift();
    if (metadata.has(relative)) continue;
    metadata.add(relative);
    const contents = await readFile(path.join(root, relative), 'utf8');
    cells(contents, path.extname(relative)).forEach(add);
  }
  return { files: [...metadata].sort(), references: [...references].sort() };
}
