/* Runens version foelger IKKE app-versionen.
 *
 * Til og med v3 satte build'et runens version til APP_VERSION, saa panelet
 * viste en ny rune ved hver udgivelse - selv om YAML'en var den samme, og
 * serveren i forvejen henter sin egen kode ved genstart. Proeven bygger en
 * KASSERBAR kopi med APP_VERSION = 999 og kraever, at runen er uaendret.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROD = new URL('..', import.meta.url).pathname;
const YAML = 'runes/genesys-demo-site.yaml';

function byg(mappe) {
  return execFileSync('python3', ['build_rune.py'], { cwd: mappe, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

test('en ny APP_VERSION giver IKKE en ny rune', () => {
  const kopi = mkdtempSync(path.join(tmpdir(), 'gds-rune-'));
  try {
    cpSync(ROD, kopi, { recursive: true, filter: (k) => !k.includes(`${path.sep}node_modules`) });
    const foer = readFileSync(path.join(kopi, YAML), 'utf8');
    const p1 = path.join(kopi, 'app/parts/p1_core.js');
    const kilde = readFileSync(p1, 'utf8');
    assert.match(kilde, /const APP_VERSION = \d+;/);
    writeFileSync(p1, kilde.replace(/const APP_VERSION = \d+;/, 'const APP_VERSION = 999;'));
    const ud = byg(kopi);
    const efter = readFileSync(path.join(kopi, YAML), 'utf8');
    assert.equal(efter, foer, 'runen aendrede sig, selv om kun app-koden gjorde');
    assert.match(ud, /Runen er UAENDRET/);
    assert.match(readFileSync(path.join(kopi, 'app/public/index.html'), 'utf8'), /app\.js\?v=999/,
      'app-versionen skal stadig stemples i index.html');
  } finally {
    rmSync(kopi, { recursive: true, force: true });
  }
});

test('RUNE_VERSION maa ikke vaere nyere end APP_VERSION', () => {
  const kopi = mkdtempSync(path.join(tmpdir(), 'gds-rune-'));
  try {
    cpSync(ROD, kopi, { recursive: true });
    const b = path.join(kopi, 'build_rune.py');
    writeFileSync(b, readFileSync(b, 'utf8').replace(/^RUNE_VERSION = \d+$/m, 'RUNE_VERSION = 10000'));
    assert.throws(() => byg(kopi), /RUNE_VERSION \(10000\) er nyere end APP_VERSION/);
  } finally {
    rmSync(kopi, { recursive: true, force: true });
  }
});
