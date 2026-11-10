import test from 'node:test';
import assert from 'node:assert/strict';
import { compareAppVersions, getDisplayVersion, isAppVersion } from '../shared/version.mjs';

test('app versions use the same canonical label for numeric and letter revisions', () => {
  for (const version of ['0.0.0', '1.0.4', '1.0.4a', '1.0.4b', '1.0.4c', '1.0.4z', '10.20.30c']) {
    assert.equal(isAppVersion(version), true, version);
    assert.equal(getDisplayVersion(version), version);
  }
  for (const value of [undefined, null, 104, {}, '', 'v1.0.4c', ' 1.0.4c', '1.0.4c ', '1.0.4c\n', '1.0.4C', '1.0.4cc', '1.0.4c1', '01.0.4c', '1.00.4c', '1.0.04c', '1.0.4-c', '1.0.4+c', '1.0.4c/../file']) {
    assert.equal(isAppVersion(value), false, String(value));
  }
});

test('letter revisions sort after their base and before the next numeric version', () => {
  const versions = ['0.9.9z', '1.0.3z', '1.0.4', '1.0.4a', '1.0.4b', '1.0.4c', '1.0.4z', '1.0.5', '1.0.9z', '1.0.10', '1.1.0', '2.0.0', '10.0.0'];
  for (let left = 0; left < versions.length; left += 1) {
    for (let right = 0; right < versions.length; right += 1) {
      assert.equal(compareAppVersions(versions[left], versions[right]), Math.sign(left - right), `${versions[left]} / ${versions[right]}`);
    }
  }
  for (const invalid of ['v1.0.4c', '1.0.4cc', '1.0.4-c', '../1.0.4c']) {
    assert.throws(() => compareAppVersions(invalid, '1.0.4c'));
    assert.throws(() => compareAppVersions('1.0.4c', invalid));
  }
});

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
