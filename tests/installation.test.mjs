import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { installationMetadataUrl, parseInstallerMetadata, parseInstalledReceipt, verifyInstallerFile, createInstallationManager } from '../electron/installation.mjs';

const version = '1.0.5';
const installerName = `PhoneGest-Barcode-Studio-${version}-Instalador.exe`;
const fixture = Buffer.from('Test fixture only. This file is never executed.');
const sha512 = createHash('sha512').update(fixture).digest('base64');
const metadataText = `version: ${version}\nfiles:\n  - url: ${installerName}\n    sha512: ${sha512}\n    size: ${fixture.length}\npath: ${installerName}\nsha512: ${sha512}\nreleaseName: ${version}\n`;

async function setup(context, overrides = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'phonegest-maintenance-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const cache = path.join(directory, 'local', 'phonegest-barcode-studio-updater');
  await mkdir(cache, { recursive: true });
  const cached = path.join(cache, 'installer.exe');
  await writeFile(cached, fixture);
  const events = [];
  const options = {
    version, directory: path.join(directory, 'program'), userData: path.join(directory, 'userdata'),
    localAppData: path.join(directory, 'local'), installed: true,
    fetchText: async (url) => { assert.equal(url, installationMetadataUrl(version)); return metadataText; },
    chooseInstaller: async () => { events.push('choose'); return undefined; },
    prepareInstall: async () => events.push('saved'), cancelInstall: () => events.push('cancel'),
    launchInstaller: async (file) => { events.push('launch'); assert.deepEqual(await readFile(file), fixture); assert.notEqual(file, cached); },
    quit: () => events.push('quit'), ...overrides,
  };
  return { directory, cached, events, options, manager: createInstallationManager(options) };
}

test('maintenance metadata is restricted to the exact current version, filename and SHA-512', () => {
  assert.equal(installationMetadataUrl('1.0.4b'), 'https://github.com/ImPaul17/phonegest-barcode-studio/releases/download/v1.0.4b/latest.yml');
  for (const invalid of ['../latest', '1.0.5\n', '1.0.5?url=evil']) assert.throws(() => installationMetadataUrl(invalid));
  assert.equal(parseInstallerMetadata(metadataText, version).filename, installerName);
  for (const invalid of [
    metadataText.replace('version: 1.0.5', 'version: 1.0.6'),
    metadataText.replace(`path: ${installerName}`, 'path: ../../evil.exe'),
    metadataText.replaceAll(sha512, 'invalid'),
    metadataText.replace(`url: ${installerName}`, 'url: https://example.com/evil.exe'),
  ]) assert.throws(() => parseInstallerMetadata(invalid, version));
});

test('relocation saves the session and opens only a verified private installer copy, then quits', async (context) => {
  const { manager, events, options } = await setup(context);
  assert.deepEqual(manager.getInfo().canChangeLocation, true);
  await manager.changeLocation();
  assert.deepEqual(events, ['saved', 'launch', 'quit']);
  // A verified metadata cache permits maintenance without Internet on later attempts.
  const offline = createInstallationManager({ ...options, fetchText: async () => { throw new Error('offline'); } });
  await offline.changeLocation();
  assert.deepEqual(events, ['saved', 'launch', 'quit', 'saved', 'launch', 'quit']);
});

test('an installer receipt verifies relocation offline from the first installation, without any network request', async (context) => {
  const result = await setup(context, { fetchText: async () => { throw new Error('Network must not be used'); } });
  const receiptDirectory = path.join(result.options.directory, 'resources');
  await mkdir(receiptDirectory, { recursive: true });
  const receipt = JSON.stringify({ version, filename: installerName, sha512Hex: createHash('sha512').update(fixture).digest('hex') });
  assert.equal(parseInstalledReceipt(receipt, version).sha512, sha512);
  assert.throws(() => parseInstalledReceipt(receipt, '1.0.6'));
  assert.throws(() => parseInstalledReceipt(receipt.replace(/sha512Hex/, 'invalid'), version));
  await writeFile(path.join(receiptDirectory, 'phonegest-installer.json'), receipt);
  await result.manager.changeLocation();
  assert.deepEqual(result.events, ['saved', 'launch', 'quit']);
});

test('wrong cached installer falls back to selecting the exact verified installer', async (context) => {
  const result = await setup(context);
  await writeFile(result.cached, 'untrusted file');
  const selected = path.join(result.directory, 'selected.exe');
  await writeFile(selected, fixture);
  const manager = createInstallationManager({ ...result.options, chooseInstaller: async (filename) => {
    assert.equal(filename, installerName); result.events.push('choose'); return selected;
  } });
  await manager.changeLocation();
  assert.deepEqual(result.events, ['choose', 'saved', 'launch', 'quit']);
  await writeFile(selected, 'different bytes');
  await assert.rejects(manager.changeLocation(), /no coincide|SHA-512/);
  assert.equal(result.events.filter((event) => event === 'launch').length, 1);
});

test('a canceled selector, missing public metadata and unsupported editions never launch an installer', async (context) => {
  const result = await setup(context);
  await writeFile(result.cached, 'wrong installer');
  await result.manager.changeLocation();
  assert.deepEqual(result.events, ['choose']);
  const missing = createInstallationManager({ ...result.options, version: '9.0.0', fetchText: async () => { throw new Error('offline'); } });
  await assert.rejects(missing.changeLocation(), /Conéctate a Internet/);
  const unsupported = createInstallationManager({ ...result.options, installed: false });
  assert.equal(unsupported.getInfo().canChangeLocation, false);
  await assert.rejects(unsupported.changeLocation(), /aplicación instalada/);
  assert.deepEqual(result.events, ['choose']);
});

test('failed session persistence prevents launch and removes the temporary executable', async (context) => {
  const result = await setup(context, { prepareInstall: async () => { throw new Error('session save failed'); } });
  await assert.rejects(result.manager.changeLocation(), /session save failed/);
  assert.deepEqual(result.events, ['cancel']);
  const files = await readdir(path.join(result.options.userData, 'maintenance'));
  assert.equal(files.some((file) => file.endsWith('.exe')), false);
  await assert.rejects(verifyInstallerFile(result.cached, { ...parseInstallerMetadata(metadataText, version), sha512: 'wrong' }), /SHA-512/);
});
