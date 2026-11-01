/**
 * Import av en lest sikkerhetskopi til lageret.
 *
 * Turene i filen skrives under synklåsen (withSyncLock i sync.js). En synk
 * som pågår, holder turene i minnet og skriver dem tilbake ved neste batch, så
 * uten låsen ville importerte turer blitt borte eller hentet på nytt. Med
 * låsen tas importerte id-er ut av synkens kø i samme skriving som turene
 * legges inn (mergeBackup), og synken fortsetter etterpå med det som mangler.
 * Storage, klokke og sleep sendes inn, så den kan testes i node.
 */

import { mergeBackup } from "./backup.js";
import { withSyncLock } from "./sync.js";

export const BACKUP_STORAGE_KEYS = ["tripCategories", "transportData", "userKeywords", "reservations", "lastSync"];

/**
 * @param {object} opts
 *   backup: { tripCategories, transportData, userKeywords, reservations, lastSync } fra parseBackup()
 *   overwrite: filen vinner der den er ulik det som er lagret
 *   owner: siden som importerer. takeFrom: synken i samme side, som tas over.
 *   onWait({ syncLock, syncState }): en annen side synker, og importen venter.
 * @returns {Promise<{ next: object, counts: object }>}
 */
export async function importBackup({ storage, backup, overwrite = false, owner, takeFrom = null, onWait, now, sleep }) {
  const read = () => storage.get([...BACKUP_STORAGE_KEYS, "syncState"]);
  if (!backup.reservations) {
    // Brukerdata skrives aldri av synken og trenger ikke låsen.
    const { next, counts } = mergeBackup(await read(), backup, { overwrite });
    await storage.set(next);
    return { next, counts };
  }
  return withSyncLock({
    storage,
    owner: importOwner(owner),
    role: "import",
    takeFrom,
    onWait,
    now,
    sleep,
    task: async ({ commit }) => {
      // Les etter at låsen er tatt, så siste batch fra synken er med.
      const { next, counts } = mergeBackup(await read(), backup, { overwrite });
      await commit(next);
      return { next, counts };
    },
  });
}

// Hver import får sin egen låseier. En lås regnes som ledig for den som alt
// eier den, så to importer fra samme side med samme eier ville begge tatt
// låsen, og den siste ville skrevet over turene fra den første.
let importSeq = 0;
function importOwner(owner) {
  importSeq += 1;
  return `${owner}-import-${importSeq}`;
}
