import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import * as yaml from 'js-yaml';

export function releaseAssetNames(version) {
  assert.match(version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, 'Solo se publican versiones estables x.y.z.');
  const installer = `PhoneGest-Barcode-Studio-${version}-Instalador.exe`;
  return [installer, `${installer}.blockmap`, 'latest.yml', `PhoneGest-Barcode-Studio-${version}-Portable.exe`];
}

export function validateReleaseTag(tag, version) {
  releaseAssetNames(version);
  assert.equal(tag, `v${version}`, 'La etiqueta debe ser v + la versión exacta de package.json.');
}

export function validateUpdateMetadata(metadata, { version, installerName, installerSize, installerSha512 }) {
  assert.ok(metadata && typeof metadata === 'object', 'latest.yml debe contener un objeto.');
  assert.equal(metadata.version, version, 'latest.yml contiene otra versión.');
  assert.equal(metadata.path, installerName, 'La actualización debe apuntar al instalador NSIS de esta versión.');
  assert.equal(metadata.sha512, installerSha512, 'SHA512 principal incorrecto.');
  assert.ok(Array.isArray(metadata.files) && metadata.files.length === 1, 'latest.yml debe anunciar un único instalador x64.');
  const file = metadata.files[0];
  assert.equal(file.url, installerName, 'El archivo de actualización debe ser un nombre local exacto, sin URL ni ruta.');
  assert.equal(file.sha512, installerSha512, 'El instalador no coincide con el SHA512 anunciado.');
  assert.equal(file.size, installerSize, 'El tamaño del instalador no coincide con latest.yml.');
  assert.ok(typeof metadata.releaseDate === 'string' && Number.isFinite(Date.parse(metadata.releaseDate)), 'Falta una fecha de publicación válida.');
}

async function fileHash(filename, algorithm, encoding = 'hex') {
  const hash = createHash(algorithm);
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest(encoding);
}

async function assertExecutable(filename) {
  const handle = await open(filename, 'r');
  try {
    const header = Buffer.alloc(2);
    const result = await handle.read(header, 0, 2, 0);
    assert.ok(result.bytesRead === 2 && header.toString() === 'MZ', `${path.basename(filename)} no parece un ejecutable Windows.`);
  } finally { await handle.close(); }
}

export async function validateReleaseArtifacts(directory, version) {
  const names = releaseAssetNames(version);
  const assets = [];
  for (const name of names) {
    const filename = path.join(directory, name);
    const details = await stat(filename);
    assert.ok(details.isFile() && details.size > 0, `Falta el archivo de publicación: ${name}`);
    assets.push({ name, bytes: details.size, sha256: await fileHash(filename, 'sha256') });
  }
  const [installer, blockmap, latest, portable] = names.map((name) => path.join(directory, name));
  await assertExecutable(installer);
  await assertExecutable(portable);
  assert.ok(assets[2].bytes < 64 * 1024, 'latest.yml es demasiado grande.');
  const metadata = yaml.load(await readFile(latest, 'utf8'), { schema: yaml.JSON_SCHEMA });
  validateUpdateMetadata(metadata, {
    version,
    installerName: names[0],
    installerSize: assets[0].bytes,
    installerSha512: await fileHash(installer, 'sha512', 'base64'),
  });
  assert.ok(assets[1].bytes < 16 * 1024 * 1024, 'El blockmap es demasiado grande.');
  const map = JSON.parse(gunzipSync(await readFile(blockmap), { maxOutputLength: 32 * 1024 * 1024 }).toString('utf8'));
  assert.equal(map.version, '2', 'Se requiere un blockmap de actualización v2.');
  assert.ok(Array.isArray(map.files) && map.files.length > 0, 'El blockmap no contiene archivos.');
  let coveredThrough = 0;
  for (const file of map.files) {
    assert.ok(Number.isSafeInteger(file.offset) && file.offset >= 0, 'Offset no válido en blockmap.');
    assert.ok(Array.isArray(file.sizes) && file.sizes.length > 0 && file.sizes.every((size) => Number.isSafeInteger(size) && size > 0), 'Tamaños no válidos en blockmap.');
    assert.equal(file.checksums?.length, file.sizes.length, 'El blockmap no tiene un checksum por bloque.');
    const end = file.offset + file.sizes.reduce((sum, size) => sum + size, 0);
    assert.ok(end <= assets[0].bytes, 'El blockmap excede el instalador.');
    coveredThrough = Math.max(coveredThrough, end);
  }
  assert.equal(coveredThrough, assets[0].bytes, 'El blockmap no cubre el instalador completo.');
  return { success: true, version, assets, updateFile: names[0] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const packageInfo = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  if (process.env.RELEASE_TAG) validateReleaseTag(process.env.RELEASE_TAG, packageInfo.version);
  const directory = path.resolve(process.argv[2] || path.join(root, 'release'));
  const result = await validateReleaseArtifacts(directory, packageInfo.version);
  await writeFile(path.join(directory, 'release-validation.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}
