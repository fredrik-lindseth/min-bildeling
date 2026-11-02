# Design for stats

Spesifikasjon for den visuelle retningen i `stats/`: dashboard, popup og årsoppsummering. Den er gjennomført, og omskrivingen kalles del 2 under. `?demo=1` på hver av sidene viser designet i bruk med oppdiktede tall (se [DEVELOPMENT.md](DEVELOPMENT.md)).

## Hva det er, og for hvem

Et privat regnskap for bilbruk. Målgruppen er alle som er medlem i en Bilparaplyen-organisasjon på dele.no, ikke bare Bildeleringen i Bergen, så eksempeltekster skal ikke forutsette en bestemt by, stasjon eller lokal prisliste. Én person åpner det for å finne ut hva bildeling koster og om det lønner seg mot egen bil. Det er ikke et produkt-dashboard for et team, og ingen skal imponeres. Tonen er nøktern og tallfast, som en ryddig årsoppgave: tallet først, så en setning som sier hva det betyr, så grunnlaget for den som vil sjekke.

To tall er grunnen til at folk åpner siden: hva de har brukt (Kostnader) og hva de sparer mot egen bil (Bilregnestykket). De får den visuelle vekten. Resten av seksjonene er støttemateriale og skal se slik ut.

## Utgangspunktet

Slik står det i dag: systemfont uten bevisst skala, blå aksent (`#2a66ab` i lys modus, `#5a9de6` i mørk) som ikke har noe med Dele å gjøre, radius 6, 10 og 14 px, grå skygge under hvert kort, og identiske kort i rutenett i alle ni seksjoner. Etiketter står i store bokstaver med sperring. Popup og dashboard har hvert sitt `:root` med litt ulike verdier, og årsoppsummeringen har et tredje tokensett (`--sum-*`) som er hardkodet mørkt. `debug.html` har hex-farger inline.

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

`color-scheme: light dark` følger `prefers-color-scheme`, så regelen om mørk modus er oppfylt uten en egen media-blokk. Årsoppsummeringen bruker de samme tokenene og følger modusen som resten (se Layout). Da finnes det ett tokensystem, ikke tre.

Konsekvensene, slik del 2 løste dem:

- `light-dark()` krever minst Firefox 120. `strict_min_version` er likevel 140, siden AMO krever det for `data_collection_permissions`. I Chromium kom støtten i Chrome 123, og skal utvidelsen lastes der, settes `minimum_chrome_version` til minst 123.
- `getComputedStyle().getPropertyValue("--color-x")` gir tilbake selve `light-dark(...)`-teksten, som Chart.js ikke forstår. `chart-helpers.js` må løse fargen gjennom et skjult måleelement: sett `style.color = "var(--color-x)"` og les `getComputedStyle(el).color`, som da er en ferdig `rgb()`.
- Eksporten via html2canvas leser beregnede stiler, som skal være ferdig løste `rgb()`-verdier. Verifisert i Firefox i begge moduser: fargene kommer riktig ut. html2canvas plasserer derimot ordene der DOM-en målte dem, men tegner dem med en canvas-font uten tabellsifre, og med `devicePixelRatio` som ikke er et helt tall forsvinner mellomrommene mellom ord. Kopien som tegnes til bilde får derfor klassen `export` med vanlige sifre og en `letter-spacing` på 0,01 px, som får html2canvas til å tegne tegn for tegn på DOM-posisjonene. Skulle `light-dark()` likevel svikte et sted, er reserveløsningen en vanlig `@media (prefers-color-scheme: dark)`-blokk.
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

Aksenten i mørk modus er en lysere lilla fordi `#51289D` gir 1,6:1 mot den mørke flaten. Primærknappen i mørk modus får derfor mørk tekst på lys lilla.

Tokenene som forsvinner: `--color-accent-light`, `--color-header-*`, `--color-nav-*`, `--color-status-*` (banneret bruker surface og border), `--color-progress-*`, `--color-btn-sync-*`, `--color-btn-secondary-*`, `--color-card-shadow`, `--color-shadow`, `--color-heatmap-text`, `--color-empty-text`, `--color-link`, `--color-rank-*`, `--color-section-divider`, `--color-secondary`, `--color-tertiary`, `--color-saving-bg`, `--color-danger-hover`, `--color-danger-bg`, alle `--shadow-*`, `--radius-sm/md/lg` og alle `--sum-*`. Grønn som «sparing»-farge går ut. Sparing vises med aksenten, så grønt ikke blir et eget signal som bare finnes ett sted, og rød mot grønn faller bort for fargeblinde.

### Kontrast

Målt med WCAG 2-formelen i et lite `python3 -I`-script. `stats/scripts/kontrast.sh` gir de samme tallene. Krav: 4,5:1 for tekst, 3:1 for kanter på kontroller og diagramelementer.

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
| `--text-hero` | 44 px (34 px under 720 px bredde) | hovedtallet i Kostnader og Bilregnestykket                    |

Bare to vekter: 400 og 600. Tall i lister og regnestykker står i 600. Hovedtall har `letter-spacing: -0.01em` og `line-height: 1.1`, alt annet har normal sperring og `line-height: 1.5`. Ingen store bokstaver, ingen sperrede etiketter, ingen små overskrifter over overskrifter. Alt i sentence case. Brødtekst holdes under 68 tegn bredde (`--measure`).

Årsoppsummeringen har sine egne store størrelser (årstall 96 px, hovedtall 56 px, 64 og 40 px på smal skjerm) som lokale verdier i `summary.css`. Den bruker samme familie og vekter, og etikettene der går også fra store bokstaver til sentence case.

## Avstand, hjørner og linjer

Avstandsskala på 4 px: `--space-1` 4, `--space-2` 8, `--space-3` 12, `--space-4` 16, `--space-5` 24, `--space-6` 32, `--space-7` 48, `--space-8` 64. Seksjoner har 48 px luft over og under og en 1 px border mellom seg. Innhold i paneler har 16 px vertikalt og 24 px horisontalt.

Ett hjørne: `--radius: 6px` overalt, også i popup og årsoppsummering, som Firefox sine egne paneler. Ingen skygger noe sted. Paneler skilles fra flaten med 1 px `--color-border`. Kontroller som skal kunne ses som kontroller, har 1 px `--color-border-strong`.

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

Med «Alle år» valgt og turer fra minst to år får nøkkeltallene tre linjer om årene øverst, og en lenke til tabellen «Per år» i Trender under listen:

```
I år hittil                                  25 500 kr
24 % mindre enn samme tid i fjor
Snitt per år                                 36 200 kr
Fra første tur i januar 2024 til i dag.
Dyreste år, 2025                             39 600 kr
Snitt per tur                                   579 kr
...
Se alle år
```

«I år hittil» regner fra 1. januar til nå og sammenligner med samme øyeblikk i fjor, så framtidige bookinger ikke teller. «Snitt per år» er summen av turene delt på tiden siden første tur, og vises først etter ett år. Begge står uten «ca.»: det er faktiske beløp over faktisk tid, ikke estimater. Velges ett år, forsvinner linjene og lenken.

```
Bilregnestykket                                   Last ned bilde
ca. 96 000 kr
mindre per år enn å eie en Volvo EX40.

Volvo EX40, per år           ca. 110 000 kr
Bildeling, per år             − 14 200 kr
──────────────────────────────────────────
Forskjell                     ca. 96 000 kr
Hvilken bil det regnes mot, i én setning.
Slik beregnes det
```

Tallene i skissene er oppdiktede og viser bare formen. Forutsetningene for bilen står i `stats/lib/referansebil.js`.

Kostnader-hovedtallet står uten «ca.» fordi det er summen av faktiske beløp (`price.total`). «ca.» står bare foran estimater: Bilregnestykket, egen bil-kostnaden og CO₂-tallene.

Bilregnestykket settes som et faktisk regnestykke, med strek over summen og summen i aksentfarge. Det er det ene grepet i designet som skal huskes, og det kommer rett fra seksjonens navn. Brukeren spør «lønner det seg?», og et regnestykke med strek over summen svarer slik folk regner selv. Sammenligningen mot Volvo EX40 blir et andre, mindre regnestykke under det første, uten eget hovedtall.

Støtteseksjonene (Bruksmønster, Bookingmønster, Kilometer, Trender, Turkategorier, Klima, Transport) har ikke hovedtall. De får seksjonsoverskrift, diagram i panel og nøkkeltall som en to-kolonners liste (`<dl>`) med etikett til venstre og tall til høyre, delt med 1 px linjer. Kortrutenettet (`.cards--2`, `.cards--3`) går ut. Rangerte lister (mest brukte biler, stasjoner) er nummererte lister der nummeret står i tekstfarge tertiary, ikke i en farget sirkel.

Under 720 px bredde stables diagram og nøkkeltall. Nav scroller horisontalt uten synlig rullefelt (`scrollbar-width: none`), og demomerket står utenfor den rullende raden. Seksjonene har `scroll-margin-top` lik navigasjonens høyde pluss 16 px, der høyden regnes av tokenene (`--nav-height` i dashboard.css), så et anker som `#bilregnestykket` lander under navigasjonen og ikke bak den. Verdiaksene i diagrammene har `autoSkipPadding: 12`, så «20 000» og «40 000» ikke går i ett på en smal akse.

Popup (350 px): brødtekst i `--text-sm`, fordi 15 px gir for få tegn per linje i 350 px. Firefox gir popupen høyst 600 px før den får rullefelt, så luften er strammere enn i dashboardet: 12 px rundt innholdet, 4 px i nøkkeltall-listen, diagram på 88 px og knapper på 36 px. Med demodata er den 392 px høy uten synkbanner og 494 px med et banner på tre linjer, sist synkronisert og begge knappene (målt 1. november 2026). Ingen tittel og ingen header: utvidelsens navn står alt i verktøylinjen, så popupen begynner rett på månedens beløp som hovedtall i `--text-lg` (24 px) med én setning under («denne måneden, 6 turer. Forrige måned 920 kr.»), så de øvrige tallene som `<dl>`, så sparkline, så en fot med tidsstempel på egen linje og to like brede knapper: «Synkroniser» (sekundær) og «Åpne dashboard» (primær).

Årsoppsummeringen: en påstand per slide, sentrert. Spart-slidene bruker `--color-accent` i stedet for grønt. Den følger lys eller mørk modus som dashboardet. Den var alltid mørk, som en «Wrapped»-visning, men det er nettopp kopien «Mot en generisk dashboard-prompt» advarer mot, og den byttet modus midt i flyten for den som åpnet den fra et lyst dashboard. Tokenene holder kontrastkravene i begge moduser, så det kostet ingenting å la den følge brukerens valg. Hver slide er nøyaktig én skjermhøyde (`100dvh`) med `scroll-snap-type: y mandatory` på dokumentet. Mellomrom, Shift+mellomrom, PageDown, PageUp og piltastene går én slide om gangen, uten animasjon ved redusert bevegelse. I årsvelgeren, på lenker og på «Slik beregnes det» virker tastene som vanlig. Metodesliden kan bli høyere enn skjermen når den åpnes.

## Komponenter

**Knapper.** Tre varianter og en lenkeknapp, alle 2 px hjørner, 15 px, vekt 600, polstring 8 × 12 px.
- Primær: accent-bakgrunn, on-accent tekst. Bare én per flate: «Synkroniser» i dashboardet, «Åpne dashboard» i popupen.
- Sekundær: surface-bakgrunn, 1 px border-strong, tekstfarge. Hover: sunken.
- Fare: som sekundær, men tekst og kant i danger.
- Stille (lenkeknapp): ingen kant, aksentfarget tekst med understrek. Brukes til «Last ned bilde» og «Slik beregnes det».
- Deaktivert: disabled-bg, disabled-text, border i `--color-border`. Ingen `opacity`.
- Fokus: `outline: 2px solid var(--color-accent); outline-offset: 2px` på `:focus-visible`, på alle knapper, lenker og skjemafelt. Nav-lenkene har ringen innenfor (`outline-offset: -2px`), fordi navigasjonen ruller vannrett og klipper alt utenfor linjen. Tastaturfokus er målt i dashboard, popup, årsoppsummering, bekreftelsesdialogen og nøkkelordkortet i begge moduser: rekkefølgen følger siden ovenfra, og ingen fokusert kontroll står uten ring eller under den faste navigasjonen.

Eksportknappen er i dag et ikon med bare `title`. Den får synlig tekst, «Last ned bilde», og ikonet går ut.

**Faner og årsvalg.** Nav-lenker i tekst-secondary. Aktiv seksjon får aksentfarget tekst, vekt 600 og 2 px aksentlinje under, og `aria-current="true"`. Ingen bakgrunnspille. Årsvalget («Alle», 2024, 2025) er en rad sekundærknapper der valgt år har accent-soft-bakgrunn, aksentfarget tekst og `aria-pressed="true"`.

**Paneler.** Surface, 1 px border, 2 px hjørner. Ingen hover-effekt, ingen løft, ingen skygge. Diagramtittelen står i panelet som `h3` i 15 px vekt 600.

**«Slik beregnes det».** Stille knapp med `aria-expanded` (i årsoppsummeringen en `<details>`). Pilen `▸` i knappeteksten går ut, `aria-expanded` og innholdet som dukker opp er nok. Innholdet er ett felles panel i alle flatene, bygd av `lib/method-panel.js` og stilt i `lib/method-panel.css`, i tekst-secondary med maks 68 tegn bredde:

- én innledende setning om hva som regnes,
- en tabell med kolonnene Hva, Verdi og Kilde: én faktor per rad, verdien i 600 og tekstfarge, kilden som et fotnotenummer som lenker til kildelisten,
- korte merknader under tabellen, med bokstav når de hører til en rad («bare utslipp fra eksos», «Hordaland-tallet brukes også for Trøndelag») og uten når de gjelder hele metoden,
- kildelisten, nummerert, med lenke og dato. En kilde uten kjent dato står som «udatert».

Metodene er rene data ved siden av regnestykket (`CO2_METHOD`, `TRANSPORT_METHOD`, `OWNERSHIP_METHOD`, `BOOKING_METHOD`), og verdiene i tabellen er de samme konstantene som regnestykket bruker. `test/method-panel.test.js` binder dem. Kildekolonnen er bare et tall, og etiketten brytes framfor verdien, så tabellen holder også i smale kolonner. Popupen viser ikke panelet: Firefox gir den høyst 600 px, og tabellen for bilregnestykket er lengre, så «Slik beregnes det» ved «Spart i år» åpner panelet i bilregnestykket i dashboardet (`dashboard.html#ownership-method-detail`).

**Tabeller.** «Per år» i Trender er den ene datatabellen i dashboardet, satt som tabellen i «Slik beregnes det»: 1 px linjer mellom radene, kolonneoverskriftene i 12 px tertiary over en linje i border-strong, året til venstre i tekst-secondary og tallene høyrejustert i 600. Tom celle er «–». Overskriftene er knapper med `aria-sort` på `<th>`, og pilen ↑ eller ↓ står etter kolonnen det sorteres på. Første klikk på en tallkolonne sorterer synkende, på År stigende, og neste klikk snur. Standard er år stigende. Smale skjermer ruller tabellen vannrett i stedet for å bryte tallene.

**Skjemafelt** (Transport, Egne nøkkelord): surface-bakgrunn, 1 px border-strong, 2 px hjørner, tekst høyrejustert i tallfelt. «Lagret» vises som tekst ved siden av knappen i tekst-secondary. Den forsvinner ikke på tid, for en melding med tidsgrense rekker ikke alle å lese, men fjernes så snart et felt i skjemaet endres, siden den da ikke lenger stemmer.

**Egne nøkkelord** (Turkategorier). Et panel bygd på `<details>`/`<summary>`, lukket som standard.

- Summary-linjen er en `h3`-lik tittel i 15 px vekt 600 med totalen («24 ord i 6 kategorier») i tekst-secondary etter. Nettleserens egen markør beholdes, så det trengs ingen tegnet pil og ingen `::-webkit-details-marker`-regel. Fokus følger fokusregelen over, uten egen radius.
- Hjelpeteksten står under i `--text-sm` og tekst-secondary, maks 68 tegn bredde. Den sier at ord i notatet som begynner med et stoppord (`STOP_WORDS` i `categories.js`, i dag juli, konkurs, diskurs og kursiv), hoppes over, også for egne nøkkelord. Lista settes inn fra koden, så teksten ikke kan gå ut av takt med den. Egne nøkkelord går ikke forbi stoppordene: de finnes for at «jul» ikke skal treffe «juli», og det gjelder like mye et ord brukeren skriver selv.
- Hver kategori er en rad i et rutenett: etikett, tekstfelt (skjemafeltregelen, men venstrejustert fordi det er tekst) og antall treff i tekst-secondary høyrejustert, med 1 px linje mellom radene. Under 480 px stables raden.
- Knapperaden har «Lagre» som sekundærknapp og «Eksporter JSON» og «Importer JSON» som stille knapper, siden primærknappen er brukt på «Synkroniser». Importknappen er en `<label>` rundt et visuelt skjult filfelt og får fokusringen via `:has(:focus-visible)`, så ringen bare vises ved tastatur.
- Statusmeldingen («Lagret», «Importerte 24 ord», feil ved ugyldig fil) står etter knappene med `role="status"` i tekst-secondary, og feil i danger.

`--radius-sm` og hover-regelen `.keyword-card:hover` går ut.

## Synk, fremdrift og feil

Synk er informasjon, ikke en advarsel. Banneret over innholdet er et panel i surface med 1 px border, en tekstlinje og en fremdriftslinje på 4 px: spor i sunken, fyll i accent, bredden er faktisk andel (`aria-valuenow` på et `role="progressbar"`). Teksten er konkret og følger fasen fra synkmotoren:

- «Henter turlisten …»
- «Henter detaljer for 240 av 412 turer …»
- I popupen, som henter 25 om gangen: «Henter 18 av 662. Resten hentes i dashboardet.» Banneret i popupen er smalt, så teksten holdes på én linje.
- Når et annet vindu synker: «Et annet vindu henter detaljer for 240 av 412 turer …»

Fremdriften står ett sted, i banneret med linjen. Synk-knappen er deaktivert under henting og sier bare «Synkroniserer…», så samme teller ikke står to ganger. Ikonet går ut, det spinner ikke. Banneret har `role="status"` så skjermlesere får fasebytter uten å avbrytes. Når synken er ferdig forsvinner banneret, og headeren er én setning: «176 turer i 2024–2026 for 102 147 kr, sist synkronisert 1. nov. kl. 09:14».

Synker en annen side, venter siden stille og viser fremdriften fra `syncState`, og fortsetter selv når låsen blir ledig. Dashboardet tar alltid over fra popupen. Det er aldri en feil at et annet vindu synker, så det får verken advarsel eller «Prøv igjen». «Prøv igjen» står bare ved ekte feil. Et delvis resultat («Hentet 25 av 662. Resten hentes i dashboardet.») og turer som prøves igjen senere, står som vanlig melding uten knapp.

Feil bruker warning-bg og warning-text uten kant, `role="alert"`, og sier hva som skjedde og hva du gjør.

Mangler innloggingen, står én av tre tilstander i banneret, med overskrift, én setning og én knapp (`lib/auth-state.js`). Bare den første ber om innlogging:

- «Ikke innlogget. Logg inn på app.dele.no og trykk Synkroniser.» Knapp: «Åpne app.dele.no».
- «Tilgang mangler. Utvidelsen trenger tilgang til app.dele.no for å lese innloggingen.» Knapp: «Gi tilgang».
- «Fanen må lastes på nytt. Innloggingen i dele.no-fanen kan ikke leses før fanen er lastet inn på nytt.» Knapp: «Last inn fanen på nytt». Fanen lastes bare etter klikket, aldri av seg selv.

Ved rate-limit: «Dele svarer sakte. Prøver igjen om 8 sekunder.» Ingen unnskyldninger, ingen «Oops».

## Foreløpige tall

Så lenge synken har turer igjen i køen (`syncState.pendingIds` er ikke tom), mangler en del av historikken. Popupen henter 25 om gangen, så etter første åpning er 25 av kanskje 662 turer lagret. Tall som summerer over hele historikken blir da feil uten at det synes, og «Spart i år» blir for høyt fordi bildelingen ser billigere ut enn den er.

Løsningen er å holde slike tall tilbake med en kort tekst, ikke å vise dem med et merke. Et tall med «foreløpig» ved siden av leses likevel som tallet. Regelen er `historyProgress()` i `lib/sync-messages.js`, og teksten er `describeIncompleteHistory()`: «Spart i år og mest brukte bil vises når alle turene er hentet. Hentet 25 av 662.»

- Popupen: «Mest brukte bil» og «Spart i år» viser «–», med teksten under nøkkeltallene. «Slik beregnes det» skjules.
- Dashbordet: headeren sier «Hentet 25 av 662 turer» i stedet for antall, år og sum. Totalen og årslinjene i Kostnader, listen over mest brukte biler, «År mot år» og «Per år» i Trender og hele Bilregnestykket holdes tilbake.

Månedstallene står. Turene hentes nyest først, så siste måned er på plass først, og dashbordet fyller inn resten mens det synker.

## Tom tilstand og lasting

Tom tilstand (ingen data, ikke innlogget) er tekst, ikke illustrasjon: én linje i tekstfarge som sier hva som er, og én i secondary som sier hva du gjør. «Ingen turer lagret ennå. Logg inn på app.dele.no i en annen fane og trykk Synkroniser. Første henting tar et par minutter, og alt lagres bare i nettleseren.»

Ved første oppstart venter dashbordet med synken og spør først: «Har du en sikkerhetskopi? Importer den først, så slipper du å hente alt på nytt.» Under står to sekundærknapper, Importer og «Start synk», siden primærknappen er Synkroniser. Svaret på importen står i banneret etter synken.

Under første synk står en forklaring («Henter turene dine fra Dele. Første gang tar det et par minutter …») til de første turene er lagret. Da vises seksjonene, og de fylles inn etter hvert. Synken henter nyeste tur først, så allerede første opptegning har grunnlag for tallene og diagrammene i hver seksjon som vises.

«Beregnes …» på tall og skjelettstriper i diagrampaneler ble planlagt, men valgt bort. Med nyeste først finnes ikke tilstanden de skulle dekke: et tall eller et diagram uten grunnlag under synken har heller ikke grunnlag etterpå, og da er en strek eller en tom tilstand det riktige svaret. «Beregnes …» ville sagt at noe kommer som ikke kommer. Banneret med fremdriften sier at mer er på vei.

Inline tom tilstand i en seksjon sier hvor mye data som trengs, for eksempel «Trender vises når du har turer fra minst tre måneder.» Et panel som bare gir mening med mer data, skjules i stedet for å stå tomt: «År mot år», «Per år» og «Sesongsammenligning» vises først med turer fra to år.

Min transport slås sammen til én linje med knappen «Legg inn tall» når det valgte året ikke har tall for andre transportmidler, framfor å vise et tomt skjema og en oppsummering der bildelingen er alt.

## Diagrammer

Chart.js-fargene hentes fra tokenene gjennom måleelementet beskrevet over, og hentes på nytt når `prefers-color-scheme` endrer seg (lytt på `matchMedia(...).change` og oppdater diagrammene).

- Maks fem farger, `--color-chart-1` til `-5`. Faste roller der det finnes faste kategorier: bildeling er alltid chart-1. Transport: bildeling 1, taxi 2, leiebil 3, buss 4, fly 5.
- Turkategorier: de fem største kategoriene får chart-1 til chart-5 i synkende rekkefølge etter beløp. Er det flere enn fem, samles resten som «Øvrige» i `--color-border-strong`, en nøytral grå som ikke er en chart-farge. Navnet er ikke «Annet», fordi det alt er en av kategoriene. «Øvrige» ligger alltid sist i diagrammet. Er det fem eller færre kategorier, finnes ikke «Øvrige». Ingen sjette chart-farge. «Øvrige» har omtrent samme lyshet som chart-3 (1,03 lys, 1,10 mørk), men er grå mot blå og står alltid sist med egen etikett. Egen bil i Transport bruker den samme grå.
- Én serie: chart-1, ingen forklaring. To serier (år mot år): valgt år som fylt søyle i chart-1, sammenligningsåret som hul søyle med 2 px kant i chart-3 (Chart.js: `backgroundColor: "transparent"`, `borderColor` chart-3, `borderWidth: 2`). Forklaringen over diagrammet viser de samme to formene. Fyll mot kant skiller seriene uten farge, og lysheten skiller dem i tillegg. Med flere enn to år er bare siste år fylt, og årene før er hule i chart-3, chart-5, chart-2 og chart-4, nærmeste år først. «År mot år» viser de tre siste årene. Har brukeren flere, står den stille knappen «Vis alle år» ved tittelen (`aria-pressed`, teksten blir «Vis siste tre år»), og alle årene finnes uansett i tabellen «Per år».
- Søyler med `borderRadius: 0`, ingen kant, unntatt sammenligningsserien over. Linjer 2 px uten fyll, uten gradient og uten glatting (`tension: 0`), punkter skjult til hover. En glattet kurve finner opp verdier mellom målepunktene.
- Rutenett i `--color-grid`, bare horisontale linjer. Akselinjen (x) i border-strong. Aksetekst 12 px i tertiary.
- Kakediagram: kakestykker skilles med 2 px strek i surface. Etikett og beløp står i en liste ved siden av, ikke bare i forklaringen.
- Varmekart (ukedag × time): én kulør, accent, i fem trinn fra sunken til accent. Trinnene regnes ut i JS fra de to tokenene.
- Tooltip: surface-bakgrunn, 1 px border, tekstfarge, 2 px hjørner. Canvas-tooltips kan ikke sette tabellsifre; tallene der er korte nok til at det ikke merkes.
- Animasjon av: `animation: false` i Chart.js-standardene. Diagrammene tegnes ferdige.

## Sjekker som håndhever reglene

Tre sjekker i `stats/scripts/`, og `package.sh` kjører alle: byggevakten `sjekk-pakke.sh` på den ferdige pakken, `kontrast.sh` og `sjekk-stil.sh`. Kjør de to siste før commit, de skal være grønne:

- Stilsjekken (`sjekk-stil.sh`) går gjennom `.css`, `.html` og `.js` under `stats/` (unntatt `vendor/`, `test/` og `dist/`) og feiler med fil og linje når den finner en hex-farge (`#rgb`, `#rrggbb`) eller `rgb()`/`rgba()`/`hsl()` utenfor `stats/lib/tokens.css`. I HTML ser den bare i `<style>` og `style`-attributter, så ankerlenker som `#bad` ikke gir falske treff. Den feiler også på `box-shadow` og `text-shadow` med annen verdi enn `none`, på `border-radius` med annen verdi enn `var(--radius)` eller `0`, og på `!important`. Den er et lite script uten avhengigheter, i samme språk som kontrastscriptet.
- Kontrastscriptet leser `light-dark(a, b)` fra `tokens.css` og sjekker parene i tabellene over i begge moduser, chart-parene inkludert.

## Bevegelse

Ingen bevegelse som ikke svarer på noe brukeren gjør. Ingen hover-løft på kort, ingen inntoning per seksjon, ingen spinnende ikon, ingen diagramanimasjon. Det som får bevege seg: åpning av «Slik beregnes det» (høyde, 150 ms) og myk scroll ved klikk i nav. Begge legges inne i `@media (prefers-reduced-motion: no-preference)`, så redusert bevegelse gir null bevegelse uten `!important`.

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
