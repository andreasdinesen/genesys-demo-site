'use strict';
/* GENERERET FIL - redigér app/parts/p*.js og koer build_rune.py.
 * Samlet af 6 dele til version 2. */

/* ===== p1_core.js ===== */
/*
 * Admin-fladen: kerne.
 *
 * Vanilla JS, ét dokument, ingen bygger. Delene i app/parts/ samles til
 * public/app.js af build_rune.py - redigér ALDRIG public/app.js i haanden.
 *
 * Versionen bor ÉT sted: konstanten herunder. Build'et laeser den og stempler
 * den paa runens `version:` og paa ?v=-adresserne i index.html.
 */
const APP_VERSION = 2;

/* Al tilstand ét sted. `data` er svaret fra /api/admin/data - den er
 * sandheden, og alt tegnes ud fra den. */
const S = {
  view: 'oversigt',
  klar: false,
  opsat: false,
  loggetInd: false,
  data: null,
  redigerer: null,      // siden der er aaben i editoren
  besked: null,         // { slags: 'ok' | 'fejl', tekst }
  travl: false,
};

/* ------------------------------------------------------------------ hjaelpere */

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const $ = (v) => document.querySelector(v);
const $$ = (v) => Array.from(document.querySelectorAll(v));

/**
 * Kald API'et.
 *
 * Content-Type saettes EFTER en eventuel merge af kalderens headers - ellers
 * forsvinder den, naar nogen sender egne (Kokkeri v15's Authorization-faelde i
 * lille udgave).
 */
async function api(sti, { metode = 'GET', krop = undefined } = {}) {
  const opsaetning = { method: metode, headers: {} };
  /* Serveren afviser ALT andet end GET uden application/json - en CSRF-barriere
   * oven paa SameSite=Lax, fordi en fremmed sides formular ikke kan saette
   * headeren. Den skal derfor med OGSAA paa kald uden krop (logout,
   * /genesys/test), ellers svarer serveren 415 paa en knap, der ser rigtig ud. */
  if (metode !== 'GET') opsaetning.headers['Content-Type'] = 'application/json';
  if (krop !== undefined) opsaetning.body = JSON.stringify(krop);
  const svar = await fetch(`/api/admin${sti}`, opsaetning);
  let json = {};
  try { json = await svar.json(); } catch { /* tomt svar er ogsaa et svar */ }
  if (!svar.ok) throw new Error(json.error || `Serveren svarede ${svar.status}`);
  return json;
}

function sig(tekst, slags = 'ok') {
  S.besked = { slags, tekst };
  tegnBesked();
  clearTimeout(sig._t);
  sig._t = setTimeout(() => { S.besked = null; tegnBesked(); }, slags === 'fejl' ? 9000 : 4000);
}

function tegnBesked() {
  const boks = $('#besked');
  if (!boks) return;
  if (!S.besked) { boks.hidden = true; boks.textContent = ''; return; }
  boks.hidden = false;
  boks.className = `besked ${S.besked.slags}`;
  boks.textContent = S.besked.tekst;
}

/** Kald et api og vis fejlen ét sted, i stedet for i tyve try/catch. */
async function proev(fn, okTekst) {
  if (S.travl) return null;
  S.travl = true;
  try {
    const svar = await fn();
    if (okTekst) sig(okTekst);
    return svar;
  } catch (e) {
    sig(e.message, 'fejl');
    return null;
  } finally {
    S.travl = false;
  }
}

async function hentData() {
  S.data = await api('/data');
  return S.data;
}

const indst = () => (S.data && S.data.indstillinger) || {};
const laas = () => (S.data && S.data.laas) || {};

/** Tid tilbage af det aabne vindue, skrevet som et menneske ville sige det. */
function timerTilbage(tid) {
  const ms = Number(tid) - Date.now();
  if (!(ms > 0)) return '';
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} min.`;
  const t = Math.floor(min / 60);
  const r = min % 60;
  return r ? `${t} t. ${r} min.` : `${t} t.`;
}

function datoTid(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('da-DK', { dateStyle: 'short', timeStyle: 'short' });
}

/* --------------------------------------------------------------------- temaet */

function tema() {
  try { return localStorage.getItem('gds_tema') || 'auto'; } catch { return 'auto'; }
}
function saetTema(vaerdi) {
  try { localStorage.setItem('gds_tema', vaerdi); } catch { /* privat vindue */ }
  document.documentElement.dataset.theme = vaerdi === 'auto'
    ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    : vaerdi;
}

/* ------------------------------------------------------- registre for delene

   Delene i app/parts/ samles til ÉN fil, saa de kan se hinandens funktioner.
   Men de skal ikke KENDE hinanden: en del laegger sine knapper i HANDLINGER,
   sine formularer i FORMER og sit efterarbejde i EFTER - og kernen kalder.
   Saa kan en ny del tilfoejes uden at rette en if-kaede her.                 */

const HANDLINGER = {};
const FORMER = {};
const EFTER = [];

async function haandter(navn, el) {
  const f = HANDLINGER[navn];
  if (!f) return;
  await f(el);
}
async function haandterForm(navn, felter, form) {
  const f = FORMER[navn];
  if (!f) return;
  await f(felter, form);
}
function efterTegning() {
  for (const f of EFTER) {
    try { f(); } catch (e) { console.error(e); }
  }
}

/* --------------------------------------------------------------- login-siden */

function tegnLogin() {
  const opsat = S.opsat;
  return `
<div class="loginside">
  <form class="kort loginkort" data-form="${opsat ? 'login' : 'setup'}">
    <h1>${esc((S.data && S.data.appNavn) || 'Genesys Demo Site')}</h1>
    <p class="daemp">${opsat ? 'Log ind for at styre demo-sitet.' : 'Opret den første administrator. Det er kun dig, der styrer sitet – demo-gæster bruger sitets eget kodeord.'}</p>
    <label>Brugernavn<input name="brugernavn" autocomplete="username" required></label>
    <label>Kodeord<input name="kodeord" type="password" autocomplete="${opsat ? 'current-password' : 'new-password'}" required></label>
    <button class="knap" type="submit">${opsat ? 'Log ind' : 'Opret administrator'}</button>
  </form>
</div>`;
}

/* ------------------------------------------------------------------- skallen */

const SIDER = [
  { id: 'oversigt', navn: 'Oversigt', ikon: '◱' },
  { id: 'sider', navn: 'Sider', ikon: '▤' },
  { id: 'udseende', navn: 'Udseende', ikon: '◑' },
  { id: 'genesys', navn: 'Genesys', ikon: '◎' },
  { id: 'sikkerhed', navn: 'Adgang', ikon: '⚿' },
];

function tegnSkal(indhold) {
  const l = laas();
  return `
<div class="skal">
  <aside class="sidebar">
    <div class="maerke">
      <span class="prik${l.laast ? ' rod' : ' groen'}"></span>
      <div>
        <p class="maerkenavn">${esc(indst().site_navn || 'Demo')}</p>
        <p class="maerkestatus">${l.laast ? 'Sitet er låst' : (l.aabentVindue ? `Åbent i ${timerTilbage(l.aabenTil)}` : 'Sitet er åbent')}</p>
      </div>
    </div>
    <nav>
      ${SIDER.map((s) => `<button type="button" data-gaa="${s.id}" class="${S.view === s.id ? 'aktiv' : ''}">
        <span class="ikon">${s.ikon}</span>${esc(s.navn)}</button>`).join('')}
    </nav>
    <div class="sidebarbund">
      <a class="knap knap-linje" href="/" target="_blank" rel="noopener">Se sitet →</a>
      <button type="button" class="knap knap-tekst" data-tema>Tema</button>
      <button type="button" class="knap knap-tekst" data-logud>Log ud</button>
      <p class="version">v${APP_VERSION}</p>
    </div>
  </aside>
  <main class="indhold">
    <div id="besked" class="besked" hidden></div>
    ${indhold}
  </main>
</div>`;
}

/* ------------------------------------------------------------------ tegningen */

function tegn() {
  const rod = $('#app');
  if (!S.klar) { rod.innerHTML = '<p class="daemp indlaeser">Henter …</p>'; return; }
  if (!S.loggetInd) { rod.innerHTML = tegnLogin(); return; }

  let indhold = '';
  if (S.view === 'oversigt') indhold = tegnOversigt();
  else if (S.view === 'sider') indhold = tegnSider();
  else if (S.view === 'udseende') indhold = tegnUdseende();
  else if (S.view === 'genesys') indhold = tegnGenesys();
  else if (S.view === 'sikkerhed') indhold = tegnSikkerhed();
  rod.innerHTML = tegnSkal(indhold);
  tegnBesked();
  if (typeof efterTegning === 'function') efterTegning();
}

/* Én delegeret lytter for hele fladen. Alternativet - at binde knapper efter
 * hver tegning - taber en knap, hver gang en ny bliver tilfoejet. */
document.addEventListener('click', async (e) => {
  const maal = e.target.closest('[data-gaa],[data-logud],[data-tema],[data-handling]');
  if (!maal) return;

  if (maal.dataset.gaa) {
    S.view = maal.dataset.gaa;
    S.redigerer = null;
    tegn();
    window.scrollTo(0, 0);
    return;
  }
  if (maal.dataset.logud !== undefined) {
    await proev(() => api('/logout', { metode: 'POST' }));
    S.loggetInd = false;
    tegn();
    return;
  }
  if (maal.dataset.tema !== undefined) {
    const raekke = ['auto', 'light', 'dark'];
    const ny = raekke[(raekke.indexOf(tema()) + 1) % raekke.length];
    saetTema(ny);
    sig(`Tema: ${{ auto: 'følger systemet', light: 'lyst', dark: 'mørkt' }[ny]}`);
    return;
  }
  if (maal.dataset.handling && typeof haandter === 'function') {
    e.preventDefault();
    await haandter(maal.dataset.handling, maal);
  }
});

document.addEventListener('submit', async (e) => {
  const form = e.target.closest('form[data-form]');
  if (!form) return;
  e.preventDefault();
  const felter = Object.fromEntries(new FormData(form).entries());
  const hvad = form.dataset.form;

  if (hvad === 'login' || hvad === 'setup') {
    const svar = await proev(() => api(hvad === 'login' ? '/login' : '/setup', { metode: 'POST', krop: felter }));
    if (!svar) return;
    await proev(async () => { await hentData(); });
    S.loggetInd = true;
    S.opsat = true;
    tegn();
    return;
  }
  if (typeof haandterForm === 'function') await haandterForm(hvad, felter, form);
});

/* --------------------------------------------------------------------- opstart */

async function start() {
  saetTema(tema());
  try {
    const status = await api('/status');
    S.opsat = status.opsat;
    S.loggetInd = status.loggetInd;
    if (S.loggetInd) await hentData();
  } catch (e) {
    S.besked = { slags: 'fejl', tekst: e.message };
  }
  S.klar = true;
  tegn();
}

window.addEventListener('DOMContentLoaded', start);

/* ===== p2_oversigt.js ===== */
/*
 * Oversigten - den side, admin aabner paa.
 *
 * Den skal svare paa ét spoergsmaal paa ét sekund: **kan kunden se sitet lige
 * nu?** Derfor er laasen ikke en indstilling nede i en formular, men det
 * foerste og stoerste paa siden, med de knapper man rent faktisk bruger foer en
 * demo: »åbn i fire timer« og »luk nu«.
 */
function tegnOversigt() {
  const l = laas();
  const g = (S.data && S.data.genesys) || {};
  const i = indst();
  const antalSider = ((S.data && S.data.sider) || []).length;
  const forside = ((S.data && S.data.sider) || []).find((s) => s.forside);

  const status = l.laast
    ? { klasse: 'rod', overskrift: 'Sitet er låst', tekst: 'Gæster møder kodeordsboksen. Åbn et vindue, før demoen begynder.' }
    : l.aabentVindue
      ? { klasse: 'gul', overskrift: `Åbent i ${timerTilbage(l.aabenTil)}`, tekst: `Låsen slår til igen ${datoTid(new Date(l.aabenTil).toISOString())}.` }
      : { klasse: 'groen', overskrift: 'Sitet er åbent', tekst: l.kodeordSat ? 'Låsen er slukket. Alle med adressen kan se sitet.' : 'Der er ikke sat noget kodeord endnu.' };

  return `
<header class="sidehoved">
  <h1>Oversigt</h1>
  <p class="daemp">${esc(i.site_navn || 'Demo')} · <a href="/" target="_blank" rel="noopener">åbn sitet →</a></p>
</header>

<section class="kort stort ${status.klasse}">
  <div class="statuslinje">
    <span class="prik ${status.klasse}"></span>
    <div>
      <h2>${esc(status.overskrift)}</h2>
      <p class="daemp">${esc(status.tekst)}</p>
    </div>
  </div>
  <div class="knapraekke">
    ${l.kodeordSat ? `
      ${l.taendt && !l.aabentVindue ? '' : '<button class="knap" type="button" data-handling="laasLukNu">Lås sitet nu</button>'}
      ${[2, 4, 8].map((t) => `<button class="knap knap-linje" type="button" data-handling="laasAaben" data-timer="${t}">Åbn i ${t} timer</button>`).join('')}
      <button class="knap knap-tekst" type="button" data-handling="laasSkift">${l.taendt ? 'Slå låsen helt fra' : 'Slå låsen til'}</button>
    ` : '<button class="knap" type="button" data-gaa="sikkerhed">Sæt et kodeord først</button>'}
  </div>
  ${l.kodeordSat ? '<p class="daemp lille">Et åbent vindue lukker sig selv – også hvis du glemmer det. Låsen gælder hele sitet, ikke admin.</p>' : ''}
</section>

<div class="gitter to">
  <section class="kort">
    <h2>Genesys</h2>
    <dl class="fakta">
      <dt>Widget på sitet</dt><dd>${i.genesys_widget === '1' && i.genesys_deployment_id ? 'Ja' : 'Nej'}</dd>
      <dt>Region</dt><dd>${esc(i.genesys_env || '–')}</dd>
      <dt>Deployment-id</dt><dd class="mono">${i.genesys_deployment_id ? `${esc(String(i.genesys_deployment_id).slice(0, 8))}…` : '–'}</dd>
      <dt>Vidensbase</dt><dd>${g.kbId ? 'valgt' : 'ikke valgt'}</dd>
      <dt>API-nøgle</dt><dd>${g.konfigureret ? 'sat' : 'mangler'}</dd>
    </dl>
    ${g.sidsteFejl ? `<p class="advarsel lille">Sidste fejl: ${esc(g.sidsteFejl.besked)}</p>` : ''}
    <p><button class="knap knap-linje" type="button" data-gaa="genesys">Åbn Genesys-opsætningen</button></p>
  </section>

  <section class="kort">
    <h2>Sider</h2>
    <p class="tal">${antalSider}</p>
    <p class="daemp">Forsiden er ${forside ? `»${esc(forside.title)}«` : 'ikke valgt'}.</p>
    <p>
      <button class="knap knap-linje" type="button" data-gaa="sider">Redigér sider</button>
      <button class="knap knap-tekst" type="button" data-handling="nySide">Ny side</button>
    </p>
  </section>
</div>`;
}

/* ------------------------------------------------------------------ knapperne */

HANDLINGER.laasAaben = async (el) => {
  const timer = Number(el.dataset.timer) || 4;
  const svar = await proev(() => api('/laas', { metode: 'PATCH', krop: { taendt: true, aabenTimer: timer } }),
    `Sitet er åbent i ${timer} timer`);
  if (svar) { S.data.laas = svar.laas; tegn(); }
};

HANDLINGER.laasLukNu = async () => {
  const svar = await proev(() => api('/laas', { metode: 'PATCH', krop: { taendt: true, aabenTimer: 0 } }), 'Sitet er låst');
  if (svar) { S.data.laas = svar.laas; tegn(); }
};

HANDLINGER.laasSkift = async () => {
  const til = !laas().taendt;
  const svar = await proev(() => api('/laas', { metode: 'PATCH', krop: { taendt: til, aabenTimer: 0 } }),
    til ? 'Låsen er slået til' : 'Låsen er slået fra – sitet er åbent');
  if (svar) { S.data.laas = svar.laas; tegn(); }
};

/* Et aabent vindue taeller ned. Uden opdateringen staar der »åbent i 4 timer«
 * en time senere - og saa er tallet ikke et svar, men en paastand. */
EFTER.push(() => {
  clearInterval(EFTER._ur);
  if (S.view !== 'oversigt' || !laas().aabentVindue) return;
  EFTER._ur = setInterval(() => {
    if (S.view !== 'oversigt') { clearInterval(EFTER._ur); return; }
    const l = laas();
    if (!l.aabentVindue || l.aabenTil <= Date.now()) {
      /* Vinduet loeb ud, mens siden stod aaben: hent den rigtige tilstand hjem
       * i stedet for at regne den ud lokalt. */
      proev(async () => { await hentData(); tegn(); });
      clearInterval(EFTER._ur);
      return;
    }
    const felt = document.querySelector('.statuslinje h2');
    if (felt) felt.textContent = `Åbent i ${timerTilbage(l.aabenTil)}`;
  }, 30000);
});

/* ===== p3_sider.js ===== */
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

/* ===== p4_udseende.js ===== */
/*
 * Udseende: navn, farver, logo og de to tekstfelter, der kan baere en kundes
 * eget script under en demo.
 *
 * Pointen med siden er, at det SAMME demo-site kan optraede som forskellige
 * kunder. Derfor er farver og navn indstillinger og ikke css - og derfor er
 * logoet et billede i databasen og ikke en fil, nogen skal laegge paa disken.
 */
function tegnUdseende() {
  const i = indst();
  return `
<header class="sidehoved">
  <h1>Udseende</h1>
  <p class="daemp">Sitets navn, farver og logo. Ændringerne slår igennem med det samme.</p>
</header>

<form class="kort" data-form="udseende">
  <h2>Navn og tekster</h2>
  <div class="gitter to">
    <label>Sitets navn<input name="site_navn" value="${esc(i.site_navn || '')}" maxlength="80"></label>
    <label>Sprog (html lang)<input name="site_sprog" value="${esc(i.site_sprog || 'da')}" maxlength="8"></label>
  </div>
  <label>Bånd øverst<input name="site_baand" value="${esc(i.site_baand || '')}" maxlength="160">
    <span class="hint">Tomt felt = intet bånd. Fx »Demomiljø – ikke et rigtigt kundesite«.</span></label>
  <div class="gitter to">
    <label>Knap i toppen<input name="site_cta_tekst" value="${esc(i.site_cta_tekst || '')}" maxlength="40"></label>
    <label>Knappens link<input name="site_cta_link" value="${esc(i.site_cta_link || '')}" maxlength="300"></label>
  </div>
  <label>Tekst i foden<textarea name="site_fodtekst" rows="2" maxlength="400">${esc(i.site_fodtekst || '')}</textarea></label>
  <label>Copyright<input name="site_copyright" value="${esc(i.site_copyright || '')}" maxlength="200"></label>

  <h2>Farver</h2>
  <div class="gitter tre">
    <label>Mærkefarve<span class="farvefelt"><input type="color" name="brand_farve" value="${esc(i.brand_farve || '#0000bf')}"><input class="mono" name="brand_farve_tekst" value="${esc(i.brand_farve || '#0000bf')}" maxlength="9"></span></label>
    <label>Mørk variant<span class="farvefelt"><input type="color" name="brand_farve_moerk" value="${esc(i.brand_farve_moerk || '#000080')}"><input class="mono" name="brand_farve_moerk_tekst" value="${esc(i.brand_farve_moerk || '#000080')}" maxlength="9"></span></label>
    <label>Tekst på mærkefarven<span class="farvefelt"><input type="color" name="brand_tekst" value="${esc(i.brand_tekst || '#ffffff')}"><input class="mono" name="brand_tekst_tekst" value="${esc(i.brand_tekst || '#ffffff')}" maxlength="9"></span></label>
  </div>

  <button class="knap" type="submit">Gem</button>
</form>

<section class="kort">
  <h2>Logo</h2>
  <div class="logoboks">
    ${i.logo ? `<img class="logoforhaand" src="${esc(i.logo)}" alt="Logo">` : '<p class="daemp">Der er intet logo – sitets navn vises som tekst.</p>'}
    <div class="knapraekke">
      <label class="knap knap-linje filknap">Vælg billede<input type="file" accept="image/*" data-logo hidden></label>
      ${i.logo ? '<button class="knap knap-tekst" type="button" data-handling="fjernLogo">Fjern logo</button>' : ''}
    </div>
  </div>
  <p class="daemp lille">Billedet skaleres ned til højst 600 px bredde og gemmes som PNG, så gennemsigtighed bevares.</p>
</section>

<section class="kort">
  <h2>Ekstra kode på sitet</h2>
  <p class="daemp">Lægges ordret ind på hver side – i &lt;head&gt; og lige før &lt;/body&gt;. Brug det til en kundes egen tracking, en anden widget eller et stykke css, en demo kræver.</p>
  <form data-form="ekstra" class="stablet">
    <label>I &lt;head&gt;<textarea class="mono" name="site_ekstra_head" rows="4">${esc(i.site_ekstra_head || '')}</textarea></label>
    <label>Før &lt;/body&gt;<textarea class="mono" name="site_ekstra_body" rows="4">${esc(i.site_ekstra_body || '')}</textarea></label>
    <button class="knap" type="submit">Gem</button>
  </form>
</section>`;
}

FORMER.udseende = async (felter) => {
  /* Farven kan skrives to steder: i vaelgeren og i tekstfeltet ved siden af.
   * Tekstfeltet vinder, naar det ligner en farve - det er dér, man indsaetter
   * en kundes hex-kode fra en designmanual. */
  const farve = (vaelger, tekst) => (/^#[0-9a-fA-F]{3,8}$/.test(String(tekst || '').trim())
    ? String(tekst).trim() : vaelger);
  const krop = {
    site_navn: felter.site_navn, site_sprog: felter.site_sprog, site_baand: felter.site_baand,
    site_cta_tekst: felter.site_cta_tekst, site_cta_link: felter.site_cta_link,
    site_fodtekst: felter.site_fodtekst, site_copyright: felter.site_copyright,
    brand_farve: farve(felter.brand_farve, felter.brand_farve_tekst),
    brand_farve_moerk: farve(felter.brand_farve_moerk, felter.brand_farve_moerk_tekst),
    brand_tekst: farve(felter.brand_tekst, felter.brand_tekst_tekst),
  };
  const svar = await proev(() => api('/indstillinger', { metode: 'PATCH', krop }), 'Gemt');
  if (!svar) return;
  S.data.indstillinger = svar.indstillinger;
  tegn();
};

FORMER.ekstra = async (felter) => {
  const svar = await proev(() => api('/indstillinger', {
    metode: 'PATCH',
    krop: { site_ekstra_head: felter.site_ekstra_head, site_ekstra_body: felter.site_ekstra_body },
  }), 'Gemt');
  if (!svar) return;
  S.data.indstillinger = svar.indstillinger;
  tegn();
};

HANDLINGER.fjernLogo = async () => {
  const svar = await proev(() => api('/indstillinger', { metode: 'PATCH', krop: { logo: '' } }), 'Logoet er fjernet');
  if (!svar) return;
  S.data.indstillinger = svar.indstillinger;
  tegn();
};

/**
 * Skalér og gem logoet.
 *
 * PNG kan ikke kvalitets-komprimeres som JPEG (RUNE-ERFARINGER §5-loggen):
 * skal billedet under en graense, skal det NEDSKALERES i en loekke. Og PNG er
 * det rigtige format her, fordi et logo med gennemsigtig baggrund bliver sort
 * i hjoernerne som JPEG.
 */
function skalerTilPng(fil) {
  return new Promise((ok, nej) => {
    const laeser = new FileReader();
    laeser.onerror = () => nej(new Error('Billedet kunne ikke læses'));
    laeser.onload = () => {
      const img = new Image();
      img.onerror = () => nej(new Error('Filen er ikke et billede, browseren kan vise'));
      img.onload = () => {
        let bredde = Math.min(600, img.width);
        for (let i = 0; i < 6; i += 1) {
          const c = document.createElement('canvas');
          c.width = Math.round(bredde);
          c.height = Math.max(1, Math.round((img.height / img.width) * bredde));
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          const url = c.toDataURL('image/png');
          if (url.length < 400000) return ok(url);
          bredde *= 0.75;
        }
        nej(new Error('Billedet er for stort – prøv et mindre logo'));
      };
      img.src = laeser.result;
    };
    laeser.readAsDataURL(fil);
  });
}

EFTER.push(() => {
  const felt = document.querySelector('[data-logo]');
  if (!felt) return;
  felt.addEventListener('change', async () => {
    const fil = felt.files && felt.files[0];
    if (!fil) return;
    await proev(async () => {
      const url = await skalerTilPng(fil);
      const svar = await api('/indstillinger', { metode: 'PATCH', krop: { logo: url } });
      S.data.indstillinger = svar.indstillinger;
      tegn();
    }, 'Logoet er gemt');
  });
});

/* ===== p5_genesys.js ===== */
/*
 * Genesys-opsaetningen: widget'en paa sitet og noeglen til vidensbasen.
 *
 * De to ting hoerer sammen paa skaermen og er helt adskilte i praksis:
 *
 *   · **Widget'en** kraever kun et deployment-id og en region. Intet login,
 *     ingen hemmelighed - snippet'en koerer i gaestens browser.
 *   · **Vidensbasen** kraever en OAuth-klient (client credentials) med
 *     rollen knowledge:readonly. Hemmeligheden bliver paa serveren og kommer
 *     ALDRIG retur hertil - feltet viser kun, om den er sat.
 *
 * Derfor staar de i hver sin formular: man kan have chat paa sitet uden nogen
 * sinde at oprette en OAuth-klient.
 */
function tegnGenesys() {
  const i = indst();
  const g = (S.data && S.data.genesys) || {};
  const regioner = (S.data && S.data.regioner) || [];
  const kbListe = S.kbListe || null;

  return `
<header class="sidehoved">
  <h1>Genesys</h1>
  <p class="daemp">Web messaging på sitet og vidensbasen bag hjælpesiden.</p>
</header>

<form class="kort" data-form="widget">
  <h2>Web messaging</h2>
  <div class="gitter to">
    <label>Region<select name="genesys_env">
      ${regioner.map((r) => `<option value="${esc(r.env)}"${r.env === i.genesys_env ? ' selected' : ''}>${esc(r.navn)} · ${esc(r.env)}</option>`).join('')}
    </select><span class="hint">Bestemmer både apps.${esc(i.genesys_domaene || '')} og api-adressen.</span></label>
    <label>Deployment-id<input class="mono" name="genesys_deployment_id" value="${esc(i.genesys_deployment_id || '')}" placeholder="00000000-0000-0000-0000-000000000000" maxlength="60">
      <span class="hint">Findes i Genesys Cloud under Admin → Messenger Deployments.</span></label>
  </div>
  <label class="afkryds"><input type="checkbox" name="genesys_widget" ${i.genesys_widget === '1' ? 'checked' : ''}> Læg widget’en på sitet</label>
  <button class="knap" type="submit">Gem</button>
  ${i.genesys_deployment_id ? `
  <details class="snippet">
    <summary>Sådan ser snippet’en ud på siderne</summary>
    <pre class="mono">${esc(`(function (g, e, n, es, ys) { … })(window, 'Genesys',
  'https://apps.${i.genesys_domaene}/genesys-bootstrap/genesys.min.js', {
    environment: '${i.genesys_env}',
    deploymentId: '${i.genesys_deployment_id}'
  });`)}</pre>
  </details>` : ''}
</form>

<form class="kort" data-form="api">
  <h2>API-adgang til vidensbasen</h2>
  <p class="daemp">Opret en OAuth-klient i Genesys Cloud med <strong>Client Credentials</strong> og en rolle, der har <span class="mono">knowledge:document:view</span> og <span class="mono">knowledge:knowledgebase:view</span>.</p>
  <div class="gitter to">
    <label>Client ID<input class="mono" name="genesys_client_id" value="${esc(i.genesys_client_id || '')}" maxlength="80"></label>
    <label>Client Secret<input class="mono" name="genesys_client_secret" type="password" placeholder="${i.genesys_secret_sat ? '•••••••• (gemt – lad stå for at beholde)' : 'ikke sat'}" maxlength="200">
      <span class="hint">Hemmeligheden vises aldrig igen. Et tomt felt ændrer den ikke.</span></label>
  </div>
  <div class="knapraekke">
    <button class="knap" type="submit">Gem</button>
    <button class="knap knap-linje" type="button" data-handling="testGenesys">Test forbindelsen</button>
    <button class="knap knap-tekst" type="button" data-handling="rydCache">Ryd cachen</button>
  </div>
  ${g.sidsteFejl ? `<p class="advarsel lille">Sidste fejl (${esc(String(g.sidsteFejl.status))}): ${esc(g.sidsteFejl.besked)}</p>` : ''}
</form>

<section class="kort">
  <h2>Vidensbase</h2>
  ${kbListe ? (kbListe.length ? `
    <ul class="valgliste">
      ${kbListe.map((k) => `<li>
        <label class="afkryds">
          <input type="radio" name="kb" value="${esc(k.id)}" ${k.id === i.genesys_kb_id ? 'checked' : ''} data-vaelg-kb>
          <span><strong>${esc(k.navn)}</strong> <span class="daemp">${esc(k.sprog || '')} · ${k.artikler} artikler${k.udgivet ? '' : ' · ikke udgivet'}</span>
          ${k.beskrivelse ? `<br><span class="daemp lille">${esc(k.beskrivelse)}</span>` : ''}</span>
        </label>
      </li>`).join('')}
    </ul>` : '<p class="daemp">Der er ingen vidensbaser i organisationen.</p>')
    : `<p class="daemp">${i.genesys_kb_id ? `Valgt: <span class="mono">${esc(i.genesys_kb_id)}</span>` : 'Ingen valgt.'} Tryk »Test forbindelsen« for at hente listen.</p>`}
  <div class="gitter to">
    <label>Artikler på hjælpesiden<input type="number" min="1" max="100" value="${esc(i.kb_antal || '20')}" data-kb-tal></label>
    <label>Cache (minutter)<input type="number" min="1" max="120" value="${esc(i.kb_cache_min || '5')}" data-kb-cache>
      <span class="hint">Hvor længe artikler og kategorier genbruges, før Genesys spørges igen.</span></label>
  </div>
  <button class="knap knap-linje" type="button" data-handling="gemKbTal">Gem</button>
</section>`;
}

FORMER.widget = async (felter) => {
  const svar = await proev(() => api('/indstillinger', {
    metode: 'PATCH',
    krop: {
      genesys_env: felter.genesys_env,
      genesys_deployment_id: String(felter.genesys_deployment_id || '').trim(),
      genesys_widget: felter.genesys_widget ? '1' : '0',
    },
  }), 'Gemt');
  if (!svar) return;
  S.data.indstillinger = svar.indstillinger;
  tegn();
};

FORMER.api = async (felter) => {
  const krop = { genesys_client_id: String(felter.genesys_client_id || '').trim() };
  /* Tomt hemmelighedsfelt betyder »lad staa«. Serveren springer den over, saa
   * et gem af client-id'et ikke sletter hemmeligheden. */
  if (felter.genesys_client_secret) krop.genesys_client_secret = felter.genesys_client_secret;
  const svar = await proev(() => api('/indstillinger', { metode: 'PATCH', krop }), 'Gemt');
  if (!svar) return;
  S.data.indstillinger = svar.indstillinger;
  tegn();
};

/**
 * Test forbindelsen.
 *
 * Serveren svarer 200 med `{ok:false, error}` i stedet for en http-fejl, naar
 * det er Genesys der siger nej: fejlen er et SVAR paa proeven, ikke et brud i
 * vores egen app - og teksten fra Genesys er det, der fortaeller hvad der er
 * galt (»401« = rollen mangler, »400 invalid_client« = forkert id/secret).
 */
HANDLINGER.testGenesys = async () => {
  const svar = await proev(() => api('/genesys/test', { metode: 'POST' }));
  if (!svar) return;
  if (!svar.ok) {
    S.data.genesys = svar.status;
    sig(`Genesys svarede: ${svar.error}`, 'fejl');
    tegn();
    return;
  }
  S.kbListe = svar.videnbaser;
  S.data.genesys = svar.status;
  sig(`Forbindelsen virker – ${svar.videnbaser.length} vidensbaser fundet`);
  tegn();
};

HANDLINGER.rydCache = async () => {
  await proev(() => api('/genesys/ryd', { metode: 'POST' }), 'Cachen er ryddet');
};

HANDLINGER.gemKbTal = async () => {
  const antal = $('[data-kb-tal]');
  const cache = $('[data-kb-cache]');
  const svar = await proev(() => api('/indstillinger', {
    metode: 'PATCH',
    krop: { kb_antal: String(antal.value || '20'), kb_cache_min: String(cache.value || '5') },
  }), 'Gemt');
  if (!svar) return;
  S.data.indstillinger = svar.indstillinger;
  tegn();
};

EFTER.push(() => {
  for (const el of $$('[data-vaelg-kb]')) {
    el.addEventListener('change', async () => {
      const svar = await proev(() => api('/indstillinger', { metode: 'PATCH', krop: { genesys_kb_id: el.value } }),
        'Vidensbasen er valgt');
      if (!svar) return;
      S.data.indstillinger = svar.indstillinger;
      S.data.genesys.kbId = el.value;
    });
  }
});

/* ===== p6_sikkerhed.js ===== */
/*
 * Adgang: sitets laas, admin-kodeordet og opsaetningen ud og ind.
 *
 * Laasen er DELT: ét kodeord for alle gaester. Det er ikke en svaghed her, det
 * er hele ideen - sitet skal kunne aabnes for en kunde med en sms, ikke med en
 * brugeroprettelse. Admin har sit eget login og er aldrig omfattet af laasen.
 */
function tegnSikkerhed() {
  const l = laas();
  const i = indst();
  return `
<header class="sidehoved">
  <h1>Adgang</h1>
  <p class="daemp">Hvem kan se demo-sitet – og hvornår.</p>
</header>

<section class="kort">
  <h2>Sitets lås</h2>
  <p class="statuslinje lille">
    <span class="prik ${l.laast ? 'rod' : (l.aabentVindue ? 'gul' : 'groen')}"></span>
    ${l.laast ? 'Sitet er låst lige nu.' : (l.aabentVindue ? `Åbent i ${timerTilbage(l.aabenTil)} – derefter låses det automatisk.` : 'Låsen er slukket. Alle med adressen kan se sitet.')}
  </p>

  <form data-form="laaseKode" class="stablet">
    <label>${l.kodeordSat ? 'Nyt kodeord til sitet' : 'Kodeord til sitet'}<input name="kodeord" type="password" autocomplete="new-password" minlength="4" placeholder="${l.kodeordSat ? 'Lad stå for at beholde det nuværende' : 'mindst 4 tegn'}"></label>
    <label>Tekst på låsesiden<input name="besked" value="${esc(i.gate_besked || '')}" maxlength="300"></label>
    <button class="knap" type="submit">Gem</button>
    ${l.kodeordSat ? '<p class="daemp lille">Et nyt kodeord lukker alle, der er logget ind på sitet med det gamle.</p>' : ''}
  </form>

  <div class="knapraekke skillelinje">
    <button class="knap ${l.taendt ? 'knap-linje' : ''}" type="button" data-handling="laasSkift" ${l.kodeordSat ? '' : 'disabled'}>
      ${l.taendt ? 'Slå låsen fra' : 'Slå låsen til'}
    </button>
    ${[2, 4, 8, 24].map((t) => `<button class="knap knap-linje" type="button" data-handling="laasAaben" data-timer="${t}" ${l.kodeordSat ? '' : 'disabled'}>Åbn ${t} t.</button>`).join('')}
    <button class="knap knap-tekst" type="button" data-handling="lukSessioner">Log alle gæster ud</button>
  </div>
  ${l.kodeordSat ? '' : '<p class="advarsel lille">Sæt et kodeord, før låsen kan slås til.</p>'}
</section>

<form class="kort" data-form="adminKode">
  <h2>Dit admin-kodeord</h2>
  <p class="daemp">Logget ind som <strong>${esc(((S.data && S.data.admin) || {}).brugernavn || '')}</strong>.</p>
  <div class="gitter to">
    <label>Nuværende kodeord<input name="gammelt" type="password" autocomplete="current-password" required></label>
    <label>Nyt kodeord<input name="nyt" type="password" autocomplete="new-password" minlength="8" required></label>
  </div>
  <button class="knap" type="submit">Skift kodeord</button>
</form>

<section class="kort">
  <h2>Opsætningen ud og ind</h2>
  <p class="daemp">Sider, tekster, farver og Genesys-opsætning som én fil. Hemmeligheder følger <strong>ikke</strong> med – client secret og sitets kodeord skal sættes igen bagefter.</p>
  <div class="knapraekke">
    <a class="knap knap-linje" href="/api/admin/eksport" download>Hent opsætningen</a>
    <label class="knap knap-linje filknap">Indlæs opsætning<input type="file" accept="application/json,.json" data-opsaetning hidden></label>
  </div>
  <p class="daemp lille">Indlæsning <strong>erstatter</strong> alle sider. Databasen i /data rører den ikke i øvrigt.</p>
</section>`;
}

FORMER.laaseKode = async (felter) => {
  const krop = { besked: felter.besked };
  if (felter.kodeord) krop.kodeord = felter.kodeord;
  const svar = await proev(() => api('/laas', { metode: 'PATCH', krop }),
    felter.kodeord ? 'Kodeordet er skiftet' : 'Gemt');
  if (!svar) return;
  await proev(async () => { await hentData(); });
  tegn();
};

FORMER.adminKode = async (felter) => {
  const svar = await proev(() => api('/kodeord', { metode: 'POST', krop: felter }), 'Kodeordet er skiftet');
  if (svar) tegn();
};

HANDLINGER.lukSessioner = async () => {
  await proev(() => api('/laas', { metode: 'PATCH', krop: { lukSessioner: true } }), 'Alle gæster er logget ud');
};

EFTER.push(() => {
  const felt = document.querySelector('[data-opsaetning]');
  if (!felt) return;
  felt.addEventListener('change', async () => {
    const fil = felt.files && felt.files[0];
    if (!fil) return;
    if (!window.confirm('Indlæs opsætningen? Alle nuværende sider erstattes.')) { felt.value = ''; return; }
    await proev(async () => {
      const tekst = await fil.text();
      let json;
      try { json = JSON.parse(tekst); } catch { throw new Error('Filen er ikke gyldig JSON'); }
      const svar = await api('/import-opsaetning', { metode: 'POST', krop: json });
      await hentData();
      tegn();
      sig(`Indlæst: ${svar.sider} sider og ${svar.indstillinger} indstillinger`);
    });
  });
});
