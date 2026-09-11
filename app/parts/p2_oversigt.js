/*
 * Oversigten - den side, admin aabner paa.
 *
 * Den skal svare paa ét spoergsmaal paa ét sekund: **kan kunden se sitet lige
 * nu?** Derfor er laasen ikke en indstilling nede i en formular, men det
 * foerste og stoerste paa siden, med de knapper man rent faktisk bruger foer en
 * demo: »åbn i fire timer« og »luk nu«.
 */

'use strict';

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
