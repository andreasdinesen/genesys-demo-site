/*
 * Sider: listen og editoren.
 *
 * ── Valget, der baerer resten ────────────────────────────────────────────
 *
 * Editoren tegnes forfra, hver gang der sker noget STRUKTURELT (en sektion
 * tilfoejes, et kort slettes). For ikke at tabe det, brugeren har skrevet
 * imens, laeses HELE formularen ind i `S.redigerer` foerst - `laesEditor()` -
 * og derefter tegnes der. Felterne peger paa deres plads i objektet med
 * `data-felt="data.hero.titel"`, saa der er ét sted at oversaette mellem
 * formular og data, ikke tredive.
 *
 * Alternativet - at flytte DOM-knuder rundt i haanden - er hurtigere at skrive
 * og umuligt at holde i live, naar sidetyperne vokser.
 */

'use strict';

/* ---------------------------------------------------------- vaerdi paa sti */

function hentSti(objekt, sti) {
  return String(sti).split('.').reduce((o, n) => (o == null ? undefined : o[n]), objekt);
}

function saetSti(objekt, sti, vaerdi) {
  const dele = String(sti).split('.');
  let o = objekt;
  for (let i = 0; i < dele.length - 1; i += 1) {
    const n = dele[i];
    /* Er naeste led et tal, skal beholderen vaere et array - ellers faar man
     * et objekt med noeglerne "0", "1" … som ser rigtigt ud i JSON og tegner
     * forkert overalt. */
    if (o[n] == null) o[n] = /^\d+$/.test(dele[i + 1]) ? [] : {};
    o = o[n];
  }
  o[dele[dele.length - 1]] = vaerdi;
}

/** Læs hele editoren ind i S.redigerer. Kaldes FOER enhver gentegning. */
function laesEditor() {
  if (!S.redigerer) return;
  for (const el of $$('[data-felt]')) {
    const vaerdi = el.type === 'checkbox' ? el.checked
      : (el.type === 'number' ? Number(el.value) : el.value);
    saetSti(S.redigerer, el.dataset.felt, vaerdi);
  }
}

/* ------------------------------------------------------------------- listen */

function tegnSider() {
  if (S.redigerer) return tegnEditor();
  const liste = (S.data && S.data.sider) || [];
  return `
<header class="sidehoved">
  <h1>Sider</h1>
  <div class="knapraekke">
    <button class="knap" type="button" data-handling="nySide">Ny side</button>
    <button class="knap knap-linje" type="button" data-handling="visImport">Importér side</button>
  </div>
</header>

<section class="kort">
  <table class="tabel">
    <thead><tr><th>Titel</th><th>Adresse</th><th>Type</th><th>Menu</th><th>Widget</th><th></th></tr></thead>
    <tbody>
      ${liste.map((s) => `<tr>
        <td>
          <button class="link" type="button" data-handling="redigerSide" data-id="${esc(s.id)}">${esc(s.title)}</button>
          ${s.forside ? '<span class="chip">forside</span>' : ''}
        </td>
        <td class="mono"><a href="${s.forside ? '/' : `/${esc(s.slug)}`}" target="_blank" rel="noopener">${s.forside ? '/' : `/${esc(s.slug)}`}</a></td>
        <td>${esc((((S.data && S.data.sidetyper) || []).find((t) => t.id === s.type) || {}).navn || s.type)}</td>
        <td>${s.nav ? 'ja' : 'nej'}</td>
        <td>${s.widget ? 'ja' : 'nej'}</td>
        <td class="hoejre">
          <button class="knap knap-tekst" type="button" data-handling="flytSide" data-id="${esc(s.id)}" data-retning="-1" title="Flyt op">↑</button>
          <button class="knap knap-tekst" type="button" data-handling="flytSide" data-id="${esc(s.id)}" data-retning="1" title="Flyt ned">↓</button>
          <button class="knap knap-tekst" type="button" data-handling="sletSide" data-id="${esc(s.id)}">Slet</button>
        </td>
      </tr>`).join('')}
    </tbody>
  </table>
  ${liste.length ? '' : '<p class="daemp">Ingen sider endnu.</p>'}
</section>

<section class="kort" id="importboks" hidden>
  <h2>Importér en side</h2>
  <p class="daemp">Hent en eksisterende side ind, som den er. Billeder og css hentes stadig fra kilden, og en Genesys-snippet, siden allerede har, fjernes – ellers ville der køre to widgets.</p>
  <form data-form="import" class="stablet">
    <label>Adresse<input name="url" type="url" placeholder="http://example.com/side.html"></label>
    <label>… eller indsæt HTML<textarea name="html" rows="5" placeholder="&lt;!DOCTYPE html&gt; …"></textarea></label>
    <label class="afkryds"><input type="checkbox" name="nav"> Vis i menuen</label>
    <button class="knap" type="submit">Importér</button>
  </form>
</section>`;
}

/* ------------------------------------------------------------------ editoren */

function tegnEditor() {
  const s = S.redigerer;
  const typer = (S.data && S.data.sidetyper) || [];
  return `
<header class="sidehoved">
  <h1>${esc(s.id ? s.title : 'Ny side')}</h1>
  <div class="knapraekke">
    <button class="knap" type="button" data-handling="gemSide">Gem</button>
    <button class="knap knap-tekst" type="button" data-handling="lukEditor">Annullér</button>
  </div>
</header>

<section class="kort">
  <div class="gitter to">
    <label>Titel<input data-felt="title" value="${esc(s.title || '')}"></label>
    <label>Adresse (slug)<input data-felt="slug" value="${esc(s.slug || '')}" ${s.forside ? 'disabled' : ''}>
      <span class="hint">${s.forside ? 'Forsiden ligger altid på /' : `Siden bliver /${esc(s.slug || '')}`}</span></label>
  </div>
  <div class="gitter to">
    <label>Type<select data-felt="type" data-gentegn>
      ${typer.map((t) => `<option value="${esc(t.id)}"${t.id === s.type ? ' selected' : ''}>${esc(t.navn)}</option>`).join('')}
    </select></label>
    <div class="afkrydsgruppe">
      <label class="afkryds"><input type="checkbox" data-felt="nav" ${s.nav ? 'checked' : ''}> Vis i menuen</label>
      <label class="afkryds"><input type="checkbox" data-felt="forside" ${s.forside ? 'checked' : ''}> Er forsiden</label>
      <label class="afkryds"><input type="checkbox" data-felt="widget" ${s.widget ? 'checked' : ''}> Genesys-widget på siden</label>
    </div>
  </div>
</section>

${tegnTypeFelter(s)}`;
}

function tegnTypeFelter(s) {
  if (s.type === 'forside') {
    const h = (s.data && s.data.hero) || {};
    return `
<section class="kort">
  <h2>Hero</h2>
  <div class="gitter to">
    <label>Overrubrik<input data-felt="data.hero.overrubrik" value="${esc(h.overrubrik || '')}"></label>
    <label>Rubrik<input data-felt="data.hero.titel" value="${esc(h.titel || '')}"></label>
  </div>
  <label>Tekst<textarea data-felt="data.hero.tekst" rows="2">${esc(h.tekst || '')}</textarea></label>
  <div class="gitter tre">
    <label>Knaptekst<input data-felt="data.hero.knapTekst" value="${esc(h.knapTekst || '')}"></label>
    <label>Knaplink<input data-felt="data.hero.knapLink" value="${esc(h.knapLink || '')}"></label>
    <label>Baggrundsbillede (url)<input data-felt="data.hero.billede" value="${esc(h.billede || '')}"></label>
  </div>
</section>
${tegnSektioner(s)}`;
  }
  if (s.type === 'indhold') {
    return `
<section class="kort">
  <h2>Manchet</h2>
  <label>Introtekst<textarea data-felt="data.intro" rows="2">${esc((s.data && s.data.intro) || '')}</textarea></label>
</section>
${tegnSektioner(s)}`;
  }
  if (s.type === 'vidensbase') {
    const g = (S.data && S.data.genesys) || {};
    return `
<section class="kort">
  <h2>Vidensbase</h2>
  <label>Introtekst<textarea data-felt="data.intro" rows="2">${esc((s.data && s.data.intro) || '')}</textarea></label>
  <label>Tekst i søgefeltet<input data-felt="data.soegetekst" value="${esc((s.data && s.data.soegetekst) || '')}"></label>
  <p class="${g.konfigureret && g.kbId ? 'daemp' : 'advarsel'} lille">
    ${g.konfigureret && g.kbId
      ? 'Artikler og kategorier hentes fra den valgte vidensbase i Genesys Cloud.'
      : 'Der er ikke valgt en vidensbase endnu – siden vil stå tom. Sæt det op under Genesys.'}
  </p>
</section>`;
  }
  if (s.type === 'kontakt') {
    const d = s.data || {};
    return `
<section class="kort">
  <h2>Kontaktoplysninger</h2>
  <label>Introtekst<textarea data-felt="data.intro" rows="2">${esc(d.intro || '')}</textarea></label>
  <div class="gitter to">
    <label>Telefon<input data-felt="data.telefon" value="${esc(d.telefon || '')}"></label>
    <label>E-mail<input data-felt="data.email" value="${esc(d.email || '')}"></label>
    <label>Adresse<input data-felt="data.adresse" value="${esc(d.adresse || '')}"></label>
    <label>Åbningstid<input data-felt="data.aabningstid" value="${esc(d.aabningstid || '')}"></label>
  </div>
</section>`;
  }
  if (s.type === 'html') {
    return `
<section class="kort">
  <h2>Importeret HTML</h2>
  <p class="daemp">${s.html ? `Siden indeholder ${typeof s.html === 'string' ? s.html.length.toLocaleString('da-DK') : '?'} tegn HTML.` : 'Der er ingen HTML endnu.'}</p>
  <label>Kilde<input data-felt="source_url" value="${esc(s.source_url || '')}" placeholder="http://…"></label>
  <div class="knapraekke">
    <button class="knap knap-linje" type="button" data-handling="hentIgen">Hent fra kilden igen</button>
  </div>
  <label>Erstat med indsat HTML<textarea data-felt="html" rows="6" placeholder="Lad feltet stå tomt for at beholde den HTML, der allerede er gemt."></textarea></label>
  <p class="daemp lille">Importerede sider får hverken menuen eller sitets css – de ser ud som originalen. Kun Genesys-snippet’en lægges ind.</p>
</section>`;
  }
  return '';
}

function tegnSektioner(s) {
  const liste = (s.data && s.data.sektioner) || [];
  return `
<section class="kort">
  <div class="korthoved">
    <h2>Sektioner</h2>
    <button class="knap knap-linje" type="button" data-handling="nySektion">Tilføj sektion</button>
  </div>
  ${liste.length ? liste.map((sek, i) => `
    <fieldset class="sektion">
      <legend>Sektion ${i + 1}</legend>
      <div class="gitter to">
        <label>Rubrik<input data-felt="data.sektioner.${i}.titel" value="${esc(sek.titel || '')}"></label>
        <label>Tekst<input data-felt="data.sektioner.${i}.tekst" value="${esc(sek.tekst || '')}"></label>
      </div>
      <div class="gitter tre">
        <label>Kolonner<input type="number" min="1" max="4" data-felt="data.sektioner.${i}.kolonner" value="${Number(sek.kolonner) || 3}"></label>
        <label class="afkryds"><input type="checkbox" data-felt="data.sektioner.${i}.toner" ${sek.toner ? 'checked' : ''}> Tonet baggrund</label>
        <div class="knapraekke">
          <button class="knap knap-tekst" type="button" data-handling="nytKort" data-sektion="${i}">Tilføj kort</button>
          <button class="knap knap-tekst" type="button" data-handling="sletSektion" data-sektion="${i}">Slet sektion</button>
        </div>
      </div>
      ${(sek.kort || []).map((k, j) => `
        <fieldset class="kortfelt">
          <legend>Kort ${j + 1}</legend>
          <div class="gitter to">
            <label>Overrubrik<input data-felt="data.sektioner.${i}.kort.${j}.overrubrik" value="${esc(k.overrubrik || '')}"></label>
            <label>Titel<input data-felt="data.sektioner.${i}.kort.${j}.titel" value="${esc(k.titel || '')}"></label>
          </div>
          <label>Tekst<textarea data-felt="data.sektioner.${i}.kort.${j}.tekst" rows="2">${esc(k.tekst || '')}</textarea></label>
          <div class="gitter tre">
            <label>Link<input data-felt="data.sektioner.${i}.kort.${j}.link" value="${esc(k.link || '')}"></label>
            <label>Linktekst<input data-felt="data.sektioner.${i}.kort.${j}.linkTekst" value="${esc(k.linkTekst || '')}"></label>
            <label>Billede (url)<input data-felt="data.sektioner.${i}.kort.${j}.billede" value="${esc(k.billede || '')}"></label>
          </div>
          <button class="knap knap-tekst" type="button" data-handling="sletKort" data-sektion="${i}" data-kort="${j}">Slet kort</button>
        </fieldset>`).join('')}
    </fieldset>`).join('') : '<p class="daemp">Ingen sektioner endnu.</p>'}
</section>`;
}

/* ----------------------------------------------------------------- knapperne */

HANDLINGER.nySide = () => {
  S.view = 'sider';
  S.redigerer = { title: 'Ny side', slug: '', type: 'indhold', nav: true, forside: false, widget: true, data: {} };
  tegn();
};

HANDLINGER.redigerSide = async (el) => {
  const svar = await proev(() => api(`/sider/${el.dataset.id}`));
  if (!svar) return;
  S.redigerer = svar;
  S.view = 'sider';
  tegn();
};

HANDLINGER.lukEditor = () => { S.redigerer = null; tegn(); };

HANDLINGER.gemSide = async () => {
  laesEditor();
  const s = S.redigerer;
  const krop = {
    title: s.title, slug: s.slug, type: s.type, nav: s.nav, forside: s.forside,
    widget: s.widget, data: s.data || {},
  };
  /* Tomt HTML-felt betyder »behold det, der er«. Ellers ville et aabent
   * redigeringsvindue kunne toemme en importeret side ved et uheld. */
  if (s.type === 'html') {
    krop.source_url = s.source_url || null;
    if (typeof s.html === 'string' && s.html.trim()) krop.html = s.html;
  }
  const svar = await proev(() => (s.id
    ? api(`/sider/${s.id}`, { metode: 'PATCH', krop })
    : api('/sider', { metode: 'POST', krop })), 'Siden er gemt');
  if (!svar) return;
  await proev(async () => { await hentData(); });
  S.redigerer = null;
  tegn();
};

HANDLINGER.sletSide = async (el) => {
  const side = ((S.data && S.data.sider) || []).find((s) => s.id === el.dataset.id);
  if (!side || !window.confirm(`Slet »${side.title}«?`)) return;
  const svar = await proev(() => api(`/sider/${el.dataset.id}`, { metode: 'DELETE' }), 'Siden er slettet');
  if (!svar) return;
  await proev(async () => { await hentData(); });
  tegn();
};

/* Raekkefoelgen gemmes som `sort` paa BEGGE de sider, der bytter plads - og
 * listen hentes hjem bagefter, saa skaermen viser det, serveren mener. */
HANDLINGER.flytSide = async (el) => {
  const liste = ((S.data && S.data.sider) || []).slice();
  const i = liste.findIndex((s) => s.id === el.dataset.id);
  const j = i + (Number(el.dataset.retning) || 1);
  if (i < 0 || j < 0 || j >= liste.length) return;
  const a = liste[i];
  const b = liste[j];
  const svar = await proev(async () => {
    await api(`/sider/${a.id}`, { metode: 'PATCH', krop: { sort: j } });
    await api(`/sider/${b.id}`, { metode: 'PATCH', krop: { sort: i } });
    await hentData();
  });
  if (svar !== null) tegn();
};

HANDLINGER.visImport = () => {
  const boks = $('#importboks');
  if (boks) { boks.hidden = !boks.hidden; if (!boks.hidden) boks.scrollIntoView({ block: 'nearest' }); }
};

HANDLINGER.nySektion = () => {
  laesEditor();
  if (!S.redigerer.data) S.redigerer.data = {};
  if (!Array.isArray(S.redigerer.data.sektioner)) S.redigerer.data.sektioner = [];
  S.redigerer.data.sektioner.push({ titel: '', tekst: '', kolonner: 3, kort: [] });
  tegn();
};
HANDLINGER.sletSektion = (el) => {
  laesEditor();
  S.redigerer.data.sektioner.splice(Number(el.dataset.sektion), 1);
  tegn();
};
HANDLINGER.nytKort = (el) => {
  laesEditor();
  const sek = S.redigerer.data.sektioner[Number(el.dataset.sektion)];
  if (!Array.isArray(sek.kort)) sek.kort = [];
  sek.kort.push({ titel: '', tekst: '' });
  tegn();
};
HANDLINGER.sletKort = (el) => {
  laesEditor();
  S.redigerer.data.sektioner[Number(el.dataset.sektion)].kort.splice(Number(el.dataset.kort), 1);
  tegn();
};

HANDLINGER.hentIgen = async () => {
  laesEditor();
  const s = S.redigerer;
  if (!s.source_url) return sig('Skriv en adresse først', 'fejl');
  const svar = await proev(() => api('/import', {
    metode: 'POST',
    krop: { id: s.id, url: s.source_url, slug: s.slug, title: s.title, nav: s.nav, widget: s.widget },
  }), 'Siden er hentet igen');
  if (!svar) return;
  await proev(async () => { await hentData(); });
  S.redigerer = svar.side;
  tegn();
};

FORMER.import = async (felter) => {
  if (!felter.url && !felter.html) return sig('Skriv en adresse eller indsæt HTML', 'fejl');
  const svar = await proev(() => api('/import', {
    metode: 'POST',
    krop: { url: felter.url || '', html: felter.html || '', nav: Boolean(felter.nav) },
  }), 'Siden er importeret');
  if (!svar) return;
  await proev(async () => { await hentData(); });
  tegn();
};

/* Skifter man sidetype, skal felterne under skifte med - men det, der allerede
 * er skrevet, skal blive staaende (data er faelles for typerne). */
EFTER.push(() => {
  const vaelger = document.querySelector('[data-gentegn]');
  if (!vaelger) return;
  vaelger.addEventListener('change', () => { laesEditor(); tegn(); });
});
