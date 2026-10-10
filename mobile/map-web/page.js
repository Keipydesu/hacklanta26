/*
 * Runs inside the map WebView (and in Node tests with a fake MapLibre). Plain ES5-style script so
 * it can be inlined into the page and evaluated without a bundler.
 *
 * Overlays never depend on the remote basemap: markers are DOM elements, and the GeoJSON layers are
 * (re)added on every style load, including the local blank style used when tiles are unreachable.
 */
function startCampusMap(ml, env) {
  var EMPTY = { type: 'FeatureCollection', features: [] };
  var overlay = { hazards: [], markers: [], routes: [] };
  var markers = {};
  var currentTheme = 'light';
  var styleGeneration = 0;
  var styleLoadHandler = null;
  var styleErrorHandler = null;
  var basemapSettled = false;
  // Set on style.load; map.isStyleLoaded() stays false until every basemap tile source loads.
  var styleReady = false;

  function post(message) { env.post(JSON.stringify(message)); }
  function notice(text) { env.notice(text); }

  var map = new ml.Map({ container: env.container, style: env.styleUrl, center: env.center, zoom: env.zoom, attributionControl: { compact: true } });

  function fallback(detail) {
    if (basemapSettled) return;
    basemapSettled = true;
    notice('Basemap unavailable · hazards, pins and routes are still shown');
    styleReady = false;
    map.setStyle({ version: 8, sources: {}, layers: [{ id: 'background', type: 'background',
      paint: { 'background-color': currentTheme === 'dark' ? '#11151b' : '#e9e7e1' } }] }, { diff: false });
    post({ type: 'basemap', status: 'unavailable', detail: String(detail || 'unknown error') });
  }

  function beginStyle(url) {
    var generation = ++styleGeneration;
    if (styleLoadHandler) map.off('style.load', styleLoadHandler);
    if (styleErrorHandler) map.off('error', styleErrorHandler);
    basemapSettled = false;
    styleReady = false;
    notice('');
    styleLoadHandler = function () {
      if (generation !== styleGeneration) return;
      styleReady = true;
      if (!basemapSettled) { basemapSettled = true; post({ type: 'basemap', status: 'loaded' }); }
      renderLayers();
    };
    styleErrorHandler = function (event) {
      if (generation === styleGeneration && !basemapSettled && !styleReady) fallback(event && event.error && event.error.message);
    };
    map.on('style.load', styleLoadHandler);
    map.on('error', styleErrorHandler);
    env.setTimeout(function () {
      if (generation === styleGeneration && !basemapSettled) fallback('basemap style timed out');
    }, env.styleTimeoutMs);
    if (url) map.setStyle(url, { diff: false });
  }

  function ensureLayers() {
    if (!map.getSource('hazards')) {
      map.addSource('hazards', { type: 'geojson', data: EMPTY });
      map.addLayer({ id: 'hazard-fill', type: 'fill', source: 'hazards',
        paint: { 'fill-color': ['match', ['get', 'source'], 'manual', '#fa9f42', '#7777dd'], 'fill-opacity': 0.4 } });
      map.addLayer({ id: 'hazard-line', type: 'line', source: 'hazards',
        paint: { 'line-color': ['match', ['get', 'source'], 'manual', currentTheme === 'dark' ? '#ffad66' : '#af4d00',
          currentTheme === 'dark' ? '#b7a7ff' : '#5555bb'], 'line-width': 2 } });
    }
    if (!map.getSource('routes')) {
      map.addSource('routes', { type: 'geojson', data: EMPTY });
      map.addLayer({ id: 'route-solid', type: 'line', source: 'routes', filter: ['!', ['get', 'dashed']],
        layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'width'] } });
      map.addLayer({ id: 'route-dashed', type: 'line', source: 'routes', filter: ['get', 'dashed'],
        paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'width'], 'line-dasharray': [2.5, 2] } });
    }
  }

  function popupContent(m) {
    var root = env.document.createElement('div');
    var title = env.document.createElement('strong');
    title.textContent = m.title;
    root.appendChild(title);
    if (m.description) {
      var description = env.document.createElement('div');
      description.textContent = m.description;
      root.appendChild(description);
    }
    return root;
  }

  function renderMarkers() {
    var seen = {};
    overlay.markers.forEach(function (m) {
      seen[m.id] = true;
      var marker = markers[m.id];
      if (marker && marker.campusColor !== m.color) { marker.remove(); marker = null; }
      if (!marker) {
        marker = new ml.Marker({ color: m.color, draggable: !!m.draggable });
        marker.campusColor = m.color;
        marker.on('dragstart', function () { marker.campusDragging = true; });
        marker.on('dragend', function () {
          marker.campusDragging = false;
          var p = marker.getLngLat();
          post({ type: 'drag', id: m.id, position: [p.lng, p.lat] });
        });
        if (m.select) {
          marker.getElement().addEventListener('click', function (event) {
            event.stopPropagation();
            post({ type: 'select', id: m.select });
          });
        }
        marker.setLngLat(m.position).addTo(map);
        markers[m.id] = marker;
      } else if (!marker.campusDragging) {
        marker.setLngLat(m.position);
      }
      marker.setDraggable(!!m.draggable);
      if (m.select) return;
      var popup = marker.getPopup();
      if (!popup) { popup = new ml.Popup({ offset: 25, closeButton: false }); marker.setPopup(popup); }
      popup.setDOMContent(popupContent(m));
    });
    Object.keys(markers).forEach(function (id) {
      if (!seen[id]) { markers[id].remove(); delete markers[id]; }
    });
  }

  function renderLayers() {
    if (!styleReady) return;
    ensureLayers();
    map.getSource('hazards').setData({ type: 'FeatureCollection', features: overlay.hazards.map(function (h) {
      return { type: 'Feature', properties: { id: h.id, source: h.source }, geometry: { type: 'Polygon', coordinates: h.rings } };
    }) });
    map.getSource('routes').setData({ type: 'FeatureCollection', features: overlay.routes.map(function (r) {
      return { type: 'Feature', properties: { id: r.id, color: r.color, width: r.width, dashed: r.dashed }, geometry: { type: 'LineString', coordinates: r.coordinates } };
    }) });
  }

  function render() { renderMarkers(); renderLayers(); }

  function postBounds() {
    var b = map.getBounds();
    post({ type: 'bounds', bounds: { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() } });
  }

  map.on('click', function (event) {
    var target = event.originalEvent && event.originalEvent.target;
    if (target && target !== map.getCanvas()) return; // a marker or popup tap is not a map tap
    post({ type: 'press', position: [event.lngLat.lng, event.lngLat.lat] });
  });
  map.on('moveend', postBounds);
  map.on('load', postBounds);
  beginStyle(null);

  return {
    receive: function (message) {
      if (message && message.type === 'overlay' && message.overlay) { overlay = message.overlay; render(); }
      if (message && message.type === 'theme' && (message.theme === 'light' || message.theme === 'dark') && message.theme !== currentTheme) {
        currentTheme = message.theme;
        beginStyle(currentTheme === 'dark' ? env.darkStyleUrl : env.styleUrl);
      }
    },
    ready: function () { post({ type: 'ready' }); postBounds(); },
  };
}

if (typeof module !== 'undefined') module.exports = { startCampusMap: startCampusMap };
