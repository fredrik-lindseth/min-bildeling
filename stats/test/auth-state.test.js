// Valget mellom «Ikke innlogget», «Tilgang mangler» og «Fanen må lastes på
// nytt». Forsøkene per fane er de background.js samler i probeAuth().

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AUTH_STATE,
  chooseAuthState,
  describeAuthState,
  stateForSyncError,
} from "../lib/auth-state.js";

test("tokenet i én fane er nok, uansett de andre", () => {
  const tabs = [
    { id: 1, discarded: true, content: "skipped", injected: "skipped" },
    { id: 2, content: "failed", injected: "auth" },
  ];
  assert.deepEqual(chooseAuthState({ hasPermission: true, tabs }), { state: AUTH_STATE.OK, tabId: 2 });
});

test("uten host-tilgang er det tilgangen som mangler, ikke innloggingen", () => {
  // tabs.query finner ingen app.dele.no-faner uten tilgang, så listen er tom.
  assert.deepEqual(chooseAuthState({ hasPermission: false, tabs: [] }), {
    state: AUTH_STATE.NO_PERMISSION,
    tabId: null,
  });
});

test("ingen app.dele.no-fane betyr ikke innlogget", () => {
  assert.deepEqual(chooseAuthState({ hasPermission: true, tabs: [] }), {
    state: AUTH_STATE.LOGGED_OUT,
    tabId: null,
  });
});

test("en fane som kunne leses uten innlogging, betyr ikke innlogget", () => {
  // localStorage er felles for app.dele.no, så den utlastede fanen endrer ikke svaret.
  const tabs = [
    { id: 1, discarded: true, content: "skipped", injected: "skipped" },
    { id: 2, content: "failed", injected: "empty" },
  ];
  assert.equal(chooseAuthState({ hasPermission: true, tabs }).state, AUTH_STATE.LOGGED_OUT);
  const viaContent = [{ id: 3, content: "empty", injected: "empty" }];
  assert.equal(chooseAuthState({ hasPermission: true, tabs: viaContent }).state, AUTH_STATE.LOGGED_OUT);
});

test("en utlastet fane må lastes på nytt", () => {
  // Fanen var åpen før installasjonen og lagt i dvale av Firefox: ingen
  // content-script, og executeScript gir «An unexpected error occurred».
  const tabs = [{ id: 7, discarded: true, content: "skipped", injected: "skipped" }];
  assert.deepEqual(chooseAuthState({ hasPermission: true, tabs }), {
    state: AUTH_STATE.RELOAD_NEEDED,
    tabId: 7,
  });
});

test("ingen fane svarte: den utlastede velges for ny lasting", () => {
  const tabs = [
    { id: 4, content: "failed", injected: "failed" },
    { id: 5, discarded: true, content: "skipped", injected: "skipped" },
  ];
  assert.deepEqual(chooseAuthState({ hasPermission: true, tabs }), {
    state: AUTH_STATE.RELOAD_NEEDED,
    tabId: 5,
  });
  const loaded = [{ id: 6, content: "failed", injected: "failed" }];
  assert.equal(chooseAuthState({ hasPermission: true, tabs: loaded }).tabId, 6);
});

test("hver tilstand har sin egen tekst og handling, og bare én ber om innlogging", () => {
  const loggedOut = describeAuthState(AUTH_STATE.LOGGED_OUT);
  const permission = describeAuthState(AUTH_STATE.NO_PERMISSION);
  const reload = describeAuthState(AUTH_STATE.RELOAD_NEEDED);

  assert.equal(loggedOut.title, "Ikke innlogget");
  assert.deepEqual(loggedOut.action, { kind: "open", label: "Åpne app.dele.no" });
  assert.equal(permission.title, "Tilgang mangler");
  assert.equal(permission.action.kind, "permission");
  assert.equal(reload.title, "Fanen må lastes på nytt");
  assert.equal(reload.action.kind, "reload");

  for (const info of [permission, reload]) {
    assert.doesNotMatch(`${info.title} ${info.text}`, /logg inn/i);
  }
  for (const info of [loggedOut, permission, reload]) {
    assert.doesNotMatch(`${info.title} ${info.text} ${info.action.label}`, /\bvi\b/i);
  }
  assert.equal(describeAuthState(AUTH_STATE.OK), null);
});

test("synkfeil: utløpt token gir alltid innlogging, ellers gjelder svaret fra background", () => {
  const reload = { hasAuth: false, state: AUTH_STATE.RELOAD_NEEDED, tabId: 9 };
  assert.deepEqual(stateForSyncError("AUTH_EXPIRED", reload), { state: AUTH_STATE.LOGGED_OUT, tabId: null });
  assert.deepEqual(stateForSyncError("NOT_LOGGED_IN", reload), { state: AUTH_STATE.RELOAD_NEEDED, tabId: 9 });
  assert.deepEqual(
    stateForSyncError("NOT_LOGGED_IN", { hasAuth: false, state: AUTH_STATE.NO_PERMISSION, tabId: null }),
    { state: AUTH_STATE.NO_PERMISSION, tabId: null }
  );
  // Ikke noe svar fra background, eller et svar fra en eldre utgave uten state.
  assert.equal(stateForSyncError("NOT_LOGGED_IN", null).state, AUTH_STATE.LOGGED_OUT);
  assert.equal(stateForSyncError("NOT_LOGGED_IN", { hasAuth: false }).state, AUTH_STATE.LOGGED_OUT);
});
