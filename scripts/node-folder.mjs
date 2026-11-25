// The media folder on disk, as scripts/inventory.cjs expects it: list() → [{ path, size }], read(path) → bytes.
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

export function nodeFolder(root) {
  async function walk(directory, relative) {
    const result = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (['.git', 'node_modules'].includes(entry.name)) continue;
      const logical = relative ? `${relative}/${entry.name}` : entry.name;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) result.push(...await walk(absolute, logical));
      else if (entry.isFile()) result.push({ path: logical, size: (await stat(absolute)).size });
    }
    return result;
  }
  return {
    list: () => walk(root, ''),
    read: (logical) => readFile(path.join(root, logical))
  };
}
