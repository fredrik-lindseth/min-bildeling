# Bildeleringen Stats

Nettleserutvidelse som viser hva Bildeleringen koster deg og hvordan du bruker det.

## Funksjoner

- **Popup**: månedsforbruk, snittpris, mest brukte bil og besparelse.
- **Dashboard** med grafer:
  - Kostnader (måned, år, per tur, per km)
  - Bruksmønster (heatmap, turer per måned, mest brukte biler)
  - Bookingmønster (forhåndsvarsel, mest brukte stasjoner, andel siste liten)
  - Kilometer (distanse, per bil, lengste tur)
  - Trender (år mot år, rullerende snitt, sesong)
  - Bilregnestykket (bildeling mot egen bil, også Volvo EX40)
  - Turkategorier (sortert automatisk etter turnotatene)
  - Klimaregnskap (CO₂ per drivstofftype og bil)
  - Transportkalkulator (taxi, leiebil, buss, fly, sykkel, totalbilde)
- **Årsoppsummering**: året ditt, én side per tall.
- **PNG-eksport** av hver seksjon.

## Slik ser det ut

Bildene viser ekte bruk, unntatt Turkategorier og Transport, som viser demodata.

### Popup

![Popupen med forbruket denne måneden og de siste seks månedene](skjermbilder/popup-mork.png)

### Dashboard

![Kostnader per måned, i år hittil, snitt per år og dyreste år](skjermbilder/seksjon-kostnader.png)

![Bruksmønster: turer per ukedag og klokkeslett, og mest brukte biler](skjermbilder/seksjon-bruksmonster.png)

![Bookingmønster: hvor lang tid i forveien, og mest brukte stasjoner](skjermbilder/seksjon-bookingmonster.png)

![Kilometer per måned og per bil](skjermbilder/seksjon-kilometer.png)

![Trender: år mot år, glidende snitt, sesong og tabell per år](skjermbilder/seksjon-trender.png)

![Bilregnestykket: bildeling mot å eie en Volvo EX40](skjermbilder/seksjon-bilregnestykket.png)

![Turkategorier med forslag fra turnotatene](skjermbilder/seksjon-turkategorier.png)

![Klimaregnskap: CO₂ per måned og per drivstofftype](skjermbilder/seksjon-klima.png)

![Min transport: bildeling sammen med taxi, buss og fly](skjermbilder/seksjon-transport.png)

![Sikkerhetskopi: eksport og import](skjermbilder/seksjon-sikkerhetskopi.png)

### Årsoppsummering

![Brukt på bildeling i året](skjermbilder/oppsummering-brukt.png)

![Kilometer kjørt i året](skjermbilder/oppsummering-kjort.png)

![Favorittbilen i året](skjermbilder/oppsummering-favorittbil.png)

![Den travleste måneden](skjermbilder/oppsummering-travleste.png)

![Spart mot å eie bil](skjermbilder/oppsummering-spart.png)

![CO₂-utslipp i året](skjermbilder/oppsummering-co2.png)

## Installasjon

Last ned `.zip` fra [Releases](https://github.com/fredrik-lindseth/bildeleringen-stats/releases).

I Firefox:

1. Gå til `about:debugging#/runtime/this-firefox`
2. Klikk «Last inn midlertidig tillegg...»
3. Velg `.zip`-filen

I Chrome (123 eller nyere), med `-chrome`-zip-en:

1. Pakk ut zip-filen
2. Gå til `chrome://extensions` og slå på Utviklermodus
3. Klikk «Last inn upakket» og velg mappen

Du må være innlogget på [app.dele.no](https://app.dele.no). Første synk tar noen minutter hvis du har mange turer. La dashboardet stå åpent til den er ferdig.

## Personvern

Alt lagres lokalt i nettleseren. Den eneste trafikken er API-kall til dele.no med innloggingen du alt har. Ingen tredjeparter, ingen sporing. Hvilke kall som gjøres og hvor ofte, står i [docs/api-bruk.md](docs/api-bruk.md).

## Estimater

Eierkostnader og CO₂ er estimater fra norske kilder (NAF, Miljødirektoratet, TØI). «Slik beregnes det» i dashboardet viser utregningen og kildene.

## Utvikling

Se [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).
