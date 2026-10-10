const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeBounds, bboxParam, boundsAround, parseFromWeb, injection, navigationDecision, readyMessages } = require('../.test-dist/map/protocol.js');
const { buildOverlay, MARKER_COLORS } = require('../.test-dist/map/overlay.js');
const { renderMapPage, scriptLiteral } = require('../.test-dist/map/html.js');
const { startCampusMap } = require('../map-web/page.js');

// ---- bounds ----------------------------------------------------------------------------------

test('initial bounds match the old react-native-maps initial region query', () => {
  // Old: center 33.7531,-84.3853 with 0.012° deltas.
  const bbox = bboxParam(boundsAround([-84.3853, 33.7531], 0.012, 0.012)).split(',').map(Number);
  [-84.3913, 33.7471, -84.3793, 33.7591].forEach((v, i) => assert.ok(Math.abs(bbox[i] - v) < 1e-9, `${i}: ${bbox[i]}`));
});

test('bounds are clamped to WGS84 and a world-wrapping view becomes the whole world', () => {
  assert.deepEqual(normalizeBounds({ west: -190, south: -95, east: -170, north: 10 }), { west: -180, south: -90, east: -170, north: 10 });
  assert.deepEqual(normalizeBounds({ west: -400, south: -85, east: 400, north: 85 }), { west: -180, south: -85, east: 180, north: 85 });
  assert.deepEqual(normalizeBounds({ west: 100, south: 0, east: 460, north: 1 }), { west: -180, south: 0, east: 180, north: 1 });
});

test('degenerate or non-finite bounds are rejected rather than sent to the API', () => {
  assert.equal(normalizeBounds({ west: NaN, south: 0, east: 1, north: 1 }), null);
  assert.equal(normalizeBounds({ west: 1, south: 0, east: 1, north: 1 }), null);
  assert.equal(normalizeBounds({ west: 200, south: 0, east: 190, north: 1 }), null);
});

test('repeated world copies retain Atlanta viewport bounds and pin coordinates', () => {
  for (const turns of [-3, -2, -1, 0, 1, 2, 3]) {
    const shift = turns * 360;
    const bounds = normalizeBounds({ west: -84.4 + shift, south: 33.7, east: -84.3 + shift, north: 33.8 });
    assert.ok(bounds);
    assert.ok(Math.abs(bounds.west + 84.4) < 1e-9);
    assert.ok(Math.abs(bounds.east + 84.3) < 1e-9);
    assert.equal(bounds.south, 33.7);
    assert.equal(bounds.north, 33.8);
    for (const type of ['press', 'drag']) {
      const message = parseFromWeb(JSON.stringify({ type, id: 'pin', position: [-84.3853 + shift, 33.7531] }));
      assert.equal(message?.type, type);
      assert.ok(Math.abs(message.position[0] + 84.3853) < 1e-9);
      assert.equal(message.position[1], 33.7531);
      if (type === 'drag') assert.equal(message.id, 'pin');
    }
  }
});

test('shifted dateline views still clip at the canonical seam without reversing bounds', () => {
  for (const shift of [-720, -360, 0, 360, 720]) {
    assert.deepEqual(normalizeBounds({ west: 170 + shift, east: 185 + shift, south: 0, north: 1 }),
      { west: 170, east: 180, south: 0, north: 1 });
    assert.deepEqual(normalizeBounds({ west: -185 + shift, east: -170 + shift, south: 0, north: 1 }),
      { west: -180, east: -170, south: 0, north: 1 });
  }
});

test('views centered exactly on the dateline select the same clipped side in every world copy', () => {
  for (const midpoint of [-180, 180]) {
    for (const turns of [-3, -2, -1, 0, 1, 2, 3]) {
      assert.deepEqual(normalizeBounds({ west: midpoint - 10 + turns * 360, east: midpoint + 10 + turns * 360, south: 0, north: 1 }),
        { west: -180, east: -170, south: 0, north: 1 });
    }
  }
});

// ---- messages --------------------------------------------------------------------------------

test('web messages are validated; malformed or out-of-range input is ignored', () => {
  assert.deepEqual(parseFromWeb('{"type":"ready"}'), { type: 'ready' });
  assert.deepEqual(parseFromWeb('{"type":"press","position":[-84.38,33.75]}'), { type: 'press', position: [-84.38, 33.75] });
  assert.deepEqual(parseFromWeb('{"type":"drag","id":"pin","position":[-84.38,33.75]}'), { type: 'drag', id: 'pin', position: [-84.38, 33.75] });
  assert.deepEqual(parseFromWeb('{"type":"bounds","bounds":{"west":-200,"south":33,"east":-84,"north":34}}'),
    { type: 'bounds', bounds: { west: -180, south: 33, east: -84, north: 34 } });
  for (const bad of ['not json', 'null', '[]', '{"type":"press","position":[0,91]}', '{"type":"press","position":[null,0]}', '{"type":"press","position":[1e999,0]}', '{"type":"press","position":["1","2"]}',
    '{"type":"drag","position":[0,0]}', '{"type":"bounds","bounds":{"west":0}}', '{"type":"basemap","status":"maybe"}', '{"type":"other"}']) {
    assert.equal(parseFromWeb(bad), null, bad);
  }
  assert.equal(parseFromWeb(JSON.stringify({ type: 'basemap', status: 'unavailable', detail: 'x'.repeat(500) })).detail.length, 200);
});

test('injected overlay script calls the page API with the message as a JSON literal', () => {
  const script = injection({ type: 'overlay', overlay: { hazards: [], markers: [], routes: [] } });
  let received;
  new Function('window', script)({ __campusMap: { receive: m => { received = m; } } });
  assert.deepEqual(received, { type: 'overlay', overlay: { hazards: [], markers: [], routes: [] } });
});

test('a ready or reloaded page receives the current theme before its overlay', () => {
  const overlay = { hazards: [], markers: [], routes: [] };
  assert.deepEqual(readyMessages('dark', overlay), [{ type: 'theme', theme: 'dark' }, { type: 'overlay', overlay }]);
});

// ---- overlay parity --------------------------------------------------------------------------

const square = [[-84.39, 33.75], [-84.38, 33.75], [-84.38, 33.76], [-84.39, 33.75]];
const hazard = (id, source, extra = {}) => ({ geometry: { coordinates: [square] }, properties: { id, source, label: `Label ${id}`, evidence_source: 'simulated', ...extra } });
const base = {
  screen: 'map', hazards: [hazard('m1', 'manual'), hazard('a1', 'automatic')], submissions: [], pin: { lat: 33.75, lon: -84.38 },
  routes: null, origin: null, destination: null, routeColors: { shortest: '#5f5f5f', safest: '#005f73' },
};

test('hazards become polygons plus labelled markers at the first ring vertex, as before', () => {
  const overlay = buildOverlay(base);
  assert.deepEqual(overlay.hazards.map(h => [h.id, h.source]), [['m1', 'manual'], ['a1', 'automatic']]);
  assert.deepEqual(overlay.hazards[0].rings, [square]);
  assert.deepEqual(overlay.markers.map(m => [m.id, m.title, m.description, m.position]), [
    ['hazard-m1', 'Community report', 'Label m1', [-84.39, 33.75]],
    ['hazard-a1', 'Automatically detected · simulated', 'Label a1', [-84.39, 33.75]],
  ]);
  assert.equal(overlay.routes.length, 0);
});

test('pending reports show until submitted; the draggable pin only on the report screen', () => {
  const submissions = [
    { id: 'q', state: 'queued', body: { lat: 33.7, lon: -84.3, kind: 'pothole' } },
    { id: 's', state: 'submitted', body: { lat: 33.7, lon: -84.3, kind: 'closure' } },
  ];
  const map = buildOverlay({ ...base, hazards: [], submissions });
  assert.deepEqual(map.markers.map(m => [m.id, m.title, m.description, m.color]), [['pending-q', 'Pending report (not yet accepted)', 'pothole', MARKER_COLORS.pending]]);
  const report = buildOverlay({ ...base, hazards: [], screen: 'report' });
  assert.deepEqual(report.markers.map(m => [m.id, m.position, m.draggable]), [['pin', [-84.38, 33.75], true]]);
});

test('route lines: lower-risk solid under a dashed shortest; shortest alone is solid; A/B pins draggable', () => {
  const routes = { shortest: { coordinates: [[-84.39, 33.75], [-84.38, 33.76]] }, lowerRisk: { coordinates: [[-84.39, 33.75], [-84.385, 33.77], [-84.38, 33.76]] } };
  const both = buildOverlay({ ...base, hazards: [], screen: 'route', routes, origin: { lat: 33.75, lon: -84.39 }, destination: { lat: 33.76, lon: -84.38 } });
  assert.deepEqual(both.routes.map(r => [r.id, r.color, r.width, r.dashed]), [['lower-risk', '#005f73', 6, false], ['shortest', '#5f5f5f', 4, true]]);
  assert.deepEqual(both.markers.map(m => [m.id, m.title, m.draggable]), [['origin', 'Start (A)', true], ['destination', 'Destination (B)', true]]);
  const alone = buildOverlay({ ...base, hazards: [], screen: 'route', routes: { ...routes, lowerRisk: null } });
  assert.deepEqual(alone.routes.map(r => [r.id, r.dashed]), [['shortest', false]]);
  assert.equal(buildOverlay({ ...base, hazards: [], routes }).routes.length, 0, 'routes only on the route screen');
});

// ---- page HTML -------------------------------------------------------------------------------

const fakeAssets = { main: 'export const x = "</script><script>alert(1)</script>";', shared: '/* shared */', worker: '/* worker */',
  css: '.a{}</style><script>alert(2)</script>', sharedImport: '"./maplibre-gl-shared.mjs"', pageScript: 'function startCampusMap() {}' };

test('embedded library text and labels cannot close the page script elements', () => {
  const html = renderMapPage(fakeAssets, { styleUrl: 'https://example.test/style?a=</script>', darkStyleUrl: 'https://example.test/dark', center: [-84.38, 33.75], zoom: 14 });
  assert.equal(html.match(/<\/script>/g).length, 3, 'only the three real script elements close');
  assert.ok(!html.includes('alert(1)</script>') && !html.includes('</style><script>'));
  const data = html.slice(html.indexOf('window.__campusAssets = ') + 24, html.indexOf(';</script>'));
  assert.equal(JSON.parse(data).main, fakeAssets.main, 'escaped JSON still round-trips exactly');
  const sep = String.fromCharCode(0x2028);
  assert.equal(scriptLiteral(`a${sep}b`), '"a\\u2028b"', 'line separators are escaped');
});

// ---- page script against a fake MapLibre -------------------------------------------------------

function fakeMapLibre() {
  const made = { maps: [], markers: [] };
  class Emitter {
    constructor() { this.handlers = {}; }
    on(name, fn) { (this.handlers[name] ||= []).push(fn); return this; }
    off(name, fn) { this.handlers[name] = (this.handlers[name] || []).filter(handler => handler !== fn); return this; }
    fire(name, event) { (this.handlers[name] || []).forEach(fn => fn(event)); }
  }
  class Map extends Emitter {
    constructor(options) { super(); this.options = options; this.loaded = false; this.sources = {}; this.layers = []; this.layerDefs = {}; this.styles = [options.style]; this.canvas = { canvas: true }; made.maps.push(this); }
    isStyleLoaded() { return this.loaded; }
    setStyle(style) { this.styles.push(style); this.loaded = false; this.sources = {}; this.layers = []; this.layerDefs = {}; }
    // Real MapLibre fires style.load while isStyleLoaded() is still false if the style's own tile
    // sources are loading; `sourcesPending` reproduces that.
    loadStyle({ sourcesPending = false } = {}) { this.loaded = !sourcesPending; this.fire('style.load'); }
    getSource(id) { return this.sources[id]; }
    addSource(id) { const source = { data: null, setData(d) { this.data = d; } }; this.sources[id] = source; }
    addLayer(layer) { this.layers.push(layer.id); this.layerDefs[layer.id] = layer; }
    getCanvas() { return this.canvas; }
    getBounds() { return { getWest: () => -84.4, getSouth: () => 33.7, getEast: () => -84.3, getNorth: () => 33.8 }; }
  }
  class Marker extends Emitter {
    constructor(options) { super(); this.options = options; this.removed = false; made.markers.push(this);
      this.element = { listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn; } }; }
    getElement() { return this.element; }
    setLngLat(p) { this.position = Array.isArray(p) ? p : [p.lng, p.lat]; return this; }
    getLngLat() { return { lng: this.position[0], lat: this.position[1] }; }
    addTo() { return this; }
    remove() { this.removed = true; }
    setDraggable(d) { this.draggable = d; }
    getPopup() { return this.popup; }
    setPopup(p) { this.popup = p; }
  }
  class Popup { setDOMContent(node) { this.node = node; return this; } }
  return { ml: { Map, Marker, Popup }, made };
}

function startPage() {
  const { ml, made } = fakeMapLibre();
  const posted = [], notices = [], timers = [];
  const document = { createElement: () => ({ children: [], textContent: '', appendChild(c) { this.children.push(c); } }) };
  const api = startCampusMap(ml, { container: 'map', document, post: t => posted.push(JSON.parse(t)), notice: t => notices.push(t),
    setTimeout: fn => timers.push(fn), styleUrl: 'https://tiles.example/positron', darkStyleUrl: 'https://tiles.example/dark',
    center: [-84.38, 33.75], zoom: 14, styleTimeoutMs: 12000 });
  return { api, map: made.maps[0], made, posted, notices, timers };
}
const overlay = {
  hazards: [{ id: 'h', source: 'manual', rings: [square] }],
  markers: [{ id: 'pin', position: [-84.38, 33.75], color: '#d64532', title: 'Report location', draggable: true }],
  routes: [{ id: 'shortest', coordinates: [[-84.39, 33.75], [-84.38, 33.76]], color: '#5f5f5f', width: 4, dashed: false }],
};

test('overlay sent before the basemap loads shows markers at once and layers on style load', () => {
  const page = startPage();
  page.api.ready();
  assert.deepEqual(page.posted.map(m => m.type), ['ready', 'bounds'], 'the real viewport is reported without waiting for tiles');
  page.api.receive({ type: 'overlay', overlay });
  assert.equal(page.made.markers.length, 1, 'DOM markers do not wait for the style');
  assert.equal(page.map.getSource('hazards'), undefined);
  page.map.loadStyle();
  assert.deepEqual(page.posted.at(-1), { type: 'basemap', status: 'loaded' });
  assert.deepEqual(page.map.layers, ['hazard-fill', 'hazard-line', 'route-solid', 'route-dashed']);
  assert.equal(page.map.getSource('hazards').data.features[0].geometry.type, 'Polygon');
  assert.equal(page.map.getSource('routes').data.features[0].properties.width, 4);
});

test('basemap failure falls back to a local blank style and still draws overlays', () => {
  const page = startPage();
  page.api.receive({ type: 'overlay', overlay });
  page.map.fire('error', { error: { message: 'Failed to fetch' } });
  assert.equal(page.map.styles.at(-1).layers[0].type, 'background', 'local blank style, no network needed');
  assert.deepEqual(page.posted.at(-1), { type: 'basemap', status: 'unavailable', detail: 'Failed to fetch' });
  assert.match(page.notices.at(-1), /Basemap unavailable/);
  page.map.loadStyle();
  assert.equal(page.map.getSource('hazards').data.features.length, 1);
  assert.equal(page.posted.filter(m => m.type === 'basemap').length, 1, 'a single basemap status');
  page.map.fire('error', { error: { message: 'later tile error' } });
  assert.equal(page.map.styles.length, 2, 'errors after the style settled do not switch styles again');
});

test('a basemap that never loads times out into the blank style', () => {
  const page = startPage();
  page.timers.forEach(fn => fn());
  assert.equal(page.map.styles.at(-1).version, 8);
  assert.equal(page.posted.at(-1).detail, 'basemap style timed out');
  const loaded = startPage();
  loaded.map.loadStyle();
  loaded.timers.forEach(fn => fn());
  assert.equal(loaded.map.styles.length, 1, 'no fallback once the real basemap loaded');
});

test('canvas taps post a press; marker or popup taps do not', () => {
  const page = startPage();
  page.map.fire('click', { lngLat: { lng: -84.381, lat: 33.751 }, originalEvent: { target: page.map.canvas } });
  page.map.fire('click', { lngLat: { lng: -84.382, lat: 33.752 }, originalEvent: { target: { marker: true } } });
  assert.deepEqual(page.posted.filter(m => m.type === 'press'), [{ type: 'press', position: [-84.381, 33.751] }]);
});

test('drag end posts the new position; an overlay update mid-drag does not yank the marker', () => {
  const page = startPage();
  page.api.receive({ type: 'overlay', overlay });
  const marker = page.made.markers[0];
  marker.fire('dragstart');
  marker.setLngLat([-84.37, 33.74]);
  page.api.receive({ type: 'overlay', overlay });
  assert.deepEqual(marker.position, [-84.37, 33.74]);
  marker.fire('dragend');
  assert.deepEqual(page.posted.at(-1), { type: 'drag', id: 'pin', position: [-84.37, 33.74] });
  page.api.receive({ type: 'overlay', overlay: { ...overlay, markers: [] } });
  assert.equal(marker.removed, true, 'markers missing from the overlay are removed');
});

test('marker popups are built from text nodes, never HTML', () => {
  const page = startPage();
  page.api.receive({ type: 'overlay', overlay: { ...overlay, markers: [{ ...overlay.markers[0], title: '<img src=x onerror=alert(1)>', description: 'd' }] } });
  const node = page.made.markers[0].popup.node;
  assert.equal(node.children[0].textContent, '<img src=x onerror=alert(1)>');
  assert.equal(node.children[1].textContent, 'd');
});

test('settled moves post the viewport bounds', () => {
  const page = startPage();
  page.map.fire('moveend');
  assert.deepEqual(page.posted.at(-1), { type: 'bounds', bounds: { west: -84.4, south: 33.7, east: -84.3, north: 33.8 } });
});

test('overlay layers are added when a remote style loads even before its tile sources finish', () => {
  const page = startPage();
  page.api.receive({ type: 'overlay', overlay });
  page.map.loadStyle({ sourcesPending: true });
  assert.equal(page.map.isStyleLoaded(), false);
  assert.deepEqual(page.map.layers, ['hazard-fill', 'hazard-line', 'route-solid', 'route-dashed']);
  assert.equal(page.map.getSource('hazards').data.features.length, 1);
  page.map.fire('error', { error: { message: 'one tile failed' } });
  assert.equal(page.map.styles.length, 1, 'a tile error after the style loaded is not a basemap failure');
  page.api.receive({ type: 'overlay', overlay: { ...overlay, hazards: [] } });
  assert.equal(page.map.getSource('hazards').data.features.length, 0, 'later overlays update while tiles still load');
});

test('switching to Dark Matter keeps viewport and markers and re-adds overlays with dark contrast', () => {
  const page = startPage();
  page.api.receive({ type: 'overlay', overlay });
  page.map.loadStyle();
  const marker = page.made.markers[0];
  page.api.receive({ type: 'theme', theme: 'dark' });
  assert.equal(page.map.styles.at(-1), 'https://tiles.example/dark');
  assert.equal(page.map.layers.length, 0);
  assert.equal(marker.removed, false);
  assert.equal(page.made.maps.length, 1, 'the viewport stays on the same map instance');
  page.map.loadStyle();
  assert.deepEqual(page.map.layers, ['hazard-fill', 'hazard-line', 'route-solid', 'route-dashed']);
  assert.equal(page.map.getSource('hazards').data.features.length, 1);
  assert.equal(page.map.getSource('routes').data.features.length, 1);
  assert.equal(page.map.layerDefs['hazard-line'].paint['line-color'].at(-1), '#b7a7ff');
  page.api.receive({ type: 'theme', theme: 'invalid' });
  page.api.receive({ type: 'theme', theme: 'dark' });
  assert.equal(page.map.styles.length, 2, 'invalid or repeated theme messages do not reload the style');
});

test('a failed dark switch uses a dark blank style and a later toggle retries the remote style', () => {
  const page = startPage();
  page.api.receive({ type: 'overlay', overlay });
  page.map.loadStyle();
  page.api.receive({ type: 'theme', theme: 'dark' });
  page.map.fire('error', { error: { message: 'offline' } });
  assert.equal(page.map.styles.at(-1).layers[0].paint['background-color'], '#11151b');
  assert.equal(page.posted.at(-1).status, 'unavailable');
  page.map.loadStyle();
  assert.equal(page.map.getSource('hazards').data.features.length, 1);
  page.api.receive({ type: 'theme', theme: 'light' });
  assert.equal(page.map.styles.at(-1), 'https://tiles.example/positron');
  page.map.loadStyle();
  assert.equal(page.map.getSource('routes').data.features.length, 1);
  assert.equal(page.notices.at(-1), '');
});

test('a timed-out dark switch keeps overlays on a dark blank style', () => {
  const page = startPage();
  page.api.receive({ type: 'overlay', overlay });
  page.map.loadStyle();
  page.api.receive({ type: 'theme', theme: 'dark' });
  page.timers.at(-1)();
  assert.equal(page.map.styles.at(-1).layers[0].paint['background-color'], '#11151b');
  page.map.loadStyle();
  assert.equal(page.map.getSource('hazards').data.features.length, 1);
  assert.equal(page.posted.at(-1).status, 'unavailable');
});

test('stale style callbacks and timeouts cannot settle a newer theme', () => {
  const page = startPage();
  const oldLoad = page.map.handlers['style.load'][0];
  const oldError = page.map.handlers.error[0];
  page.api.receive({ type: 'theme', theme: 'dark' });
  oldLoad();
  oldError({ error: { message: 'old style failed' } });
  page.timers[0]();
  assert.equal(page.map.styles.at(-1), 'https://tiles.example/dark');
  assert.equal(page.posted.filter(message => message.type === 'basemap').length, 0);
  page.map.loadStyle();
  assert.equal(page.posted.at(-1).status, 'loaded');
});

test('rapid dark-to-light switch ignores the dark request timeout', () => {
  const page = startPage();
  page.api.receive({ type: 'overlay', overlay });
  page.api.receive({ type: 'theme', theme: 'dark' });
  const darkTimeout = page.timers.at(-1);
  page.api.receive({ type: 'theme', theme: 'light' });
  darkTimeout();
  assert.equal(page.map.styles.at(-1), 'https://tiles.example/positron');
  page.map.loadStyle();
  assert.equal(page.map.getSource('routes').data.features.length, 1);
  assert.equal(page.posted.at(-1).status, 'loaded');
});

test('WebView navigation: only the page loads in place; outside http(s) opens in the browser; other schemes are blocked', () => {
  const origin = 'https://campus-map.invalid/';
  assert.equal(navigationDecision('https://campus-map.invalid/', origin), 'load');
  assert.equal(navigationDecision('https://campus-map.invalid/#x', origin), 'load');
  assert.equal(navigationDecision('about:blank', origin), 'load', 'react-native-webview bootstrap page');
  assert.equal(navigationDecision('https://openfreemap.org/', origin), 'external');
  assert.equal(navigationDecision('https://www.openstreetmap.org/copyright', origin), 'external');
  assert.equal(navigationDecision('http://example.com/', origin), 'external');
  assert.equal(navigationDecision('https://campus-map.invalid.evil.example/', origin), 'external', 'a lookalike host never loads in place');
  for (const url of ['javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'data:text/html,<script>alert(1)</script>', 'file:///etc/passwd',
    'intent://scan/#Intent;scheme=zxing;end', 'tel:5550100', 'about:srcdoc', 'blob:https://campus-map.invalid/abc',
    'https://user:pw@campus-map.invalid/', 'https://user@openfreemap.org/', 'not a url', '']) {
    assert.equal(navigationDecision(url, origin), 'block', url);
  }
});

test('tapping a hazard pin selects that hazard instead of opening a popup', () => {
  const page = startPage();
  page.api.receive({ type: 'overlay', overlay: { ...overlay, markers: [
    { id: 'hazard-h1', position: [-84.38, 33.75], color: '#d64532', title: 'Community report', select: 'h1' },
    overlay.markers[0],
  ] } });
  const [hazardMarker, pinMarker] = page.made.markers;
  let stopped = false;
  hazardMarker.element.listeners.click({ stopPropagation: () => { stopped = true; } });
  assert.deepEqual(page.posted.at(-1), { type: 'select', id: 'h1' });
  assert.equal(stopped, true, 'the tap does not also reach the map as a press');
  assert.equal(hazardMarker.popup, undefined, 'hazard pins open the native panel, not a popup');
  assert.ok(pinMarker.popup, 'other pins keep their popup');
  assert.equal(pinMarker.element.listeners.click, undefined);
});

test('select messages are validated', () => {
  assert.deepEqual(parseFromWeb('{"type":"select","id":"h1"}'), { type: 'select', id: 'h1' });
  for (const bad of ['{"type":"select"}', '{"type":"select","id":""}', '{"type":"select","id":7}', JSON.stringify({ type: 'select', id: 'x'.repeat(65) })]) {
    assert.equal(parseFromWeb(bad), null, bad);
  }
});

test('hazard pins carry their hazard id and the selected one is highlighted', () => {
  const overlayResult = buildOverlay({ ...base, selectedHazardId: 'a1' });
  assert.deepEqual(overlayResult.markers.map(m => [m.id, m.select, m.color]), [
    ['hazard-m1', 'm1', MARKER_COLORS.hazard],
    ['hazard-a1', 'a1', MARKER_COLORS.selected],
  ]);
});
