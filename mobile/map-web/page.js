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
  var cameraRevision = -1;
  var cameraPaused = false;
  var cameraNeedsZoom = true;
  var styleGeneration = 0;
  var styleLoadHandler = null;
  var styleErrorHandler = null;
  var basemapSettled = false;
  // Set on style.load; map.isStyleLoaded() stays false until every basemap tile source loads.
  var styleReady = false;
  // Film palette (decision 026). One hazard hue for both sources: the marker glyph carries the source.
  var HAZARD = { light: '#D64532', dark: '#FF6A55' };
  var GROUND = { light: '#E3E6EC', dark: '#0B0D14' };
  var INK = '#151829';

  function post(message) { env.post(JSON.stringify(message)); }
  function notice(text) { env.notice(text); }

  var map = new ml.Map({ container: env.container, style: env.styleUrl, center: env.center, zoom: env.zoom, attributionControl: { compact: true } });

  function fallback(detail) {
    if (basemapSettled) return;
    basemapSettled = true;
    notice('Basemap unavailable · hazards, pins and routes are still shown');
    styleReady = false;
    map.setStyle({ version: 8, sources: {}, layers: [{ id: 'background', type: 'background',
      paint: { 'background-color': GROUND[currentTheme] } }] }, { diff: false });
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
    if (!map.getSource('bike-lanes')) {
      map.addSource('bike-lanes', { type: 'geojson', data: env.bikeLanes, attribution: '© OpenStreetMap contributors' });
      var firstSymbol = map.getStyle().layers.find(function (layer) { return layer.type === 'symbol'; });
      map.addLayer({ id: 'bike-lanes', type: 'line', source: 'bike-lanes',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': env.bikeLaneColors[currentTheme],
          'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1, 16, 2.5], 'line-opacity': 0.48 } },
      firstSymbol && firstSymbol.id);
    }
    if (!map.getSource('hazards')) {
      map.addSource('hazards', { type: 'geojson', data: EMPTY });
      // A soft halo, a translucent zone and a crisp edge, all in the hazard hue.
      map.addLayer({ id: 'hazard-glow', type: 'line', source: 'hazards',
        paint: { 'line-color': HAZARD[currentTheme], 'line-width': 14, 'line-blur': 12, 'line-opacity': currentTheme === 'dark' ? 0.55 : 0.3 } });
      map.addLayer({ id: 'hazard-fill', type: 'fill', source: 'hazards',
        paint: { 'fill-color': HAZARD[currentTheme], 'fill-opacity': 0.22 } });
      map.addLayer({ id: 'hazard-line', type: 'line', source: 'hazards',
        paint: { 'line-color': HAZARD[currentTheme], 'line-width': 2, 'line-opacity': 0.9 } });
    }
    if (!map.getSource('routes')) {
      map.addSource('routes', { type: 'geojson', data: EMPTY });
      // Only the lower-risk line glows, so it reads as the recommended one.
      map.addLayer({ id: 'route-glow', type: 'line', source: 'routes', filter: ['==', ['get', 'id'], 'lower-risk'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ['get', 'color'], 'line-width': 18, 'line-blur': 14, 'line-opacity': currentTheme === 'dark' ? 0.55 : 0.25 } });
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

  // Dark ink on light marker colours, white on dark ones.
  function inkOn(color) {
    var m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color || '');
    if (!m) return '#fff';
    return (0.299 * parseInt(m[1], 16) + 0.587 * parseInt(m[2], 16) + 0.114 * parseInt(m[3], 16)) > 150 ? INK : '#fff';
  }

  /**
   * Film-style markers. MapLibre positions the root with its own transform, so the rotated diamond
   * is a child. Text is set with textContent only.
   */
  function glyphElement(m) {
    var doc = env.document;
    var endpoint = m.glyph === 'origin' || m.glyph === 'destination';
    var diamond = m.glyph === 'report' || m.glyph === 'pending';
    var size = endpoint ? 36 : 30;
    var inset = diamond ? 5 : 0;
    var root = doc.createElement('div');
    root.style.cssText = 'position:relative;cursor:pointer;width:' + size + 'px;height:' + size + 'px;';
    root.setAttribute('aria-label', m.title);
    if (m.glyph === 'detected') {
      var pulse = doc.createElement('div');
      pulse.className = 'campus-pulse';
      pulse.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;box-sizing:border-box;border-radius:50%;pointer-events:none;'
        + 'border:2px solid ' + m.color + ';animation:campus-pulse 2.4s ease-out infinite;';
      root.appendChild(pulse);
    }
    var shape = doc.createElement('div');
    shape.style.cssText = 'position:absolute;box-sizing:border-box;left:' + inset + 'px;top:' + inset + 'px;right:' + inset + 'px;bottom:' + inset + 'px;'
      + 'background:' + m.color + ';border:' + (m.glyph === 'pending' ? '2px dashed #fff' : '3px solid #fff') + ';'
      + 'border-radius:' + (diamond ? '5px' : '50%') + ';' + (diamond ? 'transform:rotate(45deg);' : '')
      + 'box-shadow:0 0 14px ' + m.color + ',0 2px 6px rgba(0,0,0,.5);';
    root.appendChild(shape);
    var mark = doc.createElement('div');
    mark.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;'
      + 'color:' + inkOn(m.color) + ';font:700 ' + (endpoint ? 16 : 15) + 'px -apple-system,Roboto,sans-serif;';
    if (m.glyph === 'detected') {
      var ring = doc.createElement('div');
      ring.style.cssText = 'box-sizing:border-box;width:11px;height:11px;border-radius:50%;border:2.5px solid ' + inkOn(m.color) + ';';
      mark.appendChild(ring);
    } else {
      mark.textContent = m.glyph === 'origin' ? 'A' : m.glyph === 'destination' ? 'B' : '!';
    }
    root.appendChild(mark);
    return root;
  }

  function renderMarkers() {
    var seen = {};
    overlay.markers.forEach(function (m) {
      seen[m.id] = true;
      var marker = markers[m.id];
      if (marker && marker.campusColor !== m.color) { marker.remove(); marker = null; }
      if (!marker) {
        var options = { color: m.color, draggable: !!m.draggable };
        if (m.dot) {
          var dot = env.document.createElement('div');
          dot.style.cssText = 'box-sizing:border-box;width:22px;height:22px;border-radius:50%;background:' + m.color + ';border:3.5px solid #fff;'
            + 'box-shadow:0 0 0 1.5px rgba(21,24,41,.55),0 0 0 8px rgba(105,240,209,.22);';
          dot.setAttribute('aria-label', 'Your location');
          options.element = dot;
          options.anchor = 'center';
        } else if (m.glyph) {
          options.element = glyphElement(m);
          options.anchor = 'center';
        }
        marker = new ml.Marker(options);
        marker.campusColor = m.color;
        marker.on('dragstart', function () { marker.campusDragging = true; cameraPaused = true; post({ type: 'gesture' }); });
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
  map.on('movestart', function (event) {
    if (event && event.originalEvent) { cameraPaused = true; post({ type: 'gesture' }); }
  });
  map.on('moveend', postBounds);
  map.on('load', postBounds);
  beginStyle(null);

  return {
    receive: function (message) {
      if (message && message.type === 'camera' && message.camera) {
        var camera = message.camera;
        var recenter = camera.revision !== cameraRevision;
        if (recenter) { cameraRevision = camera.revision; cameraPaused = false; cameraNeedsZoom = true; }
        if (camera.follow && camera.position && !cameraPaused) {
          var target = { center: camera.position, duration: 350 };
          if (cameraNeedsZoom) { target.zoom = Math.max(map.getZoom(), 16); cameraNeedsZoom = false; }
          map.easeTo(target);
        }
      }
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
