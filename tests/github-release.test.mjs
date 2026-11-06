import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import * as yaml from 'js-yaml';
import { releaseAssetNames, validateReleaseArtifacts, validateReleaseTag, validateUpdateMetadata } from '../scripts/release-validation.mjs';

const version = '1.2.3';
const names = releaseAssetNames(version);
const installer = Buffer.from('MZ PhoneGest installer fixture');
const checksum = createHash('sha512').update(installer).digest('base64');
const metadata = {
  version,
  files: [{ url: names[0], sha512: checksum, size: installer.length }],
  path: names[0], sha512: checksum, releaseDate: '2026-11-06T12:00:00.000Z',
};
const expected = { version, installerName: names[0], installerSize: installer.length, installerSha512: checksum };

test('release tags match package versions exactly and only stable releases are accepted', () => {
  validateReleaseTag('v1.2.3', version);
  for (const tag of ['1.2.3', 'v1.2.4', 'refs/tags/v1.2.3']) assert.throws(() => validateReleaseTag(tag, version));
  for (const input of ['1.2.3-beta.1', '../1.2.3', '01.2.3']) assert.throws(() => releaseAssetNames(input));
});

test('updater metadata rejects wrong hashes, sizes, versions and remote or unexpected assets', () => {
  validateUpdateMetadata(metadata, expected);
  for (const change of [
    { version: '1.2.4' }, { path: names[3] }, { sha512: 'incorrect' },
    { files: [{ ...metadata.files[0], url: `https://example.com/${names[0]}` }] },
    { files: [{ ...metadata.files[0], size: installer.length + 1 }] },
    { files: [{ ...metadata.files[0], sha512: 'incorrect' }] },
    { files: [...metadata.files, metadata.files[0]] }, { releaseDate: 'invalid' },
  ]) assert.throws(() => validateUpdateMetadata({ ...metadata, ...change }, expected));
});

test('display release labels do not replace the stable update version or asset paths', async () => {
  const visible = { ...metadata, releaseName: '1.2.2b' };
  validateUpdateMetadata(visible, { ...expected, displayVersion: '1.2.2b' });
  assert.throws(() => validateUpdateMetadata(visible, { ...expected, displayVersion: '1.2.2c' }));
  assert.throws(() => validateUpdateMetadata({ ...visible, version: '1.2.2b' }, { ...expected, displayVersion: '1.2.2b' }));
  const root = new URL('../', import.meta.url);
  const packageInfo = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  const buildInfo = yaml.load(await readFile(new URL('electron-builder.yml', root), 'utf8'), { schema: yaml.JSON_SCHEMA });
  assert.match(packageInfo.displayVersion, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)[a-z]?$/);
  assert.equal(buildInfo.releaseInfo.releaseName, packageInfo.displayVersion, 'La etiqueta visible del paquete y del actualizador deben coincidir.');
  validateReleaseTag(`v${packageInfo.version}`, packageInfo.version);
});

test('real release asset validation detects installer corruption and incompatible blockmaps', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'phonegest-release-'));
  try {
    await writeFile(path.join(directory, names[0]), installer);
    await writeFile(path.join(directory, names[1]), gzipSync(JSON.stringify({ version: '2', files: [{ name: 'file', offset: 0, sizes: [installer.length], checksums: ['checksum'] }] })));
    await writeFile(path.join(directory, names[2]), yaml.dump(metadata));
    await writeFile(path.join(directory, names[3]), Buffer.from('MZ portable fixture'));
    const result = await validateReleaseArtifacts(directory, version);
    assert.equal(result.success, true);
    assert.deepEqual(result.assets.map((asset) => asset.name), names);
    await writeFile(path.join(directory, names[0]), Buffer.from('MZ corrupted same size file!!!'));
    await assert.rejects(() => validateReleaseArtifacts(directory, version));
    await writeFile(path.join(directory, names[0]), installer);
    await writeFile(path.join(directory, names[1]), gzipSync(JSON.stringify({ version: '2', files: [{ name: 'file', offset: 0, sizes: [installer.length + 1], checksums: ['checksum'] }] })));
    await assert.rejects(() => validateReleaseArtifacts(directory, version), /blockmap excede/);
    const bytes = await readFile(path.join(directory, names[2]));
    assert.ok(bytes.length > 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
