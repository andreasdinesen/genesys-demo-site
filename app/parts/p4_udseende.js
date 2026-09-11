/*
 * Udseende: navn, farver, logo og de to tekstfelter, der kan baere en kundes
 * eget script under en demo.
 *
 * Pointen med siden er, at det SAMME demo-site kan optraede som forskellige
 * kunder. Derfor er farver og navn indstillinger og ikke css - og derfor er
 * logoet et billede i databasen og ikke en fil, nogen skal laegge paa disken.
 */

'use strict';

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
