import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isAllowedResourceUrl } from '../electron/security.mjs';
import { createProject, readProject, safeFilename, validatePayload, validateSession } from '../electron/validation.mjs';

const valid = { codes: ['L3A5KA9807022320129590Q'], settings: {} };

test('desktop boundary rejects malformed documents before export', () => {
  for (const payload of [null, {}, { codes: [] }, { codes: [1] }, { codes: ['A\nB'] }, { codes: ['Á'] }, { codes: Array(1001).fill('A') }]) {
    assert.throws(() => validatePayload(payload));
  }
  for (const settings of [{ startNumber: -1 }, { startNumber: 1.5 }, { layout: '../file' }, { showCheckboxes: 'true' }, { documentTitle: 'A\nB' }]) {
    assert.throws(() => validatePayload({ ...valid, settings }));
  }
  assert.equal(validatePayload(valid).codes[0], valid.codes[0]);
});

test('projects round trip and reject other formats and future schemas', () => {
  const project = createProject(valid);
  assert.deepEqual(readProject(JSON.parse(JSON.stringify(project))), validatePayload(valid));
  assert.throws(() => readProject({ ...project, application: 'other' }));
  assert.throws(() => readProject({ ...project, version: 999 }));
  assert.throws(() => readProject({ ...project, codes: ['invalid\u0000'] }));
});

test('local session keeps draft and theme while removing unknown fields', () => {
  const session = validateSession({ codes: [], settings: {}, theme: 'dark', input: 'pending', injected: true });
  assert.equal(session.theme, 'dark');
  assert.equal(session.input, 'pending');
  assert.equal(Object.hasOwn(session, 'injected'), false);
});

test('production blocks network and files outside the bundled app', () => {
  const root = path.resolve('build', 'security-fixture');
  const options = { root };
  assert.equal(isAllowedResourceUrl(pathToFileURL(path.join(root, 'dist', 'index.html')).href, options), true);
  assert.equal(isAllowedResourceUrl(pathToFileURL(path.join(root, '..', 'session.json')).href, options), false);
  for (const address of ['https://example.com/collect', 'http://localhost:5173/', 'http://127.0.0.1:5173/', 'wss://example.com/', 'ws://127.0.0.1:5173/', 'javascript:alert(1)', 'invalid']) {
    assert.equal(isAllowedResourceUrl(address, options), false, address);
  }
  assert.equal(isAllowedResourceUrl('data:image/png;base64,AAAA', options), true);
  assert.equal(isAllowedResourceUrl('about:srcdoc', options), true);
});

test('explicit development origin permits only loopback Vite', () => {
  const options = { root: process.cwd(), developmentOrigin: 'http://127.0.0.1:5173' };
  assert.equal(isAllowedResourceUrl('http://127.0.0.1:5173/src/App.tsx', options), true);
  assert.equal(isAllowedResourceUrl('ws://127.0.0.1:5173/', options), true);
  assert.equal(isAllowedResourceUrl('http://127.0.0.1:5173@evil.example/', options), false);
  assert.equal(isAllowedResourceUrl('http://127.0.0.1:5174/', options), false);
});

test('image export filename cannot escape chosen folder or use Windows reserved names', () => {
  assert.equal(safeFilename('../folder/identifier'), '..-folder-identifier');
  assert.equal(safeFilename('CON'), 'codigo');
  assert.equal(safeFilename('LPT1.txt'), 'codigo');
  assert.equal(safeFilename('ABC?*<>|'), 'ABC-----');
});
