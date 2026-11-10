const { readFileSync } = require('node:fs');
const { readFile, writeFile } = require('node:fs/promises');
const path = require('node:path');
const yaml = require('js-yaml');

const packageInfo = JSON.parse(readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
const config = yaml.load(readFileSync(path.join(__dirname, 'electron-builder.yml'), 'utf8'), { schema: yaml.JSON_SCHEMA });
const version = packageInfo.version;
const parts = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)([a-z]?)$/.exec(version);
if (!parts || parts[0] !== version || parts.slice(1, 4).some((part) => Number(part) > 65535)) {
  throw new Error('La versión debe ser x.y.z seguida opcionalmente de una letra minúscula y compatible con Windows.');
}
const revision = parts[4] ? parts[4].charCodeAt(0) - 96 : 0;
const windowsVersion = `${parts[1]}.${parts[2]}.${parts[3]}.${revision}`;

// electron-builder normalizes 1.0.4c to 1.0.4-c while reading package.json.
// extraMetadata is merged afterwards, retaining the exact app/installer version.
config.extraMetadata = { ...config.extraMetadata, version };
config.releaseInfo = { ...config.releaseInfo, releaseName: version };
config.buildVersion = version;
config.buildNumber = String(revision);

// Windows requires numeric fixed version fields. Keep the letter in every
// identity string while encoding only those binary fields as x.y.z.revision.
if (config.win.signExecutable !== false) {
  throw new Error('La edición de versiones con letra requiere el empaquetado sin firma configurado para esta distribución.');
}
config.afterSign = async ({ appOutDir, electronPlatformName, packager }) => {
  if (electronPlatformName !== 'win32') return;
  const resedit = require(require.resolve('resedit', { paths: [path.dirname(require.resolve('app-builder-lib/package.json'))] }));
  const filename = path.join(appOutDir, `${packager.appInfo.productFilename}.exe`);
  const executable = resedit.NtExecutable.from(await readFile(filename));
  const resources = resedit.NtExecutableResource.from(executable);
  const versions = resedit.Resource.VersionInfo.fromEntries(resources.entries);
  if (!versions.length) throw new Error('El ejecutable no contiene los recursos de versión esperados.');
  for (const info of versions) {
    info.setFileVersion(windowsVersion);
    info.setProductVersion(windowsVersion);
    for (const language of info.getAllLanguagesForStringValues()) {
      info.setStringValues(language, { FileVersion: version, ProductVersion: version });
    }
    info.outputToResourceEntries(resources.entries);
  }
  resources.outputResource(executable);
  await writeFile(filename, Buffer.from(executable.generate()));
};

module.exports = config;
