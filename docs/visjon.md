# Visjon

Bildeleringen Stats skal svare på spørsmålet bak hver reservasjon: lønner bildeling seg for meg? Svaret bygger på medlemmets egne turer, hentet fra dele.no og lagret i nettleseren. Ingenting sendes til andre enn dele.no.

Utvidelsen er for alle som er medlem i en Bilparaplyen-organisasjon på dele.no, ikke bare Bildeleringen i Bergen. Den skal virke rett etter at du har logget inn, uten oppsett eller API-nøkler.

## Oversikt

Popupen viser hva måneden har kostet så langt, sammenlignet med forrige måned, og besparelsen mot å eie bil. Dashboardet viser mønstrene: når på uken og døgnet du kjører, hvilke biler du bruker, hva en kilometer koster på korte og lange turer.

Trendene legger årene oppå hverandre, glatter med et rullerende tremånederssnitt og viser snittforbruket per måned på tvers av år, så det blir lettere å vite hva juli kommer til å koste.

## Bilregnestykket

Regnestykket sammenligner bildelingen din med hva det ville kostet å eie biltypen du bruker mest, ut fra din egen kjørelengde. Eierkostnadene er brutt ned i verditap, forsikring, årsavgift, vedlikehold, parkering og drivstoff, med tall fra NAF Bilkostnadsindeks. Målet er å kunne sammenligne mot en bestemt bil du har vurdert å kjøpe. I dag finnes Volvo EX C40 2026 som eget alternativ.

## Turkategorier

Turene sorteres etter formål (handletur, hyttetur, flyplass, jobb og så videre) ut fra notatene du skrev da du booket, og du kan velge kategori selv. Da ser du hva hver type tur koster, noe kontoutskriften ikke kan vise. På sikt kan utvidelsen foreslå kategorier også ut fra tidspunkt og lengde.

## Klima og annen transport

CO₂ beregnes per tur ut fra kjørt distanse, drivstofftype og bilkategori, med utslippsfaktorer fra Miljødirektoratet, og sammenlignes med en gjennomsnittlig privatbil. Transportkalkulatoren tar med taxi, leiebil, buss og bybane, fly, egen bil, sykkel og gange, så bildelingen kan ses mot resten av transporten.

Alle estimater merkes med «ca.» eller «~» og har en «Slik beregner vi»-knapp med kildene og hva som ikke er med, som utslipp fra produksjon og strøm (tank-to-wheel, ikke well-to-wheel).

## Årsoppsummering

Årsoppsummeringen viser ett tall per side: forbruk, kilometer, antall turer, mest brukte bil, lengste tur, travleste måned og estimert besparelse i kroner og CO₂. Du kan bla tilbake til tidligere år. Neste steg er å kunne dele den som et bilde.

## Data og personvern

Alt lagres lokalt, så statistikken virker også uten nett. Synken henter bare nye turer, og manuell synk er ett klikk. Det finnes ingen konto, ingen server og ingen sporing. Eksport og import av data mellom maskiner står ikke på plass ennå.

Avbestilte turer telles ikke med i kostnadene. Turer som ble booket, men ikke kjørt, telles, siden de kan ha kostet gebyr.

## Andre bildelinger

Koden er åpen og uten byggesteg, med beregningene i egne moduler. Det skal være lite arbeid å tilpasse den til andre plattformer.
