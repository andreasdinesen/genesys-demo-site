/*
 * Proever af skabelonerne.
 *
 * Det, der proeves, er de steder, hvor en fejl er USYNLIG: at et felt fra
 * admin ikke kan lukke ud af sin attribut, at widget'en kun kommer med naar
 * den skal, og at laasesiden ikke sladrer.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sider = require('../app/sider.js');

const INDST = {
  site_navn: 'Demo Erhverv',
  genesys_env: 'prod-euc1',
  genesys_domaene: 'mypurecloud.de',
  genesys_deployment_id: '4c183424-902b-415d-a396-1c4aea94130a',
  genesys_widget: '1',
  brand_farve: '#0000bf',
};

const ctx = (ekstra = {}) => Object.assign({
  indst: INDST,
  sider: [{ slug: 'forside', title: 'Forside', nav: true, forside: true }],
  sti: '/',
  version: '7',
  widget: sider.widgetSnippet(INDST),
}, ekstra);

test('snippet\'en indeholder region, domaene og deployment-id', () => {
  const s = sider.widgetSnippet(INDST);
  assert.ok(s.includes("environment: 'prod-euc1'"));
  assert.ok(s.includes("deploymentId: '4c183424-902b-415d-a396-1c4aea94130a'"));
  assert.ok(s.includes('https://apps.mypurecloud.de/genesys-bootstrap/genesys.min.js'));
});

test('ingen snippet uden deployment-id, og ingen naar widget\'en er slaaet fra', () => {
  assert.equal(sider.widgetSnippet(Object.assign({}, INDST, { genesys_deployment_id: '' })), '');
  assert.equal(sider.widgetSnippet(Object.assign({}, INDST, { genesys_widget: '0' })), '');
});

test('et deployment-id, der ikke ligner et id, kommer ikke ud paa siden', () => {
  const ondt = Object.assign({}, INDST, { genesys_deployment_id: "x'});alert(1);//" });
  assert.equal(sider.widgetSnippet(ondt), '', 'hellere ingen widget end et indsat script');
});

test('en farve, der ikke er en farve, bliver til standardfarven', () => {
  assert.equal(sider.farve('#abc', '#000'), '#abc');
  assert.equal(sider.farve('red; } body { display:none', '#000'), '#000');
  assert.equal(sider.farve('', '#000'), '#000');
});

test('links fra admin kan ikke blive javascript:', () => {
  assert.equal(sider.link('https://x.dk'), 'https://x.dk');
  assert.equal(sider.link('/hjaelp'), '/hjaelp');
  assert.equal(sider.link('mailto:a@b.dk'), 'mailto:a@b.dk');
  assert.equal(sider.link('javascript:alert(1)'), '/javascript:alert(1)',
    'ukendte skemaer bliver til en sti - ikke til kode');
});

test('sidens felter escapes', () => {
  const side = {
    slug: 'forside', title: '<img src=x onerror=alert(1)>', type: 'forside', forside: true, nav: true,
    data: { hero: { titel: '"><script>alert(1)</script>' } },
  };
  const html = sider.tegnForside(side, ctx());
  /* Det farlige er de UESCAPEDE tegn. Teksten »onerror=alert(1)« maa gerne
   * staa paa siden - den er harmloes, naar dens < og > er escaped. */
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
});

test('css og js baerer versionen - ellers cacher Cloudflare dem i timevis', () => {
  const html = sider.tegnIndhold({ slug: 'a', title: 'A', type: 'indhold', data: {} }, ctx());
  assert.ok(html.includes('/site.css?v=7'));
  assert.ok(html.includes('/site.js?v=7'));
});

test('siderne er noindex - et demo-site hoerer ikke til i Google', () => {
  const html = sider.tegnIndhold({ slug: 'a', title: 'A', type: 'indhold', data: {} }, ctx());
  assert.ok(html.includes('name="robots" content="noindex, nofollow"'));
});

test('widget\'en kommer med paa en almindelig side', () => {
  const html = sider.tegnIndhold({ slug: 'a', title: 'A', type: 'indhold', data: {} }, ctx());
  assert.ok(html.includes('genesys-bootstrap'));
});

test('en importeret side faar snippet\'en lige foer </body>', () => {
  const side = { slug: 'kunde', title: 'Kunde', type: 'html', html: '<html><body><h1>Kundens side</h1></body></html>' };
  const html = sider.tegnRaa(side, ctx());
  assert.ok(html.includes('<h1>Kundens side</h1>'), 'originalen roeres ikke');
  assert.ok(html.indexOf('genesys-bootstrap') < html.lastIndexOf('</body>'));
  assert.ok(!html.includes('site.css'), 'og den faar IKKE vores css - den skal ligne originalen');
});

test('en importeret side uden </body> faar snippet\'en til sidst', () => {
  const side = { slug: 'k', title: 'K', type: 'html', html: '<h1>Fragment</h1>' };
  const html = sider.tegnRaa(side, ctx());
  assert.ok(html.startsWith('<h1>Fragment</h1>'));
  assert.ok(html.includes('genesys-bootstrap'));
});

test('laasesiden har hverken menu eller widget', () => {
  const html = sider.tegnLaas(ctx(), { naeste: '/hjaelp' });
  assert.ok(!html.includes('genesys-bootstrap'), 'ingen chat paa en laaseskaerm');
  assert.ok(!html.includes('hovedmenu'), 'og ingen menu, der sladrer om sitets sider');
  assert.ok(html.includes('name="naeste" value="/hjaelp"'));
});

test('slugify folder ae oe aa og klipper skraastreger', () => {
  assert.equal(sider.slugify('Hjælp & Støtte'), 'hjaelp-stoette');
  assert.equal(sider.slugify('  Årsrapport 2026  '), 'aarsrapport-2026');
  assert.equal(sider.slugify('/admin/'), 'admin');
  assert.equal(sider.slugify(''), '');
});

test('vidensbasesiden staar op, ogsaa naar Genesys fejler', () => {
  const side = { slug: 'hjaelp', title: 'Hjælp', type: 'vidensbase', data: {} };
  const html = sider.tegnVidensbase(side, ctx({ kb: { kategorier: [], artikler: [], fejl: '502: nede' } }));
  assert.ok(html.includes('Vidensbasen kunne ikke hentes'));
  assert.ok(html.includes('502'), 'og den siger HVAD der gik galt');
  assert.ok(html.includes('data-kb-soeg'), 'soegefeltet staar der stadig');
});

test('foraeldede svar siges hoejt paa siden', () => {
  const side = { slug: 'hjaelp', title: 'Hjælp', type: 'vidensbase', data: {} };
  const html = sider.tegnVidensbase(side, ctx({ kb: { kategorier: [], artikler: [{ id: '1', titel: 'A' }], foraeldet: true } }));
  assert.ok(html.includes('gemt svar fra Genesys'));
});

test('artikel-adresser bygges af id og en slug af titlen', () => {
  const side = { slug: 'hjaelp', title: 'Hjælp', type: 'vidensbase', data: {} };
  const html = sider.tegnVidensbase(side, ctx({
    kb: { kategorier: [], artikler: [{ id: 'abc-123', titel: 'Sådan skifter du kode' }] },
  }));
  assert.ok(html.includes('/hjaelp/artikel/abc-123/saadan-skifter-du-kode'));
});
