/*
 * Adgang: sitets laas, admin-kodeordet og opsaetningen ud og ind.
 *
 * Laasen er DELT: ét kodeord for alle gaester. Det er ikke en svaghed her, det
 * er hele ideen - sitet skal kunne aabnes for en kunde med en sms, ikke med en
 * brugeroprettelse. Admin har sit eget login og er aldrig omfattet af laasen.
 */

'use strict';

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
