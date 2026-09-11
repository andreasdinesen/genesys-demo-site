/*
 * Demo-sitets sider. Serveren tegner dem - der er ingen SPA ude paa sitet.
 *
 * Hvorfor server-side: Genesys' snippet skal staa i den HTML, browseren faar
 * foerste gang. Tegnede en SPA siden bagefter, ville widget'en komme et halvt
 * sekund efter resten, og en demo er netop det halve sekund, kunden kigger paa.
 * Samtidig ser sitet ud som et rigtigt website i »vis kilde« - hvilket er
 * hele pointen, naar man demonstrerer web messaging.
 *
 * ── Sidetyper er et REGISTER, ikke en if-kaede ───────────────────────────
 *
 * `TYPER` nederst er den eneste liste over, hvad en side kan vaere. En ny
 * sidetype er: en tegnefunktion + en linje i registret + felterne i admin.
 * Andreas har sagt, at der kommer flere funktioner - saa er det billigt.
 */

'use strict';

const kb = require('./kb.js');

const esc = kb.esc;

/* ------------------------------------------------------------------- smaating */

/** Adresse-felter fra admin maa ikke kunne blive til `javascript:`. */
function link(raa, fallback = '#') {
  const s = String(raa || '').trim();
  if (!s) return fallback;
  if (/^(https?:|mailto:|tel:|\/|#)/i.test(s)) return s;
  return `/${s.replace(/^\/+/, '')}`;
}

/** Bruges baade til slugs fra admin og til artikel-adresser. */
function slugify(tekst) {
  return String(tekst || '')
    .toLowerCase()
    .replace(/æ/g, 'ae').replace(/ø/g, 'oe').replace(/å/g, 'aa')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/**
 * Genesys Web Messaging-snippet'en.
 *
 * Det er ORDRET den snippet, Genesys Cloud selv udleverer - med environment og
 * deployment-id fra indstillingerne. Den skrives ikke om til noget koennere:
 * naar en kunde spoerger »hvad skal vi laegge paa vores side?«, skal svaret
 * vaere »praecis det her«, og saa skal det staa, som de faar det.
 */
function widgetSnippet(indst) {
  const dep = String(indst.genesys_deployment_id || '').trim();
  if (!dep || indst.genesys_widget !== '1') return '';
  const env = String(indst.genesys_env || 'prod-euc1').trim();
  const domaene = String(indst.genesys_domaene || 'mypurecloud.de').trim();
  if (!/^[a-z0-9-]{2,40}$/.test(env) || !/^[a-z0-9.-]{4,60}$/.test(domaene)) return '';
  if (!/^[0-9a-fA-F-]{20,60}$/.test(dep)) return '';
  return `
<!-- Genesys Web Messaging -->
<script type="text/javascript" charset="utf-8">
  (function (g, e, n, es, ys) {
    g['_genesysJs'] = e;
    g[e] = g[e] || function () {
      (g[e].q = g[e].q || []).push(arguments)
    };
    g[e].t = 1 * new Date();
    g[e].c = es;
    ys = document.createElement('script'); ys.async = 1; ys.src = n; ys.charset = 'utf-8'; document.head.appendChild(ys);
  })(window, 'Genesys', 'https://apps.${domaene}/genesys-bootstrap/genesys.min.js', {
    environment: '${env}',
    deploymentId: '${dep}'
  });
</script>
<!-- /Genesys Web Messaging -->`;
}

/* ------------------------------------------------------------------- skallen */

function hoved(ctx) {
  const { indst, sider, sti } = ctx;
  const navn = indst.site_navn || 'Demo';
  const logo = indst.logo
    ? `<img src="/logo.png?v=${esc(ctx.logoVer || '0')}" alt="${esc(navn)}" class="logo-billede">`
    : `<span class="logo-tekst">${esc(navn)}</span>`;
  const punkter = sider.filter((s) => s.nav).map((s) => {
    const aktiv = sti === `/${s.slug}` || (sti === '/' && s.forside);
    return `<li><a href="${s.forside ? '/' : `/${esc(s.slug)}`}"${aktiv ? ' class="aktiv" aria-current="page"' : ''}>${esc(s.title)}</a></li>`;
  }).join('');
  return `<header class="top">
  <div class="baand">${esc(indst.site_baand || '')}</div>
  <div class="topindhold">
    <a class="logo" href="/">${logo}</a>
    <nav class="hovedmenu" aria-label="Hovedmenu"><ul>${punkter}</ul></nav>
    <div class="topknapper">
      ${indst.site_cta_tekst ? `<a class="knap knap-lys" href="${esc(link(indst.site_cta_link))}">${esc(indst.site_cta_tekst)}</a>` : ''}
      <button class="menuknap" type="button" aria-expanded="false" aria-controls="mobilmenu">Menu</button>
    </div>
  </div>
  <nav class="mobilmenu" id="mobilmenu" hidden aria-label="Menu"><ul>${punkter}</ul></nav>
</header>`;
}

function fod(ctx) {
  const { indst, sider } = ctx;
  const punkter = sider.filter((s) => s.nav).map((s) =>
    `<li><a href="${s.forside ? '/' : `/${esc(s.slug)}`}">${esc(s.title)}</a></li>`).join('');
  return `<footer class="fod">
  <div class="fodindhold">
    <div>
      <p class="fodnavn">${esc(indst.site_navn || 'Demo')}</p>
      <p class="fodtekst">${esc(indst.site_fodtekst || '')}</p>
    </div>
    <nav aria-label="Sidefod"><ul class="fodmenu">${punkter}</ul></nav>
  </div>
  <p class="fodbund">${esc(indst.site_copyright || '')}</p>
</footer>`;
}

/**
 * Hele dokumentet.
 *
 * `?v=` paa css og js er ikke pynt: Cloudflare edge-cacher dem i timevis og
 * ignorerer Cache-Control (RUNE-ERFARINGER §5). Uden versionen ser en kunde
 * gammelt design efter en opdatering.
 */
function dokument(ctx, indhold, { titel, beskrivelse = '', klasse = '' } = {}) {
  const { indst, version } = ctx;
  const navn = indst.site_navn || 'Demo';
  const fuldTitel = titel && titel !== navn ? `${titel} | ${navn}` : navn;
  return `<!DOCTYPE html>
<html lang="${esc(indst.site_sprog || 'da')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fuldTitel)}</title>
<meta name="description" content="${esc(beskrivelse || indst.site_undertitel || '')}">
<meta name="robots" content="noindex, nofollow">
<link rel="stylesheet" href="/site.css?v=${esc(version)}">
<style>:root{--maerke:${esc(farve(indst.brand_farve, '#0000bf'))};--maerke-moerk:${esc(farve(indst.brand_farve_moerk, '#000080'))};--maerke-tekst:${esc(farve(indst.brand_tekst, '#ffffff'))}}</style>
${indst.site_ekstra_head || ''}
</head>
<body class="${esc(klasse)}">
${hoved(ctx)}
<main id="indhold">
${indhold}
</main>
${fod(ctx)}
<script src="/site.js?v=${esc(version)}" defer></script>
${ctx.widget || ''}
${indst.site_ekstra_body || ''}
</body>
</html>`;
}

/** En farve fra admin skal VAERE en farve - ellers kan den lukke ud af attributten. */
function farve(raa, fallback) {
  const s = String(raa || '').trim();
  return /^#[0-9a-fA-F]{3,8}$/.test(s) ? s : fallback;
}

/* --------------------------------------------------------------- sidetyperne */

/** Hero + kortsektioner. Det er den side, en demo som regel begynder paa. */
function tegnForside(side, ctx) {
  const d = side.data || {};
  const hero = d.hero || {};
  const html = `
<section class="hero"${hero.billede ? ` style="--hero-billede:url('${esc(hero.billede)}')"` : ''}>
  <div class="indeni">
    ${hero.overrubrik ? `<p class="overrubrik">${esc(hero.overrubrik)}</p>` : ''}
    <h1>${esc(hero.titel || side.title)}</h1>
    ${hero.tekst ? `<p class="hero-tekst">${esc(hero.tekst)}</p>` : ''}
    ${hero.knapTekst ? `<p><a class="knap" href="${esc(link(hero.knapLink))}">${esc(hero.knapTekst)}</a></p>` : ''}
  </div>
</section>
${sektioner(d.sektioner)}`;
  return dokument(ctx, html, { titel: side.title, beskrivelse: hero.tekst, klasse: 'side-forside' });
}

/** En almindelig indholdsside: rubrik, manchet og de samme sektioner. */
function tegnIndhold(side, ctx) {
  const d = side.data || {};
  const html = `
<section class="sidetop">
  <div class="indeni">
    <h1>${esc(side.title)}</h1>
    ${d.intro ? `<p class="manchet">${esc(d.intro)}</p>` : ''}
  </div>
</section>
${sektioner(d.sektioner)}`;
  return dokument(ctx, html, { titel: side.title, beskrivelse: d.intro });
}

/** Kontaktsiden. Formularen sender ingen steder hen - den er en demo-rekvisit,
 *  og det staar der ogsaa, saa ingen tror, der kommer et svar. */
function tegnKontakt(side, ctx) {
  const d = side.data || {};
  const raekker = [
    d.telefon ? `<li><span>Telefon</span><a href="tel:${esc(String(d.telefon).replace(/\s+/g, ''))}">${esc(d.telefon)}</a></li>` : '',
    d.email ? `<li><span>E-mail</span><a href="mailto:${esc(d.email)}">${esc(d.email)}</a></li>` : '',
    d.adresse ? `<li><span>Adresse</span>${esc(d.adresse)}</li>` : '',
    d.aabningstid ? `<li><span>Åbningstid</span>${esc(d.aabningstid)}</li>` : '',
  ].filter(Boolean).join('');
  const html = `
<section class="sidetop">
  <div class="indeni">
    <h1>${esc(side.title)}</h1>
    ${d.intro ? `<p class="manchet">${esc(d.intro)}</p>` : ''}
  </div>
</section>
<section class="blok">
  <div class="indeni kontakt">
    <div class="kort kontaktkort">
      <h2>Skriv til os</h2>
      <form class="kontaktform" data-demo="1">
        <label>Navn<input name="navn" autocomplete="name" required></label>
        <label>E-mail<input name="email" type="email" autocomplete="email" required></label>
        <label>Besked<textarea name="besked" rows="5" required></textarea></label>
        <button class="knap" type="submit">Send</button>
        <p class="demo-note">Formularen er en demo og sender ingenting.</p>
      </form>
    </div>
    <div class="kort">
      <h2>Ring eller skriv</h2>
      <ul class="kontaktliste">${raekker}</ul>
      ${ctx.indst.genesys_widget === '1' ? '<p><button class="knap knap-linje" type="button" data-aabn-chat>Åbn chatten</button></p>' : ''}
    </div>
  </div>
</section>`;
  return dokument(ctx, html, { titel: side.title, beskrivelse: d.intro });
}

/**
 * Vidensbasen.
 *
 * Kategorier og artikler tegnes af serveren (de er hentet og cachet), mens
 * soegningen sker i browseren mod /api/kb/soeg. Fejler Genesys, staar siden
 * stadig - med en aerlig linje om hvorfor listen er tom. En demo, der viser en
 * hvid side, er vaerre end en, der siger hvad der mangler.
 */
function tegnVidensbase(side, ctx) {
  const d = side.data || {};
  const data = ctx.kb || {};
  const kategorier = data.kategorier || [];
  const artikler = data.artikler || [];
  const fejl = data.fejl;
  const basis = side.forside ? '' : `/${side.slug}`;

  const katHtml = kategorier.length ? `<ul class="kategorier">${kategorier.map((k) => `
    <li><a href="${esc(basis)}/kategori/${esc(k.id)}/${esc(slugify(k.navn))}" class="kort kategori">
      <span class="kategorinavn">${esc(k.navn)}</span>
      ${k.beskrivelse ? `<span class="kategoritekst">${esc(k.beskrivelse)}</span>` : ''}
      <span class="kategoriantal">${k.antal} artikler</span>
    </a></li>`).join('')}</ul>` : '';

  const listeHtml = artikler.length ? `<ul class="artikelliste">${artikler.map((a) => `
    <li><a href="${esc(basis)}/artikel/${esc(a.id)}/${esc(slugify(a.titel))}">
      <span class="artikeltitel">${esc(a.titel)}</span>
      ${a.resume ? `<span class="artikelresume">${esc(a.resume)}</span>` : ''}
      ${a.kategori ? `<span class="maerkat">${esc(a.kategori)}</span>` : ''}
    </a></li>`).join('')}</ul>`
    : `<p class="tom">${fejl ? `Vidensbasen kunne ikke hentes: ${esc(fejl)}` : 'Der er ingen artikler i vidensbasen endnu.'}</p>`;

  const html = `
<section class="sidetop sidetop-kb">
  <div class="indeni">
    <h1>${esc(side.title)}</h1>
    ${d.intro ? `<p class="manchet">${esc(d.intro)}</p>` : ''}
    <form class="kbsoeg" role="search" data-kb-soeg data-basis="${esc(basis)}">
      <input type="search" name="q" placeholder="${esc(d.soegetekst || 'Søg i vores hjælp …')}" autocomplete="off" aria-label="Søg">
      <button class="knap" type="submit">Søg</button>
    </form>
    ${data.foraeldet ? '<p class="advarsel">Viser et gemt svar fra Genesys – forbindelsen svarede ikke lige nu.</p>' : ''}
  </div>
</section>
<section class="blok">
  <div class="indeni">
    <div data-kb-resultat hidden></div>
    <div data-kb-standard>
      ${katHtml ? `<h2>Kategorier</h2>${katHtml}` : ''}
      <h2>${kategorier.length ? 'Populære artikler' : 'Artikler'}</h2>
      ${listeHtml}
    </div>
  </div>
</section>`;
  return dokument(ctx, html, { titel: side.title, beskrivelse: d.intro, klasse: 'side-kb' });
}

/** Én artikel fra vidensbasen. */
function tegnArtikel(side, ctx, artikel) {
  const basis = side.forside ? '' : `/${side.slug}`;
  const krop = kb.tilHtml(artikel.variation) || '<p class="tom">Artiklen har intet indhold i den valgte variation.</p>';
  const html = `
<section class="blok artikel">
  <div class="indeni smal">
    <p class="brodkrumme"><a href="${esc(basis) || '/'}">${esc(side.title)}</a>${artikel.kategori ? ` <span>/</span> ${esc(artikel.kategori)}` : ''}</p>
    <h1>${esc(artikel.titel)}</h1>
    ${artikel.aendret ? `<p class="artikelmeta">Opdateret ${esc(datoDk(artikel.aendret))}</p>` : ''}
    <div class="kbindhold">${krop}</div>
    <p class="tilbage"><a href="${esc(basis) || '/'}">← Tilbage til ${esc(side.title)}</a></p>
  </div>
</section>`;
  return dokument(ctx, html, {
    titel: artikel.titel,
    beskrivelse: artikel.resume || kb.tilTekst(artikel.variation, 160),
    klasse: 'side-artikel',
  });
}

/** Én kategori: artiklerne i den. */
function tegnKategori(side, ctx, kategori, artikler) {
  const basis = side.forside ? '' : `/${side.slug}`;
  const html = `
<section class="sidetop">
  <div class="indeni">
    <p class="brodkrumme"><a href="${esc(basis) || '/'}">${esc(side.title)}</a></p>
    <h1>${esc(kategori.navn)}</h1>
    ${kategori.beskrivelse ? `<p class="manchet">${esc(kategori.beskrivelse)}</p>` : ''}
  </div>
</section>
<section class="blok">
  <div class="indeni">
    ${artikler.length ? `<ul class="artikelliste">${artikler.map((a) => `
      <li><a href="${esc(basis)}/artikel/${esc(a.id)}/${esc(slugify(a.titel))}">
        <span class="artikeltitel">${esc(a.titel)}</span>
        ${a.resume ? `<span class="artikelresume">${esc(a.resume)}</span>` : ''}
      </a></li>`).join('')}</ul>` : '<p class="tom">Ingen artikler i kategorien.</p>'}
  </div>
</section>`;
  return dokument(ctx, html, { titel: kategori.navn, klasse: 'side-kb' });
}

/**
 * En importeret side: fremmed HTML, som den er.
 *
 * Den faar hverken vores menu eller vores css - meningen med typen er jo, at
 * siden ser ud som originalen. Det eneste, der laegges ind, er Genesys-snippet'en
 * lige foer </body> (og en eventuel eksisterende snippet er fjernet ved import,
 * saa der ikke koerer to widgets paa samme side).
 */
function tegnRaa(side, ctx) {
  const raa = side.html || '<p>Siden er tom. Importér HTML i admin.</p>';
  const tilfoej = `${ctx.widget || ''}\n${ctx.indst.site_ekstra_body || ''}`;
  if (!tilfoej.trim()) return raa;
  const i = raa.toLowerCase().lastIndexOf('</body>');
  return i === -1 ? raa + tilfoej : raa.slice(0, i) + tilfoej + raa.slice(i);
}

/* ------------------------------------------------------------------ sektioner */

/** Sektionerne er den redigerbare del: rubrik, tekst og et gitter af kort. */
function sektioner(liste) {
  if (!Array.isArray(liste) || !liste.length) return '';
  return liste.map((s) => {
    if (!s) return '';
    const kort = (s.kort || []).map((k) => {
      const indre = `
        ${k.billede ? `<img class="kortbillede" src="${esc(link(k.billede))}" alt="" loading="lazy">` : ''}
        ${k.overrubrik ? `<p class="overrubrik">${esc(k.overrubrik)}</p>` : ''}
        <h3>${esc(k.titel || '')}</h3>
        ${k.tekst ? `<p>${esc(k.tekst)}</p>` : ''}
        ${k.linkTekst ? `<p class="kortlink">${esc(k.linkTekst)} →</p>` : ''}`;
      return k.link
        ? `<li><a class="kort" href="${esc(link(k.link))}">${indre}</a></li>`
        : `<li><div class="kort">${indre}</div></li>`;
    }).join('');
    return `<section class="blok${s.toner ? ' tonet' : ''}">
  <div class="indeni">
    ${s.titel ? `<h2>${esc(s.titel)}</h2>` : ''}
    ${s.tekst ? `<p class="manchet">${esc(s.tekst)}</p>` : ''}
    ${kort ? `<ul class="kortgitter kolonner-${Math.min(4, Math.max(1, Number(s.kolonner) || 3))}">${kort}</ul>` : ''}
  </div>
</section>`;
  }).join('\n');
}

/* ---------------------------------------------------------------- kodeordssiden */

/**
 * Laasen foran sitet.
 *
 * Den har hverken menu eller Genesys-widget: er sitet lukket, skal der heller
 * ikke startes en samtale fra laaseskaermen - og en kunde, der faar adressen
 * for tidligt, skal ikke kunne se, hvad sitet hedder indeni.
 */
function tegnLaas(ctx, { fejl = '', naeste = '/' } = {}) {
  const { indst, version } = ctx;
  return `<!DOCTYPE html>
<html lang="da">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(indst.site_navn || 'Demo')}</title>
<meta name="robots" content="noindex, nofollow">
<link rel="stylesheet" href="/site.css?v=${esc(version)}">
<style>:root{--maerke:${esc(farve(indst.brand_farve, '#0000bf'))};--maerke-moerk:${esc(farve(indst.brand_farve_moerk, '#000080'))};--maerke-tekst:${esc(farve(indst.brand_tekst, '#ffffff'))}}</style>
</head>
<body class="laaseside">
<main class="laas">
  <form method="post" action="/laas" class="kort laasekort">
    <h1>${esc(indst.site_navn || 'Demo')}</h1>
    <p>${esc(indst.gate_besked || 'Siden er lukket lige nu. Skriv kodeordet for at komme ind.')}</p>
    <input type="hidden" name="naeste" value="${esc(naeste)}">
    <label>Kodeord<input type="password" name="kodeord" autocomplete="current-password" autofocus required></label>
    ${fejl ? `<p class="fejl">${esc(fejl)}</p>` : ''}
    <button class="knap" type="submit">Luk mig ind</button>
  </form>
</main>
</body>
</html>`;
}

/** Fejlsider skal ligne sitet - ikke Nodes standardtekst. */
function tegnFejl(ctx, kode, besked) {
  return dokument(ctx, `
<section class="sidetop">
  <div class="indeni">
    <h1>${kode === 404 ? 'Siden findes ikke' : 'Der gik noget galt'}</h1>
    <p class="manchet">${esc(besked || '')}</p>
    <p><a class="knap" href="/">Til forsiden</a></p>
  </div>
</section>`, { titel: kode === 404 ? 'Siden findes ikke' : 'Fejl' });
}

function datoDk(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('da-DK', { year: 'numeric', month: 'long', day: 'numeric' });
}

/**
 * Registret. `felter` bruges af admin til at vide, hvad typen kan redigere -
 * saa en ny sidetype ikke ogsaa kraever en ny formular skrevet i haanden.
 */
const TYPER = {
  forside: { navn: 'Forside', tegn: tegnForside, felter: ['hero', 'sektioner'] },
  indhold: { navn: 'Indholdsside', tegn: tegnIndhold, felter: ['intro', 'sektioner'] },
  vidensbase: { navn: 'Vidensbase (Genesys)', tegn: tegnVidensbase, felter: ['intro', 'soegetekst'] },
  kontakt: { navn: 'Kontakt', tegn: tegnKontakt, felter: ['intro', 'telefon', 'email', 'adresse', 'aabningstid'] },
  html: { navn: 'Importeret HTML', tegn: tegnRaa, felter: ['html'] },
};

module.exports = {
  TYPER, dokument, widgetSnippet, slugify, link, farve, datoDk,
  tegnForside, tegnIndhold, tegnKontakt, tegnVidensbase, tegnArtikel, tegnKategori,
  tegnRaa, tegnLaas, tegnFejl, sektioner,
};
