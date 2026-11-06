import test from 'node:test';
import assert from 'node:assert/strict';
import { getDisplayVersion } from '../shared/version.mjs';

test('display labels can differ from the numeric version without rewriting either value', () => {
  assert.equal(getDisplayVersion('1.0.5', '1.0.4b'), '1.0.4b');
  assert.equal(getDisplayVersion('2.3.0', '2.3.0'), '2.3.0');
  assert.equal(getDisplayVersion('1.0.5'), '1.0.5');
  assert.equal(getDisplayVersion('1.0.6'), '1.0.6');
});

test('release metadata accepts a version label or the fixed PhoneGest release title', () => {
  for (const value of ['1.0.4b', 'v1.0.4b', 'PhoneGest Barcode Studio 1.0.4b', 'PhoneGest Barcode Studio v1.0.4b']) {
    assert.equal(getDisplayVersion('1.0.5', value), '1.0.4b');
  }
  assert.equal(getDisplayVersion('2.0.0-beta.1', '2.0.0-beta.1'), '2.0.0-beta.1');
});

test('untrusted or missing labels fall back to the numeric version', () => {
  for (const value of [undefined, null, 104, {}, '', 'Actualización recomendada', 'Other app 1.0.4b', '<b>1.0.4b</b>', '1.0.4b<script>', '1.0.4b\nhttps://example.com', '01.0.4b', '1.0.4b-.', '1.0.4b+', '1.0.4b'.repeat(30)]) {
    assert.equal(getDisplayVersion('1.0.5', value), '1.0.5');
  }
});
