import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { redactEnv, saveSupportFile, supportFileName } from './supportFile.ts';
import { unzip } from './zip.ts';

function shopPc() {
  const dir = mkdtempSync(join(tmpdir(), 'cb-support-'));
  const data = join(dir, 'data');
  mkdirSync(join(data, 'logs'), { recursive: true });
  mkdirSync(join(data, 'backups'));
  writeFileSync(join(data, 'settings.json'), JSON.stringify({ shopId: 'rasikas-kitchen-ab12', shopName: "Rasika's Kitchen", printer: 'XP-80T', cloudUrl: 'https://cloud.test', cloudToken: 'tok-123', cloudSecret: 'sec-456', setupDone: true }));
  writeFileSync(join(data, 'station.env'), '# set by hand\nPORT=8081\nDATABASE_URL=mysql://pos:hunter2@localhost/pos\n');
  writeFileSync(join(data, 'pos.sqlite'), 'SALES AND PINS');
  writeFileSync(join(data, 'backups', 'pos-2026-10-20-nightly.sqlite'), 'SALES');
  writeFileSync(join(data, 'logs', 'server.log'), 'started\nprinter did not take it\n');
  writeFileSync(join(data, 'logs', 'update.log'), `${'old line\n'.repeat(200_000)}newest line\n`);
  writeFileSync(join(data, 'update-status.json'), '{"phase":"done","percent":100}');
  return { dir, data, done: () => rmSync(dir, { recursive: true, force: true }) };
}

const when = new Date(2026, 9, 21, 14, 32);

test("the support file: logs and this PC's details, never the sales, the database or any key", async () => {
  const pc = shopPc();
  try {
    const r = await saveSupportFile({
      dataDir: pc.data, outDir: pc.dir, version: '1.0.3', port: 8081, now: () => when, platform: 'linux',
      fetch: (async () => Response.json({ ok: true, version: '1.0.3' })) as unknown as typeof fetch,
    });
    assert.equal(r.name, 'Lume POS support 2026-10-21 1432.zip');
    const got = unzip(readFileSync(r.path));
    assert.deepEqual(Object.keys(got).sort(), ['about.txt', 'logs/server.log', 'logs/update.log', 'settings.json', 'station.env', 'update-status.json']);
    assert.match(got['about.txt'], /Version: +1\.0\.3/);
    assert.match(got['about.txt'], /Shop server: +answering \(200\)/);
    assert.match(got['about.txt'], /Backups: +1 \(newest: pos-2026-10-20-nightly\.sqlite\)/);
    assert.equal(got['logs/server.log'], 'started\nprinter did not take it\n');
    assert.match(got['logs/update.log'], /^\(older lines left out\)/);
    assert.match(got['logs/update.log'], /newest line\n$/);
    assert.ok(got['logs/update.log'].length < 1_100_000, 'a long log is cut to its newest part');

    const all = Object.values(got).join('\n');
    for (const secret of ['tok-123', 'sec-456', 'hunter2', 'SALES']) assert.ok(!all.includes(secret), `never ${secret}`);
    assert.deepEqual(JSON.parse(got['settings.json']), {
      shopId: 'rasikas-kitchen-ab12', shopName: "Rasika's Kitchen", printer: 'XP-80T', cloudUrl: 'https://cloud.test',
      cloudToken: '(hidden)', cloudSecret: '(hidden)', setupDone: true,
    });
    assert.equal(got['station.env'], '# set by hand\nPORT=8081\nDATABASE_URL=(set)');
  } finally {
    pc.done();
  }
});

test('when the POS will not start, the file says so; on Windows it asks Windows about the parts the POS needs', async () => {
  const pc = shopPc();
  const asked: string[] = [];
  try {
    const r = await saveSupportFile({
      dataDir: pc.data, outDir: pc.dir, version: '1.0.3', port: 8081, now: () => when, platform: 'win32',
      fetch: (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch,
      run: async (command, args) => { asked.push(`${command} ${args.at(-1)}`); return `answer ${asked.length}`; },
    });
    const about = unzip(readFileSync(r.path))['about.txt'];
    assert.match(about, /Shop server: +NOT answering \(fetch failed\)/);
    for (const part of ['Windows', 'Printers', 'Scheduled tasks', 'WebView2', 'Firewall', 'Network', 'Antivirus']) assert.match(about, new RegExp(`----- ${part} -----`));
    assert.ok(asked.some((a) => a.includes('Get-Printer')) && asked.some((a) => a.startsWith('reg.exe')));
  } finally {
    pc.done();
  }
});

test('names', () => {
  assert.equal(supportFileName(new Date(2026, 0, 5, 9, 7)), 'Lume POS support 2026-01-05 0907.zip');
  assert.equal(redactEnv('PRINTER=XP-80T\nCLOUD_TOKEN=abc\n\nnot a setting'), 'PRINTER=XP-80T\nCLOUD_TOKEN=(set)');
});
