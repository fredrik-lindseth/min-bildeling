# Design for stats

Spesifikasjon for den visuelle retningen i `stats/`: dashboard, popup og årsoppsummering. Den skal godkjennes før CSS-en skrives om, og den omskrivingen kalles del 2 under. `docs/design-skisse.html` viser tokenene i bruk (åpne den direkte i nettleseren, legg til `#lys` eller `#mork` for å tvinge en modus). Alle tall i skissen er oppdiktet.

## Hva det er, og for hvem

Et privat regnskap for bilbruk. Målgruppen er alle som er medlem i en Bilparaplyen-organisasjon på dele.no, ikke bare Bildeleringen i Bergen, så eksempeltekster skal ikke forutsette en bestemt by, stasjon eller lokal prisliste. Én person åpner det for å finne ut hva bildeling koster og om det lønner seg mot egen bil. Det er ikke et produkt-dashboard for et team, og ingen skal imponeres. Tonen er nøktern og tallfast, som en ryddig årsoppgave: tallet først, så en setning som sier hva det betyr, så grunnlaget for den som vil sjekke.

To tall er grunnen til at folk åpner siden: hva de har brukt (Kostnader) og hva de sparer mot egen bil (Bilregnestykket). De får den visuelle vekten. Resten av seksjonene er støttemateriale og skal se slik ut.

## Utgangspunktet

Slik står det i dag: systemfont uten bevisst skala, blå aksent `#4a90d9` som ikke har noe med Dele å gjøre, radius 6, 10 og 14 px, grå skygge under hvert kort, og identiske kort i rutenett i alle ni seksjoner. Etiketter står i store bokstaver med sperring. Popup og dashboard har hvert sitt `:root` med litt ulike verdier, og årsoppsummeringen har et tredje tokensett (`--sum-*`) som er hardkodet mørkt. `debug.html` har hex-farger inline.

## Farger

Lilla fra dele.no er eneste aksent. Flaten er varm grå, ikke rent hvitt og ikke krem. Mørk modus er nøytral grå, ikke blåsvart og ikke `#111`. Alle farger er hele hex-verdier, skrevet med små bokstaver i `tokens.css` som i resten av CSS-en (tabellene her bruker store for lesbarhet). Ingen alfa i tokens, så kontrasten kan måles og blir den samme uansett hva som ligger under.

### Mekanisme

Ett tokensett i en ny fil, `stats/lib/tokens.css`, lenket inn før sidens egen CSS i alle tre HTML-filene. Hver farge skrives én gang med `light-dark()`:

```css
:root {
  color-scheme: light dark;
  --color-bg: light-dark(#ECEAE6, #1F1F21);
}
```

`color-scheme: light dark` følger `prefers-color-scheme`, så regelen om mørk modus er oppfylt uten en egen media-blokk. Årsoppsummeringen setter bare `:root { color-scheme: dark; }` i `summary.css` og får de samme tokenene i mørk variant. Da finnes det ett tokensystem, ikke tre.

Konsekvenser som del 2 må ta:

- `light-dark()` krever minst Firefox 120, så `strict_min_version` i `manifest.json` må være minst 120. I Chromium kom støtten i Chrome 123, og skal utvidelsen lastes der, settes `minimum_chrome_version` til minst 123.
- `getComputedStyle().getPropertyValue("--color-x")` gir tilbake selve `light-dark(...)`-teksten, som Chart.js ikke forstår. `chart-helpers.js` må løse fargen gjennom et skjult måleelement: sett `style.color = "var(--color-x)"` og les `getComputedStyle(el).color`, som da er en ferdig `rgb()`.
- Eksporten via html2canvas leser beregnede stiler, som skal være ferdig løste `rgb()`-verdier. Det er ikke testet ennå. Del 2 verifiserer «Last ned bilde» i begge moduser før noe annet bygges på mekanismen. Feiler det, er reserveløsningen en vanlig `@media (prefers-color-scheme: dark)`-blokk pluss en `:root.scheme-dark`-blokk med de samme verdiene for årsoppsummeringen.
- Kontrastscriptet (se Sjekker som håndhever reglene) må kunne lese `light-dark(a, b)` og sjekke a mot a og b mot b.

### Token-settet

| Token                    | Lys       | Mørk      | Brukes til                                            |
| ------------------------ | --------- | --------- | ----------------------------------------------------- |
| `--color-bg`             | `#ECEAE6` | `#1F1F21` | sidebakgrunn                                          |
| `--color-surface`        | `#F7F6F3` | `#28282B` | header, nav, paneler, banner                          |
| `--color-sunken`         | `#E3E0DB` | `#323236` | hover på sekundærknapp, progress-spor, skjelett       |
| `--color-border`         | `#D3CFC8` | `#3B3B3F` | 1 px skillelinjer og panelkant                        |
| `--color-border-strong`  | `#8A847B` | `#7C7C83` | kant på knapper og skjemafelt, x-akse                 |
| `--color-grid`           | `#DEDAD4` | `#333337` | rutenett i diagrammer                                 |
| `--color-text`           | `#1E1C19` | `#ECEBE8` | brødtekst og tall                                     |
| `--color-text-secondary` | `#57524B` | `#B5B3AE` | etiketter, forklarende setninger                      |
| `--color-text-tertiary`  | `#6B665E` | `#9A9893` | aksetekst, «Beregnes …», tidsstempel                  |
| `--color-accent`         | `#51289D` | `#B39AEB` | primærknapp, lenker, aktiv fane, fokusring, fremdrift |
| `--color-accent-hover`   | `#41207F` | `#C6B3F1` | hover på primærknapp                                  |
| `--color-on-accent`      | `#FFFFFF` | `#1F1F21` | tekst på aksentflate                                  |
| `--color-accent-soft`    | `#E4DDF0` | `#352D48` | valgt årsknapp, rangeringsnummer                      |
| `--color-warning-bg`     | `#F5E4D3` | `#3A2C1F` | feil og «ikke innlogget»                              |
| `--color-warning-text`   | `#7A3F0A` | `#F0BE8A` | tekst på warning-bg                                   |
| `--color-danger`         | `#A12F28` | `#F08A80` | «Nullstill alt», destruktive handlinger               |
| `--color-disabled-bg`    | `#E3E0DB` | `#323236` | deaktivert knapp                                      |
| `--color-disabled-text`  | `#5E5952` | `#A3A19C` | tekst på deaktivert knapp                             |
| `--color-chart-1`        | `#51289D` | `#B39AEB` | lilla, bildeling og hovedserien                       |
| `--color-chart-2`        | `#A45C09` | `#FDD57E` | oker, den varme kontrasten                            |
| `--color-chart-3`        | `#4B86C2` | `#3E79B3` | blå, sammenligningsserien                             |
| `--color-chart-4`        | `#5B0233` | `#FFA5C1` | bær (lys) og rosa (mørk)                              |
| `--color-chart-5`        | `#0D6460` | `#3B9C97` | blågrønn                                              |

Aksenten i mørk modus er en lysere lilla fordi `#51289D` gir 1,6:1 mot den mørke flaten. Primærknappen i mørk modus får derfor mørk tekst på lys lilla, slik skissen viser.

Tokenene som forsvinner: `--color-accent-light`, `--color-header-*`, `--color-nav-*`, `--color-status-*` (banneret bruker surface og border), `--color-progress-*`, `--color-btn-sync-*`, `--color-btn-secondary-*`, `--color-card-shadow`, `--color-shadow`, `--color-heatmap-text`, `--color-empty-text`, `--color-link`, `--color-rank-*`, `--color-section-divider`, `--color-secondary`, `--color-tertiary`, `--color-saving-bg`, `--color-danger-hover`, `--color-danger-bg`, alle `--shadow-*`, `--radius-sm/md/lg` og alle `--sum-*`. Grønn som «sparing»-farge går ut. Sparing vises med aksenten, så grønt ikke blir et eget signal som bare finnes ett sted, og rød mot grønn faller bort for fargeblinde.

### Kontrast

Målt med WCAG 2-formelen i et lite `python3 -I`-script. Kontrastscriptet som kommer i del 2, skal gi de samme tallene. Krav: 4,5:1 for tekst, 3:1 for kanter på kontroller og diagramelementer.

| Par                          | Lys   | Mørk  | Krav |
| ---------------------------- | ----- | ----- | ---- |
| text på bg                   | 14,15 | 13,80 | 4,5  |
| text på surface              | 15,73 | 12,33 | 4,5  |
| text-secondary på bg         | 6,44  | 7,85  | 4,5  |
| text-secondary på surface    | 7,16  | 7,02  | 4,5  |
| text-secondary på sunken     | 5,88  | 6,09  | 4,5  |
| text-tertiary på bg          | 4,74  | 5,71  | 4,5  |
| text-tertiary på surface     | 5,27  | 5,10  | 4,5  |
| accent på bg                 | 8,17  | 6,85  | 4,5  |
| accent på surface            | 9,08  | 6,12  | 4,5  |
| accent på accent-soft        | 7,43  | 5,39  | 4,5  |
| on-accent på accent          | 9,81  | 6,85  | 4,5  |
| on-accent på accent-hover    | 12,08 | 8,71  | 4,5  |
| warning-text på warning-bg   | 6,65  | 7,97  | 4,5  |
| danger på surface            | 6,58  | 6,06  | 4,5  |
| danger på bg                 | 5,92  | 6,78  | 4,5  |
| disabled-text på disabled-bg | 5,27  | 4,95  | 4,5  |
| border-strong på surface     | 3,43  | 3,55  | 3    |
| border-strong på bg          | 3,08  | 3,97  | 3    |
| chart-1 på surface           | 9,08  | 6,12  | 3    |
| chart-2 på surface           | 4,72  | 10,50 | 3    |
| chart-3 på surface           | 3,54  | 3,21  | 3    |
| chart-4 på surface           | 12,94 | 7,98  | 3    |
| chart-5 på surface           | 6,46  | 4,47  | 3    |
| chart-3 på bg                | 3,18  | 3,60  | 3    |

Alle par holder, også alle fem chart-fargene mot bg (laveste er chart-3 over). Deaktivert tekst er unntatt i WCAG, men holdes over 4,5 fordi synk-knappen står deaktivert i minutter under første henting.

### Chart-paletten skiller på lyshet, ikke bare kulør

De fem chart-fargene ligger på hvert sitt lyshetstrinn i begge moduser, så de kan skilles også av en leser med nedsatt fargesyn og i gråtoneutskrift. Rekkefølgen fra mørkest til lysest er chart-4, 1, 5, 2, 3 i lys modus og chart-3, 5, 1, 4, 2 i mørk. Lysheten er valgt med OKLCH og målt med WCAG-formelen. Kontrast mellom hvert par av chart-farger:

| Par               | Lys  | Mørk |
| ----------------- | ---- | ---- |
| chart-1 / chart-2 | 1,92 | 1,72 |
| chart-1 / chart-3 | 2,56 | 1,90 |
| chart-1 / chart-4 | 1,43 | 1,31 |
| chart-1 / chart-5 | 1,41 | 1,37 |
| chart-2 / chart-3 | 1,33 | 3,27 |
| chart-2 / chart-4 | 2,74 | 1,31 |
| chart-2 / chart-5 | 1,37 | 2,35 |
| chart-3 / chart-4 | 3,66 | 2,48 |
| chart-3 / chart-5 | 1,82 | 1,39 |
| chart-4 / chart-5 | 2,00 | 1,79 |

Ingen par er under 1,3. Det største spranget ligger mellom chart-1 og chart-3, som er paret i to-seriers søyler. Lilla finnes bare i chart-1, så aksenten ikke får en nesten-lik nabo.

Lyshet alene er likevel ikke nok til å bære en serie, så fargen bærer aldri informasjonen alene. Kakestykker skilles med 2 px strek i surface-fargen og har etikett og beløp i en liste ved siden av. Sammenligningsserien i to-seriers søyler tegnes hul (se Diagrammer), så de to seriene også skilles på form.

## Typografi

Én familie: systemfonten (`system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`). Utvidelsen lever ved siden av nettleserens eget grensesnitt, og systemfonten passer inn der uten å laste noe. Personligheten skal komme fra hvordan tallene settes, ikke fra skrifttypen. En bundlet font (Source Sans 3 eller IBM Plex Sans som `.woff2` i `vendor/`) ble vurdert og valgt bort: 60 til 120 kB ekstra, en lisensfil til, og liten gevinst når grepet som teller er tabellsifre.

`font-variant-numeric: tabular-nums` settes på `body`, så alle tall i alle flater står i like brede sifre og kolonner flukter. Det er den viktigste typografiske endringen.

| Token         | Størrelse                         | Bruk                                                          |
| ------------- | --------------------------------- | ------------------------------------------------------------- |
| `--text-xs`   | 12 px                             | aksetekst, tidsstempel, metadata i header                     |
| `--text-sm`   | 14 px                             | brødtekst i popup (350 px bred), hjelpetekst i skjemakort     |
| `--text-base` | 15 px                             | brødtekst, nav, knapper, nøkkeltall-lister                    |
| `--text-md`   | 18 px                             | forklarende setning under hovedtall, sidetittel, regnestykket |
| `--text-lg`   | 24 px                             | seksjonsoverskrift                                            |
| `--text-xl`   | 32 px                             | hovedtall i popup                                             |
| `--text-hero` | 44 px (34 px under 720 px bredde) | hovedtallet i Kostnader og Bilregnestykket                    |

Bare to vekter: 400 og 600. Tall i lister og regnestykker står i 600. Hovedtall har `letter-spacing: -0.01em` og `line-height: 1.1`, alt annet har normal sperring og `line-height: 1.5`. Ingen store bokstaver, ingen sperrede etiketter, ingen små overskrifter over overskrifter. Alt i sentence case. Brødtekst holdes under 68 tegn bredde (`--measure`).

Årsoppsummeringen har sine egne store størrelser (årstall 96 px, hovedtall 56 px, 64 og 40 px på smal skjerm) som lokale verdier i `summary.css`. Den bruker samme familie og vekter, og etikettene der går også fra store bokstaver til sentence case.

## Avstand, hjørner og linjer

Avstandsskala på 4 px: `--space-1` 4, `--space-2` 8, `--space-3` 12, `--space-4` 16, `--space-5` 24, `--space-6` 32, `--space-7` 48, `--space-8` 64. Seksjoner har 48 px luft over og under og en 1 px border mellom seg. Innhold i paneler har 16 px vertikalt og 24 px horisontalt.

Ett hjørne: `--radius: 2px` overalt, også i popup og årsoppsummering. Det matcher flex-utvidelsen. Ingen skygger noe sted. Paneler skilles fra flaten med 1 px `--color-border`. Kontroller som skal kunne ses som kontroller, har 1 px `--color-border-strong`.

Innhold er venstrejustert. Tall i tabeller og nøkkeltall-lister er høyrejustert. Ingenting sentreres, unntatt i årsoppsummeringen, der hver slide er én påstand midt på skjermen.

## Layout

Dashboardet beholder én lang side med sticky nav og ni seksjoner. Seksjonene får ulik vekt i stedet for samme kortrutenett:

```
Kostnader                                         Last ned bilde
14 200 kr
brukt på bildeling i 2025, fordelt på 61 turer.
[ årsvalg ]
+--------------------------------+   Snitt per tur        233 kr
| Månedlige kostnader            |   Median per tur       186 kr
|  ▆ ▇ ▃ ▇ ▅ █ ▇ ▃ ▄ ▆ ▂ ▇       |   Dyreste tur        1 140 kr
+--------------------------------+   Per kilometer       4,10 kr
```

```
Bilregnestykket                                   Last ned bilde
ca. 38 000 kr
mindre per år enn å eie en tilsvarende bil.

Egen bil, per år              ca. 52 200 kr
Bildeling, per år             − 14 200 kr
──────────────────────────────────────────
Forskjell                     ca. 38 000 kr
Hva «egen bil» betyr, i én setning.
Slik beregner vi
```

Kostnader-hovedtallet står uten «ca.» fordi det er summen av faktiske beløp (`price.total`). «ca.» står bare foran estimater: Bilregnestykket, egen bil-kostnaden og CO₂-tallene.

Bilregnestykket settes som et faktisk regnestykke, med strek over summen og summen i aksentfarge. Det er det ene grepet i designet som skal huskes, og det kommer rett fra seksjonens navn. Brukeren spør «lønner det seg?», og et regnestykke med strek over summen svarer slik folk regner selv. Sammenligningen mot Volvo EX C40 blir et andre, mindre regnestykke under det første, uten eget hovedtall.

Støtteseksjonene (Bruksmønster, Bookingmønster, Kilometer, Trender, Turkategorier, Klima, Transport) har ikke hovedtall. De får seksjonsoverskrift, diagram i panel og nøkkeltall som en to-kolonners liste (`<dl>`) med etikett til venstre og tall til høyre, delt med 1 px linjer. Kortrutenettet (`.cards--2`, `.cards--3`) går ut. Rangerte lister (mest brukte biler, stasjoner) er nummererte lister der nummeret står i tekstfarge tertiary, ikke i en farget sirkel.

Under 720 px bredde stables diagram og nøkkeltall. Nav scroller horisontalt.

Popup (350 px): brødtekst i `--text-sm`, fordi 15 px gir for få tegn per linje i 350 px. Tittel i surface-header, så månedens beløp som hovedtall i 32 px med én setning under («denne måneden, 6 turer. Forrige måned 920 kr.»), så de øvrige tallene som `<dl>`, så sparkline, så en fot med tidsstempel på egen linje og to like brede knapper: «Synkroniser» (sekundær) og «Åpne dashboard» (primær).

Årsoppsummeringen: alltid mørk, en påstand per slide, sentrert. Spart-slidene bruker `--color-accent` i stedet for grønt.

## Komponenter

**Knapper.** Tre varianter og en lenkeknapp, alle 2 px hjørner, 15 px, vekt 600, polstring 8 × 12 px.
- Primær: accent-bakgrunn, on-accent tekst. Bare én per flate: «Synkroniser» i dashboardet, «Åpne dashboard» i popupen.
- Sekundær: surface-bakgrunn, 1 px border-strong, tekstfarge. Hover: sunken.
- Fare: som sekundær, men tekst og kant i danger.
- Stille (lenkeknapp): ingen kant, aksentfarget tekst med understrek. Brukes til «Last ned bilde» og «Slik beregner vi».
- Deaktivert: disabled-bg, disabled-text, border i `--color-border`. Ingen `opacity`.
- Fokus: `outline: 2px solid var(--color-accent); outline-offset: 2px` på `:focus-visible`, på alle knapper, lenker og skjemafelt.

Eksportknappen er i dag et ikon med bare `title`. Den får synlig tekst, «Last ned bilde», og ikonet går ut.

**Faner og årsvalg.** Nav-lenker i tekst-secondary. Aktiv seksjon får aksentfarget tekst, vekt 600 og 2 px aksentlinje under, og `aria-current="true"`. Ingen bakgrunnspille. Årsvalget («Alle», 2024, 2025) er en rad sekundærknapper der valgt år har accent-soft-bakgrunn, aksentfarget tekst og `aria-pressed="true"`.

**Paneler.** Surface, 1 px border, 2 px hjørner. Ingen hover-effekt, ingen løft, ingen skygge. Diagramtittelen står i panelet som `h3` i 15 px vekt 600.

**«Slik beregner vi».** Stille knapp med `aria-expanded`. Innholdet åpnes under i tekst-secondary med maks 68 tegn bredde, kildene som vanlige lenker. Pilen `▸` i knappeteksten går ut, `aria-expanded` og innholdet som dukker opp er nok.

**Skjemafelt** (Transport, Egne nøkkelord): surface-bakgrunn, 1 px border-strong, 2 px hjørner, tekst høyrejustert i tallfelt. «Lagret» vises som tekst ved siden av knappen i tekst-secondary og forsvinner ikke av seg selv.

**Egne nøkkelord** (Turkategorier). Et panel bygd på `<details>`/`<summary>`, lukket som standard.

- Summary-linjen er en `h3`-lik tittel i 15 px vekt 600 med totalen («24 ord i 6 kategorier») i tekst-secondary etter. Nettleserens egen markør beholdes, så det trengs ingen tegnet pil og ingen `::-webkit-details-marker`-regel. Fokus følger fokusregelen over, uten egen radius.
- Hjelpeteksten står under i `--text-sm` og tekst-secondary, maks 68 tegn bredde.
- Hver kategori er en rad i et rutenett: etikett, tekstfelt (skjemafeltregelen, men venstrejustert fordi det er tekst) og antall treff i tekst-secondary høyrejustert, med 1 px linje mellom radene. Under 480 px stables raden.
- Knapperaden har «Lagre» som sekundærknapp og «Eksporter JSON» og «Importer JSON» som stille knapper, siden primærknappen er brukt på «Synkroniser». Importknappen er en `<label>` rundt et visuelt skjult filfelt og får fokusringen via `:focus-within`.
- Statusmeldingen («Lagret», «Importerte 24 ord», feil ved ugyldig fil) står etter knappene med `role="status"` i tekst-secondary, og feil i danger.

`--radius-sm` og hover-regelen `.keyword-card:hover` går ut.

## Synk, fremdrift og feil

Synk er informasjon, ikke en advarsel. Banneret over innholdet er et panel i surface med 1 px border, en tekstlinje og en fremdriftslinje på 4 px: spor i sunken, fyll i accent, bredden er faktisk andel (`aria-valuenow` på et `role="progressbar"`). Teksten er konkret og følger fasen fra bakgrunnsscriptet:

- «Henter turlisten …»
- «Henter detaljer for 240 av 412 turer. Ferdige turer vises med en gang.»
- «Lagrer …»

Synk-knappen er deaktivert under henting og sier det samme kort: «Synkroniserer 240 av 412». Ikonet går ut, det spinner ikke. Banneret har `role="status"` så skjermlesere får fasebytter uten å avbrytes. Når synken er ferdig forsvinner banneret, og headeren viser «412 turer, sist synkronisert i dag kl. 09.14».

Feil bruker warning-bg og warning-text uten kant, `role="alert"`, og sier hva som skjedde og hva du gjør: «Fant ingen innlogging. Åpne app.dele.no, logg inn og trykk Synkroniser igjen.» Rate-limit: «Dele svarer sakte. Prøver igjen om 8 sekunder.» Ingen unnskyldninger, ingen «Oops».

## Tom tilstand og lasting

Tom tilstand (ingen data, ikke innlogget) er tekst, ikke illustrasjon: én linje i tekstfarge som sier hva som er, og én i secondary som sier hva du gjør. «Ingen turer lagret ennå. Logg inn på app.dele.no i en annen fane og trykk Synkroniser. Første henting tar et par minutter, og alt lagres bare i nettleseren.»

Under første synk vises seksjonene så snart de første turene er lagret. Tall som ennå mangler grunnlag, står som «Beregnes …» i tertiary i stedet for en strek. Diagrampaneler uten data får to eller tre statiske skjelettstriper i sunken. Ingen shimmer og ingen pulsering.

Inline tom tilstand i en seksjon («Ikke nok data for trendanalyse») sier hvor mye data som trengs: «Trender vises når du har turer fra minst to år.»

## Diagrammer

Chart.js-fargene hentes fra tokenene gjennom måleelementet beskrevet over, og hentes på nytt når `prefers-color-scheme` endrer seg (lytt på `matchMedia(...).change` og oppdater diagrammene).

- Maks fem farger, `--color-chart-1` til `-5`. Faste roller der det finnes faste kategorier: bildeling er alltid chart-1. Transport: bildeling 1, taxi 2, leiebil 3, buss 4, fly 5.
- Turkategorier: de fem største kategoriene får chart-1 til chart-5 i synkende rekkefølge etter beløp. Er det flere enn fem, samles resten som «Annet» i `--color-border-strong`, en nøytral grå som ikke er en chart-farge. «Annet» ligger alltid sist i diagrammet og i listen. Er det fem eller færre kategorier, finnes ikke «Annet». Ingen sjette chart-farge. «Annet» har omtrent samme lyshet som chart-3 (1,03 lys, 1,10 mørk), men er grå mot blå og står alltid sist med egen etikett.
- Én serie: chart-1, ingen forklaring. To serier (år mot år): valgt år som fylt søyle i chart-1, sammenligningsåret som hul søyle med 2 px kant i chart-3 (Chart.js: `backgroundColor: "transparent"`, `borderColor` chart-3, `borderWidth: 2`). Forklaringen over diagrammet viser de samme to formene. Fyll mot kant skiller seriene uten farge, og lysheten skiller dem i tillegg.
- Søyler med `borderRadius: 0`, ingen kant, unntatt sammenligningsserien over. Linjer 2 px uten fyll og uten gradient, punkter skjult til hover.
- Rutenett i `--color-grid`, bare horisontale linjer. Akselinjen (x) i border-strong. Aksetekst 12 px i tertiary.
- Kakediagram: kakestykker skilles med 2 px strek i surface. Etikett og beløp står i en liste ved siden av, ikke bare i forklaringen.
- Varmekart (ukedag × time): én kulør, accent, i fem trinn fra sunken til accent. Trinnene regnes ut i JS fra de to tokenene.
- Tooltip: surface-bakgrunn, 1 px border, tekstfarge, 2 px hjørner. Canvas-tooltips kan ikke sette tabellsifre; tallene der er korte nok til at det ikke merkes.
- Animasjon av: `animation: false` i Chart.js-standardene. Diagrammene tegnes ferdige.

## Sjekker som håndhever reglene

Det finnes ingen fargesjekk i repoet i dag. Del 2 legger to script i `stats/scripts/`, og begge kjøres før commit og skal være grønne:

- En fargesjekk som går gjennom `.css`, `.html` og `.js` under `stats/` (unntatt `vendor/`) og feiler med fil og linje når den finner en hex-farge (`#rgb`, `#rrggbb`) eller `rgb()`/`rgba()`/`hsl()` utenfor `stats/lib/tokens.css`. I HTML ser den bare i `<style>` og `style`-attributter, så ankerlenker som `#bad` ikke gir falske treff. Den feiler også på `box-shadow` og `text-shadow` med annen verdi enn `none`, på `border-radius` med annen verdi enn `var(--radius)` eller `0`, og på `!important`. Den er et lite script uten avhengigheter, i samme språk som kontrastscriptet.
- Kontrastscriptet, som leser `light-dark(a, b)` fra `tokens.css` og sjekker parene i tabellene over i begge moduser, chart-parene inkludert.

## Bevegelse

Ingen bevegelse som ikke svarer på noe brukeren gjør. Ingen hover-løft på kort, ingen inntoning per seksjon, ingen spinnende ikon, ingen diagramanimasjon. Det som får bevege seg: åpning av «Slik beregner vi» (høyde, 150 ms) og myk scroll ved klikk i nav. Begge legges inne i `@media (prefers-reduced-motion: no-preference)`, så redusert bevegelse gir null bevegelse uten `!important`.

## Hva som slettes

- `stats/debug.html` og `stats/debug.js`. `?dev=1`-panelet i dashboardet gjør samme jobb, `package.sh` holder dem allerede utenfor pakken, og de har farger inline. Kall-telleren som var tenkt der, hører hjemme i dev-panelet.
- Alle tokens listet under «Tokenene som forsvinner» (også `--radius-sm`, som nøkkelordkortet bruker i dag), og `--font-mono` unntatt for `<code>` i dev-panelet.
- `.card:hover`, `.cards--2`, `.cards--3`, `.comparison__vs`, `.comparison__verdict--saving/--more`, rangeringssirkelen, `@keyframes spin` og reduced-motion-blokken med `!important`.
- Separatoren `•` i headeren (headeren blir én setning).
- Ikonene i synk- og eksportknappene.

## Mot en generisk dashboard-prompt

Ber man om «et moderne dashboard for bildelingsstatistikk», får man nesten nøyaktig det som står i dag: hvit flate, blå eller lilla-til-blå aksent, avrundede kort med myk skygge i et tre-kolonners rutenett, et tall per kort med en etikett i sperrede store bokstaver over, grønt for sparing og rødt for kostnad, ikoner på alle knapper, hover-løft og inntoning ved scroll. Mørk modus blir blåsvart med samme kort. Årsoppsummeringen blir en «Wrapped»-kopi med gradienter. Valgene over går bevisst mot hvert av disse punktene.

Valgt bort: bundlet webfont, ikoner som pynt, gradienter, glassmorfisme, emoji i seksjonsoverskrifter, `01 / 02 / 03`-nummerering av seksjonene (de er ikke en rekkefølge), metastrenger med midtprikk, `→` etter lenker, og en egen dekorert «hero» øverst. Det øverste på siden er selve kostnaden.

## Flex

Flex deler token-systemet med stats (gråblå flate, hvite kort, tre nivåer tekst) og 2 px hjørner, men har Dele-lilla `#51289D` som aksent.

- Biltype og drivstoff er av/på-brikker, ikke nedtrekkslister. Småbil og Varebil er av som standard, resten på.
- Sjeldne filtre (biltype, drivstoff, gangavstand) ligger bak en sammenleggbar «Flere filtre», lukket som standard, med hint om aktive valg.
- «Søk» står i en egen fot (`.wish__foot`). Panelet er begrenset til vindushøyden og kroppen scroller inni, så Søk alltid synes.
- Tidslinjen tegner alle segmentene (grønn ledig, grå opptatt) med eget stylet verktøytips, ikke `title`.
- Tid velges med egen kalender og tid-lister, ikke `datetime-local`, som arver nettleserens locale og ga AM/PM og amerikansk format.
