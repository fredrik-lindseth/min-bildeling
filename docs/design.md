# Design for stats

Formreglene for `stats/`: dashboard, popup og årsoppsummering. `?demo=1` på hver side viser dem i bruk med oppdiktede tall (se [DEVELOPMENT.md](DEVELOPMENT.md)).

Tonen er nøktern, som en ryddig årsoppgave: tallet først, så en setning om hva det betyr, så grunnlaget. Eksempeltekster forutsetter ingen bestemt by eller stasjon, siden alle Bilparaplyen-organisasjoner på dele.no kan bruke utvidelsen. Bare Kostnader og Bilregnestykket har hovedtall.

## Tokens

Alle farger og størrelser står én gang i `stats/lib/tokens.css`, som lenkes inn før sidens egen CSS. Hver farge skrives som `light-dark(lys, mørk)` under `color-scheme: light dark`, så mørk modus følger systemet uten egen media-blokk. Fargene er hex uten alfa, så kontrasten kan måles. En ny farge trenger begge varianter og et par i `kontrast.sh`.

| Token                          | Brukes til                                            |
| ------------------------------ | ----------------------------------------------------- |
| `bg`                           | sidebakgrunn                                          |
| `surface`                      | header, nav, paneler, banner, tooltip                 |
| `sunken`                       | hover på sekundærknapp, fremdriftsspor                |
| `border`                       | 1 px skillelinjer og panelkant                        |
| `border-strong`                | kant på knapper og skjemafelt, x-akse, «Øvrige»       |
| `grid`                         | rutenett i diagrammer                                 |
| `text`                         | brødtekst og tall                                     |
| `text-secondary`               | etiketter, forklarende setninger                      |
| `text-tertiary`                | aksetekst, tidsstempel, rangeringsnummer              |
| `accent`, `accent-hover`       | primærknapp, lenker, aktiv fane, fokusring, fremdrift |
| `on-accent`                    | tekst på aksentflate                                  |
| `accent-soft`                  | valgt årsknapp                                        |
| `warning-bg`, `warning-text`   | feil og manglende innlogging                          |
| `danger`                       | destruktive handlinger, feil i skjema                 |
| `disabled-bg`, `disabled-text` | deaktivert knapp                                      |
| `demo-bg`, `demo-text`         | demomerket                                            |
| `chart-1` til `chart-5`        | diagramserier                                         |

Navnene har prefikset `--color-`. Lilla fra dele.no er eneste aksent, og sparing vises med den, ikke med grønt.

Samme fil har tekststørrelsene `--text-xs` (12 px) til `--text-hero` (44 px), `--measure` og avstandene `--space-1` til `--space-8` på en 4 px-skala.

### Kontrast

Tekst skal ha minst 4,5:1 mot flaten, kanter på kontroller, fremdrift og diagramfarger 3:1. Deaktivert tekst holdes også over 4,5. `stats/scripts/kontrast.sh` måler hvert par i begge moduser og feiler under kravet.

### Chart-paletten skiller på lyshet

De fem chart-fargene ligger på hvert sitt lyshetstrinn i begge moduser, så de kan skilles med nedsatt fargesyn og i gråtoner. `kontrast.sh` krever minst 1,3:1 mellom hvert par. Lilla finnes bare i chart-1. Fargen bærer likevel aldri informasjonen alene: kakestykker har etikett og beløp i en liste ved siden av, og sammenligningsserier tegnes hule.

## Form

Ett hjørne, `--radius` (6 px), overalt. Ingen skygger. Paneler skilles fra flaten med 1 px `--color-border`, kontroller har 1 px `--color-border-strong`. Ingen `!important`.

Én skriftfamilie, systemfonten (`--font-body`), i vektene 400 og 600. `font-variant-numeric: tabular-nums` står på `body`, så tall flukter i kolonner. Hovedtall har `line-height: 1.1` og `letter-spacing: -0.01em`, alt annet `line-height: 1.5`. Ingen store bokstaver eller sperrede etiketter, alt i sentence case. Brødtekst holdes innenfor `--measure`. Årsoppsummeringen har sine store størrelser som lokale variabler i `summary.css`.

Innhold er venstrejustert og tall i tabeller høyrejustert. Bare årsoppsummeringen sentrerer.

«ca.» står bare foran estimater (Bilregnestykket, egen bil, CO₂). Faktiske summer, som Kostnader og «I år hittil», står uten.

## Layout

Dashboardet er én side med sticky nav og seksjoner med 48 px luft og en 1 px linje mellom seg. Kostnader og Bilregnestykket har hovedtall i `--text-hero` med en setning under. Bilregnestykket settes som et regnestykke med strek over summen og summen i aksentfarge. Støtteseksjonene har diagram i panel og nøkkeltall som `<dl>` med 1 px linjer mellom radene. Rangerte lister er nummererte lister med nummeret i tertiary.

Under 720 px stables diagram og nøkkeltall, og nav ruller vannrett uten rullefelt. Seksjonene har `scroll-margin-top` regnet fra `--nav-height`, så ankre lander under navigasjonen.

Popupen er 350 px bred og får rullefelt over 600 px. Derfor har den brødtekst i `--text-sm`, strammere luft og ingen header, og «Slik beregnes det» lenker til panelet i dashboardet.

I årsoppsummeringen er hver slide én skjermhøyde med `scroll-snap-type: y mandatory`, og mellomrom, PageDown og piltastene går én slide om gangen.

## Komponenter

Knapper (`.btn`) har 15 px tekst i vekt 600, surface-bakgrunn, kant i border-strong og sunken ved hover. Variantene:

- Primær: accent med on-accent-tekst. Én per flate, «Synkroniser» i dashboardet og «Åpne dashboard» i popupen.
- Fare: tekst og kant i danger.
- Stille: ingen kant, aksentfarget tekst med understrek. For «Last ned bilde», «Slik beregnes det» og lignende.
- Deaktivert: disabled-bg og disabled-text, aldri `opacity`.

Knapper har synlig tekst, ikke ikoner.

Fokus er `outline: 2px solid var(--color-accent); outline-offset: 2px` på `:focus-visible`. Nav-lenkene har ringen innenfor (`outline-offset: -2px`), fordi raden klipper alt utenfor.

Nav-lenker står i text-secondary, og aktiv seksjon får aksenttekst, vekt 600, 2 px linje under og `aria-current="true"`. Årsvalget er sekundærknapper der valgt år har accent-soft-bakgrunn, aksenttekst og `aria-pressed="true"`.

Paneler er surface med 1 px border, uten hover-effekt. Diagramtittelen er en `h3` i 15 px vekt 600.

«Slik beregnes det» er en stille knapp med `aria-expanded` (en `<details>` i årsoppsummeringen). Panelet bygges av `lib/method-panel.js`: en innledende setning, en tabell med Hva, Verdi og Kilde, merknader og en nummerert kildeliste med dato. Verdiene er konstantene regnestykket bruker, bundet av `test/method-panel.test.js`.

Tabeller («Per år» i Trender) har 1 px linjer mellom radene, kolonneoverskrifter i 12 px tertiary, tall høyrejustert i 600 og «–» i tomme celler. Sorterbare overskrifter er knapper med `aria-sort` på `<th>`. Smale skjermer ruller tabellen vannrett.

Skjemafelt har surface, 1 px border-strong og høyrejustert tekst i tallfelt. «Lagret» (`role="status"`) forsvinner når et felt endres, aldri på tid.

Ordlisten i «Nøkkelord og kategorier» har hver kategori som en `<details>` med nummeret i tertiary foran navnet, i den rekkefølgen kategoriene prøves. Ordene står i et rutenett med flere kolonner når det er plass og én kolonne på smale skjermer (målene står i `dashboard.css`), med treff og tagger («egen», «helt ord», «også sist i ord») i tertiary 12 px. «Fjern» er en stille knapp. Fjernede standardord står sist, gjennomstreket i tertiary med «Ta tilbake». Sletting og tilbakestilling bekreftes i dialogen.

### `[hidden]` og display

En klasse som setter `display`, slår `hidden`-attributtet, og elementet blir stående synlig. Skjules en slik klasse med `hidden`, trenger den sin egen regel:

```css
.status[hidden] {
  display: none;
}
```

Dashboardet har det for `.status`, `.btn`, `.lead__number`, `.figures > div`, `.transport-year` og `.transport-empty`, popupen for `.method-link`.

## Synk og feil

Synkbanneret er et panel med `role="status"`, én konkret tekstlinje («Henter detaljer for 240 av 412 turer …») og en 4 px fremdriftslinje i accent på sunken. Fremdriften står bare der, så synkknappen sier bare «Synkroniserer…». At et annet vindu synker, er aldri en feil.

Feil bruker warning-bg og warning-text uten kant, `role="alert"`, og sier hva som skjedde og hva brukeren gjør. «Prøv igjen» står bare ved ekte feil. Manglende innlogging har tre tilstander i `lib/auth-state.js`, hver med overskrift, én setning og én knapp.

## Foreløpige tall

Så lenge synken har turer i køen (`syncState.pendingIds`), blir tall over hele historikken feil uten at det synes. De holdes tilbake med en kort tekst, ikke vist med et merke, for et tall merket «foreløpig» leses likevel som tallet. Regelen er `historyProgress()` og teksten `describeIncompleteHistory()` i `lib/sync-messages.js`. Popupen viser «–» for «Mest brukte bil» og «Spart i år». Dashboardet holder tilbake totalen og årslinjene i Kostnader, mest brukte biler, «År mot år», «Per år» og hele Bilregnestykket. Månedstallene står, siden turene hentes nyest først.

## Tomme tilstander

Tom tilstand er tekst: én linje i text om hva som er, og én i text-secondary om hva brukeren gjør. Inline tom tilstand sier hvor mye data som trengs («Trender vises når du har turer fra minst tre måneder.»). Et panel som bare gir mening med mer data, skjules i stedet for å stå tomt: «År mot år», «Per år» og «Sesongsammenligning» kommer først med turer fra to år. Min transport slås sammen til én linje med knappen «Legg inn tall» når det valgte året ikke har tall for andre transportmidler.

## Diagrammer

Chart.js forstår ikke `light-dark()`, så fargene hentes med `resolveColor()` i `lib/chart-helpers.js`, som gir ferdig `rgb()`. Diagrammene tegnes på nytt ved bytte av modus.

- Maks fem farger, `--color-chart-1` til `-5`, og bildeling er alltid chart-1. Transport: taxi 2, leiebil 3, buss 4, fly 5, egen bil og sykkel i border-strong.
- Turkategorier: de fem største får chart-1 til -5 etter beløp, også når noen av dem er egne kategorier. Resten samles sist som «Øvrige» i border-strong, aldri en sjette farge.
- År mot år: siste år fylt i chart-1, årene før hule med 2 px kant i chart-3, -5, -2 og -4, nærmeste år først.
- Søyler har `borderRadius: 0`. Linjer er 2 px uten fyll, gradient eller glatting (`tension: 0`).
- Rutenett i grid, bare vannrett. X-akse i border-strong, aksetekst 12 px i tertiary.
- Kakestykker skilles med 2 px strek i surface.
- Varmekartet har fem trinn fra sunken til accent.
- Tooltip i surface med 1 px border og tekstfarge.
- `animation: false`.

## Bevegelse

Bare det som svarer på en handling beveger seg: myk scroll ved klikk i nav og fremdriftslinjen i synkbanneret. Begge ligger i `@media (prefers-reduced-motion: no-preference)`, så redusert bevegelse gir ingen bevegelse uten overstyring.

## Sjekker

Begge sjekkene skal være grønne før commit, og `package.sh` kjører dem.

`sjekk-stil.sh` går gjennom `.css`, `.html` og `.js` under `stats/` (ikke `vendor/`, `test/` eller `dist/`) og feiler med fil og linje på fargeverdier (`#hex`, `rgb()`, `hsl()`) utenfor `tokens.css`, på `box-shadow` og `text-shadow` annet enn `none`, på `border-radius` annet enn `var(--radius)` eller `0`, og på `!important`.

`kontrast.sh` leser `light-dark()` fra `tokens.css` og måler parene sine i begge moduser, chart-parene inkludert.

## Flex

Flex har eget `:root` i `flex/finder.css`, samme lilla aksent, og stats-sjekkene gjelder ikke der. Biltype og drivstoff er av/på-brikker. Sjeldne filtre ligger bak en lukket «Flere filtre», og «Søk» står i en fot som alltid synes. Tid velges med egen kalender, fordi `datetime-local` arver nettleserens locale og gir AM/PM.
