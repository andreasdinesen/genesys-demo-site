/*
 * Demo-sitets lille smule JavaScript.
 *
 * Sitet tegnes af serveren. Det her er kun de tre ting, en side ikke kan klare
 * selv: menuknappen paa mobil, soegningen i vidensbasen og knappen, der aabner
 * Genesys-chatten.
 *
 * Ingen bygger, ingen pakker. Filen koeres som et klassisk script med defer.
 */

(function () {
  'use strict';

  /* Mobilgraensen staar OGSAA i site.css. De to skal foelges ad - er de ude af
   * trit, folder menuknappen menuen sammen paa en bredde, hvor CSS'en tror, den
   * er synlig (RUNE-ERFARINGER §4). */
  var MOBIL = 900;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ------------------------------------------------------------- menuknappen */

  var knap = document.querySelector('.menuknap');
  var menu = document.getElementById('mobilmenu');
  if (knap && menu) {
    knap.addEventListener('click', function () {
      var aaben = !menu.hidden;
      menu.hidden = aaben;
      knap.setAttribute('aria-expanded', String(!aaben));
    });
    window.addEventListener('resize', function () {
      if (window.innerWidth > MOBIL) { menu.hidden = true; knap.setAttribute('aria-expanded', 'false'); }
    });
  }

  /* ------------------------------------------------------------- chat-knappen */

  /* Genesys-koeen findes, saa snart snippet'en har koert - ogsaa foer selve
   * widget'en er hentet. Kommandoen laegges i koeen og udfoeres, naar den er
   * klar, saa knappen virker ogsaa paa et hurtigt klik. */
  document.addEventListener('click', function (e) {
    var maal = e.target.closest ? e.target.closest('[data-aabn-chat]') : null;
    if (!maal) return;
    e.preventDefault();
    if (typeof window.Genesys === 'function') window.Genesys('command', 'Messenger.open');
    else alert('Genesys-widget’en er ikke slået til for siden.');
  });

  /* Demo-formularen sender ingen steder hen. Den skal bare ikke genindlaese
   * siden og se i stykker ud midt i en demo. */
  var form = document.querySelector('.kontaktform[data-demo]');
  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var note = form.querySelector('.demo-note');
      if (note) note.textContent = 'Tak! (Demo – beskeden sendes ikke nogen steder.)';
      form.reset();
    });
  }

  /* ---------------------------------------------------------- soeg i vidensbasen */

  var soegForm = document.querySelector('[data-kb-soeg]');
  var resultat = document.querySelector('[data-kb-resultat]');
  var standard = document.querySelector('[data-kb-standard]');
  if (soegForm && resultat && standard) {
    var basis = soegForm.getAttribute('data-basis') || '';
    var felt = soegForm.querySelector('input[name="q"]');
    var sidste = 0;

    function visStandard() {
      resultat.hidden = true;
      resultat.innerHTML = '';
      standard.hidden = false;
    }

    function tegn(svar, q) {
      var traef = svar.traef || [];
      var html = '<h2>' + (traef.length ? traef.length + ' resultater for “' + esc(q) + '”'
        : 'Ingen resultater for “' + esc(q) + '”') + '</h2>';
      if (!traef.length) {
        html += '<p class="tom">Prøv et andet ord – eller spørg os i chatten.</p>';
      } else {
        html += '<ul class="artikelliste kb-traefliste">' + traef.map(function (a) {
          return '<li><a href="' + esc(basis) + '/artikel/' + esc(a.id) + '/' + esc(a.slug || '') + '">'
            + '<span class="artikeltitel">' + esc(a.titel) + '</span>'
            + (a.resume ? '<span class="artikelresume">' + esc(a.resume) + '</span>' : '')
            + (a.kategori ? '<span class="maerkat">' + esc(a.kategori) + '</span>' : '')
            + '</a></li>';
        }).join('') + '</ul>';
      }
      html += '<p><button class="knap knap-linje" type="button" data-kb-ryd>Ryd søgningen</button></p>';
      resultat.innerHTML = html;
      resultat.hidden = false;
      standard.hidden = true;
    }

    soegForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var q = (felt.value || '').trim();
      if (!q) return visStandard();
      var mit = ++sidste;
      resultat.innerHTML = '<p class="kb-status">Søger …</p>';
      resultat.hidden = false;
      standard.hidden = true;
      fetch('/api/kb/soeg?q=' + encodeURIComponent(q), { headers: { accept: 'application/json' } })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (svar) {
          /* Et gammelt svar maa ikke overskrive et nyere: brugeren taster
           * videre, mens kaldet er undervejs. */
          if (mit !== sidste) return;
          if (!svar.ok) throw new Error(svar.j && svar.j.error ? svar.j.error : 'ukendt fejl');
          tegn(svar.j, q);
        })
        .catch(function (err) {
          if (mit !== sidste) return;
          resultat.innerHTML = '<p class="fejl">Søgningen fejlede: ' + esc(err.message) + '</p>';
        });
    });

    document.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('[data-kb-ryd]')) { felt.value = ''; visStandard(); felt.focus(); }
    });
  }
}());
