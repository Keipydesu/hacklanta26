const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = ts.createSourceFile('App.tsx', fs.readFileSync(path.join(__dirname, '../App.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let openScreen;
function find(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'openScreen') openScreen = node.getText(source);
  ts.forEachChild(node, find);
}
find(source);
assert.ok(openScreen, 'App.tsx defines openScreen');
const script = ts.transpileModule(`${openScreen}\nfor (const next of order) openScreen(next);`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

test('switching between Map, Trip and Report keeps the panel expanded or collapsed', () => {
  const screens = [], expandedCalls = [];
  vm.runInNewContext(script, {
    order: ['map', 'route', 'report', 'map', 'report', 'route'],
    screenRef: { current: 'map' }, reportLocationRef: { current: { status: 'ready' } },
    setScreen: next => screens.push(next), setExpanded: value => expandedCalls.push(value),
    setFollowing() {}, setCameraRevision() {}, setPicking() {}, setEditing() {},
    shouldLocateOnEnter: () => false, reportLocator: { request() {} },
  });
  assert.deepEqual(screens, ['map', 'route', 'report', 'map', 'report', 'route']);
  assert.deepEqual(expandedCalls, [], 'changing tabs never changes the panel state');
});
