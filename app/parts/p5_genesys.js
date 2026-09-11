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

'use strict';

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
