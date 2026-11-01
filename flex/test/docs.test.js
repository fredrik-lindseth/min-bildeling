// Dokumentasjonen nevner avstandstaket i kilometer. Testen binder tallet til
// konstanten, så teksten ikke kan skli fra det søket faktisk gjør.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { REGION_CEILING_M } from "../lib/flex.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("avstandstaket i docs stemmer med REGION_CEILING_M", () => {
  const km = `${REGION_CEILING_M / 1000} km`;
  for (const path of ["../../docs/api/README.md", "../README.md"]) {
    assert.ok(read(path).includes(km), `${path} mangler «${km}»`);
  }
});
