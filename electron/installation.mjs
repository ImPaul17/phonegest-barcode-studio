import path from 'node:path';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { isAppVersion } from '../shared/version.mjs';

const requireUpdater = createRequire(createRequire(import.meta.url).resolve('electron-updater/package.json'));
const yaml = requireUpdater('js-yaml');
const RELEASES = 'https://github.com/ImPaul17/phonegest-barcode-studio/releases/download';
const MAX_METADATA_BYTES = 65536;

export function installationMetadataUrl(version) {
  if (!isAppVersion(version)) throw new TypeError('La versión instalada no es válida.');
  return `${RELEASES}/v${version}/latest.yml`;
}

export function validateInstallerMetadata(value, version) {
  const filename = `PhoneGest-Barcode-Studio-${version}-Instalador.exe`;
  const digest = value?.sha512;
  if (!isAppVersion(version) || !value || value.version !== version || (value.path ?? value.filename) !== filename
    || typeof digest !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(digest)
    || Buffer.from(digest, 'base64').length !== 64) {
    throw new TypeError('El instalador publicado no coincide con la versión de esta aplicación.');
  }
  const entry = value.files?.find((file) => file.url === filename);
  if (value.files && (!entry || entry.sha512 !== digest)) {
    throw new TypeError('Los datos de verificación del instalador no coinciden.');
  }
  const size = entry?.size ?? value.size;
  if (size !== undefined && (!Number.isSafeInteger(size) || size <= 0 || size > 2 ** 31)) {
    throw new TypeError('El tamaño del instalador no es válido.');
  }
  return { version, filename, sha512: digest, ...(size === undefined ? {} : { size }) };
}

export function parseInstallerMetadata(text, version) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_METADATA_BYTES) throw new TypeError('Los datos del instalador son demasiado grandes.');
  return validateInstallerMetadata(yaml.load(text, { schema: yaml.JSON_SCHEMA }), version);
}

export async function verifyInstallerFile(filename, metadata) {
  const info = await stat(filename);
  if (!info.isFile() || info.size <= 0 || info.size > 2 ** 31 || (metadata.size !== undefined && info.size !== metadata.size)) {
    throw new Error('El archivo seleccionado no coincide con el instalador publicado.');
  }
  const hash = createHash('sha512');
  for await (const bytes of createReadStream(filename)) hash.update(bytes);
  if (hash.digest('base64') !== metadata.sha512) throw new Error('La comprobación SHA-512 del instalador ha fallado. Descarga el instalador original de esta versión.');
}

/** Launches the existing assisted installer; never moves a running application's files. */
export function createInstallationManager({
  version, directory, userData, localAppData, installed,
  unsupportedReason = 'El cambio de ubicación está disponible en la aplicación instalada en Windows.',
  fetchText, chooseInstaller, prepareInstall, cancelInstall, launchInstaller, quit,
}) {
  const maintenanceDirectory = path.join(userData, 'maintenance');
  const metadataFile = path.join(maintenanceDirectory, `installer-${version}.json`);
  const cachedInstaller = path.join(localAppData, 'phonegest-barcode-studio-updater', 'installer.exe');
  let changing = null;

  async function getMetadata() {
    try {
      const metadata = parseInstallerMetadata(await fetchText(installationMetadataUrl(version)), version);
      await mkdir(maintenanceDirectory, { recursive: true });
      const temporary = `${metadataFile}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(metadata), { flag: 'wx' });
        await rename(temporary, metadataFile);
      } finally { await unlink(temporary).catch(() => {}); }
      return metadata;
    } catch {
      try {
        if ((await stat(metadataFile)).size > MAX_METADATA_BYTES) throw new Error();
        return validateInstallerMetadata(JSON.parse(await readFile(metadataFile, 'utf8')), version);
      } catch {
        throw new Error('Conéctate a Internet para verificar el instalador de esta versión antes de cambiar la ubicación. La versión debe estar publicada en GitHub.');
      }
    }
  }

  async function change() {
    if (!installed) throw new Error(unsupportedReason);
    const metadata = await getMetadata();
    let source = cachedInstaller;
    try { await verifyInstallerFile(source, metadata); }
    catch {
      source = await chooseInstaller(metadata.filename);
      if (!source) return;
      await verifyInstallerFile(source, metadata);
    }
    await mkdir(maintenanceDirectory, { recursive: true });
    // Use a private verified copy: NSIS replaces its standard installer cache while installing.
    const temporary = path.join(maintenanceDirectory, `${randomUUID()}.exe`);
    await copyFile(source, temporary, constants.COPYFILE_EXCL);
    try {
      await verifyInstallerFile(temporary, metadata);
      await prepareInstall();
      await verifyInstallerFile(temporary, metadata);
      await launchInstaller(temporary);
      quit();
    } catch (error) {
      cancelInstall();
      await unlink(temporary).catch(() => {});
      throw error;
    }
  }

  return Object.freeze({
    getInfo: () => ({
      installed: Boolean(installed), path: directory, canChangeLocation: Boolean(installed),
      reason: installed
        ? 'Se abrirá el asistente para elegir otra carpeta o disco. Se conservarán tus ajustes y proyectos. La primera comprobación del instalador necesita Internet.'
        : unsupportedReason,
    }),
    changeLocation: async () => {
      if (changing) return changing;
      changing = change();
      try { await changing; }
      finally { changing = null; }
    },
  });
}
