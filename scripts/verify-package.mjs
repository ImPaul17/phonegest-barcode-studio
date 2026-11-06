import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, mkdir, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { extractFile } = require('@electron/asar');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(process.argv[2] || path.join(root, 'release', 'win-unpacked'));
const archive = path.join(output, 'resources', 'app.asar');
const hash = (buffer) => createHash('sha256').update(buffer).digest('hex');

async function enumerate(directory, prefix = directory) {
  const entries = await readdir(path.join(root, directory), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...await enumerate(relative));
    else files.push(relative);
  }
  return files;
}

const sources = [
  ...await enumerate('electron'),
  ...await enumerate('shared'),
  ...await enumerate('dist'),
  'assets/phonegest-reference.png',
  'assets/phonegest.ico',
];
const files = [];
for (const file of sources) {
  const source = await readFile(path.join(root, file));
  const packed = extractFile(archive, path.normalize(file));
  assert.equal(hash(packed), hash(source), `El archivo empaquetado está desactualizado: ${file}`);
  files.push({ file, bytes: packed.length, sha256: hash(packed) });
}
const sourceNotices = await readFile(path.join(root, 'THIRD-PARTY-NOTICES.txt'));
const shippedNotices = await readFile(path.join(output, 'THIRD-PARTY-NOTICES.txt'));
assert.equal(hash(shippedNotices), hash(sourceNotices), 'Los avisos de licencia no coinciden.');
await access(path.join(output, 'LICENSE.electron.txt'));
await access(path.join(output, 'LICENSES.chromium.html'));
const result = { success: true, output, files, noticesSha256: hash(shippedNotices) };
await mkdir(path.join(root, 'build'), { recursive: true });
await writeFile(path.join(root, 'build', 'package-verification.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ success: true, files: files.length, notices: true, runtimeLicenses: true }));
