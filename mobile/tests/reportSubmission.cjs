const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Exercise the actual screen handler without a native renderer. Controller-only tests
// cannot catch a stale screen closure across the AsyncStorage await in this wiring.
const source = ts.createSourceFile('App.tsx', fs.readFileSync(path.join(__dirname, '../App.tsx'), 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let handler;
function find(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'send') handler = node.getText(source);
  ts.forEachChild(node, find);
}
find(source);
assert.ok(handler, 'Report submission handler exists');

for (const [screen, appState, expectedRequests] of [
  ['report', 'active', 1], ['map', 'active', 0], ['route', 'active', 0],
  ['report', 'background', 0], ['report', 'inactive', 0],
]) {
  test(`delayed report save finishes on ${screen}/${appState} without an out-of-context fix`, async () => {
    let persist;
    let requests = 0, drains = 0, clears = 0, kind = 'closure', description = 'Confirmed construction barrier';
    const context = {
      guardSubmit: run => run(), setSubmitting() {}, setError(error) { assert.equal(error, ''); },
      fixtureMode: false, kind, description, Crypto: { randomUUID: () => 'report-id' },
      screenRef: { current: 'report' }, AppState: { currentState: 'active' },
      setKind: next => { kind = next; },
      setDescription: next => { description = next; }, setDraftRevision() {},
      reportLocator: {
        freeze: draft => { assert.equal(draft.description, 'Confirmed construction barrier'); return { id: 'report-id' }; },
        clear: () => { clears++; }, request: () => { requests++; },
      },
      queue: {
        enqueue: () => new Promise(resolve => { persist = resolve; }), drain: () => { drains++; },
      },
    };
    vm.createContext(context);
    vm.runInContext(`${handler}\ncompletion = send();`, context);
    context.screenRef.current = screen;
    context.AppState.currentState = appState;
    persist();
    await context.completion;
    assert.equal(requests, expectedRequests);
    assert.equal(clears, 1);
    assert.equal(kind, null);
    assert.equal(description, '');
    assert.equal(drains, 1, 'saved reports still drain without another location fix');
  });
}
