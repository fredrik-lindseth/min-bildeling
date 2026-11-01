import { test } from "node:test";
import assert from "node:assert/strict";
import { searchErrorText } from "../lib/search-api.js";

test("rå feilkoder blir korte norske meldinger", () => {
  for (const code of [null, "API error: 500", "Max retries exceeded", "NetworkError when attempting to fetch resource."]) {
    const text = searchErrorText(code);
    assert.doesNotMatch(text, /API error|Max retries|NetworkError/);
    assert.match(text, /igjen|på nytt/);
  }
});
