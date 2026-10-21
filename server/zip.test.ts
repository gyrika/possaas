import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unzip, zip } from './zip.ts';

test('a zip that reads back the same, names and all (UTF-8, folders in names)', () => {
  const file = zip([{ name: 'about.txt', data: 'Lume POS 1.0.3\n' }, { name: 'logs/server.log', data: 'x'.repeat(50_000) }, { name: 'සිංහල.txt', data: 'ok' }]);
  assert.deepEqual(unzip(file), { 'about.txt': 'Lume POS 1.0.3\n', 'logs/server.log': 'x'.repeat(50_000), 'සිංහල.txt': 'ok' });
  assert.ok(file.length < 2_000, 'compressed');
});
