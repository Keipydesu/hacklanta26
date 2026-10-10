const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Exercise the actual Expo client without starting React Native or a live API.
function client(fetch) {
  const timers = new Map();
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/api/client.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(source, {
    exports, require: p => require(path.resolve(__dirname, '../src/api', p)),
    process: { env: { EXPO_PUBLIC_API_URL: 'https://product.example' } },
    AbortController, fetch,
    setTimeout: (fn, ms) => { const id = {}; timers.set(id, { fn, ms }); return id; },
    clearTimeout: id => timers.delete(id),
  });
  return { api: exports, timers };
}
const turn = () => new Promise(resolve => setImmediate(resolve));

test('report and route deadlines cover stalled success bodies, then allow retry', async () => {
  for (const method of ['report', 'route']) {
    let calls = 0;
    const h = client(async (_url, { signal }) => ({
      ok: true,
      headers: new Headers({ 'X-Stage-0-Stub': 'true' }),
      json: () => ++calls > 1 ? Promise.resolve({ ok: true }) : new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted body')), { once: true });
      }),
    }));
    const send = () => method === 'report' ? h.api.submitReport({ id: 'same-id' }) : h.api.getRoutes({ lat: 1, lon: 2 }, { lat: 2, lon: 3 });
    const pending = send();
    const rejected = assert.rejects(pending, /aborted body/);
    await turn();
    assert.equal(h.timers.size, 1, `${method}: retain deadline until body finishes`);
    const [timer] = h.timers.values();
    assert.equal(timer.ms, 15_000);
    timer.fn();
    await rejected;
    assert.equal(h.timers.size, 0);
    const result = await send();
    assert.equal(method === 'report' ? result.ok : result.response.ok, true);
    if (method === 'route') assert.equal(result.illustrative, true, 'preserve stub header');
    assert.equal(h.timers.size, 0, 'successful parse cleans up deadline');
  }
});
