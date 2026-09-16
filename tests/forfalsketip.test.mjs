/*
 * Proeve af klient-IP'en mod den RIGTIGE server: en forfalsket vaerdi forrest
 * i X-Forwarded-For maa ikke give en ny nøgle.
 *
 * Serveren kører lokalt, saa socket-adressen er loopback - praecis som bag
 * tunnelen. Hvert kald sender »<ny opdigtet>, 203.0.113.50«: den forreste
 * vaelger klienten, den bageste har proxyen sat. Med den gamle regel (første
 * værdi) fik hvert kald sin egen spand, og hverken søgeloftet eller
 * login-spærringen ramte nogensinde.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROD = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.FORFALSKET_PORT || 9062);
const BASIS = `http://127.0.0.1:${PORT}`;
const RIGTIG = '203.0.113.50';

let server;
let data;
let udskrift = '';

test.before(async () => {
  data = mkdtempSync(path.join(tmpdir(), 'gds-forfalsket-'));
  server = spawn(process.execPath, [path.join(ROD, 'app/server.js')], {
    env: { ...process.env, BIND_PORT: String(PORT), DATA_DIR: data },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (b) => { udskrift += String(b); });
  await new Promise((ok, nej) => {
    const t = setTimeout(() => nej(new Error('serveren startede ikke')), 10000);
    server.stdout.on('data', () => { if (/lytter på port/.test(udskrift)) { clearTimeout(t); ok(); } });
    server.on('exit', (k) => { clearTimeout(t); nej(new Error(`serveren stoppede (${k})`)); });
  });
});

test.after(() => {
  if (server) server.kill('SIGTERM');
  if (data) rmSync(data, { recursive: true, force: true });
});

let n = 0;
/** Ny opdigtet adresse forrest ved HVERT kald. */
const forfalsket = () => { n += 1; return `198.51.100.${n % 250}, ${RIGTIG}`; };

test('søgeloftet rammer, selv om hver søgning sender en ny opdigtet IP', async () => {
  const koder = [];
  for (let i = 0; i < 31; i++) {
    const r = await fetch(`${BASIS}/api/kb/soeg?q=ord`, {
      headers: { accept: 'application/json', 'x-forwarded-for': forfalsket() },
    });
    koder.push(r.status);
    await r.arrayBuffer();
  }
  assert.deepEqual(koder.slice(0, 30), Array(30).fill(502));
  assert.equal(koder[30], 429);
});

test('admin-login spærres, selv om hvert forsøg sender en ny opdigtet IP', async () => {
  const koder = [];
  for (let i = 0; i < 16; i++) {
    const r = await fetch(`${BASIS}/api/admin/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': forfalsket() },
      body: JSON.stringify({ brugernavn: 'x', kodeord: 'y' }),
    });
    koder.push(r.status);
    await r.arrayBuffer();
  }
  assert.deepEqual(koder.slice(0, 15), Array(15).fill(401));
  assert.equal(koder[15], 429);
});

test('låsens kodeord spærres, selv om hvert forsøg sender en ny opdigtet IP', async () => {
  const koder = [];
  for (let i = 0; i < 16; i++) {
    const r = await fetch(`${BASIS}/laas`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': forfalsket() },
      body: 'kodeord=forkert&naeste=/',
      redirect: 'manual',
    });
    koder.push(r.status);
    await r.arrayBuffer();
  }
  assert.deepEqual(koder.slice(0, 15), Array(15).fill(401));
  assert.equal(koder[15], 429);
});

test('[sikkerhed]-linjerne skriver den rigtige adresse - aldrig den opdigtede', () => {
  const linjer = udskrift.split('\n').filter((l) => l.includes('[sikkerhed]'));
  const ips = new Set(linjer.map((l) => (l.match(/ip=(\S+)/) || [])[1]));
  assert.ok(linjer.some((l) => l.includes('kb-soeg-loft')), 'ingen loft-linje');
  assert.ok(linjer.some((l) => l.includes('login-spaerret')), 'ingen login-linje');
  assert.ok(linjer.some((l) => l.includes('laas-spaerret')), 'ingen laas-linje');
  assert.deepEqual([...ips], [RIGTIG]);
});
