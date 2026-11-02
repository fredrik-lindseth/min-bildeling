# Chrome Web Store-listing for Bildeleringen Stats

Teksten som fylles inn i utviklerkonsollen på [chrome.google.com/webstore/devconsole](https://chrome.google.com/webstore/devconsole). Pakken er `stats/dist/bildeleringen-stats-chrome-v<versjon>.zip` fra `package.sh`.

## Butikkoppføring

- Navn: Bildeleringen Stats (fra manifestet)
- Språk: norsk bokmål
- Kategori: Verktøy, eventuelt Produktivitet
- Ikon: `stats/icons/icon-128.png`
- Promobilde, lite (440x280): `stats/icons/listing/promo-440x280.png`
- Skjermbilder (1280x800, inntil fem): fra `skjermbilder/butikk/`, for eksempel `seksjon-kostnader`, `seksjon-bilregnestykket`, `seksjon-bruksmonster`, `popup-lys` og `oppsummering-spart`
- Hjemmeside: https://github.com/fredrik-lindseth/bildeleringen-stats

Kort beskrivelse er `description` i manifestet. Lang beskrivelse:

```text
Er du medlem i Bildeleringen eller en annen Bilparaplyen-organisasjon på dele.no, viser utvidelsen statistikk over din egen bildeling:

- hva du bruker per måned og år, per tur og per kilometer
- når du kjører, hvilke biler du velger og hvor lang tid i forveien du booker
- et anslag over hva det ville kostet å eie bil selv
- CO₂ per drivstofftype og bil
- en årsoppsummering, én side per tall

Logg inn på app.dele.no som vanlig, og åpne utvidelsen. Første gang henter den alle turene dine, og det tar noen minutter hvis du har mange. Etterpå hentes bare nye turer.

Utvidelsen leser bare dine egne reservasjoner, med innloggingen du alt har på app.dele.no. Alt lagres i nettleseren din. Ingenting sendes til utvikleren eller til andre, og det finnes ingen sporing.

Utvidelsen er laget av et medlem og er ikke tilknyttet eller godkjent av Dele AS.
```

## Personvernpraksis

Enkeltformål:

```text
Viser statistikk over brukerens egne turer i bildelingsordninger på dele.no: kostnader, kjøremønster, et anslag over egen bil og CO₂.
```

Begrunnelse per tillatelse:

| Tillatelse              | Begrunnelse                                                                                                                                                                      |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storage`               | Lagrer brukerens reservasjoner, turkategorier og innstillinger lokalt, så statistikken kan vises uten å hente alt på nytt.                                                       |
| `unlimitedStorage`      | Brukere med mange år med turer har flere tusen reservasjoner, som kan gå over standardkvoten for lokal lagring.                                                                  |
| `scripting`             | Leser innloggingen fra localStorage i en app.dele.no-fane som var åpen før utvidelsen ble installert, der innholdsskriptet ikke er lastet. Brukes ikke på andre sider.          |
| `https://app.dele.no/*` | Innholdsskriptet leser brukerens egen innlogging på app.dele.no, og utvidelsen henter brukerens reservasjoner fra API-et der. Det er den eneste adressen utvidelsen kobler seg til. |

Fjernkode: Nei. All kode ligger i pakken.

### Databruk

Utvidelsen leser innloggingen (tokenet og medlemskaps-id-en) fra app.dele.no og henter brukerens egne reservasjoner med priser, biler, tidspunkter og kilometer. Reservasjonene lagres bare lokalt i nettleseren. Tokenet lagres ikke, det holdes i minnet og sendes bare til app.dele.no. Ingenting sendes til utvikleren eller til andre.

Usikkert: skjemaet spør hvilke datakategorier utvidelsen «samler inn», og det er uklart om Google regner data som bare behandles lokalt som innsamlet. Gjør de det, er de nærmeste kategoriene autentiseringsinformasjon (tokenet), økonomisk informasjon (prisene på turene) og nettstedinnhold (reservasjonene). Les hjelpeteksten i skjemaet før du krysser av, og kryss heller av for mye enn for lite.

De tre erklæringene stemmer alle: data selges ikke til tredjeparter, brukes ikke til noe annet enn utvidelsens formål og brukes ikke til kredittvurdering eller utlån.

Personvernerklæring: https://github.com/fredrik-lindseth/bildeleringen-stats/blob/main/docs/personvern.md

## Publisering

1. Bygg med `./stats/scripts/package.sh`, og last inn `stats/dist/chrome` upakket i egen Chrome for en siste sjekk (se [DEVELOPMENT.md](DEVELOPMENT.md)).
2. I utviklerkonsollen: «Nytt element», last opp Chrome-zip-en.
3. Fyll inn butikkoppføringen og personvernpraksisen fra dette dokumentet.
4. Under Distribusjon: velg synlighet «Ikke oppført» (unlisted). Send til gjennomgang.
5. Når den er godkjent, installer fra lenken i egen Chrome og gå gjennom sjekklisten i [publisering.md](publisering.md) del 3. Den utpakkede utgaven har et annet lager enn butikkutgaven, så ta en sikkerhetskopi først og importer den etterpå.
6. Når Dele har sagt ok, bytt synlighet til «Offentlig».

Ny versjon: øk `version` i `stats/manifest.json`, bygg, last opp zip-en under «Pakke» på elementet og send til gjennomgang.
