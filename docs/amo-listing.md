# AMO-listing for Min bildeling

Teksten som limes inn på addons.mozilla.org når tillegget går fra unlisted til listed. Skjermbildene ligger i `skjermbilder/` og lages med `stats/scripts/skjermbilder.sh`. Ikonet er `stats/icons/listing/icon-256.png`.

## Navn

Min bildeling

## Sammendrag

Se hva bildelingen på dele.no koster deg, hvor mye du kjører og hvor mye CO₂ turene slipper ut. For medlemmer i alle Bilparaplyen-organisasjoner. Alt lagres lokalt i nettleseren.

## Beskrivelse

Er du medlem i Bildeleringen eller en annen Bilparaplyen-organisasjon på dele.no, viser utvidelsen statistikk over din egen bildeling:

- hva du bruker per måned og år, per tur og per kilometer
- når du kjører, hvilke biler du velger og hvor lang tid i forveien du booker
- et anslag over hva det ville kostet å eie bil selv
- CO₂ per drivstofftype og bil
- en årsoppsummering, én side per tall

Logg inn på app.dele.no som vanlig, og åpne utvidelsen. Første gang henter den alle turene dine, og det tar noen minutter hvis du har mange. Etterpå hentes bare nye turer.

Utvidelsen leser bare dine egne reservasjoner, med innloggingen du alt har på app.dele.no. Alt lagres i nettleseren din. Ingenting sendes til utvikleren eller til andre, og det finnes ingen sporing.

Utvidelsen er laget av et medlem og er ikke tilknyttet eller godkjent av Dele AS.

## Kategori og lenker

- Kategori: Andre (eventuelt Bokmerker og produktivitet)
- Hjemmeside: https://github.com/fredrik-lindseth/bildeleringen-stats
- Support-e-post: hei@fredriklindseth.no
- Personvernerklæring: innholdet i [personvern.md](personvern.md)
- Lisens: MIT

## Notes to reviewer

Min bildeling shows members of Norwegian car-sharing co-ops on dele.no statistics about their own trips. The source is plain JavaScript, HTML and CSS with no build step, bundler or transpiler: the uploaded files are the source, and the repository is https://github.com/fredrik-lindseth/bildeleringen-stats.

To try it without an account, open `dashboard/dashboard.html?demo=1` from the extension (for example `moz-extension://<uuid>/dashboard/dashboard.html?demo=1`). Demo mode uses synthetic data and an in-memory store, and makes no network requests.

With an account, the user logs in to app.dele.no as usual. The content script reads the user's own bearer token and membership id from the site's `localStorage` key `persist:data`, which is where the dele.no web app keeps its session. If the content script is not injected yet (Firefox may skip already open tabs after install or restart), `background.js` falls back to `scripting.executeScript` on an open app.dele.no tab to read the same key. That is the only use of the `scripting` permission. The token is kept in memory and sent only in the `authorization` header to `https://app.dele.no/api`, exactly as the site itself does. It never leaves the browser in any other way and is not stored or logged.

Responses are stored in `browser.storage.local`. There is no analytics, no telemetry and no backend of our own, so `data_collection_permissions` is `required: ["none"]`. Which endpoints are called and how often is documented for Dele's developers in https://github.com/fredrik-lindseth/bildeleringen-stats/blob/main/docs/api-bruk.md (Norwegian).

`innerHTML` is only used with static markup or with values passed through `escapeHtml()` in `dashboard/dashboard.js`, which escapes via `textContent`.

Third-party libraries in `vendor/`, unmodified:

| File                        | Library           | Upstream file                                                          | SHA-256                                                            |
| --------------------------- | ----------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `vendor/chart.min.js`       | Chart.js 4.5.1    | https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js      | `48444a82d4edcb5bec0f1965faacdde18d9c17db3063d042abada2f705c9f54a` |
| `vendor/html2canvas.min.js` | html2canvas 1.4.1 | https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js | `e87e550794322e574a1fda0c1549a3c70dae5a93d9113417a429016838eab8cb` |
