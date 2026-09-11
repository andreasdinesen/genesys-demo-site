/*
 * Proever af artikel-rendereren.
 *
 * Genesys' artikelformat er et trae af blokke, og den eneste maade at vide, at
 * oversaettelsen til HTML er rigtig, er at fodre den med rigtige blokke.
 * Formerne herunder er skrevet af efter Platform API'ets swagger
 * (DocumentBodyBlock, DocumentContentBlock, DocumentText …), ikke efter koden -
 * ellers proever proeven bare, at koden er enig med sig selv.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const kb = require('../app/kb.js');

const afsnit = (tekst, egenskaber) => ({
  type: 'Paragraph',
  paragraph: { blocks: [{ type: 'Text', text: { text: tekst } }], properties: egenskaber },
});

test('et almindeligt afsnit bliver til <p>', () => {
  assert.equal(kb.tilHtml({ blocks: [afsnit('Hej')] }), '<p>Hej</p>');
});

test('Heading1 bliver til h2 - siden har allerede sin h1', () => {
  const html = kb.tilHtml({ blocks: [afsnit('Overskrift', { fontType: 'Heading1' })] });
  assert.equal(html, '<h2>Overskrift</h2>');
});

test('tekst escapes', () => {
  const html = kb.tilHtml({ blocks: [afsnit('<script>alert(1)</script>')] });
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('maerker laegges i fast raekkefoelge', () => {
  const blok = {
    type: 'Paragraph',
    paragraph: { blocks: [{ type: 'Text', text: { text: 'vigtigt', marks: ['Italic', 'Bold'] } }] },
  };
  const a = kb.tilHtml({ blocks: [blok] });
  const b = kb.tilHtml({ blocks: [{ type: 'Paragraph', paragraph: { blocks: [{ type: 'Text', text: { text: 'vigtigt', marks: ['Bold', 'Italic'] } }] } }] });
  assert.equal(a, b, 'samme maerker i anden raekkefoelge skal give samme HTML');
  /* Fed laegges foerst og ender derfor inderst - det er raekkefoelgen i
   * MAERKER, der bestemmer, og pointen er at den er FAST. */
  assert.equal(a, '<p><em><strong>vigtigt</strong></em></p>');
});

test('javascript:-links bliver til ren tekst', () => {
  const blok = { type: 'Paragraph', paragraph: { blocks: [{ type: 'Text', text: { text: 'klik', hyperlink: 'javascript:alert(1)' } }] } };
  const html = kb.tilHtml({ blocks: [blok] });
  assert.equal(html, '<p>klik</p>');
  assert.ok(!html.includes('href'));
});

test('http-links aabner i ny fane og er nofollow', () => {
  const blok = { type: 'Paragraph', paragraph: { blocks: [{ type: 'Text', text: { text: 'se', hyperlink: 'https://example.com/a?b=1&c=2' } }] } };
  const html = kb.tilHtml({ blocks: [blok] });
  assert.ok(html.includes('href="https://example.com/a?b=1&amp;c=2"'));
  assert.ok(html.includes('rel="noopener noreferrer nofollow"'));
  assert.ok(html.includes('target="_blank"'));
});

test('lister - ogsaa lister i lister', () => {
  const indre = { type: 'UnorderedList', list: { blocks: [{ type: 'ListItem', blocks: [{ type: 'Text', text: { text: 'under' } }] }] } };
  const ydre = {
    type: 'OrderedList',
    list: { blocks: [{ type: 'ListItem', blocks: [{ type: 'Text', text: { text: 'et' } }, indre] }] },
  };
  const html = kb.tilHtml({ blocks: [ydre] });
  assert.ok(html.startsWith('<ol class="kb-liste">'));
  assert.ok(html.includes('<ul class="kb-liste"><li>under</li></ul>'));
});

test('tabeller ruller i deres egen boks', () => {
  const tabel = {
    type: 'Table',
    table: {
      rows: [
        { cells: [{ properties: { cellType: 'HeaderCell' }, blocks: [afsnit('Kolonne')] }] },
        { cells: [{ blocks: [afsnit('Vaerdi')] }] },
      ],
    },
  };
  const html = kb.tilHtml({ blocks: [tabel] });
  assert.ok(html.includes('<div class="kb-tabelboks">'));
  assert.ok(html.includes('<th><p>Kolonne</p></th>'));
  assert.ok(html.includes('<td><p>Vaerdi</p></td>'));
});

test('billeder kraever en tryg adresse', () => {
  assert.equal(kb.tilHtml({ blocks: [{ type: 'Image', image: { url: 'javascript:1' } }] }), '');
  const ok = kb.tilHtml({ blocks: [{ type: 'Image', image: { url: 'https://x/y.png', properties: { altText: 'Et "billede"' } } }] });
  assert.ok(ok.includes('src="https://x/y.png"'));
  assert.ok(ok.includes('alt="Et &quot;billede&quot;"'));
  assert.ok(ok.includes('loading="lazy"'));
});

test('video: mp4 indlejres, alt andet bliver et link', () => {
  assert.ok(kb.tilHtml({ blocks: [{ type: 'Video', video: { url: 'https://x/y.mp4' } }] }).includes('<video'));
  const yt = kb.tilHtml({ blocks: [{ type: 'Video', video: { url: 'https://youtube.com/watch?v=1' } }] });
  assert.ok(yt.includes('<a href'));
  assert.ok(!yt.includes('<iframe'));
});

test('ukendte bloktyper springes over uden at vaelte artiklen', () => {
  const html = kb.tilHtml({ blocks: [{ type: 'NoGetHeltNyt', data: {} }, afsnit('Resten')] });
  assert.equal(html.trim(), '<p>Resten</p>');
});

test('tilTekst giver ren tekst uden entiteter', () => {
  const tekst = kb.tilTekst({ blocks: [afsnit('Vi & de <andre>')] });
  assert.equal(tekst, 'Vi & de <andre>');
});

test('tom eller manglende krop giver tom streng', () => {
  assert.equal(kb.tilHtml(null), '');
  assert.equal(kb.tilHtml({}), '');
  assert.equal(kb.tilHtml({ blocks: [] }), '');
});
