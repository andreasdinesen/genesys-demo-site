/*
 * Genesys' artikelformat (DocumentBody) -> HTML.
 *
 * En artikel er ikke HTML i Genesys. Den er en trae af blokke: afsnit med
 * tekststumper, lister, tabeller, billeder og video - hver med egne
 * egenskaber (overskriftsniveau, justering, farve). Skal artiklen vises paa
 * demo-sitet, skal traeet oversaettes.
 *
 * ── De to regler ─────────────────────────────────────────────────────────
 *
 * 1. **Alt tekst escapes, ingen undtagelser.** Indholdet kommer fra en
 *    vidensbase, andre skriver i - og siden vises for kunder. En artikel maa
 *    aldrig kunne indsaette et script paa demo-sitet.
 * 2. **Adresser valideres, ikke bare escapes.** `javascript:`-links overlever
 *    en HTML-escape uskadt. Kun http, https, mailto og tel slipper igennem;
 *    alt andet bliver til ren tekst uden link.
 *
 * Ukendte bloktyper springes over i stilhed. Genesys tilfoejer typer over tid,
 * og en ukendt blok maa ikke kunne vaelte hele artiklen.
 */

'use strict';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Kun adresser, en browser kan foelge uden at koere kode (regel 2). */
function trygUrl(raa) {
  const s = String(raa || '').trim();
  if (!s) return null;
  if (/^(https?:|mailto:|tel:)/i.test(s)) return s;
  /* Relative adresser peger ind i vidensbasens eget indhold og er ufarlige. */
  if (/^\/[^/]/.test(s)) return s;
  return null;
}

const MAERKER = {
  bold: ['<strong>', '</strong>'],
  italic: ['<em>', '</em>'],
  underline: ['<u>', '</u>'],
  strikethrough: ['<s>', '</s>'],
  subscript: ['<sub>', '</sub>'],
  superscript: ['<sup>', '</sup>'],
};

/** En tekststump med sine maerker og sit eventuelle link. */
function tekst(t) {
  if (!t || typeof t.text !== 'string') return '';
  let ud = esc(t.text);
  /* Maerkerne laegges udefra og ind i fast raekkefoelge. Genesys sender dem som
   * et saet uden orden, og uden en fast raekkefoelge ville den samme artikel
   * kunne give forskellig HTML fra gang til gang. */
  for (const m of Object.keys(MAERKER)) {
    if ((t.marks || []).some((x) => String(x).toLowerCase() === m)) {
      ud = MAERKER[m][0] + ud + MAERKER[m][1];
    }
  }
  const url = trygUrl(t.hyperlink);
  if (url) ud = `<a href="${esc(url)}" rel="noopener noreferrer nofollow"${/^https?:/i.test(url) ? ' target="_blank"' : ''}>${ud}</a>`;
  return ud;
}

function billede(b) {
  if (!b) return '';
  const url = trygUrl(b.url);
  if (!url) return '';
  const p = b.properties || {};
  const alt = esc(p.altText || '');
  const stil = [];
  if (p.align) stil.push(`--just:${String(p.align).toLowerCase()}`);
  const img = `<img src="${esc(url)}" alt="${alt}" loading="lazy">`;
  const link = trygUrl(b.hyperlink);
  return `<figure class="kb-billede${p.align ? ` kb-${String(p.align).toLowerCase()}` : ''}">${
    link ? `<a href="${esc(link)}" rel="noopener noreferrer nofollow" target="_blank">${img}</a>` : img
  }</figure>`;
}

function video(v) {
  const url = v && trygUrl(v.url);
  if (!url) return '';
  if (/\.(mp4|webm|ogg)(\?|$)/i.test(url)) {
    return `<video class="kb-video" controls preload="metadata" src="${esc(url)}"></video>`;
  }
  /* Alt andet (YouTube, Vimeo, en intern afspiller) indlejres IKKE: en iframe
   * fra en ukendt vaert paa et demo-site er en fremmed side, vi ikke styrer. */
  return `<p class="kb-video-link"><a href="${esc(url)}" target="_blank" rel="noopener noreferrer nofollow">Se video</a></p>`;
}

const OVERSKRIFTER = {
  heading1: 'h2', heading2: 'h3', heading3: 'h4',
  heading4: 'h5', heading5: 'h6', heading6: 'h6',
};

/**
 * Et afsnit.
 *
 * `Heading1` bliver til `<h2>`, ikke `<h1>`: siden har allerede sin egen `<h1>`
 * med artiklens titel, og to h1'er paa samme side er et laeseraekkefoelge-rod
 * for skaermlaesere.
 */
function afsnit(pa) {
  if (!pa) return '';
  const indhold = (pa.blocks || []).map(indholdsblok).join('');
  if (!indhold.trim()) return '';
  const p = pa.properties || {};
  const type = String(p.fontType || '').toLowerCase();
  if (type === 'preformatted') return `<pre class="kb-pre">${indhold}</pre>`;
  const tag = OVERSKRIFTER[type] || 'p';
  const klasser = [];
  if (p.align && String(p.align).toLowerCase() !== 'left') klasser.push(`kb-${String(p.align).toLowerCase()}`);
  if (p.fontSize) klasser.push(`kb-str-${String(p.fontSize).toLowerCase()}`);
  return `<${tag}${klasser.length ? ` class="${klasser.join(' ')}"` : ''}>${indhold}</${tag}>`;
}

function indholdsblok(c) {
  if (!c) return '';
  switch (String(c.type)) {
    case 'Text': return tekst(c.text);
    case 'Image': return billede(c.image);
    case 'Video': return video(c.video);
    case 'OrderedList': return liste(c.list, 'ol');
    case 'UnorderedList': return liste(c.list, 'ul');
    default: return '';
  }
}

/** Lister kan indeholde lister. Dybden er begraenset, saa et cyklisk (eller
 *  bare absurd) svar ikke kan koere stakken toer. */
function liste(l, tag, dybde = 0) {
  if (!l || dybde > 8) return '';
  const punkter = (l.blocks || []).map((b) => {
    const indhold = (b && b.blocks ? b.blocks : []).map((c) => {
      if (c && (c.type === 'OrderedList' || c.type === 'UnorderedList')) {
        return liste(c.list, c.type === 'OrderedList' ? 'ol' : 'ul', dybde + 1);
      }
      return indholdsblok(c);
    }).join('');
    return indhold.trim() ? `<li>${indhold}</li>` : '';
  }).join('');
  return punkter ? `<${tag} class="kb-liste">${punkter}</${tag}>` : '';
}

function tabel(t) {
  if (!t || !Array.isArray(t.rows)) return '';
  const raekker = t.rows.map((r) => {
    const celler = (r.cells || []).map((c) => {
      const p = c.properties || {};
      const tag = String(p.cellType || '').toLowerCase() === 'headercell' ? 'th' : 'td';
      const attr = [];
      if (Number(p.colSpan) > 1) attr.push(`colspan="${Number(p.colSpan)}"`);
      if (Number(p.rowSpan) > 1) attr.push(`rowspan="${Number(p.rowSpan)}"`);
      const indhold = (c.blocks || []).map((b) => {
        if (b && b.type === 'Paragraph') return afsnit(b.paragraph);
        return indholdsblok(b);
      }).join('');
      return `<${tag}${attr.length ? ` ${attr.join(' ')}` : ''}>${indhold}</${tag}>`;
    }).join('');
    return `<tr>${celler}</tr>`;
  }).join('');
  /* Tabellen faar sin egen rulleboks: en bred tabel maa aldrig kunne give hele
   * siden en vandret scrollbar paa en telefon (RUNE-ERFARINGER §4). */
  return raekker ? `<div class="kb-tabelboks"><table class="kb-tabel">${raekker}</table></div>` : '';
}

/** Hele artiklens krop. */
function tilHtml(body) {
  if (!body || !Array.isArray(body.blocks)) return '';
  return body.blocks.map((b) => {
    if (!b) return '';
    switch (String(b.type)) {
      case 'Paragraph': return afsnit(b.paragraph);
      case 'Image': return billede(b.image);
      case 'Video': return video(b.video);
      case 'OrderedList': return liste(b.list, 'ol');
      case 'UnorderedList': return liste(b.list, 'ul');
      case 'Table': return tabel(b.table);
      default: return '';
    }
  }).join('\n');
}

/** Ren tekst ud af artiklen - til resumeer og til <meta description>. */
function tilTekst(body, maks = 400) {
  const ud = tilHtml(body).replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
  return ud.length > maks ? `${ud.slice(0, maks - 1)}…` : ud;
}

module.exports = { tilHtml, tilTekst, trygUrl, esc };
