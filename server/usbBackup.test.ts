import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { usbBackup } from './usbBackup.ts';

test('a copy of the sales on a USB stick: only a stick that is plugged in, checked, in "Lume POS backups"', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cb-usb-'));
  const data = join(dir, 'data');
  const stick = join(dir, 'E');
  mkdirSync(data);
  mkdirSync(stick);
  try {
    const run = async () => 'E|KINGSTON|8000000000\r\nnot a drive\r\n';
    const usb = usbBackup({ dataDir: data, platform: 'win32', run, now: () => new Date(2026, 9, 21, 22, 30) });
    assert.deepEqual(await usb.drives(), [{ letter: 'E', label: 'KINGSTON', freeBytes: 8000000000 }]);
    await assert.rejects(usb.save('E', stick), /no sales on this computer/);

    const db = new DatabaseSync(join(data, 'pos.sqlite'));
    db.exec('CREATE TABLE events (id TEXT); INSERT INTO events VALUES (1), (2), (3)');
    db.close();
    await assert.rejects(usb.save('F', stick), /not plugged in/);
    const r = await usb.save('E', stick);
    assert.equal(r.events, 3);
    assert.ok(r.file.startsWith(join(stick, 'Lume POS backups')) && existsSync(r.file));
    const onStick = new DatabaseSync(r.file, { readOnly: true });
    assert.equal((onStick.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number }).n, 3);
    onStick.close();
    assert.deepEqual(await usbBackup({ dataDir: data, platform: 'linux' }).drives(), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
