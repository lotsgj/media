import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const mygita = path.resolve(root, '../mygita');
const kit = await import(pathToFileURL(path.join(mygita, 'engine/js/content-kit.js')).href);
const logicalFile = (logical) => path.join(root, logical);
const readText = (logical) => readFile(logicalFile(logical), 'utf8');
const hashOf = async (logical, overrideText = null) => createHash('sha256').update(overrideText == null ? await readFile(logicalFile(logical)) : Buffer.from(overrideText)).digest('hex');

const context = { document: { currentScript: { src: pathToFileURL(path.join(mygita, 'engine/js/local-workspace.js')).href } }, URL };
context.globalThis = context;
vm.runInNewContext(await readFile(path.join(mygita, 'engine/js/local-workspace.js'), 'utf8'), context);

const media = await kit.openMedia(readText);
const releaseLabel = process.argv[2] || media.catalog.content_version;
const result = await kit.publish(media, { readText, hashOf, workspace: context.__MYGITA_LOCAL_WORKSPACE__, releaseLabel });
if (result.problems.blocking.length) {
  for (const problem of result.problems.blocking) console.error(`${problem.path || 'media'}: ${problem.message}`);
  process.exitCode = 1;
} else {
  for (const write of result.writes) await writeFile(logicalFile(write.path), write.text);
  console.log(result.writes.length ? `Published ${releaseLabel}: ${result.changed.join(', ')}` : `Media ${releaseLabel} is already published.`);
}
