# Veien videre

Konkrete oppgaver ligger under [issues](https://github.com/fredrik-lindseth/bildeleringen-stats/issues). Eget ikon for stats, bookingmønster og varsler i flex er alt bygget.

## Stats

- **Delbar årsoppsummering**: lage et bilde av årsoppsummeringen som kan deles.
- **Transportdata automatisk**: hente fra Skyss, bankdata eller andre kilder framfor å skrive inn for hånd i transportkalkulatoren.
- **Flere medlemskap**: støtte for flere medlemskap eller husholdninger.

## Flex

- **Eget ikon og pakking**: flex bruker fortsatt Dele-symbolet og mangler `package.sh`. Begge trengs før den kan signeres, se [publisering.md](publisering.md).
- **Booking i utvidelsen**: legge inn reservasjonen via API framfor å sende brukeren til dele.no. Krever at skrive-endepunktet kartlegges, og feil koster penger.

Mindre ting i koden: `splitPairs` rangerer etter tidligste gyldige byttetid og ikke den som ligger nærmest midtpunktet, `opts.sameLocationOnly` mangler tester, og `parseLocalISO` sjekker sifrene, men ikke om datoen finnes.
