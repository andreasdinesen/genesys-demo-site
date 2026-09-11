#!/usr/bin/env python3
"""Byg runes/genesys-demo-site.yaml - Yggdrasil Panel-runen til demo-sitet.

Runen BAERER ikke koden. Den henter den fra GitHub-taggen `vN`, og serveren
henter selv nyere udgaver ved hver genstart (app/kilde.js). Det er moensteret
fra Sagu, og det er valgt her fra dag ét, fordi Andreas selv bad om det:
koden skal komme fra GitHub, saa install-scriptets stoerrelse ikke er en
begraensning paa, hvad sitet maa indeholde.

Hvad scriptet goer:

  1. Laeser APP_VERSION fra app/parts/p1_core.js - versionen bor ÉT sted.
  2. Samler app/parts/p*.js til app/public/app.js og koerer `node --check`.
  3. Stempler ?v=N paa app.js og style.css i index.html og SKRIVER TILBAGE.
  4. Tjekker kilderne for skabelon-kollisioner ({{STORT}}) og for at alle
     require'de filer findes.
  5. Advarer, hvis arbejdstraeet ikke er pushet - for det er GITHUB, der
     bliver installeret, ikke det der ligger her.
  6. Skriver og validerer YAML'en, og at install og update peger paa SAMME tag.

Kør:  python3 build_rune.py
"""

import glob
import os
import re
import subprocess
import sys
import textwrap

try:
    import yaml
except ImportError:
    sys.exit('FEJL: PyYAML mangler. pip3 install pyyaml')

EJER = 'andreasdinesen'
REPO = 'genesys-demo-site'
ROD = os.path.dirname(os.path.abspath(__file__))

# Runens egen version. Den taeller UDGIVELSER af runen - altsaa af YAML'en:
# variabler, porte, startup, watchers. App-koden har sin egen APP_VERSION og
# skal IKKE have en ny rune for at blive opdateret.
#
# RUNE_VERSION er ogsaa den tag, install-scriptet henter FOERSTE gang, saa
# taggen `v<RUNE_VERSION>` SKAL vaere pushet - ellers kan runen ikke installeres
# forfra. Derfor foelges de to tal ad ved udgivelse.
RUNE_VERSION = None   # udfyldes af APP_VERSION nedenfor


def fejl(besked):
    sys.exit(f'FEJL: {besked}')


def laes(sti):
    with open(os.path.join(ROD, sti), encoding='utf-8') as f:
        return f.read()


def skriv(sti, indhold):
    with open(os.path.join(ROD, sti), 'w', encoding='utf-8') as f:
        f.write(indhold)


def node_tjek(sti):
    r = subprocess.run(['node', '--check', os.path.join(ROD, sti)],
                       capture_output=True, text=True)
    if r.returncode != 0:
        fejl(f'{sti} er ikke gyldig JavaScript:\n{r.stderr.strip()}')


# ----------------------------------------------------------------- frontenden

def saml_frontend(version):
    """app/parts/p*.js -> app/public/app.js.

    Delene samles i NAVNERAEKKEFOELGE, og p1_core skal vaere foerst: den
    definerer S, api() og registrene, som de andre skriver i paa indlaesnings-
    tidspunktet. `const` paa topniveau i et klassisk script er ikke hejst som en
    funktion - en del, der koerer foer p1, ville faa »Cannot access before
    initialization«, og fejlen ville pege paa den forkerte fil.
    """
    dele = sorted(glob.glob(os.path.join(ROD, 'app/parts/p*.js')))
    if not dele:
        fejl('ingen dele i app/parts/')
    if not os.path.basename(dele[0]).startswith('p1_'):
        fejl(f'foerste del skal vaere p1_*, ikke {os.path.basename(dele[0])}')

    stykker = [
        '/* GENERERET FIL - redigér app/parts/p*.js og koer build_rune.py.\n'
        f' * Samlet af {len(dele)} dele til version {version}. */\n'
    ]
    for sti in dele:
        navn = os.path.basename(sti)
        with open(sti, encoding='utf-8') as f:
            kode = f.read()
        # 'use strict' pr. del giver en advarsel om dublet i nogle vaerktoejer
        # og betyder ingenting, naar filen alligevel samles - den staar én gang
        # i toppen af resultatet.
        kode = re.sub(r"^\s*'use strict';\s*\n", '', kode, count=1, flags=re.M)
        stykker.append(f'\n/* ===== {navn} ===== */\n{kode.rstrip()}\n')

    samlet = "'use strict';\n" + ''.join(stykker)
    skriv('app/public/app.js', samlet)
    node_tjek('app/public/app.js')
    print(f'  frontend: {len(dele)} dele -> app/public/app.js ({len(samlet):,} tegn)')


def stempl_version(version):
    """?v=N paa app.js og style.css i index.html.

    Cloudflare edge-cacher .js og .css i timevis og ignorerer Cache-Control
    (RUNE-ERFARINGER §5). Versionerede adresser er den eneste maade at komme
    uden om det paa - og resultatet SKAL skrives tilbage til disken, for det er
    filen paa disken, GitHub udleverer.
    """
    html = laes('app/public/index.html')
    ny = re.sub(r'(app\.js|style\.css)(\?v=\d+)?', rf'\1?v={version}', html)
    if ny != html:
        skriv('app/public/index.html', ny)
    if f'app.js?v={version}' not in ny:
        fejl('index.html fik ikke noget versionsstempel - staar der et <script src="/app.js">?')
    print(f'  index.html stemplet ?v={version}')


# --------------------------------------------------------------- sundhedstjek

def tjek_kilder(filer):
    for navn in filer:
        if not navn.endswith(('.js', '.html', '.css')):
            continue
        tekst = laes(navn)
        # Panelet erstatter {{STORE_BOGSTAVER}} i HELE runen. Staar et saadant
        # moenster i en kildefil, forsvinder det uden varsel.
        hits = set(re.findall(r'\{\{[A-Z_]+\}\}', tekst))
        if hits:
            fejl(f'{navn} indeholder skabelon-kollisioner: {sorted(hits)}')
        if navn.endswith('.js'):
            node_tjek(navn)


def tjek_requires(filer):
    """Alt, der require'es relativt, SKAL vaere i repoet.

    Beanledger udgav to versioner, der slet ikke kunne installeres, fordi to
    moduler manglede i pakningen. Her pakkes der ikke - men et modul, der ikke
    er committet, giver praecis samme fejl paa serveren.
    """
    mangler = []
    for navn in [f for f in filer if f.endswith('.js')]:
        for rel in re.findall(r"require\(['\"](\./[^'\"]+)['\"]\)", laes(navn)):
            sti = os.path.normpath(os.path.join(os.path.dirname(navn), rel))
            if not sti.endswith('.js'):
                sti += '.js'
            if not os.path.exists(os.path.join(ROD, sti)):
                mangler.append(f'{navn} -> {sti}')
    if mangler:
        fejl('disse require-filer findes ikke: ' + ', '.join(mangler))


def tjek_git(version):
    """Det er GITHUB, der bliver installeret - ikke arbejdstraeet.

    Derfor er en beskidt mappe eller en manglende tag ikke en detalje: runen
    ville installere noget ANDET end det, der lige er bygget og testet. Det er
    en advarsel og ikke en fejl, fordi build'et skal kunne koeres midt i
    arbejdet - men den skal staa, saa den ikke kan overses.
    """
    def git(*args):
        r = subprocess.run(['git', '-C', ROD, *args], capture_output=True, text=True)
        return r.stdout.strip() if r.returncode == 0 else None

    if git('rev-parse', '--git-dir') is None:
        print('  ADVARSEL: ingen git-mappe - install-scriptet henter fra GitHub, saa koden SKAL pushes')
        return
    beskidt = git('status', '--porcelain')
    if beskidt:
        print(f'  ADVARSEL: {len(beskidt.splitlines())} ucommittede aendringer - de kommer IKKE med i v{version}')
    tags = (git('tag', '--list', f'v{version}') or '')
    if not tags:
        print(f'  ADVARSEL: taggen v{version} findes ikke endnu.')
        print(f'            Runen kan foerst installeres, naar »git tag v{version} && git push --tags« er koert.')


# --------------------------------------------------------------- selve runen

def tarball_url(version):
    """Altid en TAG, aldrig en gren.

    `refs/heads/main` ville installere det, main tilfaeldigvis indeholder i dag;
    `refs/tags/vN` installerer praecis vN. Glemmer man at pushe taggen, siger
    install-scriptet det HOEJT i stedet for at installere noget andet.
    """
    return f'https://codeload.github.com/{EJER}/{REPO}/tar.gz/refs/tags/v{version}'


def henter(version):
    """Hentningen som ét node -e-udtryk.

    Node er garanteret til stede (install-imaget ER node:*-alpine), mens
    busybox' wget og dens TLS er ubevist. zlib pakker gzip'en ud, saa `tar` kun
    skal kunne det, den goer i forvejen (`tar x`) - ingen -z, ingen
    --strip-components, ingen wildcards.

    Udtrykket staar i en 'single quoted' sh-streng og maa derfor ikke indeholde
    et enkeltcitationstegn.
    """
    url = tarball_url(version)
    kode = (
        'const https=require("https"),zlib=require("zlib");'
        f'const U="{url}";'
        'function d(m){console.error("[fejl] "+m);console.error("Adresse: "+U);'
        'console.error("GitHub svarer 404 BAADE naar adressen ikke findes OG naar '
        'der ikke er adgang - tjek at taggen er pushet, og at repoet er offentligt.");'
        'process.exit(1);}'
        f'function hent(u,n){{https.get(u,{{headers:{{"user-agent":"{REPO}-installer"}}}},(r)=>{{'
        'if(r.statusCode>=300&&r.statusCode<400&&r.headers.location){'
        'if(n<=0)return d("for mange omdirigeringer");r.resume();'
        'return hent(new URL(r.headers.location,u).toString(),n-1);}'
        'if(r.statusCode!==200)return d("GitHub svarede "+r.statusCode);'
        'const g=zlib.createGunzip();'
        'g.on("error",(e)=>d("arkivet kunne ikke pakkes ud: "+e.message));'
        'r.pipe(g).pipe(process.stdout);'
        '}).on("error",(e)=>d("kunne ikke naa GitHub: "+e.message));}'
        'hent(U,3);'
    )
    if "'" in kode:
        fejl('hente-udtrykket indeholder et enkeltcitationstegn og kan ikke staa i sh')
    return kode


def hent_krop(version):
    """De linjer, install og update har til faelles.

    Tre detaljer baerer dem, og alle tre er laert paa den dyre maade i Sagu:

      1. Der pakkes ud VED SIDEN AF app/ - ikke i /tmp. `mv` mellem to
         filsystemer er en KOPI, og en kopi kan afbrydes paa midten; to
         `rename` inden for samme filsystem kan ikke.
      2. Den gamle app FLYTTES vaek i stedet for at blive slettet, saa
         startup-kommandoen kan saette den tilbage, hvis containeren doer
         mellem de to omdoebninger.
      3. Mappenavnet i et GitHub-arkiv (<repo>-<ref uden v>) gaettes ikke -
         der ledes efter den app-mappe, der FINDES.
    """
    return (
        'echo "Henter app-koden fra GitHub ..."\n'
        '\n'
        '# Der pakkes ud VED SIDEN AF app/, ikke i /tmp: et bytte skal kunne\n'
        '# ske med to rename inden for samme filsystem.\n'
        'rm -rf .gds-ny .gds-gammel\n'
        'mkdir -p .gds-ny\n'
        f"node -e '{henter(version)}' > .gds-ny/app.tar\n"
        'tar x -C .gds-ny -f .gds-ny/app.tar\n'
        'rm -f .gds-ny/app.tar\n'
        '\n'
        '# Mappenavnet i et GitHub-arkiv er <repo>-<ref uden v>, og arkivet\n'
        '# begynder med en pax_global_header-post. Ingen af delene gaettes:\n'
        '# find den app-mappe, der FINDES.\n'
        'NY=$(find .gds-ny -maxdepth 2 -type d -name app | head -n 1)\n'
        'if [ -z "$NY" ] || [ ! -f "$NY/server.js" ]; then\n'
        '  echo "[fejl] arkivet fra GitHub indeholder ingen app/server.js"\n'
        '  exit 1\n'
        'fi\n'
        '\n'
        '# To omdoebninger, ingen kopi. Doer vi mellem dem, ligger den gamle\n'
        '# app under .gds-gammel, og startup-kommandoen saetter den tilbage.\n'
        'if [ -d app ]; then mv app .gds-gammel; fi\n'
        'mv "$NY" app\n'
        'rm -rf .gds-ny .gds-gammel\n'
    )


def install_script(version):
    return (
        'set -eu\n'
        f'echo "Installerer Genesys Demo Site (startsnor v{version}) ..."\n'
        'echo "Node: $(node --version)"\n'
        '\n'
        + hent_krop(version)
        + '\n'
        'echo "Filer udpakket:"\n'
        'ls -1 app app/public\n'
        'echo "Klar. Start serveren i panelet - den henter selv nyeste udgave"\n'
        'echo "(eller den, KODE_VERSION laaser til), foer den starter."\n'
    )


def opdater_script(version):
    """»Opdater demo-sitet«-knappen i panelet.

    Knappen maa ALDRIG hente startsnorens tag, naar appen allerede er laengere
    fremme - v1 oven i v14 er en nedgradering, ingen bad om. Findes app/kilde.js,
    er DEN facit: den kender KODE_VERSION og henter praecis den udgave, en
    genstart ville hente. Startsnoren er kun redningen, hvis app/ er vaek.
    """
    return (
        'set -eu\n'
        'echo "Opdaterer Genesys Demo Site ..."\n'
        'echo "Node: $(node --version)"\n'
        '\n'
        # mkdir er atomisk paa alle filsystemer; `[ -d ]` efterfulgt af mkdir er
        # ikke - der er et hul imellem dem, og to tryk paa knappen faa sekunder
        # fra hinanden ville traede i hinandens arbejdsmapper.
        'if ! mkdir .gds-laas 2>/dev/null; then\n'
        '  echo "[fejl] en anden opdatering er allerede i gang."\n'
        '  echo "Vent til den er faerdig, eller genstart demo-sitet og proev igen."\n'
        '  exit 1\n'
        'fi\n'
        "trap 'rm -rf .gds-laas .gds-ny' EXIT INT TERM\n"
        '\n'
        'if [ -f app/kilde.js ]; then\n'
        # Panelet templater {{...}} ind i scriptets TEKST, og variablerne findes
        # OGSAA som env i containeren. Hvilken der gaelder, er ubevist - saa vi
        # proever skabelonen og falder tilbage til env, hvis den staar
        # utemplateret. Ellers kunne en laasning gaa tabt paa en antagelse.
        '  K="{{KODE_VERSION}}"\n'
        '  case "$K" in\n'
        "    '') : ;;\n"
        '    seneste|latest|[0-9]*) : ;;\n'
        '    *) K="${KODE_VERSION:-}" ;;\n'
        '  esac\n'
        '  echo "Oensket udgave: ${K:-nyeste}"\n'
        '  KODE_VERSION="$K" node app/kilde.js\n'
        'else\n'
        + textwrap.indent(hent_krop(version), '  ')
        + 'fi\n'
        '\n'
        'echo "App-filerne er skiftet ud. Databasen i /data er uroert."\n'
        'echo "Panelet genstarter appen bagefter. Sker det ikke, saa genstart"\n'
        'echo "selv - serveren koerer den gamle kode, til den er genstartet."\n'
    )


STARTUP = (
    # 1. Redningen. kilde.js bytter app/ ud med to omdoebninger; doer
    #    containeren imellem dem, ligger den gamle app under .gds-gammel.
    #    Uden det her trin ville et daarligt sekund efterlade en container
    #    uden app/ - og dermed uden kilde.js til at hente en ny.
    'if [ ! -f app/server.js ] && [ -f .gds-gammel/server.js ]; then\n'
    '  rm -rf app\n'
    '  mv .gds-gammel app\n'
    '  echo "[kode] app/ sat tilbage efter en afbrudt udskiftning"\n'
    'fi\n'
    # 2. En strandet laas ville goere opdateringsknappen doed for altid. En
    #    container, der STARTER, er den bedste lejlighed til at rydde den.
    'if [ -d .gds-laas ]; then\n'
    '  rm -rf .gds-laas .gds-ny\n'
    '  echo "[kode] en strandet opdateringslaas er ryddet"\n'
    'fi\n'
    # 3. Hentningen. Fejler den, siger den det og gaar videre - den kode, der
    #    ligger, er stadig et koerende demo-site. Derfor `|| echo`.
    'node app/kilde.js || echo "[kode] advarsel: opdateringen kunne ikke koeres"\n'
    'if node -e "require(\'node:sqlite\')" >/dev/null 2>&1; then\n'
    '  exec node app/server.js\n'
    'else\n'
    '  exec node --experimental-sqlite app/server.js\n'
    'fi\n'
)


def byg_yaml(version):
    rune = {'gameskill': {
        'id': 'genesys-demo-site',
        'name': 'Genesys Demo Site',
        'category': 'Apps',
        'description': (
            'Demo-website til Genesys Cloud. Web messaging-widget paa alle sider, '
            'vidensbase hentet live fra Genesys Knowledge API, redigerbare sider '
            '(forside, indhold, kontakt) og import af en eksisterende side, saa en '
            'kundes rigtige website kan bruges som kulisse. Hele sitet kan laases bag '
            'ét kodeord, der kan aabnes i et tidsvindue foer en demo og lukker sig selv '
            'igen. Egen SQLite-database, ingen eksterne afhaengigheder.'
        ),
        'author': 'andreas',
        'version': version,
        'icon': 'app',

        # Node-versionen er et FELT i panelet, ikke en konstant i koden: findes
        # der en CVE i Node, kan den lukkes med »Opdater demo-sitet« - uden
        # kodeaendring.
        'docker': {'image': '{{NODE_IMAGE}}'},

        'variables': [
            {'key': 'APP_NAME', 'name': 'Appens navn', 'type': 'string',
             'default': 'Genesys Demo Site'},
            {'key': 'SITE_NAME', 'name': 'Sitets navn', 'type': 'string',
             'default': 'Demo Erhverv',
             'hint': 'Vises i menuen og i foden. Kan aendres i admin bagefter.'},
            {'key': 'GENESYS_ENV', 'name': 'Genesys-region', 'type': 'string',
             'default': 'prod-euc1',
             'pattern': r'^prod[a-z0-9-]*$',
             'hint': 'Fx prod-euc1 (Frankfurt) eller prod-euw1 (Irland).'},
            {'key': 'GENESYS_DEPLOYMENT_ID', 'name': 'Messenger deployment-id', 'type': 'string',
             'default': '',
             'pattern': r'^([0-9a-fA-F-]{20,60})?$',
             'hint': 'Valgfrit. Kan ogsaa saettes i admin under Genesys.'},
            {'key': 'NODE_IMAGE', 'name': 'Node-image', 'type': 'string',
             'default': 'node:24-alpine',
             'pattern': r'^node:[0-9][A-Za-z0-9._-]*$',
             'hint': 'Skal vaere et node:-image. node:sqlite kraever Node 22 eller nyere.'},
            {'key': 'KODE_VERSION', 'name': 'Kodeversion', 'type': 'string',
             'default': '',
             'pattern': r'^([0-9]+|seneste|latest)?$',
             'hint': 'Tom = hent nyeste udgivelse fra GitHub ved hver genstart. '
                     'Et tal (fx 3) laaser til praecis den udgave - brug det til at '
                     'fryse sitet dagen foer en stor demo.'},
        ],

        'install': {'image': '{{NODE_IMAGE}}', 'script': install_script(version)},
        'update': {'image': '{{NODE_IMAGE}}', 'label': 'Opdater demo-sitet',
                   'script': opdater_script(version)},
        'startup': {
            'command': STARTUP,
            # Serverens linje er »… lytter på port 8920 (data: …)«. Regexen
            # skrives ASCII: panelets matchning paa et flerbyte-tegn er ubevist,
            # og et done_regex, der aldrig rammer, giver en rune, der ser ud til
            # at haenge i opstart, selv om serveren koerer fint.
            'done_regex': r'lytter p\S+ port \d+',
            'stop_timeout': 20,
        },

        'ports': [{'name': 'web', 'default': 3000, 'protocol': 'tcp'}],

        'watchers': [
            {'name': 'Serverfejl i demo-sitet', 'pattern': r'\[fejl\]',
             'threshold': 5, 'window_secs': 300},
        ],

        # Watcheren notificerer; events giver historikken pr. IP i panelet.
        # Sitets laas er ét delt kodeord - saa er det netop dét, der skal kunne
        # ses paa en liste, naar adressen har vaeret delt bredt.
        'events': [
            {'key': 'gds_admin_login_fejl', 'label': 'Mislykket admin-login',
             'match': r'\[sikkerhed\] login-fejl ip=(\S+)'},
            {'key': 'gds_admin_spaerret', 'label': 'Admin-login spaerret af rate-limit',
             'match': r'\[sikkerhed\] login-spaerret ip=(\S+)'},
            {'key': 'gds_laas_fejl', 'label': 'Forkert kodeord til sitet',
             'match': r'\[sikkerhed\] laas-fejl ip=(\S+)'},
            {'key': 'gds_laas_spaerret', 'label': 'Sitets laas spaerret af rate-limit',
             'match': r'\[sikkerhed\] laas-spaerret ip=(\S+)'},
        ],

        'backup': {'include': []},
        'wipe': {'paths': ['demosite.db', 'demosite.db-wal', 'demosite.db-shm'],
                 'backup_first': True},
    }}

    tekst = yaml.safe_dump(rune, allow_unicode=True, sort_keys=False, width=120)

    # Valider, at det vi skrev kan laeses igen - og at install og update peger
    # paa SAMME tag. En update, der henter en anden version end installationen,
    # opdages ellers foerst, naar nogen trykker paa knappen.
    genlaest = yaml.safe_load(tekst)['gameskill']
    for navn in ('install', 'update'):
        if genlaest[navn]['script'] != rune['gameskill'][navn]['script']:
            fejl(f'{navn}-scriptet overlevede ikke en YAML-rundtur')
    kilder = {navn: set(re.findall(r'refs/tags/v(\d+)', genlaest[navn]['script']))
              for navn in ('install', 'update')}
    if kilder['install'] != kilder['update']:
        fejl(f'install og update henter forskellige tags: {kilder}')
    if kilder['install'] != {str(version)}:
        fejl(f'scripterne henter {kilder["install"]}, ikke v{version}')
    if 'mkdir .gds-laas' not in genlaest['update']['script']:
        fejl('update-scriptet mangler laasen mod to samtidige opdateringer')

    sti = 'runes/genesys-demo-site.yaml'
    skriv(sti, tekst)
    print(f'  {sti}: {len(tekst):,} tegn, rune v{version}')
    return tekst


# --------------------------------------------------------------------- main

def main():
    kilde = laes('app/parts/p1_core.js')
    m = re.search(r'const APP_VERSION = (\d+);', kilde)
    if not m:
        fejl('APP_VERSION ikke fundet i app/parts/p1_core.js')
    version = int(m.group(1))
    print(f'Bygger Genesys Demo Site v{version}')

    saml_frontend(version)
    stempl_version(version)

    os.chdir(ROD)   # glob(root_dir=) findes foerst i Python 3.10
    filer = (sorted(glob.glob('app/*.js'))
             + sorted(glob.glob('app/parts/*.js'))
             + ['app/public/index.html', 'app/public/app.js',
                'app/public/style.css', 'app/public/site.css', 'app/public/site.js'])
    for navn in ['app/server.js', 'app/kilde.js', 'app/genesys.js', 'app/kb.js', 'app/sider.js',
                 'app/public/icon-192.png', 'app/public/icon-512.png']:
        if not os.path.exists(os.path.join(ROD, navn)):
            fejl(f'{navn} mangler')
    tjek_kilder(filer)
    tjek_requires([f for f in filer if f.endswith('.js') and '/parts/' not in f])
    tjek_git(version)
    byg_yaml(version)
    print('Faerdig.')


if __name__ == '__main__':
    main()
