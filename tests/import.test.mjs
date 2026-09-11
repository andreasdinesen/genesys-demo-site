/*
 * Proever af sideimporten.
 *
 * De to funktioner herunder afgoer, om en importeret kundeside VIRKER som
 * kulisse: om dens billeder og css stadig kan hentes, og om der koerer én
 * Genesys-widget - ikke to.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const imp = require('../app/import.js');

const KILDE = 'http://80.209.89.190/DemoBots.html';

test('relative ressourcer bliver absolutte', () => {
  const html = imp.absolutiser(
    '<link rel="stylesheet" href="/styles.css"><script src="app-1.js"></script><img src="/b.png">',
    KILDE);
  assert.ok(html.includes('href="http://80.209.89.190/styles.css"'));
  assert.ok(html.includes('src="http://80.209.89.190/app-1.js"'));
  assert.ok(html.includes('src="http://80.209.89.190/b.png"'));
});

test('LINKS flyttes IKKE - ellers forlader man demoen ved foerste klik', () => {
  const html = imp.absolutiser('<a href="/produkter">Se mere</a>', KILDE);
  assert.ok(html.includes('href="/produkter"'), 'et <a> skal blive, hvor det er');
});

test('protokol-relative og absolutte adresser roeres ikke', () => {
  const html = imp.absolutiser(
    '<script src="//s.c.dk/f.js"></script><img src="https://tdc.dk/a.png"><img src="data:image/png;base64,AAA">',
    KILDE);
  assert.ok(html.includes('src="http://s.c.dk/f.js"'), 'protokol-relativ faar kildens protokol');
  assert.ok(html.includes('src="https://tdc.dk/a.png"'));
  assert.ok(html.includes('src="data:image/png;base64,AAA"'));
});

test('srcset: hver kandidat for sig, bredde-angivelsen bevares', () => {
  const html = imp.absolutiser('<img srcset="/a.png 1x, /b.png 2x">', KILDE);
  assert.ok(html.includes('srcset="http://80.209.89.190/a.png 1x, http://80.209.89.190/b.png 2x"'));
});

test('url() i css bliver ogsaa absolut', () => {
  const html = imp.absolutiser('<style>.a{background:url(/bg.jpg)}</style>', KILDE);
  assert.ok(html.includes('url(http://80.209.89.190/bg.jpg)'));
});

test('kildens egen Genesys-snippet fjernes', () => {
  const original = `<body><p>Indhold</p>
<script type="text/javascript" charset="utf-8">
  (function (g, e, n, es, ys) { g['_genesysJs'] = e; })(window, 'Genesys',
    'https://apps.mypurecloud.de/genesys-bootstrap/genesys.min.js',
    { environment: 'prod-euc1', deploymentId: 'abc' });
</script>
</body>`;
  const ud = imp.fjernGenesys(original);
  assert.ok(!ud.includes('_genesysJs'), 'scriptet skal vaere vaek');
  assert.ok(ud.includes('oprindelig Genesys-snippet fjernet'), 'og der skal staa hvorfor');
  assert.ok(ud.includes('<p>Indhold</p>'), 'resten af siden roeres ikke');
});

test('andre scripts overlever - kun Genesys fjernes', () => {
  const ud = imp.fjernGenesys('<script src="https://x/analytics.js"></script><script>var a=1;</script>');
  assert.ok(ud.includes('analytics.js'));
  assert.ok(ud.includes('var a=1;'));
});

test('en side uden Genesys aendres ikke', () => {
  const original = '<html><body>Hej</body></html>';
  assert.equal(imp.fjernGenesys(original), original);
});

test('hentSide afviser alt andet end http og https', async () => {
  await assert.rejects(() => imp.hentSide('file:///etc/passwd'), /Kun http og https/);
  await assert.rejects(() => imp.hentSide('ikke en adresse'), /Ugyldig adresse/);
});
