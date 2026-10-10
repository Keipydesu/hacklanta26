const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { createForegroundWatch } = require('../.test-dist/location/foregroundWatch.js');
const { livePosition } = require('../.test-dist/location/livePosition.js');
const source = ts.createSourceFile('App.tsx', fs.readFileSync(path.join(__dirname, '../App.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let effect;
function find(node) {
  if (ts.isCallExpression(node) && node.expression.getText(source) === 'useEffect' &&
      node.arguments[0].getText(source).includes('createForegroundWatch')) effect = node.arguments[0].getText(source);
  ts.forEachChild(node, find);
}
find(source);
assert.ok(effect);
const script = ts.transpileModule(`cleanup = (${effect})();`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const settle = () => new Promise(resolve => setImmediate(resolve));

for (const fixtureMode of [false, true]) {
  test(`real Trip effect wires moving GPS and background cleanup (fixture=${fixtureMode})`, async () => {
    let callback, lifecycle, position = null, options, removed = 0, nearbyPositions = 0;
    const context = {
      screen: 'route', fixtureMode, createForegroundWatch, livePosition, Date,
      setPosition: change => { position = typeof change === 'function' ? change(position) : change; }, setWatchStatus() {},
      nearby: { setActive() {}, position() { nearbyPositions++; } },
      Location: {
        Accuracy: { High: 4, Balanced: 3 }, getForegroundPermissionsAsync: async () => ({ granted: true }),
        watchPositionAsync: async (opts, cb) => { options = opts; callback = cb; return { remove() { removed++; } }; },
      },
      AppState: { currentState: 'active', addEventListener: (_name, cb) => { lifecycle = cb; return { remove() {} }; } },
    };
    vm.createContext(context); vm.runInContext(script, context);
    await settle();
    assert.equal(options.accuracy, 4);
    assert.equal(options.distanceInterval, 0, 'stationary riders still need fresh fixes');
    const timestamp = Date.now();
    const fix = { timestamp, coords: { latitude: 33.75, longitude: -84.38, accuracy: 8 } };
    callback(fix);
    assert.equal(position.lat, 33.75);
    callback({ ...fix, timestamp: timestamp + 1, coords: { ...fix.coords, latitude: 33.751 } });
    assert.equal(position.lat, 33.751);
    assert.equal(nearbyPositions, fixtureMode ? 0 : 2);
    lifecycle('background');
    assert.equal(position, null);
    callback(fix);
    assert.equal(position, null, 'late callback cannot resurrect the dot');
    assert.equal(removed, 1);
    lifecycle('active'); await settle();
    callback({ ...fix, timestamp: Date.now() });
    assert.equal(position.lat, 33.75);
    context.cleanup();
    assert.equal(position, null);
  });
}
