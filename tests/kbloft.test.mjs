/*
 * Proeve af loftet paa /api/kb/soeg - mod den RIGTIGE server.
 *
 * Laasen er ikke en ratebegraensning: under en demo staar sitet aabent, og saa
 * er soegningen en ulogget proxy ind i Genesys. Proeven starter serveren med
 * en tom datamappe (laasen slukket, ingen vidensbase valgt), saa hvert kald,
 * der slipper igennem loftet, ender som 502 - uden at roere Genesys.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROD = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.KBLOFT_PORT || 9061);
const BASIS = `http://127.0.0.1:${PORT}`;

let server;
let data;

test.before(async () => {
  data = mkdtempSync(path.join(tmpdir(), 'gds-kbloft-'));
  server = spawn(process.execPath, [path.join(ROD, 'app/server.js')], {
    env: { ...process.env, BIND_PORT: String(PORT), DATA_DIR: data },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((ok, nej) => {
    const t = setTimeout(() => nej(new Error('serveren startede ikke')), 10000);
    server.stdout.on('data', (b) => { if (/lytter på port/.test(String(b))) { clearTimeout(t); ok(); } });
    server.on('exit', (k) => { clearTimeout(t); nej(new Error(`serveren stoppede (${k})`)); });
  });
});

test.after(() => {
  if (server) server.kill('SIGTERM');
  if (data) rmSync(data, { recursive: true, force: true });
});

const soeg = (ip, q = 'faktura') => fetch(`${BASIS}/api/kb/soeg?q=${encodeURIComponent(q)}`, {
  headers: { accept: 'application/json', 'x-forwarded-for': ip },
});

test('en ivrig demo (25 søgninger på et minut) rammer ikke loftet', async () => {
  for (let i = 0; i < 25; i++) {
    const r = await soeg('203.0.113.10', `ord ${i}`);
    assert.notEqual(r.status, 429, `søgning ${i + 1} blev afvist`);
    await r.arrayBuffer();
  }
});

test('den 31. søgning fra samme IP inden for et minut får 429 på dansk', async () => {
  const koder = [];
  for (let i = 0; i < 31; i++) {
    const r = await soeg('203.0.113.20');
    koder.push(r.status);
    if (i < 30) { await r.arrayBuffer(); continue; }
    assert.equal(r.status, 429);
    assert.equal(r.headers.get('retry-after'), '60');
    const j = await r.json();
    assert.match(j.error, /For mange søgninger/);
  }
  /* De 30 foerste slap igennem til Genesys-klienten (502: ingen vidensbase). */
  assert.deepEqual(koder.slice(0, 30), Array(30).fill(502));
});

test('loftet er pr. IP: en anden gæst kan stadig søge', async () => {
  const r = await soeg('203.0.113.30');
  assert.equal(r.status, 502);
  await r.arrayBuffer();
});

test('loftet spærrer ikke login-tavlen (egen tæller)', async () => {
  const r = await fetch(`${BASIS}/api/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.20' },
    body: JSON.stringify({ brugernavn: 'x', kodeord: 'y' }),
  });
  assert.equal(r.status, 401);
  await r.arrayBuffer();
});
